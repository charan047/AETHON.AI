import json
import logging
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database.db import AsyncSessionLocal
from database.models import Workflow, WorkflowVersion
from services.websocket_manager import ws_manager


class VersioningService:
    async def create_version(
        self,
        workflow_id: str,
        definition: dict,
        user_id: str | None,
        changelog: str | None = None,
        db: AsyncSession | None = None,
    ) -> WorkflowVersion:
        owns_session = db is None
        if owns_session:
            db = AsyncSessionLocal()

        try:
            max_result = await db.execute(
                select(func.max(WorkflowVersion.version_number)).where(WorkflowVersion.workflow_id == workflow_id)
            )
            next_version = (max_result.scalar() or 0) + 1

            if not changelog:
                previous = await self._get_latest_version(workflow_id, db)
                previous_definition = self._loads(previous.definition) if previous else None
                changelog = await self._generate_changelog(previous_definition, definition)

            version = WorkflowVersion(
                id=str(uuid.uuid4()),
                workflow_id=workflow_id,
                version_number=next_version,
                definition=json.dumps(definition, indent=2, sort_keys=True, default=str),
                changelog=(changelog or "Workflow updated")[:500],
                created_by_user_id=user_id,
            )
            db.add(version)
            await db.flush()
            await self._prune_old_versions(workflow_id, db)
            await db.commit()
            await db.refresh(version)
            return version
        finally:
            if owns_session:
                await db.close()

    async def get_versions(
        self,
        workflow_id: str,
        db: AsyncSession | None = None,
    ) -> list[WorkflowVersion]:
        owns_session = db is None
        if owns_session:
            db = AsyncSessionLocal()

        try:
            result = await db.execute(
                select(WorkflowVersion)
                .where(WorkflowVersion.workflow_id == workflow_id)
                .order_by(WorkflowVersion.version_number.desc())
            )
            return list(result.scalars().all())
        finally:
            if owns_session:
                await db.close()

    async def get_diff(
        self,
        workflow_id: str,
        version_a: int,
        version_b: int,
        db: AsyncSession | None = None,
    ) -> dict:
        owns_session = db is None
        if owns_session:
            db = AsyncSessionLocal()

        try:
            versions = await self._get_versions_by_number(workflow_id, [version_a, version_b], db)
            if version_a not in versions or version_b not in versions:
                raise ValueError("One or both versions were not found")

            definition_a = self._loads(versions[version_a].definition)
            definition_b = self._loads(versions[version_b].definition)
            return self._compute_diff(definition_a, definition_b)
        finally:
            if owns_session:
                await db.close()

    async def rollback(
        self,
        workflow_id: str,
        target_version: int,
        user_id: str,
        db: AsyncSession | None = None,
    ) -> Workflow:
        owns_session = db is None
        if owns_session:
            db = AsyncSessionLocal()

        try:
            result = await db.execute(
                select(WorkflowVersion).where(
                    WorkflowVersion.workflow_id == workflow_id,
                    WorkflowVersion.version_number == target_version,
                )
            )
            version = result.scalar_one_or_none()
            if not version:
                raise ValueError(f"Version {target_version} was not found")

            workflow_result = await db.execute(select(Workflow).where(Workflow.id == workflow_id))
            workflow = workflow_result.scalar_one_or_none()
            if not workflow:
                raise ValueError("Workflow not found")

            definition = self._loads(version.definition)
            self.apply_definition(workflow, definition)
            workflow.updated_at = datetime.utcnow()
            await self.create_version(
                workflow_id=workflow_id,
                definition=self.workflow_to_definition(workflow),
                user_id=user_id,
                changelog=f"Rolled back to v{target_version}",
                db=db,
            )
            await db.refresh(workflow)
            await ws_manager.broadcast(
                {
                    "type": "workflow_rolled_back",
                    "workflow_id": workflow_id,
                    "target_version": target_version,
                }
            )
            return workflow
        finally:
            if owns_session:
                await db.close()

    @staticmethod
    def workflow_to_definition(workflow: Workflow) -> dict:
        return {
            "name": workflow.name,
            "description": workflow.description,
            "nodes": workflow.nodes or [],
            "edges": workflow.edges or [],
            "status": workflow.status,
            "trigger": workflow.trigger,
            "schedule": workflow.schedule,
            "template_id": workflow.template_id,
            "execution_mode": workflow.execution_mode,
            "orchestration_prompt": workflow.orchestration_prompt,
            "max_cycles": workflow.max_cycles,
        }

    @staticmethod
    def apply_definition(workflow: Workflow, definition: dict) -> None:
        for field in (
            "name",
            "description",
            "nodes",
            "edges",
            "status",
            "trigger",
            "schedule",
            "template_id",
            "execution_mode",
            "orchestration_prompt",
            "max_cycles",
        ):
            if field in definition:
                setattr(workflow, field, definition[field])

    async def _get_latest_version(self, workflow_id: str, db: AsyncSession) -> WorkflowVersion | None:
        result = await db.execute(
            select(WorkflowVersion)
            .where(WorkflowVersion.workflow_id == workflow_id)
            .order_by(WorkflowVersion.version_number.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def _get_versions_by_number(
        self,
        workflow_id: str,
        version_numbers: list[int],
        db: AsyncSession,
    ) -> dict[int, WorkflowVersion]:
        result = await db.execute(
            select(WorkflowVersion).where(
                WorkflowVersion.workflow_id == workflow_id,
                WorkflowVersion.version_number.in_(version_numbers),
            )
        )
        return {version.version_number: version for version in result.scalars().all()}

    async def _generate_changelog(self, previous_definition: dict | None, new_definition: dict) -> str:
        if previous_definition is None:
            return "Initial workflow snapshot"

        try:
            from langchain_core.messages import HumanMessage
            from runtime.agent_runner import _extract_text, build_llm

            llm = build_llm(model=settings.default_model, max_tokens=80, temperature=0.1)
            response = await llm.ainvoke(
                [
                    HumanMessage(
                        content=(
                            "In one sentence, describe what changed in this workflow update.\n\n"
                            f"Previous workflow:\n{json.dumps(previous_definition, indent=2)[:6000]}\n\n"
                            f"New workflow:\n{json.dumps(new_definition, indent=2)[:6000]}"
                        )
                    )
                ]
            )
            changelog = _extract_text(response.content).strip()
            if changelog:
                return changelog[:500]
        except Exception as exc:
            logging.getLogger(__name__).warning("Workflow changelog generation failed: %s", exc)

        diff = self._compute_diff(previous_definition, new_definition)
        pieces = []
        if diff["nodes_added"]:
            pieces.append(f"added {len(diff['nodes_added'])} node(s)")
        if diff["nodes_removed"]:
            pieces.append(f"removed {len(diff['nodes_removed'])} node(s)")
        if diff["nodes_modified"]:
            pieces.append(f"changed {len(diff['nodes_modified'])} node(s)")
        if diff["edges_added"] or diff["edges_removed"]:
            pieces.append("updated connections")
        if diff["settings_changed"]:
            pieces.append("updated workflow settings")
        return "Workflow updated: " + ", ".join(pieces) if pieces else "Workflow saved with no structural changes"

    async def _prune_old_versions(self, workflow_id: str, db: AsyncSession) -> None:
        result = await db.execute(
            select(WorkflowVersion.id)
            .where(WorkflowVersion.workflow_id == workflow_id)
            .order_by(WorkflowVersion.version_number.desc())
            .offset(50)
        )
        old_ids = [row[0] for row in result.all()]
        if old_ids:
            await db.execute(delete(WorkflowVersion).where(WorkflowVersion.id.in_(old_ids)))

    def _compute_diff(self, before: dict, after: dict) -> dict:
        before_nodes = {node.get("id"): node for node in before.get("nodes", []) if node.get("id")}
        after_nodes = {node.get("id"): node for node in after.get("nodes", []) if node.get("id")}
        before_edges = {self._edge_key(edge): edge for edge in before.get("edges", [])}
        after_edges = {self._edge_key(edge): edge for edge in after.get("edges", [])}

        node_ids_before = set(before_nodes)
        node_ids_after = set(after_nodes)
        edge_ids_before = set(before_edges)
        edge_ids_after = set(after_edges)
        setting_keys = set(before) | set(after)
        setting_keys -= {"nodes", "edges"}

        return {
            "nodes_added": [after_nodes[node_id] for node_id in sorted(node_ids_after - node_ids_before)],
            "nodes_removed": [before_nodes[node_id] for node_id in sorted(node_ids_before - node_ids_after)],
            "nodes_modified": [
                {
                    "id": node_id,
                    "before": before_nodes[node_id],
                    "after": after_nodes[node_id],
                }
                for node_id in sorted(node_ids_before & node_ids_after)
                if before_nodes[node_id] != after_nodes[node_id]
            ],
            "edges_added": [after_edges[edge_id] for edge_id in sorted(edge_ids_after - edge_ids_before)],
            "edges_removed": [before_edges[edge_id] for edge_id in sorted(edge_ids_before - edge_ids_after)],
            "settings_changed": {
                key: {"before": before.get(key), "after": after.get(key)}
                for key in sorted(setting_keys)
                if before.get(key) != after.get(key)
            },
        }

    @staticmethod
    def _edge_key(edge: dict[str, Any]) -> str:
        return str(edge.get("id") or f"{edge.get('source')}->{edge.get('target')}:{edge.get('label', '')}")

    @staticmethod
    def _loads(payload: str) -> dict:
        loaded = json.loads(payload)
        return loaded if isinstance(loaded, dict) else {}

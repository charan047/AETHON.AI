import asyncio
import os
from datetime import datetime, timezone
from uuid import uuid4

os.environ.setdefault("ANONYMIZED_TELEMETRY", "False")

import chromadb
from chromadb.config import Settings as ChromaSettings
from sentence_transformers import SentenceTransformer

from config import settings


class MemoryService:
    def __init__(self):
        self._client = chromadb.PersistentClient(
            path=settings.chroma_persist_dir,
            settings=ChromaSettings(anonymized_telemetry=False),
        )
        self._collection = self._client.get_or_create_collection(
            name=settings.chroma_collection_name,
            metadata={"hnsw:space": "cosine"},
        )
        # Force CPU embeddings for stability. The default auto-device selection
        # can pick Apple MPS on macOS, which has been crashing worker processes
        # during background workflow execution.
        self._embedding_model = SentenceTransformer(settings.embedding_model, device="cpu")

    async def _encode(self, content: str) -> list[float]:
        embedding = await asyncio.to_thread(self._embedding_model.encode, content)
        return embedding.tolist() if hasattr(embedding, "tolist") else list(embedding)

    @staticmethod
    def _agent_where(agent_id: str) -> dict:
        return {"agent_id": {"$eq": agent_id}}

    @staticmethod
    def _agent_session_where(agent_id: str, session_id: str) -> dict:
        return {
            "$and": [
                {"agent_id": {"$eq": agent_id}},
                {"session_id": {"$eq": session_id}},
            ]
        }

    async def store_memory(
        self,
        agent_id: str,
        session_id: str,
        role: str,
        content: str,
        metadata: dict = {},
    ) -> str:
        embedding = await self._encode(content)
        doc_id = f"{agent_id}_{session_id}_{uuid4()}"
        memory_metadata = {
            "agent_id": agent_id,
            "session_id": session_id,
            "role": role,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            **metadata,
        }

        await asyncio.to_thread(
            self._collection.add,
            documents=[content],
            embeddings=[embedding],
            ids=[doc_id],
            metadatas=[memory_metadata],
        )
        return doc_id

    async def retrieve_relevant_memory(
        self,
        agent_id: str,
        query: str,
        top_k: int = 5,
        session_id: str = None,
    ) -> list[dict]:
        embedding = await self._encode(query)
        where = (
            self._agent_session_where(agent_id, session_id)
            if session_id
            else self._agent_where(agent_id)
        )

        results = await asyncio.to_thread(
            self._collection.query,
            query_embeddings=[embedding],
            n_results=top_k,
            where=where,
        )

        memories = []
        ids = results.get("ids", [[]])[0] or []
        documents = results.get("documents", [[]])[0] or []
        metadatas = results.get("metadatas", [[]])[0] or []
        distances = results.get("distances", [[]])[0] or []

        for doc_id, content, metadata, distance in zip(ids, documents, metadatas, distances):
            memories.append(
                {
                    "content": content,
                    "metadata": metadata or {},
                    "distance": distance,
                    "id": doc_id,
                }
            )

        return sorted(memories, key=lambda item: item["distance"])

    async def get_agent_memory_summary(
        self,
        agent_id: str,
        last_n: int = 20,
    ) -> list[dict]:
        results = await asyncio.to_thread(
            self._collection.get,
            where=self._agent_where(agent_id),
            include=["documents", "metadatas"],
        )

        memories = []
        for content, metadata in zip(results.get("documents", []) or [], results.get("metadatas", []) or []):
            memories.append({"content": content, "metadata": metadata or {}})

        memories.sort(
            key=lambda item: item["metadata"].get("timestamp", ""),
            reverse=True,
        )
        return memories[:last_n]

    async def delete_agent_memory(self, agent_id: str) -> int:
        results = await asyncio.to_thread(
            self._collection.get,
            where=self._agent_where(agent_id),
        )
        ids = results.get("ids", []) or []
        if ids:
            await asyncio.to_thread(self._collection.delete, ids=ids)
        return len(ids)

    async def delete_session_memory(self, agent_id: str, session_id: str) -> int:
        results = await asyncio.to_thread(
            self._collection.get,
            where=self._agent_session_where(agent_id, session_id),
        )
        ids = results.get("ids", []) or []
        if ids:
            await asyncio.to_thread(self._collection.delete, ids=ids)
        return len(ids)

    async def get_memory_stats(self, agent_id: str) -> dict:
        results = await asyncio.to_thread(
            self._collection.get,
            where=self._agent_where(agent_id),
            include=["metadatas"],
        )
        metadatas = results.get("metadatas", []) or []
        timestamps = sorted(
            metadata.get("timestamp")
            for metadata in metadatas
            if metadata and metadata.get("timestamp")
        )
        session_ids = {
            metadata.get("session_id")
            for metadata in metadatas
            if metadata and metadata.get("session_id")
        }

        return {
            "total_memories": len(results.get("ids", []) or []),
            "oldest_memory": timestamps[0] if timestamps else None,
            "newest_memory": timestamps[-1] if timestamps else None,
            "session_count": len(session_ids),
        }

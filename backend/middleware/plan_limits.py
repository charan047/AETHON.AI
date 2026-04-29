from datetime import datetime, timezone

from fastapi.security.utils import get_authorization_scheme_param
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from auth.security import decode_token, verify_password
from database.db import AsyncSessionLocal
from database.models import ApiKey, OrgMember, OrgMemberRole, Organization, User
from services.plan_service import plan_service


class PlanLimitMiddleware(BaseHTTPMiddleware):
    GUARDED_ROUTES = {
        ("POST", "/api/agents"): "agents",
        ("POST", "/api/workflows"): "workflows",
        ("POST", "/api/executions"): "executions",
        ("POST", "/api/tools"): "custom_tools",
        ("POST", "/api/triggers/webhooks"): "webhooks",
        ("POST", "/api/evals/suites"): "eval_suites",
    }

    async def dispatch(self, request: Request, call_next):
        resource = self._resource_for_request(request)
        if not resource:
            return await call_next(request)

        async with AsyncSessionLocal() as db:
            user, preferred_org_id = await self._resolve_user(request, db)
            if not user:
                return await call_next(request)

            org = await self._resolve_org(request, db, user.id, preferred_org_id)
            if not org:
                return JSONResponse(
                    {
                        "detail": "No organization membership found",
                        "code": "organization_required",
                    },
                    status_code=403,
                )

            request.state.user = user
            request.state.org = org
            allowed, message = await plan_service.check_limit(org, resource, db)
            if not allowed:
                plan = org.plan.value if hasattr(org.plan, "value") else str(org.plan)
                return JSONResponse(
                    {
                        "detail": message,
                        "code": "plan_limit_reached",
                        "resource": resource,
                        "current_plan": plan,
                    },
                    status_code=429,
                )

        return await call_next(request)

    def _resource_for_request(self, request: Request) -> str | None:
        path = request.url.path.rstrip("/") or "/"
        route_key = (request.method, path)
        if route_key in self.GUARDED_ROUTES:
            return self.GUARDED_ROUTES[route_key]
        if request.method == "POST" and path.startswith("/api/executions/workflows/") and path.endswith("/run"):
            return "executions"
        return None

    async def _resolve_user(self, request: Request, db: AsyncSession) -> tuple[User | None, str | None]:
        x_api_key = request.headers.get("x-api-key")
        if x_api_key:
            now = datetime.now(timezone.utc)
            result = await db.execute(
                select(ApiKey).where(
                    ApiKey.is_active == True,  # noqa: E712
                    or_(ApiKey.expires_at.is_(None), ApiKey.expires_at > now),
                )
            )
            for api_key in result.scalars().all():
                if verify_password(x_api_key, api_key.key_hash):
                    user = await db.get(User, api_key.user_id)
                    if user and user.is_active:
                        return user, api_key.org_id
            return None, None

        scheme, credentials = get_authorization_scheme_param(request.headers.get("authorization"))
        if scheme.lower() != "bearer" or not credentials:
            return None, None

        try:
            payload = decode_token(credentials)
        except Exception:
            return None, None

        if payload.get("type") != "access" or not payload.get("sub"):
            return None, None

        user = await db.get(User, payload["sub"])
        if not user or not user.is_active:
            return None, None
        return user, None

    async def _resolve_org(
        self,
        request: Request,
        db: AsyncSession,
        user_id: str,
        preferred_org_id: str | None,
    ) -> Organization | None:
        org_id = request.headers.get("x-org-id") or preferred_org_id
        if org_id:
            result = await db.execute(
                select(Organization, OrgMember)
                .join(OrgMember, OrgMember.org_id == Organization.id)
                .where(
                    Organization.id == org_id,
                    Organization.is_active == True,  # noqa: E712
                    OrgMember.user_id == user_id,
                )
            )
        else:
            result = await db.execute(
                select(Organization, OrgMember)
                .join(OrgMember, OrgMember.org_id == Organization.id)
                .where(
                    Organization.is_active == True,  # noqa: E712
                    OrgMember.user_id == user_id,
                )
                .order_by(
                    (OrgMember.role == OrgMemberRole.owner).desc(),
                    OrgMember.joined_at.asc(),
                )
                .limit(1)
            )
        row = result.one_or_none()
        return row[0] if row else None

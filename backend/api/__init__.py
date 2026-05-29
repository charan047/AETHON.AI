from fastapi import APIRouter
from config import settings
from .auth import router as auth_router
from .agents import router as agents_router
from .workflows import router as workflows_router, public_router as public_workflows_router
from .executions import router as executions_router
from .monitoring import router as monitoring_router
from .tools import router as tools_router
from .tools_registry import router as tools_registry_router
from .memory import router as memory_router
from .approvals import router as approvals_router
from .onboarding import router as onboarding_router
from .company import router as company_router
from .business import router as business_router
from .integrations import router as integrations_router
from .feedback import router as feedback_router
from .clients import router as clients_router, portal_router as client_portal_router
from .agency_overview import router as agency_overview_router
from .dashboard import router as dashboard_router
from .company_chat import router as company_chat_router
from .notifications import router as notifications_router
from .triggers import router as triggers_router
from .analytics import router as analytics_router
from .evals import router as evals_router
from .organizations import router as organizations_router
from .marketplace import router as marketplace_router
from .models import public_router as public_models_router
from .models import router as models_router, agent_model_router
from .audit_logs import router as audit_logs_router
from .roles import router as roles_router
from .messages import router as messages_router
from .missions import router as missions_router
from .files import router as files_router
from .org_variables import router as org_variables_router
from .intake import router as intake_router, public_router as public_intake_router
from .search import router as search_router
from .a2a import internal_router as a2a_internal_router
from .system_settings import router as settings_router
if settings.enable_testing_api or settings.environment == "test":
    from .testing import router as testing_router
else:
    testing_router = None

api_router = APIRouter()
api_router.include_router(auth_router)
api_router.include_router(client_portal_router, prefix="/portal", tags=["portal"])
api_router.include_router(agents_router, prefix="/agents", tags=["agents"])
api_router.include_router(workflows_router, prefix="/workflows", tags=["workflows"])
api_router.include_router(public_workflows_router)
api_router.include_router(executions_router, prefix="/executions", tags=["executions"])
api_router.include_router(monitoring_router, prefix="/monitoring", tags=["monitoring"])
api_router.include_router(tools_registry_router, prefix="/tools", tags=["tools-registry"])
api_router.include_router(tools_router, prefix="/tools", tags=["tools"])
api_router.include_router(memory_router, prefix="/memory", tags=["memory"])
api_router.include_router(approvals_router, prefix="/approvals", tags=["approvals"])
api_router.include_router(onboarding_router, prefix="/onboarding", tags=["onboarding"])
api_router.include_router(company_router, prefix="/company", tags=["company"])
api_router.include_router(business_router, prefix="/business", tags=["business"])
api_router.include_router(integrations_router, prefix="/integrations", tags=["integrations"])
api_router.include_router(feedback_router, prefix="/feedback", tags=["feedback"])
api_router.include_router(clients_router, prefix="/clients", tags=["clients"])
api_router.include_router(agency_overview_router, prefix="/agency", tags=["agency"])
api_router.include_router(dashboard_router, prefix="/dashboard", tags=["dashboard"])
api_router.include_router(company_chat_router, prefix="/company", tags=["company-chat"])
api_router.include_router(notifications_router, prefix="/notifications", tags=["notifications"])
api_router.include_router(triggers_router, tags=["triggers"])
api_router.include_router(analytics_router, prefix="/analytics", tags=["analytics"])
api_router.include_router(evals_router, prefix="/evals", tags=["evals"])
api_router.include_router(organizations_router, tags=["organizations"])
api_router.include_router(marketplace_router, prefix="/marketplace", tags=["marketplace"])
api_router.include_router(public_models_router)
api_router.include_router(models_router)
api_router.include_router(agent_model_router)
api_router.include_router(roles_router, prefix="/roles", tags=["roles"])
api_router.include_router(messages_router, prefix="/messages", tags=["messages"])
api_router.include_router(missions_router, tags=["missions"])
api_router.include_router(files_router, prefix="/files", tags=["files"])
api_router.include_router(search_router, prefix="/search", tags=["search"])
api_router.include_router(org_variables_router, prefix="/org", tags=["org-variables"])
api_router.include_router(intake_router, prefix="/intake", tags=["intake"])
api_router.include_router(public_intake_router, prefix="/intake", tags=["intake-public"])
api_router.include_router(a2a_internal_router, prefix="/a2a", tags=["a2a"])
api_router.include_router(settings_router, prefix="/settings", tags=["settings"])
api_router.include_router(audit_logs_router)
if testing_router is not None:
    api_router.include_router(testing_router)

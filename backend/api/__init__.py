from fastapi import APIRouter
from .auth import router as auth_router
from .agents import router as agents_router
from .workflows import router as workflows_router
from .executions import router as executions_router
from .monitoring import router as monitoring_router
from .tools import router as tools_router

api_router = APIRouter()
api_router.include_router(auth_router)
api_router.include_router(agents_router, prefix="/agents", tags=["agents"])
api_router.include_router(workflows_router, prefix="/workflows", tags=["workflows"])
api_router.include_router(executions_router, prefix="/executions", tags=["executions"])
api_router.include_router(monitoring_router, prefix="/monitoring", tags=["monitoring"])
api_router.include_router(tools_router, prefix="/tools", tags=["tools"])

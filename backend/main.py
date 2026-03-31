import logging
import os
import sys
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from src.api.auth import router as auth_router
from src.api.asset import router as project_assets_router
from src.api.billing import router as billing_router
from src.api.project import router as project_core_router
from src.api.media import router as project_media_router
from src.api.storyboard import router as project_storyboard_router
from src.api.series import router as series_router
from src.api.system import router as system_router
from src.api.task import router as task_router
from src.api.tenant_admin import router as tenant_admin_router
from src.worker.task_worker import TaskWorker
from src.common import bootstrap_api_environment
from src.common.log import get_log_dir, setup_logging
from src.common.request_logging import log_request_response

logger = logging.getLogger(__name__)


def get_application_path() -> str:
    if getattr(sys, "frozen", False):
        application_path = sys._MEIPASS
        resources_path = os.path.join(
            os.path.dirname(os.path.dirname(application_path)),
            "Resources",
        )
        if os.path.exists(resources_path) and resources_path not in sys.path:
            sys.path.insert(0, resources_path)
        if application_path not in sys.path:
            sys.path.insert(0, application_path)
        return application_path

    return os.path.dirname(os.path.abspath(__file__))


def bootstrap_runtime() -> None:
    app_dir = get_application_path()
    os.chdir(app_dir)
    setup_logging()
    # 日志统一写入用户数据目录，避免仓库目录再承载运行时状态。
    logger.info("BOOTSTRAP: app_dir=%s log_dir=%s", app_dir, get_log_dir())


def create_app() -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        logger.info("APP: entering lifespan startup")
        bootstrap_api_environment(logging.getLogger(__name__))
        # 统一由主入口托管 worker，当前已经接管 llm/image/video/audio/export 几类长任务。
        task_worker = TaskWorker(queues=["llm", "image", "video", "audio", "export"], poll_interval=2.0)
        task_worker.start_in_thread()
        app.state.task_worker = task_worker
        try:
            yield
        finally:
            logger.info("APP: entering lifespan shutdown")
            task_worker.stop(timeout=5.0)

    app = FastAPI(title="AI Comic Gen API", lifespan=lifespan)
    # 在应用创建时补一条汇总日志，方便确认当前实例已经把哪些核心路由装载进来。
    logger.info("APP: creating FastAPI application instance")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://127.0.0.1:3000",
            "http://localhost:3000",
            "http://127.0.0.1:3001",
            "http://localhost:3001",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition"],
    )

    @app.middleware("http")
    async def request_logging_middleware(request: Request, call_next):
        return await log_request_response(request, call_next)

    app.include_router(auth_router)
    app.include_router(system_router)
    app.include_router(billing_router)
    app.include_router(task_router)
    app.include_router(tenant_admin_router)
    app.include_router(series_router)
    app.include_router(project_core_router)
    app.include_router(project_assets_router)
    app.include_router(project_media_router)
    app.include_router(project_storyboard_router)
    logger.info("APP: routers registered successfully")
    return app


if __name__ == "__main__":
    bootstrap_runtime()
    uvicorn.run(
        create_app(),
        host="127.0.0.1",
        port=17177,
        reload=False,
        log_level="info",
        access_log=False,
    )

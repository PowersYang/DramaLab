import logging
import os
import sys

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.staticfiles import StaticFiles

from src.common import bootstrap_api_environment
from src.common.log import setup_logging
from src.common.request_logging import log_request_response


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

    log_dir = os.path.join("output", "logs")
    os.makedirs(log_dir, exist_ok=True)

    setup_logging(log_file=os.path.join(log_dir, "app.log"))


def create_app() -> FastAPI:
    from src.api.asset import router as project_assets_router
    from src.api.project import router as project_core_router
    from src.api.media import router as project_media_router
    from src.api.storyboard import router as project_storyboard_router
    from src.api.series import router as series_router
    from src.api.system import router as system_router

    app = FastAPI(title="AI Comic Gen API")
    bootstrap_api_environment(logging.getLogger(__name__))

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition"],
    )

    @app.middleware("http")
    async def add_cache_control_header(request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/files/"):
            response.headers["Cache-Control"] = "public, max-age=86400"
        return response

    @app.middleware("http")
    async def request_logging_middleware(request: Request, call_next):
        return await log_request_response(request, call_next)

    app.mount(
        "/files/outputs/videos",
        StaticFiles(directory="output/video"),
        name="files_outputs_videos",
    )
    app.mount(
        "/files/outputs/assets",
        StaticFiles(directory="output/assets"),
        name="files_outputs_assets",
    )
    app.mount("/files/outputs", StaticFiles(directory="output"), name="files_outputs")
    app.mount("/files/videos", StaticFiles(directory="output/video"), name="files_videos")
    app.mount("/files/assets", StaticFiles(directory="output/assets"), name="files_assets")
    app.mount("/files", StaticFiles(directory="output"), name="files")

    app.include_router(system_router)
    app.include_router(series_router)
    app.include_router(project_core_router)
    app.include_router(project_assets_router)
    app.include_router(project_media_router)
    app.include_router(project_storyboard_router)
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

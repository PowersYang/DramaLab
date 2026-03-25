import mimetypes
import logging
import os
import sys
import threading
import time
from datetime import datetime

import uvicorn
import webview
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.staticfiles import StaticFiles
from src.common import bootstrap_api_environment


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


cwd = get_application_path()


# 创建一个同时写入文件和控制台的类
class TeeOutput:
    def __init__(self, file_path, original_stream):
        self.file = open(file_path, 'a', encoding='utf-8')
        self.original = original_stream

    def write(self, message):
        self.file.write(message)
        self.file.flush()
        self.original.write(message)
        self.original.flush()

    def flush(self):
        self.file.flush()
        self.original.flush()

    def isatty(self):
        # 返回原始流的 isatty 状态
        return self.original.isatty() if hasattr(self.original, 'isatty') else False


mimetypes.add_type('text/css', '.css')
mimetypes.add_type('application/javascript', '.js')

def bootstrap_runtime():
    path = os.path.expanduser("~/.lumen-x")
    os.makedirs(path, exist_ok=True)
    os.chdir(path)

    log_dir = os.path.join(path, "logs")
    os.makedirs(log_dir, exist_ok=True)
    log_file = os.path.join(log_dir, "app.log")

    original_stdout = sys.stdout
    original_stderr = sys.stderr
    sys.stdout = TeeOutput(log_file, original_stdout)
    sys.stderr = TeeOutput(log_file, original_stderr)

    from src.utils import setup_logging

    setup_logging(log_file=log_file)


def create_app() -> FastAPI:
    from src.api.asset import router as project_assets_router
    from src.api.project import router as project_core_router
    from src.api.media import router as project_media_router
    from src.api.project_settings import router as project_settings_router
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

    static_dir = os.path.join(cwd, "static")
    if os.path.exists(static_dir):
        app.mount("/static", StaticFiles(directory=static_dir, html=True), name="static")

    app.include_router(system_router)
    app.include_router(series_router)
    app.include_router(project_core_router)
    app.include_router(project_assets_router)
    app.include_router(project_settings_router)
    app.include_router(project_media_router)
    app.include_router(project_storyboard_router)
    return app


app = create_app()


def run_server():
    # 直接传入 app 对象,而非字符串路径
    # 这样可以避免 PyArmor 混淆后字符串导入失败的问题
    # 注意: Windows 不支持 uvloop, 使用默认的 asyncio 事件循环
    uvicorn.run(app,
                host="127.0.0.1",
                port=17177,
                reload=False,
                log_level="info",
                )


def open_webview():
    # 等待服务器启动
    time.sleep(2)

    # 在 Windows 平台上检查并安装 WebView2 Runtime
    if sys.platform == 'win32':
        try:
            from src.utils.webview2_installer import ensure_webview2_runtime
            if not ensure_webview2_runtime():
                print("警告: WebView2 Runtime 未安装或安装失败")
                print("应用可能无法正常运行，请手动安装 Edge WebView2 Runtime")
                print("下载地址: https://developer.microsoft.com/microsoft-edge/webview2/")
                time.sleep(5)  # 给用户时间阅读提示
        except Exception as e:
            print(f"检查 WebView2 Runtime 时出错: {e}")
            print("将尝试继续启动...")

    # 创建 pywebview 窗口
    window = webview.create_window(
        title="LumenX Studio",
        url=f"http://127.0.0.1:17177/static/index.html?timestamp={datetime.now().timestamp()}",
        width=1280,
        height=800,
        resizable=True,
        fullscreen=False,
        min_size=(800, 600)
    )

    # 启动 webview(阻塞式调用)
    if sys.platform == 'win32':
        # gui='edgechromium': 使用 Edge Chromium 引擎(Windows 推荐),替代已弃用的 MSHTML
        webview.start(
            gui='edgechromium',
            private_mode=False,
            storage_path=os.path.expanduser("~/.lumen-x/webview_storage")
        )
    else:
        # private_mode=False: 禁用隐私模式,允许保存 cookies 和 localStorage
        # storage_path: 指定持久化存储路径,确保 localStorage 数据不会丢失
        webview.start(
            private_mode=False,
            storage_path=os.path.expanduser("~/.lumen-x/webview_storage")
        )

    # WebView 关闭后，退出整个进程
    os._exit(0)


if __name__ == "__main__":
    bootstrap_runtime()

    # 在后台线程启动服务器
    server_thread = threading.Thread(target=run_server, daemon=True)
    server_thread.start()

    # 在主线程打开 WebView
    open_webview()

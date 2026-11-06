from contextlib import asynccontextmanager
import logging
import os

from fastapi import FastAPI, Request
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse

from .api.routes import router
from .core.config import Settings
from .core.instance import single_engine
from .database.store import Store
from .services.jobs import Jobs


def create_app(settings=None, transcriber=None, ollama=None):
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app):
        logging.getLogger('uvicorn.error').info('ClipForge PID %s: Ollama %s at %s; data directory %s; device preference %s',
                                                os.getpid(), settings.ollama_model, settings.ollama_url, settings.data_dir, settings.device)
        with single_engine(settings.data_dir):
            app.state.settings = settings
            app.state.store = Store(settings.data_dir)
            app.state.store.recover()
            app.state.jobs = Jobs(settings, app.state.store, transcriber, ollama)
            try:
                yield
            finally:
                app.state.jobs.shutdown()

    app = FastAPI(title='ClipForge Local Engine', version='0.2.0', lifespan=lifespan)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=['127.0.0.1', 'localhost', 'testserver'])

    @app.middleware('http')
    async def local_origin(request: Request, call_next):
        # Same-origin Vite proxy is the browser entry point; block drive-by web requests.
        origin = request.headers.get('origin')
        if origin and origin not in {'http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:4173', 'http://localhost:4173', 'http://127.0.0.1:8000', 'http://localhost:8000'}:
            return JSONResponse({'detail': 'Only the local ClipForge interface is allowed.'}, status_code=403)
        return await call_next(request)

    app.include_router(router)
    return app


app = create_app()

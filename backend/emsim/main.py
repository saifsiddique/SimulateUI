"""FastAPI app (context.md M0). Serves the API and, in production, the built frontend."""

from __future__ import annotations

import importlib.metadata as md
import mimetypes
import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .api import abtem, bloch, incostem, jobs, specimen, structure, system

FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"

# Python takes MIME types from the Windows registry, where `.js` is often "text/plain" (set by
# editors and other software). Browsers refuse to run ES-module scripts with that type, which
# shows as a completely blank page. Declare the types the built frontend needs explicitly.
for _ext, _type in {
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".wasm": "application/wasm",
    ".json": "application/json",
    ".map": "application/json",
}.items():
    mimetypes.add_type(_type, _ext)


def _version(pkg: str) -> str | None:
    try:
        return md.version(pkg)
    except md.PackageNotFoundError:
        return None


def _warm_up() -> None:
    """Import abTEM and run the GPU smoke test in the background, so the first requests are fast
    (importing abTEM takes ~6 s, the GPU smoke test ~10 s)."""
    try:
        import abtem.atoms  # noqa: F401

        from .services import hardware

        if hardware.gpu_info()["available"]:
            hardware.abtem_gpu_smoke_test()
    except Exception:  # never prevent the server from starting
        pass


@asynccontextmanager
async def lifespan(_: FastAPI):
    from .services import bloch_sim

    # Temporary solves of a program that crashed are removed at start; ours at exit.
    bloch_sim.purge_cache_dir()
    threading.Thread(target=_warm_up, name="warm-up", daemon=True).start()
    yield
    from .services import jobs as job_service

    job_service.manager.shutdown()
    bloch_sim.CACHE.clear()
    bloch_sim.purge_cache_dir()


app = FastAPI(title="SimulateUI", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        f"http://{host}:{port}"
        for host in ("localhost", "127.0.0.1")
        for port in (os.environ.get("EMSIM_DEV_PORT", "5273"), "4273")
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "versions": {
            name: _version(pkg)
            for name, pkg in {
                "abtem": "abtem",
                "ase": "ase",
                "h5py": "h5py",
                "numpy": "numpy",
                "dask": "dask",
                "cupy": "cupy",
                "fastapi": "fastapi",
            }.items()
        },
    }


app.include_router(system.router, prefix="/api")
app.include_router(structure.router, prefix="/api")
app.include_router(specimen.router, prefix="/api")
app.include_router(abtem.router, prefix="/api")
app.include_router(bloch.router, prefix="/api")
app.include_router(incostem.router, prefix="/api")
app.include_router(jobs.router, prefix="/api")

if FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")

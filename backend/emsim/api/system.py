from __future__ import annotations

from fastapi import APIRouter

from ..services import estimate as est
from ..services import hardware

router = APIRouter(tags=["system"])


@router.get("/system")
def get_system(refresh: bool = False) -> dict:
    """CPU/GPU report plus the recommended device. `refresh=true` repeats the GPU smoke test."""
    if refresh:
        hardware.abtem_gpu_smoke_test(force=True)
    return hardware.system_report()


@router.post("/estimate", response_model=est.EstimateResponse)
def post_estimate(req: est.EstimateRequest) -> est.EstimateResponse:
    return est.estimate(req)

"""Memory and time estimates for simulations (context.md M1).

Rough, deliberately conservative models. They are meant to warn before a run, and are calibrated
against measured peaks in later modules (M6).
"""

from __future__ import annotations

import math
from typing import Literal

from pydantic import BaseModel, Field

C64 = 8  # bytes, complex64
F32 = 4  # bytes, float32

TARGET_BATCH_BYTES = 256 * 1024**2


class EstimateRequest(BaseModel):
    gpts: tuple[int, int] = Field(description="Simulation grid (x, y), pixels")
    n_slices: int = Field(ge=1)
    frozen_phonons: int = Field(default=1, ge=1)
    scan_positions: int = Field(default=1, ge=1, description="1 for plane-wave methods")
    detector_shape: tuple[int, int] | None = Field(
        default=None, description="Stored diffraction pattern size (4D-STEM / CBED), pixels"
    )
    n_detectors: int = Field(default=0, ge=0, description="Integrating detectors (STEM images)")
    save_exit_wave: bool = False
    device: Literal["gpu", "cpu"] = "cpu"
    workers: int = Field(default=1, ge=1)
    batch: int | None = Field(default=None, ge=1, description="Waves per batch; auto if None")


class EstimateResponse(BaseModel):
    wave_bytes: int
    batch: int
    peak_bytes: int  # per worker (or on the GPU)
    total_peak_bytes: int  # all workers together
    output_bytes: int
    seconds: float
    note: str


def estimate(req: EstimateRequest) -> EstimateResponse:
    nx, ny = req.gpts
    n = nx * ny
    wave = n * C64

    if req.batch is not None:
        batch = min(req.batch, req.scan_positions)
    else:
        batch = max(1, min(req.scan_positions, TARGET_BATCH_BYTES // (3 * wave)))

    # A batch needs the waves, an FFT work copy and the propagated result; the potential and the
    # transmission function of the current and the next slice are held in addition.
    per_worker = batch * wave * 3 + 2 * n * (F32 + C64) + 2 * wave
    total = per_worker * (1 if req.device == "gpu" else req.workers)

    output = 0
    if req.detector_shape is not None:
        output += req.scan_positions * req.detector_shape[0] * req.detector_shape[1] * F32
    output += req.n_detectors * req.scan_positions * F32
    if req.save_exit_wave:
        output += req.scan_positions * wave

    # Two FFTs per slice per wave, ~5 N log2 N flops each; a measured-throughput guess.
    flops = req.scan_positions * req.frozen_phonons * req.n_slices * 2 * 5 * n * math.log2(max(n, 2))
    throughput = 4e10 if req.device == "gpu" else 4e9 * req.workers
    seconds = flops / throughput

    return EstimateResponse(
        wave_bytes=wave,
        batch=int(batch),
        peak_bytes=int(per_worker),
        total_peak_bytes=int(total),
        output_bytes=int(output),
        seconds=float(seconds),
        note="Rough estimate (within a factor of ~2 for memory; time is order-of-magnitude).",
    )

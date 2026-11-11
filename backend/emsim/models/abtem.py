"""Request for an abTEM parameter preview (context.md M4)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

SimType = Literal["hrtem", "saed", "cbed", "stem", "4dstem"]


class DetectorModel(BaseModel):
    name: str
    inner: float = 0.0
    outer: float | None = None


class AbtemPreviewRequest(BaseModel):
    specimenId: str
    sim_type: SimType = "stem"
    energy_kv: float = Field(default=200.0, gt=0, le=2000)
    sampling: float = Field(default=0.05, gt=0, le=1)
    slice_thickness: float = Field(default=1.0, gt=0, le=20)
    semiangle_mrad: float = Field(default=20.0, ge=0, le=300)
    defocus: float = 0.0
    cs_mm: float = 0.0
    c5_mm: float = 0.0
    # Further aberrations by abTEM name (C12, phi12, C21, ...): magnitudes in Å, angles in radians.
    # They are added to the defocus, `cs_mm` and `c5_mm` above (the latter two for older callers).
    aberrations: dict[str, float] = {}
    # HRTEM objective aperture (mrad); None = no aperture. Recorded for M6 and drawn in the UI.
    objective_aperture_mrad: float | None = None
    scan_step: float | None = None
    scan_fov: tuple[float, float, float, float] | None = None
    fov_margin: float | None = None
    pattern_size: int = Field(default=128, ge=16, le=1024)
    # Pixels of the pattern summed into one; the saved pattern has pattern_size // binning pixels.
    binning: int = Field(default=1, ge=1, le=64)
    phonons: int = Field(default=1, ge=1, le=200)
    # Frozen-phonon displacement sigma (Å) by element symbol (abTEM's `sigmas`); used when
    # `phonons` > 1. M6 passes it to FrozenPhonons.
    phonon_sigmas: dict[str, float] = {}
    # Thickness series: depths (Å) at which to keep output as well as the exit surface. Empty
    # means the exit surface only; M6 does the saving.
    thicknesses: list[float] = Field(default=[], max_length=1000)
    # Defocus series (Å, abTEM's sign): one run per value. Empty = the single `defocus` above.
    defocus_series: list[float] = Field(default=[], max_length=1000)
    # Tilt series (diffraction types): (tilt x, tilt y) in mrad, one run per pair. Empty = no tilt.
    tilt_series: list[tuple[float, float]] = Field(default=[], max_length=10000)
    detectors: list[DetectorModel] = []
    device: Literal["cpu", "gpu"] = "cpu"
    workers: int = Field(default=1, ge=1)

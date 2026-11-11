"""Request for an INCOSTEM image (context.md §7.MU step U6)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class NoiseModel(BaseModel):
    """Electron counting noise: counts = Poisson(I x current x dwell time / e)."""

    current_pa: float = Field(gt=0, le=1e6)
    dwell_us: float = Field(gt=0, le=1e7)
    seed: int = 0


class IncostemRequest(BaseModel):
    specimenId: str
    energy_kv: float = Field(default=200.0, gt=0, le=2000)
    semiangle_mrad: float = Field(default=20.0, gt=0, le=300)
    # abTEM's sign: positive is underfocus (C10 = -defocus), Å. Cs and C5 in mm.
    defocus: float = 0.0
    cs_mm: float = 0.0
    c5_mm: float = 0.0
    # Further aberrations by abTEM name (C12, phi12, C21, ...): magnitudes in Å, angles in radians.
    aberrations: dict[str, float] = {}
    # Gaussian source (FWHM, Å) and defocus spread (FWHM, Å).
    source_fwhm: float = Field(default=0.0, ge=0, le=20)
    defocus_spread_fwhm: float = Field(default=0.0, ge=0, le=2000)
    adf_min_mrad: float = Field(default=50.0, ge=0, le=3000)
    adf_max_mrad: float = Field(default=200.0, gt=0, le=3000)
    parametrization: Literal["kirkland", "lobato"] = "kirkland"
    # Pixel size of the image (Å); the box is a whole number of pixels, so it is adjusted a little.
    pixel_size: float = Field(default=0.1, gt=0, le=5)
    # Exact pixels of the whole box (nx, ny) instead of `pixel_size`.
    grid: tuple[int, int] | None = None
    # Field of view [x0, y0, w, h] in Å; None = the whole box.
    fov: tuple[float, float, float, float] | None = None
    noise: NoiseModel | None = None
    device: Literal["cpu", "gpu"] = "cpu"

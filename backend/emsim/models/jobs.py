"""Request to run a simulation as a job (context.md M6)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class JobRequest(BaseModel):
    method: Literal["multislice", "bloch", "incostem"]
    # The request body of the method's preview (`/api/abtem/preview`, `/api/bloch/preview`,
    # `/api/incostem`): it carries the `specimenId` (multislice, INCOSTEM) or the `structureId`
    # and `zoneAxis` (Bloch). A Bloch run adds `thicknesses`.
    body: dict[str, Any]
    # Runs are stored under projects/<project>/<method>/.
    project: str = Field(default="default", max_length=120)
    name: str = Field(default="", max_length=120)


class Dose(BaseModel):
    """The electrons of the run. HRTEM takes a dose per area; every other type a current and a time
    (the dwell time per position for STEM and 4D-STEM, the exposure for a pattern)."""

    dose_per_area: float | None = Field(default=None, gt=0, description="e-/Å² (HRTEM)")
    # Electrons per scan position (STEM, 4D-STEM, INCOSTEM) or in the pattern (SAED, CBED).
    electrons: float | None = Field(default=None, gt=0)
    current_pa: float | None = Field(default=None, gt=0)
    time_us: float | None = Field(default=None, gt=0)


class DetectorSettings(BaseModel):
    """Post-processing of a finished run (context.md M6.5): pixel size, blur, dose, shot noise."""

    pixel_mode: Literal["native", "target"] = "native"
    # Å for images, mrad for diffraction patterns.
    target: float = Field(default=0.1, gt=0)
    # Standard deviation of a Gaussian blur, in the unit of the pixel size (0 = none).
    smoothing: float = Field(default=0.0, ge=0)
    dose: Dose | None = None
    noise: bool = False
    samples: int = Field(default=1, ge=1, le=100)
    seed: int = 0

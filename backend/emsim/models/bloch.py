"""Bloch-wave preview request (context.md M5). The crystal is the registered unit cell, not the
specimen supercell: Bloch waves are solved for the periodic crystal along a zone axis."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class BlochPreviewRequest(BaseModel):
    structureId: str
    zoneAxis: tuple[float, float, float]
    energy_kv: float = Field(default=200.0, gt=0, le=2000)
    k_max: float = Field(default=2.0, gt=0.2, le=5)
    sg_max: float = Field(default=0.02, gt=0, le=1)
    sim_type: Literal["saed", "cbed", "lacbed"] = "saed"
    alpha_mrad: float = Field(default=4.0, ge=0, le=100)
    pixel_size: float = Field(default=0.02, ge=0.002, le=0.2)
    # Debye-Waller sigma (Å): one number, or by element symbol.
    thermal_sigma: float | dict[str, float] | None = None
    thicknesses: list[float] = []
    # Processes that share the incident directions of a CBED or LACBED solve (estimate only).
    workers: int = Field(default=1, ge=1, le=256)


class BlochFactorsRequest(BaseModel):
    structureId: str
    zoneAxis: tuple[float, float, float]
    energy_kv: float = Field(default=200.0, gt=0, le=2000)
    g_max: float = Field(default=5.0, gt=0.5, le=6)
    # Higher-order Laue zones are listed when they lie within this of the Ewald sphere.
    sg_cap: float = Field(default=0.1, gt=0, le=1)
    thermal_sigma: float | dict[str, float] | None = None

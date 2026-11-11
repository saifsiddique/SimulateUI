"""Result records of runs made by earlier versions (context.md M8): what they did not store is
worked out again from the run's own `project.json`, so that every stored run can still be shown,
processed and exported.

Bloch CBED and LACBED runs made before 2026-11-11 do not record their pixel size in mrad, and
LACBED runs not their normalisation (the number of incident directions).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def upgrade(results_dir: Path, r: dict[str, Any]) -> dict[str, Any]:
    """The record `r` with the missing calibration filled in (a new dict; `r` is not changed)."""
    if r.get("kind") not in ("pattern", "discs") or r.get("pixel_mrad"):
        return r
    try:
        body = json.loads((results_dir.parent / "project.json").read_text(encoding="utf8"))["body"]
    except (OSError, ValueError, KeyError):
        return r
    if "pixel_size" not in body:
        return r
    from .bloch_sim import energy2wavelength

    lam = energy2wavelength(float(body.get("energy_kv", 200.0)) * 1e3)
    out = dict(r)
    out["pixel_inv_a"] = float(body["pixel_size"])
    out["pixel_mrad"] = [float(body["pixel_size"]) * lam * 1e3] * 2
    if r["kind"] == "discs" and not r.get("normalisation"):
        from . import discs

        mask = discs.load(results_dir / r["file"])["mask"]
        if mask is not None:
            out["normalisation"] = int(mask.sum())
    return out

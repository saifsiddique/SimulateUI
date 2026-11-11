"""The LACBED discs of a Bloch run on disk (context.md M5, M7).

`lacbed.npz` holds one array per beam, named by its Miller indices (`"0_0_0"`, `"-1_2_0"`), each
`(depth, y, x)`-ordered like the pattern, so that `z["0_0_0"]` is the disc of the direct beam, a
stack over the thicknesses (a single thickness gives `(1, D, D)`). The same file also has `hkl`
(n, 3), `thicknesses` (Å) and `mask` (the pixels the discs cover). Files of earlier runs have one
array `discs[beam, depth, ...]` instead; `load` reads both.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np

META = ("hkl", "thicknesses", "mask")


def name(h) -> str:
    """The array name of a beam: its indices joined by underscores."""
    return "_".join(str(int(v)) for v in h)


def load(path: Path) -> dict[str, Any]:
    """`{"hkl": [(h, k, l), ...], "discs": {(h, k, l): (depth, D, D)}, "thicknesses", "mask"}`."""
    with np.load(path) as z:  # closed again at once: Windows cannot delete an open file
        hkl = [tuple(int(v) for v in h) for h in np.asarray(z["hkl"])]
        if "discs" in z.files:  # the first layout
            stack = np.asarray(z["discs"])
            discs = {h: stack[i] for i, h in enumerate(hkl)}
        else:
            discs = {h: np.asarray(z[name(h)]) for h in hkl}
        thick = np.asarray(z["thicknesses"])
        mask = np.asarray(z["mask"]) if "mask" in z.files else None
    return {"hkl": hkl, "discs": discs, "thicknesses": thick, "mask": mask}


def save(path: Path, hkl, discs: dict, thicknesses, mask=None, **extra: np.ndarray) -> None:
    arrays = {name(h): np.asarray(discs[tuple(h)]) for h in hkl}
    np.savez(path, hkl=np.array([list(h) for h in hkl], dtype=int),
             thicknesses=np.asarray(thicknesses, dtype=float),
             **({"mask": mask} if mask is not None else {}), **arrays, **extra)


def ranges(hkl) -> dict[str, list[int]]:
    """The smallest and largest h, k and l of the beams."""
    a = np.asarray(list(hkl), dtype=int).reshape(-1, 3)
    return {ax: [int(a[:, i].min()), int(a[:, i].max())] for i, ax in enumerate("hkl")}

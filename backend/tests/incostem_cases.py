"""The reference cases of the INCOSTEM validation (context.md §7.MU step U6).

`scripts/compare_incostem.py` runs the original incostem program on each case and saves its images
and cross sections in `fixtures/incostem_computem.npz`; `test_incostem.py` compares our result with
them. Both build the same atoms from this file.

Every atom of a case sits exactly on the centre of a pixel: the original program places an atom on
a pixel by interpolating in x but truncating in y, so a comparison is only meaningful when no
position needs rounding. (The images of ours are interpolated in both directions, which is exact
here.)
"""

from __future__ import annotations

import numpy as np
from ase import Atoms

#: Every atom is put this far (Å) above its pixel centre in y. The original truncates y to a pixel,
#: and an atom exactly on a pixel centre can fall into the pixel below through float rounding; with
#: the nudge (0.01 pixel) the truncation is unambiguous and our bilinear placement leaks only 1 %.
Y_SAFE = 0.002

# one cell of Si [110] (the cell of the original program's si110.xyz): a x b x c in Å and the atoms
SI_CELL = (3.83959, 5.43, 3.83959)
SI_ATOMS = [(14, 0.0, 0.0, 0.0), (14, 0.0, 1.3575, 1.91979), (14, 1.91979, 2.715, 1.91979),
            (14, 1.91979, 4.0725, 3.83959)]
# one cell of SrTiO3 [001]
STO_CELL = (3.9051, 3.9051, 3.9051)
STO_ATOMS = [(38, 0.0, 0.0, 0.0), (8, 1.95255, 1.95255, 0.0), (22, 1.95255, 1.95255, 1.95255),
             (8, 1.95255, 0.0, 1.95255), (8, 0.0, 1.95255, 1.95255)]

#: probe = (kV, Cs3 mm, Cs5 mm, defocus Å, α mrad); adf = (inner, outer) mrad
CASES: dict[str, dict] = {
    "si110_a10": dict(kind="lattice", cell=SI_CELL, atoms=SI_ATOMS, ncell=(8, 6, 1), grid=(128, 96),
                      probe=(200, 1.3, 0.0, 0.0, 10.0), adf=(50, 200)),
    "si110_aberrations": dict(kind="lattice", cell=SI_CELL, atoms=SI_ATOMS, ncell=(8, 6, 1), grid=(128, 96),
                              probe=(200, 0.5, 0.0, 40.0, 20.0), adf=(70, 250), source=0.4, dfspread=30.0,
                              aber=(("C12a", 1e-5), ("C12b", -2e-5), ("C32a", 1e-3))),
    "si110_300kv": dict(kind="lattice", cell=SI_CELL, atoms=SI_ATOMS, ncell=(8, 6, 1), grid=(192, 192),
                        probe=(300, 0.001, 0.0, -30.0, 25.0), adf=(60, 220)),
    "srtio3_001": dict(kind="lattice", cell=STO_CELL, atoms=STO_ATOMS, ncell=(6, 6, 2), grid=(96, 96),
                       probe=(200, 1.0, 0.0, 30.0, 21.0), adf=(80, 300), source=0.3),
}
# one atom on pixel (40, 40) of a 128 x 128 grid of 0.2 Å pixels
ONE_BOX = 25.6
ONE_GRID = (128, 128)
ONE_PIXEL = (40, 40)
SINGLE = {
    "one_plain": dict(probe=(200, 0.0, 0.0, 0.0, 20.0), adf=(50, 200)),
    "one_cs_defocus": dict(probe=(200, 1.3, 2.0, -50.0, 20.0), adf=(50, 200)),
    "one_source_spread": dict(probe=(200, 1.3, 0.0, 50.0, 20.0), adf=(50, 200), source=0.6, dfspread=60.0),
    "one_even_aber": dict(probe=(300, 0.3, 0.0, 30.0, 25.0), adf=(60, 220),
                          aber=(("C12a", 1e-5), ("C12b", -2e-5), ("C32a", 1e-3), ("C34b", 5e-3))),
    # odd-order terms: the original's probe is the point inversion of abTEM's (see below)
    "one_odd_c21": dict(probe=(200, 0.0, 0.0, 0.0, 20.0), adf=(50, 200), aber=(("C21a", 1e-4),), odd=True),
    "one_odd_c23": dict(probe=(200, 0.0, 0.0, 0.0, 20.0), adf=(50, 200), aber=(("C23b", 1e-4),), odd=True),
    "one_odd_mix": dict(probe=(200, 0.0, 0.0, 0.0, 20.0), adf=(50, 200),
                        aber=(("C21a", 1e-4), ("C12a", 2e-5), ("C45b", 0.5)), odd=True),
    # an atom 0.4 pixel off a pixel centre in x only (the original interpolates in x)
    "one_subpixel_x": dict(probe=(200, 0.0, 0.0, 0.0, 20.0), adf=(50, 200), dx_frac=0.4),
}
#: cross sections: element, kV, (inner, outer) mrad
SIGMAS = [(z, kv, adf) for z in (6, 8, 14, 22, 38, 79) for kv, adf in ((200, (50, 200)), (300, (30, 120)))]


def abtem_aberrations(aber) -> dict[str, float]:
    """The original's `C12a`, `C12b`, ... (mm) as abTEM's magnitude (Å) and angle (rad)."""
    parts: dict[str, list[float]] = {}
    for name, value in aber:
        ab = parts.setdefault(name[:3], [0.0, 0.0])
        ab[0 if name[3] == "a" else 1] = value
    out = {}
    for key, (a, b) in parts.items():
        m = int(key[2])
        out[key] = float(np.hypot(a, b)) * 1e7
        out["phi" + key[1:]] = float(np.arctan2(b, a) / m)
    return out


def cell_atoms(case: dict) -> list[tuple[int, float, float, float]]:
    """The atoms of one cell as given to the original program (nudged, see `Y_SAFE`)."""
    return [(z, x, y + Y_SAFE, zz) for z, x, y, zz in case["atoms"]]


def lattice_atoms(case: dict) -> Atoms:
    a, b, c = case["cell"]
    nx, ny, nz = case["ncell"]
    pos, num = [], []
    for i in range(nx):
        for j in range(ny):
            for k in range(nz):
                for z, x, y, zz in cell_atoms(case):
                    num.append(z)
                    pos.append((x + i * a, y + j * b, zz + k * c))
    return Atoms(numbers=num, positions=pos, cell=[nx * a, ny * b, nz * c], pbc=True)


def single_atom(z: int = 14, dx_frac: float = 0.0) -> Atoms:
    d = ONE_BOX / ONE_GRID[0]
    return Atoms(numbers=[z], positions=[((ONE_PIXEL[0] + dx_frac) * d, ONE_PIXEL[1] * d + Y_SAFE, 1.0)],
                 cell=[ONE_BOX, ONE_BOX, 2.0], pbc=True)


def point_invert(a: np.ndarray, centre: tuple[int, int] = ONE_PIXEL) -> np.ndarray:
    """The image turned about a pixel (r -> -r), periodic."""
    nx, ny = a.shape
    return a[np.ix_((2 * centre[0] - np.arange(nx)) % nx, (2 * centre[1] - np.arange(ny)) % ny)]

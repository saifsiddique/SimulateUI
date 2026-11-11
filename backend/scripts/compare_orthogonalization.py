"""Compare our orthogonal-cell search with abTEM's route for a set of zone axes (context.md M3).

Run from `backend/`:  python scripts/compare_orthogonalization.py
For each case: the smallest cell within 0.2% strain (or the least strained within the atom budget)
from our search, against abTEM's `orthogonalize_cell` after rotating the zone axis onto z, with
max_repetitions = 1, 2, 3, 5, 8 (5 is abTEM's default).
"""

from __future__ import annotations

import json
import sys
import time
import warnings
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
warnings.filterwarnings("ignore")

from emsim.models.structure import StructurePayload  # noqa: E402
from emsim.services import specimen as sp  # noqa: E402
from emsim.services import structure as st  # noqa: E402

PAYLOADS = Path(__file__).resolve().parents[2] / "frontend" / "tests" / "fixtures" / "payloads"

CASES = [
    ("Si", [0, 0, 1]), ("Si", [1, 1, 0]), ("Si", [1, 1, 1]), ("Si", [1, 1, 2]),
    ("graphite", [0, 0, 1]), ("graphite", [1, 0, 0]), ("graphite", [2, 1, 0]),
    ("rutile", [0, 0, 1]), ("rutile", [1, 0, 1]), ("rutile", [1, 1, 1]),
    ("ZrO2_baddeleyite", [1, 0, 0]), ("ZrO2_baddeleyite", [0, 1, 0]),
    ("ZrO2_baddeleyite", [0, 0, 1]), ("ZrO2_baddeleyite", [1, 1, 0]),
    ("albite", [0, 0, 1]), ("albite", [1, 0, 0]), ("albite", [1, 1, 0]),
    ("olivine_partial", [1, 1, 0]), ("olivine_partial", [1, 0, 1]),
]


def atoms(name):
    return st.build_atoms(StructurePayload(**json.loads((PAYLOADS / f"{name}.json").read_text())))


def run(max_repeat_atoms=2000, tolerance=0.002):
    rows = []
    for name, u in CASES:
        a = atoms(name)
        t0 = time.time()
        r = sp.build(a, u, lateral=(1, 1), thickness=1, strain_tolerance=tolerance,
                     max_repeat_atoms=max_repeat_atoms, occupancy="keep")
        dt = time.time() - t0
        R = np.array(r["rotation"])
        cands = sp.search_cells(a.cell.array, R, sp.reduce_indices(u), len(a),
                                max_repeat_atoms=20000)
        ab = sp.abtem_comparison(a, R, 20000)
        ok = [x for x in ab if "strain" in x]
        ab5 = next((x for x in ok if x["max_repetitions"] == 5), None)
        abbest = min(ok, key=lambda x: x["strain"]) if ok else None

        def ours_at(n):
            s = [c["strain"] for c in cands if c["natoms"] <= n]
            return min(s) if s else None

        rows.append({
            "case": f"{name} {u}",
            "ours_atoms": r["natoms_repeat"], "ours_strain": r["strain"]["max_abs"],
            "ours_cell": [round(x, 2) for x in r["repeat_cell"]], "seconds": round(dt, 2),
            "abtem5_atoms": ab5 and ab5["natoms"], "abtem5_strain": ab5 and ab5["strain"],
            "abtem5_tilt": ab5 and ab5["zone_axis_tilt_deg"],
            "ours_at_abtem5": ab5 and ours_at(ab5["natoms"]),
            "abtem_best_atoms": abbest and abbest["natoms"],
            "abtem_best_strain": abbest and abbest["strain"],
            "abtem_best_tilt": abbest and abbest["zone_axis_tilt_deg"],
            "ours_at_abtem_best": abbest and ours_at(abbest["natoms"]),
        })
    return rows


if __name__ == "__main__":
    rows = run()
    fmt = ("{:26s} {:>5} {:>8} {:>22} | {:>5} {:>8} {:>6} {:>8} | {:>5} {:>8} {:>6} {:>8}")
    print(fmt.format("case", "ours", "strain", "repeat cell (A)", "ab5 n", "strain", "tilt",
                     "ours@n", "best n", "strain", "tilt", "ours@n"))
    for r in rows:
        f = lambda x: "-" if x is None else f"{x:.1e}"  # noqa: E731
        g = lambda x: "-" if x is None else f"{x:.2f}"  # noqa: E731
        print(fmt.format(r["case"], r["ours_atoms"], f(r["ours_strain"]), str(r["ours_cell"]),
                         str(r["abtem5_atoms"]), f(r["abtem5_strain"]), g(r["abtem5_tilt"]),
                         f(r["ours_at_abtem5"]), str(r["abtem_best_atoms"]),
                         f(r["abtem_best_strain"]), g(r["abtem_best_tilt"]),
                         f(r["ours_at_abtem_best"])))
    print("strain = max |principal stretch - 1|; tilt = zone-axis tilt in degrees caused by "
          "abTEM's map (ours: always 0); ours@n = our least strain with at most n atoms.")

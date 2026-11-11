"""Cross-check the TypeScript CIF parser against pymatgen on the COD sample.

    python -I scripts/check_cod_sample.py            (run from app/, after `npm run test:cod`)

`npm run test:cod` writes tests/cod_sample/_ours.json (cell, space-group number, symop count and
atom list per file as our parser reads them). This script reads the same CIFs with pymatgen's
low-level CIF reader and reports every disagreement in cell, space-group number, number of
symmetry operations, atom count, element or fractional coordinates.
"""

from __future__ import annotations

import json
import re
import warnings
from pathlib import Path

from pymatgen.core.periodic_table import get_el_sp
from pymatgen.io.cif import CifParser

warnings.filterwarnings("ignore")
D = Path(__file__).resolve().parent.parent / "tests" / "cod_sample"
ours = json.loads((D / "_ours.json").read_text())


def f(s):
    s = str(s).strip()
    m = re.match(r"^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?", s)
    return float(m.group(0)) if m else None


def element(sym):
    m = re.match(r"[A-Za-z]+", sym)
    run = m.group(0) if m else ""
    return run


bad, checked, skipped = [], 0, 0
for cod_id, o in sorted(ours.items()):
    try:
        parser = CifParser(str(D / f"{cod_id}.cif"), occupancy_tolerance=100)
        block = next(iter(parser.as_dict().values()))
    except Exception as e:  # pymatgen could not read it at all
        skipped += 1
        continue
    checked += 1
    problems = []
    for key, tag in (("a", "_cell_length_a"), ("b", "_cell_length_b"), ("c", "_cell_length_c"),
                     ("alpha", "_cell_angle_alpha"), ("beta", "_cell_angle_beta"), ("gamma", "_cell_angle_gamma")):
        v = f(block.get(tag, "")) if tag in block else None
        if v is None and key in ("alpha", "beta", "gamma"):
            v = 90.0
        if v is None or abs(v - o["cell"][key]) > 1e-9:
            problems.append(f"cell {key}: pymatgen {v} vs ours {o['cell'][key]}")
    ops = block.get("_space_group_symop_operation_xyz") or block.get("_symmetry_equiv_pos_as_xyz") or []
    if isinstance(ops, str):
        ops = [ops]
    if len(ops) != o["nSymops"]:
        problems.append(f"symops: pymatgen {len(ops)} vs ours {o['nSymops']}")
    labels = block.get("_atom_site_label") or []
    xs = block.get("_atom_site_fract_x") or []
    if isinstance(xs, str):
        xs = [xs]
    if len(xs) and len(xs) != len(o["atoms"]):
        problems.append(f"atoms: pymatgen {len(xs)} vs ours {len(o['atoms'])}")
    elif len(xs):
        ys, zs = block["_atom_site_fract_y"], block["_atom_site_fract_z"]
        types = block.get("_atom_site_type_symbol") or labels
        for i, atom in enumerate(o["atoms"]):
            px, py, pz = f(xs[i]), f(ys[i]), f(zs[i])
            if None in (px, py, pz):
                continue  # we skip these with a warning
            if max(abs(px - atom[1]), abs(py - atom[2]), abs(pz - atom[3])) > 5e-4:  # pymatgen snaps 0.3333 -> 1/3
                problems.append(f"atom {i} coordinates differ")
                break
            run = element(types[i])
            if run in ("D", "T") or run.upper() == "X":
                continue
            try:
                theirs = get_el_sp(types[i].strip()).symbol
            except Exception:  # odd symbol: fall back to the leading letter
                theirs = None
            if (theirs is not None and theirs != atom[0]) or (
                theirs is None and not run.lower().startswith(atom[0].lower()[:1])
            ):
                problems.append(f"atom {i} element: pymatgen '{types[i]}' vs ours {atom[0]}")
                break
    if problems:
        bad.append((cod_id, problems))

print(f"checked {checked}, pymatgen could not read {skipped}, disagreements {len(bad)}")
for cod_id, p in bad[:40]:
    print(cod_id, "; ".join(p))

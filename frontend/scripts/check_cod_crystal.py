"""Cross-check the TypeScript unit-cell builder against pymatgen + spglib on the COD sample.

    python -I scripts/check_cod_crystal.py            (run from app/, after `npm run test:cod`)

Compares, per file: number of unit-cell positions (pymatgen merges sites within 0.01 A, the same
rule we use), per-element weighted counts, the number of space-group operations, and the
space-group number spglib detects against the one we report. Differences are listed by category;
most come from files whose declared symmetry is wrong or whose partial occupancies pymatgen
rounds, so the interesting number is how many remain unexplained.
"""

from __future__ import annotations

import json
import warnings
from collections import Counter
from pathlib import Path

from pymatgen.core import Structure
from pymatgen.io.cif import CifParser
from pymatgen.symmetry.analyzer import SpacegroupAnalyzer

warnings.filterwarnings("ignore")
D = Path(__file__).resolve().parent.parent / "tests" / "cod_sample"
ours = json.loads((D / "_crystal.json").read_text())

stats = Counter()
details: dict[str, list[str]] = {}
for cod_id, o in sorted(ours.items()):
    try:
        parser = CifParser(str(D / f"{cod_id}.cif"), occupancy_tolerance=100)
        structs = parser.parse_structures(primitive=False)
        s: Structure = structs[0]
    except Exception:
        stats["pymatgen unreadable"] += 1
        continue
    stats["compared"] += 1
    issues = []
    if len(s) != o["nPositions"]:
        issues.append(f"positions pymatgen {len(s)} vs ours {o['nPositions']}")
    counts = {}
    for site in s:
        for sp, occ in site.species.items():
            counts[sp.symbol] = counts.get(sp.symbol, 0) + occ
    for el in set(counts) | set(o["counts"]):
        a, b = counts.get(el, 0), o["counts"].get(el, 0)
        if abs(a - b) > 0.02 * max(1, a):
            issues.append(f"count {el}: pymatgen {a:.3f} vs ours {b:.3f}")
            break
    try:
        sga = SpacegroupAnalyzer(s, symprec=1e-3)
        if sga.get_space_group_number() != o["sg"]:
            issues.append(f"sg spglib {sga.get_space_group_number()} vs ours {o['sg']}")
    except Exception:
        stats["spglib failed"] += 1
    if issues:
        stats["differences"] += 1
        details[cod_id] = issues

print(dict(stats))
cats = Counter(i.split(" ")[0] + " " + i.split(" ")[1].rstrip(":") for v in details.values() for i in v)
print(cats)
for cod_id, v in list(details.items())[:30]:
    print(cod_id, "; ".join(v))

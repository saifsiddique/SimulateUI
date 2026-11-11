"""Generate reference fixtures for the CrystalLens unit tests.

Run offline and rarely; the outputs under tests/fixtures/ are committed so CI needs neither
Python nor network access.

    conda activate s-em                      # needs pymatgen + spglib
    python -I scripts/make_fixtures.py --fetch   # download any missing CIFs from COD, then generate
    python -I scripts/make_fixtures.py           # regenerate the JSON from the committed CIFs

Run it from the app/ directory. `-I` keeps the working directory off sys.path because the CIFs
are downloaded (untrusted) data.

What is stored (all frame-independent unless noted; pymatgen's Cartesian frame has c || z, which
differs from context.md section 5.2, so Cartesian matrices are recomputed here in the 5.2 frame):
  cell, volume, metric tensor G and reciprocal metric G* = inv(G)
  matrix_standard / recip_matrix_standard  (a || x, b in xy-plane; columns = vectors)
  declared and detected (spglib) space group, number of symmetry operations
  unit-cell atoms (pymatgen's de-duplicated list), per-element weighted counts
  reflections for |h|,|k|,|l| <= 3: d-spacing and |F|^2 (X-ray, no Debye-Waller)
  Weiss-zone reflection lists for zone axes [001], [110], [111]
  zero-order Laue zone electron-diffraction spots for [001] and [110] at 200 kV
  (pymatgen TEMCalculator: hkl, d, normalised kinematic intensity)
  powder pattern (Cu Ka, 10-90 deg 2theta) from pymatgen's XRDCalculator

|F|^2 uses pymatgen's scattering table (ITC electron parameters converted with Mott-Bethe), the
same one XRDCalculator uses. It differs by about 1% from Waasmaier-Kirfel (context.md M4), so
tests comparing against it need a tolerance of ~2%, not 1e-3.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
import urllib.request
from importlib.metadata import version as pkg_version
from itertools import product
from pathlib import Path

import numpy as np
import spglib
from pymatgen.analysis.diffraction.tem import TEMCalculator
from pymatgen.analysis.diffraction.xrd import ATOMIC_SCATTERING_PARAMS, XRDCalculator
from pymatgen.core import Element
from pymatgen.io.cif import CifParser
from pymatgen.symmetry.analyzer import SpacegroupAnalyzer

ROOT = Path(__file__).resolve().parent.parent
CIF_DIR = ROOT / "tests" / "fixtures" / "cifs"
JSON_DIR = ROOT / "tests" / "fixtures" / "json"

# name -> (COD id, what it exercises)
FIXTURES: dict[str, tuple[int, str]] = {
    "Si": (9008565, "cubic diamond, Fd-3m origin choice 1 (':1'), AMCSD-style CIF"),
    "NaCl": (1000041, "cubic rock salt, Fm-3m, older ICSD-style CIF tags"),
    "rutile": (9004141, "tetragonal P42/mnm, atoms on special positions"),
    "graphite": (9011577, "hexagonal P63/mmc, gamma=120; [110] is parallel to the (110) normal, [100] is not to (100)"),
    "ZrO2_baddeleyite": (9007485, "monoclinic P21/c, beta != 90"),
    "albite": (9000525, "triclinic, declared in centred setting C-1; the only fixture where legacy v6 sin(gamma) bug changes the matrix"),
    "olivine_partial": (9006875, "orthorhombic Pbnm, Mg/Fe mixed occupancy (<1)"),
}

HKL_MAX = 3
ZONE_AXES = [(0, 0, 1), (1, 1, 0), (1, 1, 1)]
WAVELENGTH_NAME = "CuKa"
TWO_THETA_RANGE = (10.0, 90.0)
TEM_VOLTAGE_KV = 200
TEM_ZONE_AXES = [(0, 0, 1), (1, 1, 0)]


def fetch_cif(name: str, cod_id: int) -> None:
    dest = CIF_DIR / f"{name}.cif"
    if dest.exists():
        return
    url = f"https://www.crystallography.net/cod/{cod_id}.cif"
    print(f"  fetching {url}")
    with urllib.request.urlopen(url, timeout=90) as response:
        text = response.read().decode("utf-8", errors="replace")
    if not re.search(r"^data_", text, re.M):
        raise RuntimeError(f"{url} did not return a CIF")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(text, encoding="utf-8", newline="\n")


def r(x: float) -> float:
    """Round to 10 significant digits so regenerated files do not churn."""
    return float(f"{float(x):.10g}")


def standard_matrix(a, b, c, alpha, beta, gamma) -> np.ndarray:
    """Columns a, b, c with a || x and b in the xy-plane (context.md 5.2)."""
    al, be, ga = (math.radians(t) for t in (alpha, beta, gamma))
    cx = c * math.cos(be)
    cy = c * (math.cos(al) - math.cos(be) * math.cos(ga)) / math.sin(ga)
    cz = math.sqrt(c * c - cx * cx - cy * cy)
    return np.array(
        [[a, b * math.cos(ga), cx], [0.0, b * math.sin(ga), cy], [0.0, 0.0, cz]]
    )


def scattering_factor(symbol: str, s2: float) -> float:
    """X-ray f(s) exactly as pymatgen's XRDCalculator computes it."""
    z = Element(symbol).Z
    coeff = np.array(ATOMIC_SCATTERING_PARAMS[symbol])
    return z - 41.78214 * s2 * float(np.sum(coeff[:, 0] * np.exp(-coeff[:, 1] * s2)))


def structure_factor_sq(structure, lattice, hkl) -> float:
    d = lattice.d_hkl(hkl)
    s2 = (1.0 / (2.0 * d)) ** 2
    total = 0j
    for site in structure:
        phase = 2j * math.pi * float(np.dot(site.frac_coords, hkl))
        for el, occ in site.species.items():
            total += scattering_factor(el.symbol, s2) * float(occ) * np.exp(phase)
    return float(abs(total) ** 2)


def build_fixture(name: str, cod_id: int, note: str) -> dict:
    cif_path = CIF_DIR / f"{name}.cif"
    raw = cif_path.read_bytes()
    parser = CifParser(str(cif_path))
    structure = parser.parse_structures(primitive=False)[0]
    lat = structure.lattice
    a, b, c = lat.abc
    alpha, beta, gamma = lat.angles

    g = lat.matrix @ lat.matrix.T  # G_ij = a_i . a_j, independent of the Cartesian frame
    g_star = np.linalg.inv(g)
    m_std = standard_matrix(a, b, c, alpha, beta, gamma)
    # Self-consistency: the independent numpy matrix must reproduce pymatgen's metric tensor.
    assert np.allclose(m_std.T @ m_std, g, atol=1e-9), f"{name}: standard matrix disagrees"
    b_std = np.linalg.inv(m_std).T  # columns a*, b*, c*

    sga = SpacegroupAnalyzer(structure, symprec=1e-3)
    block = next(iter(parser.as_dict().values()))
    declared_number = block.get("_space_group_IT_number") or block.get("_symmetry_Int_Tables_number")
    declared_hm = (
        block.get("_space_group_name_H-M_alt") or block.get("_symmetry_space_group_name_H-M")
    )

    atoms = []
    for site in structure:
        species = {el.symbol: r(occ) for el, occ in site.species.items()}
        frac = [r(x % 1.0 if abs(x % 1.0 - 1.0) > 1e-8 else 0.0) for x in site.frac_coords]
        atoms.append({"species": species, "frac": frac})
    atoms.sort(key=lambda t: (sorted(t["species"]), t["frac"]))

    counts: dict[str, float] = {}
    for atom in atoms:
        for el, occ in atom["species"].items():
            counts[el] = counts.get(el, 0.0) + occ

    reflections = []
    for hkl in product(range(-HKL_MAX, HKL_MAX + 1), repeat=3):
        if hkl == (0, 0, 0):
            continue
        reflections.append(
            [*hkl, r(lat.d_hkl(hkl)), r(structure_factor_sq(structure, lat, hkl))]
        )

    zones = {
        " ".join(map(str, uvw)): [
            " ".join(map(str, row[:3]))
            for row in reflections
            if row[0] * uvw[0] + row[1] * uvw[1] + row[2] * uvw[2] == 0
        ]
        for uvw in ZONE_AXES
    }

    # Zero-order Laue zone spots per zone axis from pymatgen's kinematic TEMCalculator. Screen
    # positions are omitted (pymatgen's in-plane frame is arbitrary); hkl, d and the intensity
    # (pymatgen normalises to its own maximum) are frame-independent. Its electron scattering
    # factors differ from M4's Lobato parameterisation, so compare intensities with a tolerance.
    tem_zones = {}
    for uvw in TEM_ZONE_AXES:
        calc = TEMCalculator(beam_direction=uvw, voltage=TEM_VOLTAGE_KV)
        zolz = calc.zone_axis_filter(calc.generate_points(-HKL_MAX, HKL_MAX))
        spots = sorted(
            [*map(int, dot.hkl), r(dot.d_spacing), r(dot.intensity)]
            for dot in calc.tem_dots(structure, zolz)
            if tuple(dot.hkl) != (0, 0, 0)
        )
        tem_zones[" ".join(map(str, uvw))] = spots
    tem_wavelength = TEMCalculator(voltage=TEM_VOLTAGE_KV).wavelength_rel()

    pattern = XRDCalculator(wavelength=WAVELENGTH_NAME).get_pattern(
        structure, scaled=True, two_theta_range=TWO_THETA_RANGE
    )
    peaks = [
        {
            "two_theta": r(x),
            "intensity": r(y),
            "d": r(d),
            "hkls": [{"hkl": list(map(int, h["hkl"])), "m": int(h["multiplicity"])} for h in hkls],
        }
        for x, y, hkls, d in zip(pattern.x, pattern.y, pattern.hkls, pattern.d_hkls)
    ]

    return {
        "name": name,
        "note": note,
        "source": {
            "cod_id": cod_id,
            "cif": f"cifs/{name}.cif",
            "sha256": hashlib.sha256(raw).hexdigest(),
        },
        "generator": {"pymatgen": pkg_version("pymatgen"), "spglib": spglib.__version__},
        "cell": {
            "a": r(a), "b": r(b), "c": r(c),
            "alpha": r(alpha), "beta": r(beta), "gamma": r(gamma),
        },
        "volume": r(lat.volume),
        "metric": [[r(v) for v in row] for row in g],
        "recip_metric": [[r(v) for v in row] for row in g_star],
        "matrix_standard": [[r(v) for v in row] for row in m_std],
        "recip_matrix_standard": [[r(v) for v in row] for row in b_std],
        "space_group": {
            "declared_number": int(declared_number) if declared_number else None,
            "declared_hm": declared_hm,
            "detected_number": int(sga.get_space_group_number()),
            "detected_symbol": sga.get_space_group_symbol(),
            "crystal_system": sga.get_crystal_system(),
            "n_operations": len(sga.get_symmetry_operations()),
        },
        "unit_cell": {
            "n_sites": len(atoms),
            "counts": {el: r(n) for el, n in sorted(counts.items())},
            "atoms": atoms,
        },
        "reflections": {"hkl_max": HKL_MAX, "columns": ["h", "k", "l", "d", "F2"], "rows": reflections},
        "zones": zones,
        "tem": {
            "voltage_kV": TEM_VOLTAGE_KV,
            "wavelength": r(tem_wavelength),
            "columns": ["h", "k", "l", "d", "I"],
            "zones": tem_zones,
        },
        "pxrd": {
            "wavelength_name": WAVELENGTH_NAME,
            "wavelength": r(XRDCalculator(wavelength=WAVELENGTH_NAME).wavelength),
            "two_theta_range": list(TWO_THETA_RANGE),
            "peaks": peaks,
        },
    }


def dump(obj: dict, path: Path) -> None:
    text = json.dumps(obj, indent=1, ensure_ascii=False)
    # Keep arrays of plain numbers on one line so diffs stay readable.
    text = re.sub(
        r"\[\s*([-+0-9.eE,\s]+?)\s*\]",
        lambda m: "[" + re.sub(r"\s+", " ", m.group(1)) + "]",
        text,
    )
    path.write_text(text + "\n", encoding="utf-8", newline="\n")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--fetch", action="store_true", help="download missing CIFs from COD first")
    args = ap.parse_args()

    JSON_DIR.mkdir(parents=True, exist_ok=True)
    for name, (cod_id, note) in FIXTURES.items():
        print(f"{name} (COD {cod_id})")
        if args.fetch:
            fetch_cif(name, cod_id)
        if not (CIF_DIR / f"{name}.cif").exists():
            print(f"  missing CIF; rerun with --fetch", file=sys.stderr)
            return 1
        fixture = build_fixture(name, cod_id, note)
        dump(fixture, JSON_DIR / f"{name}.json")
        sg = fixture["space_group"]
        print(
            f"  SG {sg['detected_number']} ({sg['detected_symbol']}), "
            f"{fixture['unit_cell']['n_sites']} sites, {len(fixture['pxrd']['peaks'])} PXRD peaks"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

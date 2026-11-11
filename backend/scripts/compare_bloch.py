"""Compare Bloch-wave results: py4DSTEM vs abTEM `BlochWaves` vs emsim.services.bloch_sim.

py4DSTEM 0.14.x needs numpy < 2, while our engine targets abTEM >= 1.0.11 (numpy >= 2), so the
two cannot share an environment any more. Run from `backend/`:

    # in a throwaway env: python=3.12 "numpy<2" py4dstem==0.14.18 ase
    python scripts/compare_bloch.py --fixtures-only
        -> writes tests/fixtures/bloch_py4dstem.npz (py4DSTEM results only)

    # full comparison (used once, 2026-10-27, in an env with py4DSTEM + abTEM 1.0.5)
    python scripts/compare_bloch.py [--write-fixtures]

The test suite (tests/test_bloch.py) checks our engine against the saved fixtures.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import warnings
from pathlib import Path

import numpy as np
from ase import Atoms
from ase.build import bulk

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
warnings.filterwarnings("ignore")

bloch_sim = None  # imported in main() unless --fixtures-only

ENERGY = 200e3
THICK = np.array([50.0, 100.0, 200.0, 400.0, 800.0])
K_MAX = 2.0


def rutile() -> Atoms:
    a, c, u = 4.594, 2.959, 0.3048
    frac = [(0, 0, 0), (0.5, 0.5, 0.5), (u, u, 0), (1 - u, 1 - u, 0),
            (0.5 + u, 0.5 - u, 0.5), (0.5 - u, 0.5 + u, 0.5)]
    return Atoms("Ti2O4", scaled_positions=frac, cell=[a, a, c], pbc=True)


CASES = {
    "Si_110": (bulk("Si", "diamond", a=5.431, cubic=True), (1, 1, 0)),
    "Si_111": (bulk("Si", "diamond", a=5.431, cubic=True), (1, 1, 1)),
    "TiO2_001": (rutile(), (0, 0, 1)),
}


def py4dstem_saed(atoms, za, sigma_sg=0.02):
    from py4DSTEM.process.diffraction import Crystal

    xt = Crystal.from_ase(atoms)
    xt.calculate_dynamical_structure_factors(
        ENERGY, "Lobato", k_max=2 * K_MAX, thermal_sigma=None, tol_structure_factor=0.0
    )
    beams = xt.generate_diffraction_pattern(
        zone_axis_lattice=np.array(za), sigma_excitation_error=sigma_sg,
        tol_excitation_error_mult=3, tol_intensity=0.0, k_max=K_MAX,
    )
    pls = xt.generate_dynamical_diffraction_pattern(
        beams, thickness=THICK, zone_axis_lattice=np.array(za), always_return_list=True
    )
    hkl = np.stack([beams.data["h"], beams.data["k"], beams.data["l"]], 1).astype(int)
    inten = np.stack([p.data["intensity"] for p in pls])
    return xt, beams, hkl, inten


def match(hkl_a, I_a, hkl_b, I_b):
    """Intensities of beams present in both lists, (t, n_common) each, plus the hkl list."""
    ib = {tuple(h): i for i, h in enumerate(hkl_b)}
    common = [(i, ib[tuple(h)]) for i, h in enumerate(hkl_a) if tuple(h) in ib]
    ia, jb = np.array(common).T
    return I_a[:, ia], I_b[:, jb], hkl_a[ia]


def metrics(Ia, Ib, floor=1e-3):
    strong = np.maximum(Ia, Ib) > floor
    diff = np.abs(Ia - Ib)
    return {
        "max_abs_diff": float(diff.max()),
        "max_rel_diff_strong": float((diff[strong] / np.maximum(Ia, Ib)[strong]).max()),
        "n_strong": int(strong.sum()),
    }


def compare_saed(name, atoms, za):
    out = {}
    t0 = time.time()
    xt, beams, hkl_p, I_p = py4dstem_saed(atoms, za)
    out["py4dstem_seconds"] = time.time() - t0
    out["n_beams_py4dstem"] = len(hkl_p)

    # py4DSTEM has k0 along -z, abTEM (and we) along +z: py4DSTEM's beam g is our beam -g.
    # (1) Same beam list -> isolates the physics (structure factors, matrix, propagation).
    t0 = time.time()
    setup = bloch_sim.prepare(atoms, za, ENERGY, k_max=K_MAX, hkl=-hkl_p)
    sp = bloch_sim.saed(setup, THICK)
    out["emsim_seconds"] = time.time() - t0
    Ie, Ip, hkl_c = match(-sp.hkl, sp.intensity, hkl_p, I_p)
    out["same_beams"] = metrics(Ie, Ip)

    # (2) Each code's own beam selection (same k_max, comparable sg_max).
    setup2 = bloch_sim.prepare(atoms, za, ENERGY, k_max=K_MAX, sg_max=0.06)
    sp2 = bloch_sim.saed(setup2, THICK)
    Ie, Ip, _ = match(-sp2.hkl, sp2.intensity, hkl_p, I_p)
    out["own_beams"] = {"n_beams_emsim": setup2.num_beams, **metrics(Ie, Ip, floor=1e-2)}

    # (3) abTEM's own BlochWaves with the same beams' orientation (cross-check of our solver).
    from abtem.bloch.dynamical import BlochWaves, StructureFactor

    sf = StructureFactor(atoms, k_max=2.2 * K_MAX, parametrization="lobato")
    bw = BlochWaves(sf, ENERGY, sg_max=0.06, k_max=K_MAX, orientation_matrix=setup2.rotation)
    dp = bw.calculate_diffraction_patterns(list(THICK), lazy=False)
    I_a = np.asarray(dp.array)
    I_a = I_a.get() if hasattr(I_a, "get") else I_a
    hkl_a = np.asarray(dp.miller_indices)
    Ie, Ia, _ = match(sp2.hkl, sp2.intensity, hkl_a, I_a)
    out["emsim_vs_abtem_blochwaves"] = {"n_beams_abtem": len(hkl_a), **metrics(Ie, Ia)}

    Ie, Ip, hkl_c = match(-sp.hkl, sp.intensity, hkl_p, I_p)
    worst = np.argsort(-np.abs(Ie - Ip).max(axis=0))[:4]
    out["largest_differences"] = [
        {"hkl": hkl_c[i].tolist(),
         "py4dstem": Ip[:, i].round(5).tolist(), "emsim": Ie[:, i].round(5).tolist()}
        for i in worst
    ]
    return out, (hkl_p, I_p)


def compare_cbed(atoms, za, alpha_mrad=4.0, pixel=0.02, thick=(400.0,)):
    from py4DSTEM.process.diffraction import Crystal

    xt = Crystal.from_ase(atoms)
    xt.calculate_dynamical_structure_factors(
        ENERGY, "Lobato", k_max=2 * K_MAX, thermal_sigma=None, tol_structure_factor=0.0
    )
    beams = xt.generate_diffraction_pattern(
        zone_axis_lattice=np.array(za), sigma_excitation_error=0.02,
        tol_excitation_error_mult=3, tol_intensity=0.0, k_max=K_MAX,
    )
    t0 = time.time()
    lac_p = xt.generate_CBED(
        beams, thickness=list(thick), alpha_mrad=alpha_mrad, pixel_size_inv_A=pixel,
        zone_axis_lattice=np.array(za), LACBED=True, progress_bar=False,
    )
    tp = time.time() - t0
    hkl_p = np.stack([beams.data["h"], beams.data["k"], beams.data["l"]], 1).astype(int)

    t0 = time.time()
    res = bloch_sim.cbed(atoms, za, ENERGY, alpha_mrad, list(thick), pixel, k_max=K_MAX,
                         lacbed=True, hkl=-hkl_p)
    te = time.time() - t0

    lac0 = lac_p[0] if isinstance(lac_p, list) else lac_p
    strongest = sorted(lac0, key=lambda k: -float(np.mean(lac0[k])))[:8]
    out = {"py4dstem_seconds": tp, "emsim_seconds": te, "n_tilts": int(res.mask.sum()),
           "discs": {}}
    for key in strongest:
        p = np.asarray(lac0[key])
        best = None
        # py4DSTEM has k0 along -z: its disc g may be our disc g or -g, mirrored. Try both
        # beams and the 8 flips/transposes; report the best match.
        for sign in (1, -1):
            ekey = tuple(sign * v for v in key)
            if ekey not in res.discs:
                continue
            e = res.discs[ekey][0]
            n = min(p.shape[0], e.shape[0])
            pp, ee = p[:n, :n], e[:n, :n]
            for tr in (False, True):
                for fx in (False, True):
                    for fy in (False, True):
                        q = ee.T if tr else ee
                        q = q[::-1] if fx else q
                        q = q[:, ::-1] if fy else q
                        msk = (pp > 0) & (q > 0)
                        if msk.sum() < 10:
                            continue
                        corr = float(np.corrcoef(pp[msk], q[msk])[0, 1])
                        rel = float(np.abs(pp[msk] - q[msk]).max() / max(pp[msk].max(), 1e-12))
                        if best is None or corr > best["corr"]:
                            best = {"corr": corr, "max_diff_rel_to_peak": rel, "sign": sign,
                                    "transform": [tr, fx, fy],
                                    "mean_py4dstem": float(pp[msk].mean()),
                                    "mean_emsim": float(q[msk].mean())}
        out["discs"][str(key)] = best
    return out, (np.array(strongest), lac0)


def write_fixtures(fixtures):
    path = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "bloch_py4dstem.npz"
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(path, thicknesses=THICK, energy=ENERGY, k_max=K_MAX, **fixtures)
    print(f"wrote {path}")


def fixtures_only():
    fixtures = {}
    for name, (atoms, za) in CASES.items():
        _, _, hkl, inten = py4dstem_saed(atoms, za)
        fixtures[f"{name}_hkl"], fixtures[f"{name}_I"] = hkl, inten
    atoms, za = CASES["Si_110"]
    xt, beams, _, _ = py4dstem_saed(atoms, za)
    lac = xt.generate_CBED(beams, thickness=[400.0], alpha_mrad=4.0, pixel_size_inv_A=0.02,
                           zone_axis_lattice=np.array(za), LACBED=True, progress_bar=False)
    lac0 = lac[0] if isinstance(lac, list) else lac
    strongest = sorted(lac0, key=lambda k: -float(np.mean(lac0[k])))[:8]
    fixtures["Si_110_lacbed_hkl"] = np.array(strongest)
    for key in strongest:
        fixtures[f"Si_110_lacbed_{key[0]}_{key[1]}_{key[2]}"] = np.asarray(lac0[key])
    write_fixtures(fixtures)


def main():
    global bloch_sim
    ap = argparse.ArgumentParser()
    ap.add_argument("--write-fixtures", action="store_true")
    ap.add_argument("--fixtures-only", action="store_true")
    args = ap.parse_args()
    if args.fixtures_only:
        fixtures_only()
        return
    from emsim.services import bloch_sim as _b

    bloch_sim = _b
    report = {}
    fixtures = {}
    for name, (atoms, za) in CASES.items():
        report[name], (hkl, I) = compare_saed(name, atoms, za)
        fixtures[f"{name}_hkl"] = hkl
        fixtures[f"{name}_I"] = I
    report["Si_110_LACBED"], (hkl, lac0) = compare_cbed(*CASES["Si_110"])
    fixtures["Si_110_lacbed_hkl"] = hkl
    for key in hkl:
        fixtures[f"Si_110_lacbed_{key[0]}_{key[1]}_{key[2]}"] = np.asarray(lac0[tuple(key)])
    print(json.dumps(report, indent=1))
    if args.write_fixtures:
        write_fixtures(fixtures)


if __name__ == "__main__":
    main()

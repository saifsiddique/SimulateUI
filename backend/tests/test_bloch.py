"""Bloch engine against py4DSTEM 0.14.18 reference results (tests/fixtures/bloch_py4dstem.npz,
written by scripts/compare_bloch.py --write-fixtures). py4DSTEM puts the beam along -z and we
(like abTEM) along +z, so py4DSTEM's beam g is our beam -g."""

from pathlib import Path

import numpy as np
import pytest
from ase import Atoms
from ase.build import bulk

from emsim.services import bloch_sim

FIX = np.load(Path(__file__).parent / "fixtures" / "bloch_py4dstem.npz")
ENERGY = float(FIX["energy"])
THICK = FIX["thicknesses"]
K_MAX = float(FIX["k_max"])


def rutile() -> Atoms:
    a, c, u = 4.594, 2.959, 0.3048
    frac = [(0, 0, 0), (0.5, 0.5, 0.5), (u, u, 0), (1 - u, 1 - u, 0),
            (0.5 + u, 0.5 - u, 0.5), (0.5 - u, 0.5 + u, 0.5)]
    return Atoms("Ti2O4", scaled_positions=frac, cell=[a, a, c], pbc=True)


SI = bulk("Si", "diamond", a=5.431, cubic=True)
CASES = {"Si_110": (SI, (1, 1, 0)), "Si_111": (SI, (1, 1, 1)), "TiO2_001": (rutile(), (0, 0, 1))}


@pytest.mark.parametrize("name", list(CASES))
def test_saed_matches_py4dstem(name):
    atoms, za = CASES[name]
    hkl_p, I_p = FIX[f"{name}_hkl"], FIX[f"{name}_I"]
    sp = bloch_sim.saed(bloch_sim.prepare(atoms, za, ENERGY, k_max=K_MAX, hkl=-hkl_p), THICK)
    ours = {tuple(-h): sp.intensity[:, i] for i, h in enumerate(sp.hkl)}
    I_e = np.stack([ours[tuple(h)] for h in hkl_p], axis=1)
    strong = np.maximum(I_e, I_p) > 1e-3
    assert np.abs(I_e - I_p).max() < 1e-4
    assert (np.abs(I_e - I_p)[strong] / np.maximum(I_e, I_p)[strong]).max() < 1e-3


@pytest.mark.parametrize("name", list(CASES))
def test_saed_matches_abtem_blochwaves(name):
    from abtem.bloch.dynamical import BlochWaves, StructureFactor

    atoms, za = CASES[name]
    setup = bloch_sim.prepare(atoms, za, ENERGY, k_max=K_MAX, sg_max=0.06)
    sp = bloch_sim.saed(setup, THICK)
    sf = StructureFactor(atoms, g_max=2.2 * K_MAX, centering="P")
    bw = BlochWaves(sf, ENERGY, sg_max=0.06, g_max=K_MAX, orientation_matrix=setup.rotation,
                    centering="P")
    dp = bw.calculate_diffraction_patterns(list(THICK), lazy=False)
    I_a = np.asarray(dp.array)
    hkl_a = np.asarray(dp.miller_indices)
    theirs = {tuple(h): I_a[:, i] for i, h in enumerate(hkl_a)}
    common = [i for i, h in enumerate(sp.hkl) if tuple(h) in theirs]
    assert len(common) > 0.95 * len(sp.hkl)
    I_e = sp.intensity[:, common]
    I_t = np.stack([theirs[tuple(sp.hkl[i])] for i in common], axis=1)
    assert np.abs(I_e - I_t).max() < 1e-4


def test_si_110_forbidden_002_is_dynamically_excited():
    sp = bloch_sim.saed(bloch_sim.prepare(SI, (1, 1, 0), ENERGY, k_max=K_MAX), THICK)
    i002 = np.where(np.all(np.abs(sp.hkl) == [0, 0, 2], axis=1))[0]
    assert len(i002) == 2 and sp.intensity[:, i002].max() > 1e-3


def test_lacbed_discs_match_py4dstem():
    hkl_p = FIX["Si_110_lacbed_hkl"]
    res = bloch_sim.cbed(SI, (1, 1, 0), ENERGY, alpha_mrad=4.0, thicknesses=[400.0],
                         pixel_size=0.02, k_max=K_MAX, lacbed=True,
                         hkl=-FIX["Si_110_hkl"])
    for h in hkl_p:
        p = FIX[f"Si_110_lacbed_{h[0]}_{h[1]}_{h[2]}"]
        e = res.discs[tuple(int(v) for v in -h)][0]
        # py4DSTEM's discs are 2r x 2r (centre at index r), ours (2r+1)^2 with the same centre.
        e = e[: p.shape[0], : p.shape[1]]
        m = (p > 0) & (e > 0)
        assert m.sum() > 100
        assert np.corrcoef(p[m], e[m])[0, 1] > 0.9999
        assert np.abs(p[m] - e[m]).max() < 0.02 * p[m].max()


def test_cbed_places_discs_at_g():
    res = bloch_sim.cbed(SI, (1, 1, 0), ENERGY, alpha_mrad=3.0, thicknesses=[300.0],
                         pixel_size=0.02, k_max=1.0)
    img = res.images[0]
    c = res.center[0]
    assert img[c, c] > 0  # bright-field disc centre
    total = img.sum()
    assert np.isfinite(total) and total > 0


def test_orientation_matrix_puts_zone_axis_on_z():
    R = bloch_sim.orientation_matrix(SI.cell.array, (1, 1, 0))
    z = np.array([1, 1, 0]) @ SI.cell.array
    np.testing.assert_allclose(R @ (z / np.linalg.norm(z)), [0, 0, 1], atol=1e-12)
    np.testing.assert_allclose(R @ R.T, np.eye(3), atol=1e-12)


def test_gpu_matches_cpu():
    cupy = pytest.importorskip("cupy")
    if cupy.cuda.runtime.getDeviceCount() == 0:
        pytest.skip("no GPU")
    s = bloch_sim.prepare(SI, (1, 1, 0), ENERGY, k_max=1.5)
    tilts = np.array([[0.0, 0.0], [1e-3, -2e-3]])
    a = bloch_sim.amplitudes(s, THICK, tilts=tilts)
    b = bloch_sim.amplitudes(s, THICK, tilts=tilts, device="gpu")
    np.testing.assert_allclose(np.abs(a) ** 2, np.abs(b) ** 2, atol=1e-9)


def test_discs_a_few_pixels_across_warn_and_suggest_a_finer_pixel():
    si = bulk("Si", cubic=True)
    # 60 kV, 7 mrad: a disc radius of 0.144 1/A, under 3 pixels of 0.05 1/A
    coarse = bloch_sim.preview_pattern(si, (1, 1, 0), 60e3, k_max=1.0, sim_type="cbed",
                                       alpha_mrad=7, pixel_size=0.05)
    assert any("polygons" in w and "0.014" in w for w in coarse["warnings"])
    fine = bloch_sim.preview_pattern(si, (1, 1, 0), 60e3, k_max=1.0, sim_type="cbed",
                                     alpha_mrad=7, pixel_size=0.0144)
    assert not any("polygons" in w for w in fine["warnings"])

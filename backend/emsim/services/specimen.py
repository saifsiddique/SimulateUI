"""Specimen builder (context.md M3): zone axis -> centre -> orthogonal periodic box.

Order of operations (user's choice, 2026-10-27):
1. **Zone axis.** The beam (+z of the specimen) is along the lattice vector [uvw]; an in-plane
   reference fixes x and y.
2. **Centre.** A chosen point of the crystal (unit-cell centre, the atom nearest to it, or the
   origin) is placed at the centre of the final specimen box.
3. **Orthogonalise.** A periodic orthogonal box is found and the crystal is mapped onto it.

Orthogonalisation (our own search, replacing abTEM's rounding of `orthogonalize_cell`):
- The box's third vector is t3 = M.u (u = [uvw] / gcd), the shortest lattice vector along the beam,
  so the zone axis stays *exactly* along z: the map onto the box never tilts the crystal.
- An integer basis (U0, U1, u) of the lattice is built around u (unimodular completion). Every
  lattice vector is then i b0 + j b1 + k t3; reducing k puts each one as close as possible to the
  plane normal to the beam. All (i, j) up to a length `max_length` are enumerated.
- The box vectors t1 (near x) and t2 (near y) are chosen from those, scoring every pair by the true
  strain of the affine map F onto the orthogonal box (polar decomposition F = R P, strain = the
  eigenvalues of P - 1; the rotation R is about the beam only and is harmless), under an atom budget.
  The smallest cell within the strain tolerance wins; if none exists, the least strained one.
- abTEM's own route (rotate, then `orthogonalize_cell`) is available as `method="abtem"` for
  comparison; the two agree for cubic/hexagonal axes, the search is much better for low symmetry.

All abTEM calls of this module are in `_abtem_orthogonalize` (context.md 5.3).
"""

from __future__ import annotations

import hashlib
import json
import math
from collections import OrderedDict
from threading import Lock
from typing import Literal

import numpy as np
from ase import Atoms
from ase.build import make_supercell
from scipy.linalg import polar

# --------------------------------------------------------------------------------------------
# Integer lattice helpers
# --------------------------------------------------------------------------------------------


def reduce_indices(uvw) -> np.ndarray:
    u = np.asarray(uvw, dtype=np.int64)
    if not np.any(u):
        raise ValueError("The zone axis [0 0 0] is not a direction.")
    g = math.gcd(math.gcd(int(abs(u[0])), int(abs(u[1]))), int(abs(u[2])))
    return u // g


def complete_basis(u) -> np.ndarray:
    """Integer matrix U (columns are lattice-index vectors) with det(U) = +1 and U[:, 2] = u.

    u must be primitive (gcd 1). Built by reducing u to a unit vector with integer row operations
    (Euclid on its components); U is the inverse of the accumulated operations.
    """
    x = np.array(u, dtype=np.int64)
    T = np.eye(3, dtype=np.int64)
    while np.count_nonzero(x) > 1:
        nz = [i for i in range(3) if x[i] != 0]
        i, j = sorted(nz, key=lambda k: abs(x[k]))[-1], sorted(nz, key=lambda k: abs(x[k]))[0]
        q = x[i] // x[j]
        x[i] -= q * x[j]
        T[i] -= q * T[j]
    k = int(np.flatnonzero(x)[0])
    if abs(x[k]) != 1:
        raise ValueError(f"{list(u)} is not a primitive integer vector.")
    if k != 2:  # move the unit component to the last row
        T[[k, 2]] = T[[2, k]]
        x[[k, 2]] = x[[2, k]]
    if x[2] < 0:
        T[2] *= -1
    U = np.rint(np.linalg.inv(T.astype(float))).astype(np.int64)
    if np.linalg.det(U) < 0:
        U[:, 0] *= -1
    assert np.array_equal(U[:, 2], np.asarray(u)), (U, u)
    return U


# --------------------------------------------------------------------------------------------
# Orientation
# --------------------------------------------------------------------------------------------


def specimen_frame(cell: np.ndarray, u: np.ndarray, y_ref=None) -> np.ndarray:
    """Rotation R (rows = specimen x, y, z in the crystal's Cartesian frame), z || u . cell.

    `y_ref` (Cartesian, crystal frame) is projected onto the plane normal to z to give y (e.g. the
    screen-up of the 3D view); by default the projection of b (else a, c), so the result is
    reproducible.
    """
    z = np.asarray(u, dtype=float) @ cell
    z /= np.linalg.norm(z)
    refs = []
    if y_ref is not None:
        refs.append(np.asarray(y_ref, dtype=float))
    refs += [cell[1], cell[0], cell[2], np.array([0.0, 1.0, 0.0]), np.array([1.0, 0.0, 0.0])]
    for r in refs:
        y = r - (r @ z) * z
        if np.linalg.norm(y) > 1e-6 * max(np.linalg.norm(r), 1e-12):
            y /= np.linalg.norm(y)
            break
    x = np.cross(y, z)
    return np.vstack([x, y, z])


# --------------------------------------------------------------------------------------------
# The orthogonal-cell search
# --------------------------------------------------------------------------------------------


def _strain_batch(C: np.ndarray, L: np.ndarray):
    """Affine maps F (column convention) taking cells C (rows t1,t2,t3) onto boxes diag(L).

    Returns (max |principal stretch - 1|, principal stretches sorted, in-plane rotation angle deg).
    """
    # x_box = F x_cell with F C^T = diag(L)  =>  F = diag(L) C^-T
    Cinv_T = np.linalg.inv(C).transpose(0, 2, 1)
    F = L[:, :, None] * Cinv_T
    s = np.linalg.svd(F, compute_uv=False)  # principal stretches
    strain = np.abs(s - 1.0).max(axis=1)
    return strain, s, F


def _gauss_reduce(b0: np.ndarray, b1: np.ndarray, n0: np.ndarray, n1: np.ndarray):
    """Lagrange-Gauss reduction of a 2D basis (xy parts of b0, b1), carrying integer indices."""
    for _ in range(100):
        if b0[:2] @ b0[:2] > b1[:2] @ b1[:2]:
            b0, b1, n0, n1 = b1, b0, n1, n0
        m = round(float(b0[:2] @ b1[:2]) / float(b0[:2] @ b0[:2]))
        if m == 0:
            break
        b1 = b1 - m * b0
        n1 = n1 - m * n0
    return b0, b1, n0, n1


def search_cells(
    cell: np.ndarray,
    R: np.ndarray,
    u: np.ndarray,
    n_cell_atoms: int,
    max_length: float = 100.0,
    max_repeat_atoms: int = 2000,
    max_candidates: int = 1500,
    max_exact: int = 60000,
):
    """Enumerate near-orthogonal periodic cells for the zone axis u (see the module docstring).

    Returns a list of dicts sorted by (strain, atoms): {indices (3x3 int rows n1, n2, u),
    lengths (Lx, Ly, Lz), natoms, strain, stretches}.
    """
    U = complete_basis(u)
    rot = lambda n: R @ (np.asarray(n, dtype=float) @ cell)  # noqa: E731
    t3 = rot(u)
    c3 = float(t3[2])
    b0, b1 = rot(U[:, 0]), rot(U[:, 1])
    n0, n1 = U[:, 0].copy(), U[:, 1].copy()

    def lift(b, n):
        k = round(float(b[2]) / c3)
        return b - k * t3, n - k * u

    b0, n0 = lift(b0, n0)
    b1, n1 = lift(b1, n1)
    b0, b1, n0, n1 = _gauss_reduce(b0, b1, n0, n1)
    shortest = math.sqrt(min(b0[:2] @ b0[:2], b1[:2] @ b1[:2]))
    # the reduced basis is near-orthogonal (>= 60 deg), so |i|, |j| <= 2 L / shortest suffices
    K = int(min(120, math.ceil(2 * max_length / max(shortest, 1e-6)) + 1))
    ii, jj = np.meshgrid(np.arange(-K, K + 1), np.arange(-K, K + 1), indexing="ij")
    ii, jj = ii.ravel(), jj.ravel()
    V = ii[:, None] * b0 + jj[:, None] * b1
    N = ii[:, None] * n0 + jj[:, None] * n1
    k = np.rint(V[:, 2] / c3)
    V = V - k[:, None] * t3
    N = N - k[:, None].astype(np.int64) * u
    lxy = np.hypot(V[:, 0], V[:, 1])
    keep = (lxy > 1e-6) & (lxy <= max_length)
    V, N, lxy = V[keep], N[keep], lxy[keep]
    out_of_plane = np.abs(V[:, 2]) / lxy

    def pick(axis: int):
        ang = np.arctan2(V[:, 1 - axis] if axis == 0 else V[:, 0], V[:, axis])
        m = (np.abs(ang) <= np.radians(45)) & (V[:, axis] > 0)
        idx = np.flatnonzero(m)
        # best first: nearly in-plane, then short
        order = np.lexsort((lxy[idx], np.round(out_of_plane[idx], 6)))
        return idx[order[:max_candidates]]

    i1, i2 = pick(0), pick(1)
    if len(i1) == 0 or len(i2) == 0:
        raise ValueError("No in-plane lattice vectors found; increase the maximum length.")
    A1, A2 = np.repeat(i1, len(i2)), np.tile(i2, len(i1))
    T1, T2 = V[A1], V[A2]
    vol = np.abs(np.einsum("ij,ij->i", np.cross(T1, T2), np.broadcast_to(t3, T1.shape)))
    cell_vol = abs(np.linalg.det(cell))
    natoms = np.rint(vol / cell_vol).astype(np.int64) * n_cell_atoms
    ok = (natoms > 0) & (natoms <= max_repeat_atoms)
    if not np.any(ok):
        raise ValueError(
            f"Every periodic cell for this zone axis has more than {max_repeat_atoms} atoms; "
            "raise the atom limit."
        )
    A1, A2, T1, T2, natoms = A1[ok], A2[ok], T1[ok], T2[ok], natoms[ok]
    if len(A1) > max_exact:
        # Cheap first-order strain: out-of-plane tilt of each vector and the in-plane shear.
        cosang = np.abs(np.einsum("ij,ij->i", T1[:, :2], T2[:, :2])) / (
            np.hypot(T1[:, 0], T1[:, 1]) * np.hypot(T2[:, 0], T2[:, 1]))
        approx = np.maximum.reduce([out_of_plane[A1], out_of_plane[A2], cosang])
        # keep the best by strain, and for every size the best few (small cells matter too)
        best = np.argsort(approx)[: max_exact // 2]
        size_order = np.lexsort((approx, natoms))
        _, first = np.unique(natoms[size_order], return_index=True)
        per_size = np.concatenate([size_order[f: f + 20] for f in first])
        sel = np.unique(np.concatenate([best, per_size]))
        A1, A2, T1, T2, natoms = A1[sel], A2[sel], T1[sel], T2[sel], natoms[sel]
    C = np.stack([T1, T2, np.broadcast_to(t3, T1.shape)], axis=1)
    L = np.stack([np.linalg.norm(T1, axis=1), np.linalg.norm(T2, axis=1),
                  np.full(len(T1), c3)], axis=1)
    strain, stretches, _ = _strain_batch(C, L)
    order = np.lexsort((natoms, np.round(strain, 9)))
    res = []
    seen = set()
    for o in order[:5000]:
        key = (int(natoms[o]), round(float(strain[o]), 7))
        if key in seen:
            continue
        seen.add(key)
        res.append({
            "indices": np.stack([N[A1[o]], N[A2[o]], u]).astype(int),
            "lengths": L[o].copy(),
            "natoms": int(natoms[o]),
            "strain": float(strain[o]),
            "stretches": stretches[o].copy(),
        })
    return res


def choose_cell(cands: list[dict], strain_tolerance: float) -> tuple[dict, bool]:
    """Smallest cell within the tolerance; otherwise the smallest cell whose strain is within
    20% of the least strain available (a much larger cell for a marginal gain is not worth it)."""
    within = [c for c in cands if c["strain"] <= strain_tolerance + 1e-12]
    if within:
        return min(within, key=lambda c: (c["natoms"], c["strain"])), True
    least = min(c["strain"] for c in cands)
    near = [c for c in cands if c["strain"] <= 1.2 * least + 1e-12]
    return min(near, key=lambda c: (c["natoms"], c["strain"])), False


def pareto(cands: list[dict], limit: int = 10) -> list[dict]:
    """Cells that no other cell beats on both size and strain, smallest first."""
    best = math.inf
    front = []
    for c in sorted(cands, key=lambda c: (c["natoms"], c["strain"])):
        if c["strain"] < best - 1e-9:
            front.append(c)
            best = c["strain"]
    return front[:limit]


# --------------------------------------------------------------------------------------------
# abTEM's route, for comparison
# --------------------------------------------------------------------------------------------


def _abtem_orthogonalize(atoms: Atoms, R: np.ndarray, max_repetitions: int):
    from abtem.atoms import orthogonalize_cell

    rotated = atoms.copy()
    rotated.set_cell(atoms.cell.array @ R.T, scale_atoms=True)
    out, A = orthogonalize_cell(rotated, max_repetitions=max_repetitions,
                                return_transform_matrix=True)
    A = np.asarray(A)
    _, P = polar(A)
    strain = float(np.abs(np.linalg.eigvalsh(P) - 1).max())
    # Where the zone axis ends up: abTEM maps row vectors x -> x A; the zone axis is +z before.
    z = np.array([0.0, 0.0, 1.0]) @ A
    tilt = float(np.degrees(np.arctan2(np.hypot(z[0], z[1]), abs(z[2]))))
    out.info["zone_axis_tilt_deg"] = tilt
    return out, strain


def abtem_comparison(atoms: Atoms, R: np.ndarray, max_atoms: int) -> list[dict]:
    rows = []
    for mr in (1, 2, 3, 5, 8):
        try:
            out, strain = _abtem_orthogonalize(atoms, R, mr)
        except Exception as e:  # report, never fail the build because of the comparison
            rows.append({"max_repetitions": mr, "error": f"{type(e).__name__}: {e}"})
            continue
        if len(out) > max_atoms:
            break
        rows.append({"max_repetitions": mr, "natoms": len(out), "strain": strain,
                     "zone_axis_tilt_deg": out.info["zone_axis_tilt_deg"]})
    return rows


# --------------------------------------------------------------------------------------------
# Building the specimen
# --------------------------------------------------------------------------------------------

CenterMode = Literal["cell", "atom", "origin"]
OccupancyPolicy = Literal["dominant", "random", "keep"]


def centre_point(atoms: Atoms, mode: CenterMode) -> np.ndarray:
    cell = atoms.cell.array
    if mode == "origin":
        return np.zeros(3)
    c = np.array([0.5, 0.5, 0.5]) @ cell
    if mode == "cell":
        return c
    if mode == "atom":
        from ase.geometry import get_distances

        _, d = get_distances(c[None], atoms.positions, cell=cell, pbc=True)
        i = int(np.argmin(d[0]))
        return atoms.positions[i].copy()
    raise ValueError(f"Unknown centre mode {mode!r}")


def resolve_occupancy(atoms: Atoms, policy: OccupancyPolicy, seed: int = 0,
                      tol: float = 0.05) -> tuple[Atoms, list[str]]:
    """Turn partially occupied / shared sites into whole atoms (abTEM needs them)."""
    occ = atoms.arrays.get("occupancy")
    if occ is None or np.all(occ >= 1 - 1e-6):
        return atoms, []
    if policy == "keep":
        return atoms, ["Partial occupancies kept: atoms overlap at mixed sites, the potential "
                       "will count every one of them fully."]
    from scipy.spatial import cKDTree
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components

    L = np.diag(atoms.cell.array).copy()
    pos = np.mod(atoms.positions, L)
    tree = cKDTree(pos, boxsize=L)
    pairs = tree.query_pairs(tol, output_type="ndarray")
    n = len(atoms)
    g = coo_matrix((np.ones(len(pairs)), (pairs[:, 0], pairs[:, 1])), shape=(n, n))
    _, label = connected_components(g, directed=False)
    order = np.argsort(label, kind="stable")
    bounds = np.flatnonzero(np.diff(label[order])) + 1
    groups = np.split(order, bounds)
    rng = np.random.default_rng(seed)
    keep = []
    for grp in groups:
        o = occ[grp]
        total = float(o.sum())
        if policy == "dominant":
            if total >= 0.5:
                keep.append(int(grp[np.argmax(o)]))
        else:  # random
            r = rng.random()
            acc = np.cumsum(o)
            hit = np.searchsorted(acc, r, side="right")
            if hit < len(grp):
                keep.append(int(grp[hit]))
    keep = np.sort(np.array(keep, dtype=int))
    out = atoms[keep]
    out.arrays["occupancy"] = np.ones(len(out))
    note = (f"Occupancy resolved ({policy}): {n} atoms at {len(groups)} sites -> {len(out)} "
            "whole atoms.")
    return out, [note]


def _payload_hash(obj) -> str:
    return hashlib.sha1(json.dumps(obj, sort_keys=True, default=str).encode()).hexdigest()[:16]


def build(
    atoms: Atoms,
    zone_axis,
    y_direction=None,
    center: CenterMode = "cell",
    lateral: tuple[float, float] = (30.0, 30.0),
    thickness: float = 100.0,
    repeats_requested: tuple[int, int, int] | None = None,
    vacuum: tuple[float, float] = (0.0, 0.0),
    strain_tolerance: float = 0.002,
    max_repeat_atoms: int = 2000,
    max_length: float = 100.0,
    max_atoms: int = 200_000,
    occupancy: OccupancyPolicy = "dominant",
    seed: int = 0,
    method: Literal["search", "abtem"] = "search",
    supercell=None,
    abtem_repetitions: int = 5,
) -> dict:
    """Build the specimen. Returns a plain dict (see models.specimen.SpecimenResponse)."""
    warns: list[str] = []
    cell = atoms.cell.array.copy()
    u = reduce_indices(zone_axis)
    R = specimen_frame(cell, u, y_direction)
    n_cell = len(atoms)

    # ---- 1. orthogonal periodic repeat cell ------------------------------------------------
    cands: list[dict] = []
    if method == "abtem":
        rep, strain = _abtem_orthogonalize(atoms, R, abtem_repetitions)
        P_int = None
        repeat_cell = np.diag(rep.cell.array).copy()
        chosen = {"natoms": len(rep), "strain": strain, "lengths": repeat_cell,
                  "stretches": np.full(3, np.nan), "indices": None}
        within = strain <= strain_tolerance
        repeat = rep
        repeat.wrap()
    else:
        if supercell is not None:
            Pm = np.asarray(supercell, dtype=np.int64)
            if not np.array_equal(Pm[2], u) and not np.array_equal(Pm[2], -u):
                raise ValueError("The third supercell vector must be the zone axis.")
            rot = lambda n: R @ (np.asarray(n, float) @ cell)  # noqa: E731
            C = np.stack([rot(Pm[0]), rot(Pm[1]), rot(Pm[2])])[None]
            L = np.linalg.norm(C, axis=2)
            L[0, 2] = abs(C[0, 2, 2])
            strain_v, s, _ = _strain_batch(C, L)
            chosen = {"indices": Pm, "lengths": L[0], "strain": float(strain_v[0]),
                      "stretches": s[0], "natoms": int(round(abs(np.linalg.det(Pm)))) * n_cell}
            within = chosen["strain"] <= strain_tolerance
            cands = search_cells(cell, R, u, n_cell, max_length, max_repeat_atoms)
        else:
            cands = search_cells(cell, R, u, n_cell, max_length, max_repeat_atoms)
            chosen, within = choose_cell(cands, strain_tolerance)
        P_int = chosen["indices"]
        if round(abs(np.linalg.det(P_int))) == 0:
            raise ValueError("Degenerate supercell.")
        # Fractional coordinates in the supercell are kept and the cell replaced by the box:
        # exactly the affine map F of the search.
        super_atoms = make_supercell(atoms, P_int, wrap=True)
        repeat_cell = np.asarray(chosen["lengths"], dtype=float)
        frac = super_atoms.get_scaled_positions(wrap=True)
        repeat = super_atoms.copy()
        repeat.set_cell(np.diag(repeat_cell), scale_atoms=False)
        repeat.set_scaled_positions(frac)

    if not within:
        warns.append(
            f"No periodic cell within {strain_tolerance:.2%} strain and {max_repeat_atoms} atoms; "
            f"the least strained one has {chosen['strain']:.2%}. Raise the atom limit or the "
            "maximum length to find a better one."
        )
    if chosen["strain"] > 0.05:
        warns.append(f"Strain {chosen['strain']:.1%}: multislice results will be unreliable.")

    # ---- 2. tile to the requested extents, centring the chosen point ------------------------
    if repeats_requested is not None:
        nx, ny, nz = (max(1, int(v)) for v in repeats_requested)
    else:
        nx = max(1, math.ceil(lateral[0] / repeat_cell[0] - 1e-9))
        ny = max(1, math.ceil(lateral[1] / repeat_cell[1] - 1e-9))
        nz = max(1, round(thickness / repeat_cell[2]))
    reps = np.array([nx, ny, nz])
    final_n = len(repeat) * nx * ny * nz
    if final_n > max_atoms:
        raise ValueError(f"The specimen would have {final_n} atoms (limit {max_atoms}); "
                         "reduce the extents or the thickness.")

    # centre: where the chosen crystal point lands in repeat-cell fractional coordinates
    p = centre_point(atoms, center)
    if P_int is not None:
        p_frac = np.linalg.solve((np.asarray(P_int, float) @ cell).T, p)  # p = frac . (P cell)
    else:
        p_spec = R @ p
        p_frac = p_spec / repeat_cell
    target = np.mod(0.5 * reps, 1.0)  # final box centre, in repeat-cell fractional units
    shift = target - p_frac
    f = np.mod(repeat.get_scaled_positions(wrap=False) + shift, 1.0)
    repeat.set_scaled_positions(f)
    specimen = repeat.repeat(tuple(int(x) for x in reps))

    # ---- 3. occupancy, vacuum ---------------------------------------------------------------
    specimen, notes = resolve_occupancy(specimen, occupancy, seed)
    warns += notes
    top, bottom = float(vacuum[0]), float(vacuum[1])
    crystal_extent = repeat_cell * reps
    box = crystal_extent.copy()
    if top or bottom:
        box[2] += top + bottom
        specimen.set_cell(np.diag(box), scale_atoms=False)
        specimen.positions[:, 2] += top

    # ---- geometry for the crystal-frame overlay (box outline, beam) ---------------------------
    corners = []
    for cx in (0, 1):
        for cy in (0, 1):
            for cz in (0, 1):
                fr = np.array([cx, cy, cz]) * reps - shift  # repeat-cell frac of the corner
                if P_int is not None:
                    corners.append(fr @ (np.asarray(P_int, float) @ cell))
                else:
                    corners.append(R.T @ (fr * repeat_cell))
    corners = np.array(corners)
    centre = corners.mean(axis=0)
    beam = R[2]

    if len(specimen) > 50_000:
        warns.append(f"{len(specimen)} atoms: potentials will be slow and memory hungry.")

    symbols = sorted(set(specimen.get_chemical_symbols()))
    index = {s: i for i, s in enumerate(symbols)}
    uiso = specimen.arrays.get("uiso")
    return {
        "zone_axis": [int(x) for x in u],
        "rotation": R.tolist(),
        "method": method,
        "supercell": None if P_int is None else np.asarray(P_int).tolist(),
        "repeat_cell": repeat_cell.tolist(),
        "natoms_repeat": int(len(repeat)),
        "strain": {
            "max_abs": float(chosen["strain"]),
            "principal": [float(x) - 1 for x in chosen["stretches"]],
            "within_tolerance": bool(within),
        },
        "repeats": reps.tolist(),
        "crystal_extent": crystal_extent.tolist(),
        "box": box.tolist(),
        "vacuum": [top, bottom],
        "natoms": int(len(specimen)),
        "symbols": symbols,
        "species": [index[s] for s in specimen.get_chemical_symbols()],
        "positions": np.round(specimen.positions, 4).ravel().tolist(),
        "uiso": None if uiso is None else [None if np.isnan(x) else float(x) for x in uiso],
        "box_corners_crystal": corners.tolist(),
        "centre_crystal": centre.tolist(),
        "centre_point_crystal": p.tolist(),
        "beam_crystal": beam.tolist(),
        "candidates": [
            {"supercell": c["indices"].tolist(), "natoms": c["natoms"], "strain": c["strain"],
             "repeat_cell": [float(x) for x in c["lengths"]]}
            for c in pareto(cands)
        ],
        "warnings": warns,
        "atoms_object": specimen,
    }


# --------------------------------------------------------------------------------------------
# Store (for later modules: M4 builds potentials from the stored specimen)
# --------------------------------------------------------------------------------------------


class SpecimenStore:
    def __init__(self, capacity: int = 8):
        self._items: OrderedDict[str, Atoms] = OrderedDict()
        self._cap = capacity
        self._lock = Lock()

    def put(self, key: str, atoms: Atoms) -> None:
        with self._lock:
            self._items[key] = atoms
            self._items.move_to_end(key)
            while len(self._items) > self._cap:
                self._items.popitem(last=False)

    def get(self, key: str) -> Atoms | None:
        with self._lock:
            return self._items.get(key)


store = SpecimenStore()


def specimen_id(structure_id: str, params: dict) -> str:
    return _payload_hash({"structure": structure_id, **params})

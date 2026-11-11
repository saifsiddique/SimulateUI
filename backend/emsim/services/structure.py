"""Structure registration and orthogonalisation (context.md M2).

The browser (strFac_app's parser) is authoritative for the unit cell; this module turns its P1 payload
into an `ase.Atoms`, cross-checks it against ASE's/pymatgen's reading of the raw CIF, and builds the
orthogonal cell abTEM needs (multislice requires an orthogonal, periodic cell: a non-orthogonal one
gives wrong results). abTEM calls are confined to `orthogonalize` (context.md 5.3).
"""

from __future__ import annotations

import hashlib
import io
import warnings
from collections import OrderedDict
from threading import Lock

import numpy as np
from ase import Atoms
from ase.data import atomic_masses, atomic_numbers
from ase.geometry import cellpar_to_cell
from scipy.linalg import polar

from ..models.structure import (
    CellModel,
    OrthogonalAtom,
    OrthogonalizeResponse,
    StrainInfo,
    StructurePayload,
    StructureResponse,
    StructureSummary,
)

AVOGADRO = 6.02214076e23

CELL_TOL = 1e-3  # relative tolerance of the cell cross-check
ORTHOGONAL_TOL = 1e-6  # relative off-diagonal size below which a cell counts as orthogonal


# --------------------------------------------------------------------------------------------
# Payload -> Atoms
# --------------------------------------------------------------------------------------------


def payload_id(p: StructurePayload) -> str:
    key = p.model_dump_json(exclude={"rawCif", "fileName"})
    return hashlib.sha1(key.encode()).hexdigest()[:16]


def build_atoms(p: StructurePayload) -> Atoms:
    """ase.Atoms (a || x, b in the xy-plane, as in the browser) with per-atom occupancy and Uiso."""
    c = p.cell
    cell = cellpar_to_cell([c.a, c.b, c.c, c.alpha, c.beta, c.gamma])
    try:
        numbers = [atomic_numbers[a.element] for a in p.atoms]
    except KeyError as e:
        raise ValueError(f"Unknown element symbol {e.args[0]!r}") from None
    atoms = Atoms(numbers=numbers, cell=cell, pbc=True,
                  scaled_positions=[a.frac for a in p.atoms])
    atoms.set_array("occupancy", np.array([a.occupancy for a in p.atoms], dtype=float))
    atoms.set_array("uiso", np.array([np.nan if a.uiso is None else a.uiso for a in p.atoms],
                                     dtype=float))
    return atoms


def is_orthogonal(cell, tol: float = ORTHOGONAL_TOL) -> bool:
    cell = np.asarray(cell, dtype=float)
    off = np.abs(cell - np.diag(np.diag(cell))).max()
    return bool(off <= tol * np.linalg.norm(cell, axis=1).max())


def formula(atoms: Atoms) -> str:
    return atoms.get_chemical_formula(mode="hill")


def density_g_cm3(atoms: Atoms) -> float:
    occ = atoms.arrays.get("occupancy", np.ones(len(atoms)))
    mass = float(np.sum(atomic_masses[atoms.numbers] * occ))  # g/mol
    return mass / AVOGADRO / (atoms.cell.volume * 1e-24)


# --------------------------------------------------------------------------------------------
# Cross-check against the raw CIF
# --------------------------------------------------------------------------------------------


def _cell_mismatch(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.abs(np.asarray(a) - np.asarray(b)).max())


def distinct_positions(atoms: Atoms, tol: float = 0.01, limit: int = 4000) -> int:
    """Number of distinct places (atoms closer than `tol` A, periodically, share one place).

    A mixed-occupancy site (Si/Al) is several atoms at one place; readers like ASE keep only the
    dominant species there, so places are what the readings can be compared on.
    """
    n = len(atoms)
    if n > limit:
        return n
    from ase.geometry import get_distances
    from scipy.sparse import csr_matrix
    from scipy.sparse.csgraph import connected_components

    _, d = get_distances(atoms.positions, cell=atoms.cell, pbc=True)
    n_comp, _ = connected_components(csr_matrix(d < tol), directed=False)
    return int(n_comp)


def cross_check(atoms: Atoms, raw_cif: str) -> list[str]:
    """Compare atom count and cell with ASE's (then pymatgen's) reading of the raw CIF.

    Never raises: the browser result stays authoritative, mismatches are reported as warnings.
    """
    if not raw_cif.strip():
        return []
    notes: list[str] = []
    reference: tuple[str, int, np.ndarray] | None = None
    try:
        from ase.io import read

        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            ref = read(io.StringIO(raw_cif), format="cif")
        reference = ("ASE", len(ref), ref.cell.cellpar())
    except Exception as e_ase:
        try:
            from pymatgen.core import Structure

            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                s = Structure.from_str(raw_cif, fmt="cif")
            reference = ("pymatgen", len(s), np.array(s.lattice.parameters))
            notes.append(f"ASE could not read the CIF ({type(e_ase).__name__}); checked with pymatgen.")
        except Exception as e_pmg:
            notes.append(
                "Neither ASE nor pymatgen could read this CIF "
                f"({type(e_ase).__name__}, {type(e_pmg).__name__}); using the browser's parse only."
            )
    if reference is not None:
        who, n, par = reference
        places = distinct_positions(atoms)
        if n != places:
            notes.append(f"{who} reads {n} atoms in the cell, the browser built {places} "
                         f"distinct positions ({len(atoms)} atoms).")
        mine = atoms.cell.cellpar()
        # angle-sorted comparison is not needed: both use the CIF's own setting
        if _cell_mismatch(par[:3], mine[:3]) > CELL_TOL * mine[:3].max() or _cell_mismatch(
            par[3:], mine[3:]
        ) > 0.05:
            notes.append(f"{who} reads a different cell from the CIF "
                         f"({np.round(par, 4).tolist()} vs {np.round(mine, 4).tolist()}).")
    return notes


# --------------------------------------------------------------------------------------------
# Store
# --------------------------------------------------------------------------------------------


class StructureStore:
    """Small in-memory LRU cache, keyed by the payload hash."""

    def __init__(self, capacity: int = 32):
        self._items: OrderedDict[str, tuple[StructurePayload, Atoms]] = OrderedDict()
        self._cap = capacity
        self._lock = Lock()

    def put(self, key: str, payload: StructurePayload, atoms: Atoms) -> None:
        with self._lock:
            self._items[key] = (payload, atoms)
            self._items.move_to_end(key)
            while len(self._items) > self._cap:
                self._items.popitem(last=False)

    def get(self, key: str) -> tuple[StructurePayload, Atoms] | None:
        with self._lock:
            item = self._items.get(key)
            if item is not None:
                self._items.move_to_end(key)
            return item


store = StructureStore()


def register(payload: StructurePayload) -> StructureResponse:
    atoms = build_atoms(payload)
    key = payload_id(payload)
    warns = cross_check(atoms, payload.rawCif)
    occ = atoms.arrays["occupancy"]
    partial = int(np.sum(occ < 1 - 1e-6))
    if partial:
        warns.append(f"{partial} atoms have occupancy < 1; the specimen step must resolve them "
                     "(abTEM needs whole atoms).")
    store.put(key, payload, atoms)
    c = payload.cell
    return StructureResponse(
        structureId=key,
        summary=StructureSummary(
            natoms=len(atoms),
            formula=formula(atoms),
            cell=CellModel(**c.model_dump()),
            volume=float(atoms.cell.volume),
            density=density_g_cm3(atoms),
            orthogonal=is_orthogonal(atoms.cell),
            partial_sites=partial,
        ),
        warnings=warns,
    )


# --------------------------------------------------------------------------------------------
# Orthogonalisation (abTEM)
# --------------------------------------------------------------------------------------------

AUTO_MAX_REPETITIONS = 12


def _strain_from_matrix(A: np.ndarray) -> StrainInfo:
    """A maps the repeated (cut) cell onto the orthogonal box; A = R P (polar decomposition)."""
    R, P = polar(A)
    principal = np.linalg.eigvalsh(P) - 1.0
    angle = np.degrees(np.arccos(np.clip((np.trace(R) - 1) / 2, -1, 1)))
    return StrainInfo(
        principal=tuple(float(x) for x in principal),
        max_abs=float(np.abs(principal).max()),
        rotation_deg=float(angle),
        volume_change=float(np.linalg.det(A) - 1.0),
    )


def _run_abtem(atoms: Atoms, max_repetitions: int):
    from abtem.atoms import orthogonalize_cell

    return orthogonalize_cell(atoms.copy(), max_repetitions=max_repetitions,
                              return_transform_matrix=True)


def orthogonalize(
    payload: StructurePayload,
    atoms: Atoms,
    structure_id: str,
    max_repetitions: int | None = None,
    strain_tolerance: float = 0.01,
    max_atoms: int = 20000,
) -> OrthogonalizeResponse:
    """Orthogonal cell via abTEM's `orthogonalize_cell`.

    abTEM repeats the cell until its lattice vectors are close to the Cartesian axes and removes
    the remainder by an affine strain. With `max_repetitions=None` the smallest value whose strain is
    <= `strain_tolerance` is used (scanning 1..12); if none reaches it, the least strained candidate
    within `max_atoms` is returned with a warning.
    """
    warns: list[str] = []
    n0 = len(atoms)
    base = atoms.copy()
    base.set_tags(np.arange(n0))

    candidates: list[dict] = []

    def attempt(mr: int):
        out, A = _run_abtem(base, mr)
        strain = _strain_from_matrix(np.asarray(A))
        candidates.append({"max_repetitions": mr, "natoms": len(out), "strain": strain.max_abs})
        return out, strain

    if is_orthogonal(atoms.cell):
        out, strain = attempt(1)
        chosen = 1
        already = True
    else:
        already = False
        if max_repetitions is not None:
            out, strain = attempt(max_repetitions)
            chosen = max_repetitions
        else:
            best = None
            seen_sizes: set[int] = set()
            chosen = 1
            for mr in range(1, AUTO_MAX_REPETITIONS + 1):
                out_i, strain_i = attempt(mr)
                if len(out_i) > max_atoms:
                    break
                if len(out_i) in seen_sizes and best is not None and mr > 1:
                    # abTEM returned the same supercell size again: nothing new to gain
                    # (the cell is the same up to the strain, which is then unchanged).
                    continue
                seen_sizes.add(len(out_i))
                if best is None or strain_i.max_abs < best[2].max_abs - 1e-12:
                    best = (mr, out_i, strain_i)
                if strain_i.max_abs <= strain_tolerance:
                    best = (mr, out_i, strain_i)
                    break
            if best is None:
                raise ValueError(f"Every orthogonal cell tried has more than {max_atoms} atoms.")
            chosen, out, strain = best
            if strain.max_abs > strain_tolerance:
                warns.append(
                    f"No orthogonal cell within {strain_tolerance:.1%} strain was found with up to "
                    f"{max_atoms} atoms; the best has {strain.max_abs:.2%}."
                )

    if len(out) > max_atoms:
        raise ValueError(f"The orthogonal cell has {len(out)} atoms (limit {max_atoms}).")
    if strain.max_abs > 0.05:
        warns.append(f"Strain of {strain.max_abs:.1%} distorts bond lengths strongly; "
                     "multislice results will be unreliable. Increase the repetitions.")
    elif strain.max_abs > strain_tolerance:
        warns.append(f"Strain of {strain.max_abs:.2%} exceeds the {strain_tolerance:.1%} tolerance.")
    if strain.rotation_deg > 1e-6 and not already:
        warns.append(f"The cell is rotated by {strain.rotation_deg:.2f} deg when made orthogonal.")
    if int(np.sum(base.arrays["occupancy"] < 1 - 1e-6)):
        warns.append("Partially occupied sites keep all their atoms here (overlapping at mixed "
                     "sites); the specimen step resolves them.")
    if len(out) > 5000:
        warns.append(f"{len(out)} atoms: potentials will be slow and memory hungry.")

    tags = out.get_tags()
    occ = base.arrays["occupancy"][tags]
    uiso = base.arrays["uiso"][tags]
    frac = out.get_scaled_positions(wrap=True)
    elements = out.get_chemical_symbols()
    atoms_out = [
        OrthogonalAtom(
            element=elements[i],
            frac=tuple(float(x) for x in frac[i]),
            occupancy=float(occ[i]),
            uiso=None if np.isnan(uiso[i]) else float(uiso[i]),
            source=int(tags[i]),
        )
        for i in range(len(out))
    ]
    lengths = tuple(float(x) for x in np.diag(out.cell))
    return OrthogonalizeResponse(
        structureId=structure_id,
        already_orthogonal=already,
        max_repetitions=int(chosen),
        volume_ratio=float(out.cell.volume / atoms.cell.volume),
        cell=lengths,  # type: ignore[arg-type]
        natoms=len(out),
        strain=strain,
        atoms=atoms_out,
        candidates=candidates,
        warnings=warns,
    )

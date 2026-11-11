/** Typed errors thrown by `core/` (context.md 5.3). The UI catches these and shows a message. */
export class CrystalLensError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** A unit cell that cannot describe a real lattice (non-positive length, impossible angles). */
export class LatticeError extends CrystalLensError {}

/** A matrix that cannot be inverted. */
export class SingularMatrixError extends CrystalLensError {}

/** An unparseable symmetry operation, an unknown space group, or operations that do not form a group. */
export class SymmetryError extends CrystalLensError {}

/** A CIF that cannot be turned into a structure (missing cell, no atoms, ...). */
export class CifError extends CrystalLensError {}

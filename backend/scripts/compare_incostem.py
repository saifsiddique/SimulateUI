"""Make the INCOSTEM reference fixtures with the original incostem program (context.md §7.MU U6).

The original is Earl Kirkland's `incostem` (GPL-3, "incostem version dated 6-jul-2016"). It is only
RUN here, to produce images and partial cross sections for `tests/fixtures/incostem_computem.npz`;
none of its code is part of SimulateUI. Build or download it outside this repository:

    python scripts/compare_incostem.py "C:/path/to/incostem.exe"

(its libfftw3f DLL must sit next to it, or on the PATH). The program is driven through its prompts
(file, cells, output, pixels, probe, ADF angles, aberrations, END, source size, defocus spread,
noise y/n) and its float TIFF output is read with Pillow (page 1 = the image).

Run again only when `tests/incostem_cases.py` changes; the fixture is committed.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "tests"))
import incostem_cases as cases  # noqa: E402

OUT = HERE.parent / "tests" / "fixtures" / "incostem_computem.npz"


def write_xyz(path: Path, cell, atoms) -> None:
    lines = ["case", "%.6f %.6f %.6f" % tuple(cell)]
    lines += ["%d %.6f %.6f %.6f 1.0 0.08" % a for a in atoms]
    path.write_text("\n".join(lines + ["-1", ""]))


def run(exe: Path, work: Path, xyz: str, ncell, nxy, probe, adf, aber=(), source=0.0, dfspread=0.0):
    out = "out.tif"
    lines = [xyz, "%d %d %d" % tuple(ncell), out, "%d %d" % tuple(nxy), "%g %g %g %g %g" % tuple(probe),
             "%g %g" % tuple(adf)]
    lines += ["%s %g" % (n, v) for n, v in aber]
    lines += ["END", "%g" % source, "%g" % dfspread, "n"]
    res = subprocess.run([str(exe)], input="\n".join(lines) + "\n", capture_output=True, text=True,
                         cwd=work, timeout=600)
    img = Image.open(work / out)
    img.seek(1)
    pix = np.array(img, dtype=np.float32)  # rows = y, columns = x
    sig = {int(z): float(v) for z, v in re.findall(r"partial cross section for Z = (\d+) is ([0-9.eE+-]+)", res.stdout)}
    banner = re.search(r"incostem version dated [^\n]*", res.stdout)
    return pix.T, sig, banner.group(0) if banner else ""  # [x, y]


def main(exe_path: str) -> None:
    exe = Path(exe_path).resolve()
    data: dict[str, np.ndarray] = {}
    meta: dict = {"program": "", "command": "prompts in scripts/compare_incostem.py"}
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, c in cases.CASES.items():
            write_xyz(work / "in.xyz", c["cell"], cases.cell_atoms(c))
            pix, sig, banner = run(exe, work, "in.xyz", c["ncell"], c["grid"], c["probe"], c["adf"],
                                   c.get("aber", ()), c.get("source", 0.0), c.get("dfspread", 0.0))
            data[f"{name}/image"], meta["program"] = pix, banner
            for z, v in sig.items():
                data[f"{name}/sigma{z}"] = np.array(v)
            print(name, pix.shape, float(pix.min()), float(pix.max()), sig)
        for name, c in cases.SINGLE.items():
            d = cases.ONE_BOX / cases.ONE_GRID[0]
            x = (cases.ONE_PIXEL[0] + c.get("dx_frac", 0.0)) * d
            write_xyz(work / "in.xyz", (cases.ONE_BOX, cases.ONE_BOX, 2.0), [(14, x, cases.ONE_PIXEL[1] * d + cases.Y_SAFE, 1.0)])
            pix, sig, _ = run(exe, work, "in.xyz", (1, 1, 1), cases.ONE_GRID, c["probe"], c["adf"],
                              c.get("aber", ()), c.get("source", 0.0), c.get("dfspread", 0.0))
            data[f"{name}/image"] = pix
            data[f"{name}/sigma14"] = np.array(sig[14])
            print(name, float(pix.max()))
        for z, kv, adf in cases.SIGMAS:
            write_xyz(work / "in.xyz", (20.0, 20.0, 2.0), [(z, 10.0, 10.0, 1.0)])
            _, sig, _ = run(exe, work, "in.xyz", (1, 1, 1), (64, 64), (kv, 0.0, 0.0, 0.0, 20.0), adf)
            data[f"sigma/{z}/{kv}"] = np.array(sig[z])
            print("sigma", z, kv, adf, sig[z])
    meta["cases"] = {k: {kk: vv for kk, vv in v.items() if kk != "atoms"} for k, v in cases.CASES.items()}
    data["meta"] = np.array(json.dumps(meta, default=list))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(OUT, **data)
    print("wrote", OUT, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])

"""Download a random sample of COD CIFs for the M2 parser robustness run.

    python -I scripts/fetch_cod_sample.py [N] [--seed S]     (run from app/)

Writes app/tests/cod_sample/<id>.cif (gitignored). IDs are drawn from the populated COD ranges,
so ~10% of draws are missing and skipped. Run it with `-I`: the downloaded CIFs are untrusted data.
"""

from __future__ import annotations

import argparse
import random
import urllib.error
import urllib.request
from pathlib import Path

# Populated COD ranges: inorganic, organic, ... (1xxxxxx), 2xxxxxx, 4xxxxxx, 7xxxxxx, 9xxxxxx.
RANGES = [(1000000, 1100000), (1500000, 1560000), (2000000, 2240000), (4000000, 4130000),
          (7000000, 7240000), (8100000, 8110000), (9000000, 9017000)]
OUT = Path(__file__).resolve().parent.parent / "tests" / "cod_sample"


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("n", nargs="?", type=int, default=600)
    p.add_argument("--seed", type=int, default=20261023)
    args = p.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    rng = random.Random(args.seed)
    weights = [hi - lo for lo, hi in RANGES]
    have = len(list(OUT.glob("*.cif")))
    tries = 0
    while have < args.n and tries < args.n * 3:
        tries += 1
        lo, hi = rng.choices(RANGES, weights)[0]
        cod_id = rng.randrange(lo, hi)
        dest = OUT / f"{cod_id}.cif"
        if dest.exists():
            continue
        try:
            with urllib.request.urlopen(f"https://www.crystallography.net/cod/{cod_id}.cif", timeout=30) as r:
                data = r.read()
        except (urllib.error.URLError, TimeoutError):
            continue
        if b"data_" not in data[:4000]:
            continue
        dest.write_bytes(data)
        have += 1
        if have % 50 == 0:
            print(have, flush=True)
    print("done", have)


if __name__ == "__main__":
    main()

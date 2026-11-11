"""Hardware detection (context.md M1): CPU, RAM, GPU (cupy) and a real abTEM GPU smoke test."""

from __future__ import annotations

import json
import platform
import subprocess
import sys
import threading
import time
from typing import Any

import psutil

_SMOKE_SCRIPT = r"""
import json, time
t0 = time.time()
try:
    import numpy as np
    from ase import Atoms
    import abtem
    atoms = Atoms("Si", positions=[(0, 0, 0)], cell=(4, 4, 4), pbc=True)
    potential = abtem.Potential(atoms, sampling=0.1, slice_thickness=2, device="gpu",
                                projection="infinite", parametrization="lobato")
    wave = abtem.PlaneWave(energy=100e3, device="gpu")
    exit_wave = wave.multislice(potential).compute(progress_bar=False)
    intensity = np.asarray(exit_wave.intensity().array.get() if hasattr(exit_wave.intensity().array, "get")
                           else exit_wave.intensity().array)
    ok = bool(np.isfinite(intensity).all() and intensity.sum() > 0)
    print(json.dumps({"ok": ok, "seconds": time.time() - t0, "abtem": abtem.__version__,
                      "error": None if ok else "non-finite or empty result"}))
except Exception as e:  # report, never raise
    print(json.dumps({"ok": False, "seconds": time.time() - t0, "error": f"{type(e).__name__}: {e}"}))
"""

_lock = threading.Lock()
_smoke_cache: dict[str, Any] | None = None


def cpu_info() -> dict[str, Any]:
    vm = psutil.virtual_memory()
    return {
        "physical_cores": psutil.cpu_count(logical=False) or psutil.cpu_count() or 1,
        "logical_cores": psutil.cpu_count(logical=True) or 1,
        "ram_total": int(vm.total),
        "ram_available": int(vm.available),
    }


def platform_info() -> dict[str, Any]:
    """The operating system and processor (context.md §5.6). abTEM's GPU path is CUDA only, so on
    Apple silicon the multislice runs CPU-parallel; the report says so instead of 'no GPU'."""
    system = platform.system()  # 'Windows', 'Darwin', 'Linux'
    machine = platform.machine().lower()
    apple = sys.platform == "darwin" and machine in ("arm64", "aarch64")
    return {
        "system": {"Darwin": "macOS"}.get(system, system),
        "release": platform.release(),
        "machine": machine,
        "python": platform.python_version(),
        "apple_silicon": apple,
    }


def gpu_info() -> dict[str, Any]:
    """cupy-based device query. Never raises; `available` is False with a `reason` on failure."""
    info: dict[str, Any] = {
        "cupy_installed": False,
        "cupy_version": None,
        "available": False,
        "reason": None,
        "cuda_runtime": None,
        "cuda_driver": None,
        "devices": [],
    }
    try:
        import cupy  # noqa: F401
        from cupy.cuda import runtime
    except Exception as e:
        info["reason"] = f"cupy is not importable ({type(e).__name__}: {e}). Running on CPU."
        return info
    info["cupy_installed"] = True
    info["cupy_version"] = cupy.__version__
    try:
        n = runtime.getDeviceCount()
        info["cuda_runtime"] = runtime.runtimeGetVersion()
        info["cuda_driver"] = runtime.driverGetVersion()
        for i in range(n):
            props = runtime.getDeviceProperties(i)
            with cupy.cuda.Device(i):
                free, total = runtime.memGetInfo()
            name = props["name"]
            info["devices"].append(
                {
                    "index": i,
                    "name": name.decode() if isinstance(name, bytes) else str(name),
                    "memory_total": int(total),
                    "memory_free": int(free),
                    "compute_capability": f"{props['major']}.{props['minor']}",
                }
            )
        info["available"] = n > 0
        if n == 0:
            info["reason"] = "cupy is installed but no CUDA device was found. Running on CPU."
    except Exception as e:
        info["reason"] = f"CUDA query failed ({type(e).__name__}: {e}). Running on CPU."
    return info


def abtem_gpu_smoke_test(force: bool = False, timeout: float = 180.0) -> dict[str, Any]:
    """Run a tiny abTEM multislice on the GPU in a subprocess (crash-safe), cached per start."""
    global _smoke_cache
    with _lock:
        if _smoke_cache is not None and not force:
            return _smoke_cache
        try:
            out = subprocess.run(
                [sys.executable, "-c", _SMOKE_SCRIPT],
                capture_output=True,
                text=True,
                timeout=timeout,
            )
            line = out.stdout.strip().splitlines()[-1] if out.stdout.strip() else ""
            result = json.loads(line) if line else {"ok": False, "error": out.stderr[-500:]}
        except subprocess.TimeoutExpired:
            result = {"ok": False, "seconds": timeout, "error": "smoke test timed out"}
        except Exception as e:
            result = {"ok": False, "error": f"{type(e).__name__}: {e}"}
        result["checked_at"] = time.time()
        _smoke_cache = result
        return result


def system_report(run_smoke: bool = True) -> dict[str, Any]:
    cpu = cpu_info()
    gpu = gpu_info()
    smoke: dict[str, Any] | None = None
    if gpu["available"] and run_smoke:
        smoke = abtem_gpu_smoke_test()
    elif _smoke_cache is not None:
        smoke = _smoke_cache
    gpu["abtem_smoke_test"] = smoke
    gpu_usable = bool(gpu["available"] and smoke and smoke.get("ok"))
    workers = cpu["physical_cores"]
    if gpu_usable:
        rec = {"device": "gpu", "workers": 1, "reason": "A working GPU was found."}
    elif gpu["available"] and smoke is None:
        rec = {"device": "cpu", "workers": workers, "reason": "GPU test has not been run yet."}
    else:
        reason = gpu["reason"] or (smoke or {}).get("error") or "No usable GPU."
        rec = {"device": "cpu", "workers": workers, "reason": f"{reason}"}
    plat = platform_info()
    if plat["apple_silicon"] and not gpu_usable:
        rec["reason"] = (
            "Apple silicon: abTEM has no Metal backend, so simulations run on the CPU "
            f"({workers} cores in parallel)."
        )
    return {
        "platform": plat,
        "cpu": cpu,
        "gpu": gpu,
        "gpu_usable": gpu_usable,
        "recommended": rec,
    }

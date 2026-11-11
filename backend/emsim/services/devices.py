"""The compute device a job uses (context.md §5.6, M6).

A job asks for "gpu" or "cpu". The GPU is used only when cupy sees a CUDA device and abTEM's own
smoke test passed; otherwise the job runs on the CPU and says why. Every array call of the
simulators goes through the `device` argument they already take ("cpu" or "gpu" for abTEM, cupy or
numpy for the Bloch and INCOSTEM code), so there is nothing else to switch.
"""

from __future__ import annotations

from . import hardware


def resolve(requested: str) -> tuple[str, str]:
    """(device actually used, a note for the log; empty when the request was met)."""
    if requested != "gpu":
        return "cpu", ""
    info = hardware.gpu_info()
    if not info["available"]:
        return "cpu", f"The GPU was asked for but is not usable: {info['reason'] or 'no CUDA device'}. Using the CPU."
    smoke = info.get("abtem_smoke_test") or hardware.abtem_gpu_smoke_test()
    if not smoke.get("ok"):
        return "cpu", f"The GPU failed abTEM's test ({smoke.get('error')}). Using the CPU."
    return "gpu", ""

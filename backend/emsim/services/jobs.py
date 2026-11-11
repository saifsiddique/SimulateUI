"""The job runner (context.md M6).

One simulation runs at a time, across the whole app; further jobs wait in a queue. Each job runs in
a worker process of its own (`spawn`, so it behaves the same on Windows, macOS and Linux): the API
stays responsive, a crash or a memory error takes down the worker and not the server, and
cancelling is killing that process tree. The worker sends its progress through a queue; this
module turns it into a job record (state, fraction, elapsed and remaining time, message).

Every job has a folder `<projects>/<material>_<space group>/<method>_<type>/<date>_<number>/`
(for example `Si_Fd-3m/multislice_stem/20261105_015`) that holds

    job.json       the record, kept up to date
    project.json   the exact inputs (method and request body)
    versions.json  package versions, the device, the host
    atoms.pkl      the specimen the worker read
    log.txt        what the worker reported
    results/       the arrays and pictures (see `runs.py`), and results.json, which has
                   four sections: sim_type, setup_params, metadata, output

The folder is the result store: `list_jobs` also finds the jobs of earlier sessions there.
"""

from __future__ import annotations

import json
import multiprocessing as mp
import os
import pickle
import platform
import re
import threading
import time
import traceback
from collections import deque
from datetime import datetime
from pathlib import Path
from typing import Any

import psutil

from . import bloch_sim

ACTIVE = ("queued", "running")


def projects_dir() -> Path:
    env = os.environ.get("EMSIM_PROJECTS_DIR")
    return Path(env) if env else Path(__file__).resolve().parents[3] / "projects"


def _highest_number(day: str) -> int:
    """The largest job number among the folders already stored for this date (`YYYYMMDD`)."""
    best = 0
    root = projects_dir()
    if root.is_dir():
        for f in root.glob(f"*/*/{day}_*"):
            m = re.fullmatch(rf"{day}_(\d+)", f.name)
            if m:
                best = max(best, int(m.group(1)))
    return best


def _slug(text: str) -> str:
    s = re.sub(r"[^A-Za-z0-9._-]+", "_", text.strip()).strip("._")
    return s[:60] or "default"


# ---- the worker process ----------------------------------------------------------------------------


def _worker(job_dir: str, queue) -> None:
    """Runs in the child process: read the inputs, simulate, report."""
    import atexit

    from . import runs

    # The saved Bloch solve outlives this process (the app adopts it); only the app deletes it.
    atexit.unregister(bloch_sim.purge_cache_dir)
    d = Path(job_dir)
    try:
        t0 = time.time()
        spec = json.loads((d / "project.json").read_text(encoding="utf8"))
        with open(d / "atoms.pkl", "rb") as f:
            atoms = pickle.load(f)
        params = spec["body"]
        method = spec["method"]
        cache = None
        if method == "bloch":
            # the solve of this run is kept in the run's own folder, not the computer's temp folder
            cache = bloch_sim.ModeCache(base_dir=d / "temp")
            cache.adopt(spec.get("cache"))

        def report(fraction: float, message: str) -> None:
            queue.put({"type": "progress", "fraction": float(min(max(fraction, 0.0), 1.0)),
                       "message": message})

        workers = max(1, int(params.get("workers", 1)))
        results = runs.run(method, atoms, params, d / "results", report, workers, cache)
        _write_results_json(d, spec, atoms, results, time.time() - t0)
        saved = cache.export() if cache is not None else None
        if cache is not None:
            cache.adopt(None)  # the files outlive this process
        queue.put({"type": "done", "results": results, "cache": saved})
    except BaseException as e:  # report every failure, then end
        queue.put({"type": "error", "message": f"{type(e).__name__}: {e}",
                   "trace": traceback.format_exc()})


def _write_results_json(d: Path, spec: dict[str, Any], atoms, output: list[dict[str, Any]],
                        elapsed: float) -> None:
    """results.json, in four sections: what was simulated, the inputs, where and how it ran, and
    the results (with the files they are in)."""
    body = {k: v for k, v in spec["body"].items() if not k.startswith("_")}
    versions_file = d / "versions.json"
    versions = json.loads(versions_file.read_text(encoding="utf8")) if versions_file.is_file() else {}
    lengths = [float(x) for x in atoms.cell.lengths()]
    doc = {
        "sim_type": {"method": spec["method"], "type": body.get("sim_type")},
        "setup_params": body,
        "metadata": {
            "id": spec.get("id"), "name": spec.get("name"), "project": spec.get("project"),
            "created": spec.get("created"),
            "finished": datetime.now().astimezone().isoformat(timespec="seconds"),
            "elapsed_s": round(elapsed, 2),
            "specimen": {"atoms": len(atoms), "cell_angstrom": lengths,
                         "formula": atoms.get_chemical_formula()},
            "software": versions,
        },
        "output": output,
    }
    (d / "results" / "results.json").write_text(json.dumps(doc, indent=2), encoding="utf8")


# ---- the manager -----------------------------------------------------------------------------------


class JobManager:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._jobs: dict[str, dict[str, Any]] = {}
        self._order: list[str] = []
        self._queue: deque[str] = deque()
        self._procs: dict[str, mp.Process] = {}
        self._current: str | None = None
        self._ctx = mp.get_context("spawn")
        self._counter = 0
        self._day = ""

    # -- public ---------------------------------------------------------------------------------

    def submit(self, method: str, body: dict[str, Any], atoms, project: str = "default",
               name: str = "") -> dict[str, Any]:
        with self._lock:
            # The number goes up with every job of the day, across restarts, and starts again at 1
            # on a new date, so a folder name never repeats.
            now = datetime.now()
            day = now.strftime("%Y%m%d")
            if self._day != day:
                self._day, self._counter = day, 0
            self._counter = max(self._counter, _highest_number(day)) + 1
            job_id = f"{day}_{self._counter:03d}"
            kind = f"{method}_{body.get('sim_type') or 'adf'}"  # incostem has one type, ADF-STEM
            folder = projects_dir() / _slug(project) / _slug(kind) / job_id
            folder.mkdir(parents=True, exist_ok=True)
            job = {
                "id": job_id, "name": name or f"{method} {body.get('sim_type', '')}".strip(),
                "project": _slug(project), "method": method, "sim_type": body.get("sim_type"),
                "state": "queued", "fraction": 0.0, "message": "Waiting", "created": time.time(),
                "started": None, "finished": None, "elapsed": 0.0, "eta": None, "error": None,
                "directory": str(folder), "results": [], "device": body.get("device", "cpu"),
            }
            spec = {"id": job_id, "method": method, "body": body, "name": job["name"],
                    "project": job["project"], "created": now.astimezone().isoformat(timespec="seconds")}
            if method == "bloch":
                spec["cache"] = bloch_sim.CACHE.export()
            (folder / "project.json").write_text(json.dumps(spec, indent=2), encoding="utf8")
            with open(folder / "atoms.pkl", "wb") as f:
                pickle.dump(atoms, f)
            (folder / "versions.json").write_text(
                json.dumps(_versions(body.get("device", "cpu")), indent=2), encoding="utf8"
            )
            self._jobs[job_id] = job
            self._order.append(job_id)
            self._queue.append(job_id)
            self._save(job)
        self._next()
        return self.get(job_id)  # type: ignore[return-value]

    def get(self, job_id: str) -> dict[str, Any] | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return self._from_disk(job_id)
            return self._snapshot(job)

    def list_jobs(self, limit: int = 10000) -> list[dict[str, Any]]:
        with self._lock:
            live = [self._snapshot(self._jobs[i]) for i in reversed(self._order)]
        seen = {j["id"] for j in live}
        old = [j for j in self._scan_disk() if j["id"] not in seen]
        return (live + old)[:limit]

    def cancel(self, job_id: str) -> dict[str, Any] | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job["state"] not in ACTIVE:
                return self.get(job_id)
            if job["state"] == "queued":
                self._queue.remove(job_id)
                self._finish(job, "cancelled", message="Cancelled before it started")
                return self._snapshot(job)
            proc = self._procs.get(job_id)
            job["message"] = "Cancelling"
            job["_cancel"] = True
        if proc is not None:
            _kill_tree(proc)
        return self.get(job_id)

    def delete(self, job_id: str) -> bool:
        """Cancel the job if it is active, then remove its folder."""
        import shutil

        job = self.get(job_id)
        if job is None:
            return False
        if job["state"] in ACTIVE:
            self.cancel(job_id)
            self.wait(job_id, 15)
        shutil.rmtree(job["directory"], ignore_errors=True)
        with self._lock:
            self._jobs.pop(job_id, None)
            if job_id in self._order:
                self._order.remove(job_id)
        return True

    def set_results(self, job_id: str, results: list[dict[str, Any]]) -> dict[str, Any] | None:
        """Replace the results of a finished job (the detector settings were applied to them)."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job is not None:
                job["results"] = results
                self._save(job)
                return self._snapshot(job)
        old = self._from_disk(job_id)
        if old is None:
            return None
        old["results"] = results
        (Path(old["directory"]) / "job.json").write_text(json.dumps(old, indent=2), encoding="utf8")
        return old

    def wait(self, job_id: str, timeout: float = 60.0) -> dict[str, Any] | None:
        end = time.time() + timeout
        while time.time() < end:
            j = self.get(job_id)
            if j is None or j["state"] not in ACTIVE:
                return j
            time.sleep(0.05)
        return self.get(job_id)

    def shutdown(self) -> None:
        with self._lock:
            ids = list(self._queue) + ([self._current] if self._current else [])
        for i in ids:
            self.cancel(i)

    # -- internals ------------------------------------------------------------------------------

    def _snapshot(self, job: dict[str, Any]) -> dict[str, Any]:
        snap = {k: v for k, v in job.items() if not k.startswith("_")}
        if snap["state"] == "running" and snap["started"]:
            snap["elapsed"] = time.time() - snap["started"]
            f = snap["fraction"]
            snap["eta"] = snap["elapsed"] * (1 - f) / f if f > 0.02 else None
        snap["queue_position"] = (
            list(self._queue).index(job["id"]) + 1 if job["id"] in self._queue else None
        )
        return snap

    def _save(self, job: dict[str, Any]) -> None:
        snap = {k: v for k, v in job.items() if not k.startswith("_")}
        try:
            (Path(job["directory"]) / "job.json").write_text(json.dumps(snap, indent=2), encoding="utf8")
        except OSError:
            pass

    def _from_disk(self, job_id: str) -> dict[str, Any] | None:
        for j in self._scan_disk():
            if j["id"] == job_id:
                return j
        return None

    def _scan_disk(self) -> list[dict[str, Any]]:
        out = []
        root = projects_dir()
        if not root.is_dir():
            return out
        for f in root.glob("*/*/*/job.json"):
            try:
                j = json.loads(f.read_text(encoding="utf8"))
            except (OSError, ValueError):
                continue
            if j.get("state") in ACTIVE:  # left by a program that was closed
                j["state"], j["message"] = "failed", "The program was closed while this job ran."
            j["queue_position"] = None
            # the folder the record is in, not the one it was written in: a projects folder that
            # was moved or copied must never send reads and writes back to the old place
            j["directory"] = str(f.parent)
            out.append(j)
        out.sort(key=lambda j: j.get("created", 0), reverse=True)
        return out

    def _next(self) -> None:
        with self._lock:
            if self._current is not None or not self._queue:
                return
            job_id = self._queue.popleft()
            job = self._jobs[job_id]
            self._current = job_id
            job["state"], job["started"], job["message"] = "running", time.time(), "Starting"
            self._save(job)
            queue = self._ctx.Queue()
            proc = self._ctx.Process(target=_worker, args=(job["directory"], queue), daemon=False)
            self._procs[job_id] = proc
        proc.start()
        threading.Thread(target=self._watch, args=(job_id, proc, queue), daemon=True,
                         name=f"job-{job_id}").start()

    def _watch(self, job_id: str, proc: mp.Process, queue) -> None:
        job = self._jobs[job_id]
        log = open(Path(job["directory"]) / "log.txt", "a", encoding="utf8")
        outcome: dict[str, Any] | None = None
        try:
            while True:
                try:
                    msg = queue.get(timeout=0.2)
                except Exception:
                    if not proc.is_alive():
                        try:  # one last look: the message may have arrived just before the exit
                            msg = queue.get(timeout=0.5)
                        except Exception:
                            break
                    else:
                        continue
                if msg["type"] == "progress":
                    with self._lock:
                        job["fraction"], job["message"] = msg["fraction"], msg["message"]
                    log.write(f"{time.strftime('%H:%M:%S')} {msg['fraction']:.3f} {msg['message']}\n")
                    log.flush()
                else:
                    outcome = msg
                    break
            proc.join(10)
            if proc.is_alive():
                _kill_tree(proc)
        finally:
            with self._lock:
                if job["method"] == "bloch":  # the solve the worker saved now belongs to the app
                    bloch_sim.CACHE.adopt(outcome.get("cache") if outcome else None)
                cancelled = job.get("_cancel", False)
                if cancelled:
                    self._finish(job, "cancelled", message="Cancelled")
                elif outcome and outcome["type"] == "done":
                    job["results"] = outcome["results"]
                    self._finish(job, "done", message="Done", fraction=1.0)
                elif outcome:
                    log.write(outcome.get("trace", ""))
                    self._finish(job, "failed", message=outcome["message"], error=outcome["message"])
                else:
                    code = proc.exitcode
                    text = f"The worker stopped unexpectedly (exit code {code}); it may have run out of memory."
                    self._finish(job, "failed", message=text, error=text)
                self._procs.pop(job_id, None)
                self._current = None
            log.close()
            self._next()

    def _finish(self, job: dict[str, Any], state: str, message: str = "", error: str | None = None,
                fraction: float | None = None) -> None:
        job["state"], job["message"], job["finished"] = state, message, time.time()
        job["error"] = error
        if fraction is not None:
            job["fraction"] = fraction
        if job["started"]:
            job["elapsed"] = job["finished"] - job["started"]
        job["eta"] = None
        self._save(job)


def _kill_tree(proc: mp.Process) -> None:
    try:
        parent = psutil.Process(proc.pid)
        kids = parent.children(recursive=True)
    except psutil.Error:
        kids = []
    for k in kids:
        try:
            k.kill()
        except psutil.Error:
            pass
    try:
        proc.kill()
    except Exception:
        pass


def _versions(device: str) -> dict[str, Any]:
    import importlib.metadata as md

    def v(pkg: str) -> str | None:
        try:
            return md.version(pkg)
        except md.PackageNotFoundError:
            return None

    return {
        "packages": {p: v(p) for p in ("abtem", "ase", "numpy", "dask", "zarr", "cupy", "scipy")},
        "python": platform.python_version(), "platform": platform.platform(),
        "device_requested": device, "cpu_count": os.cpu_count(),
    }


def open_folder(path: Path) -> None:
    """Show a folder in the system's file manager (the app runs on the user's own computer)."""
    import subprocess
    import sys

    if sys.platform == "win32":
        os.startfile(path)  # type: ignore[attr-defined]
    else:
        subprocess.Popen(["open" if sys.platform == "darwin" else "xdg-open", str(path)])


manager = JobManager()

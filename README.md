# SimulateUI

Set up and run **electron microscopy simulations in your web browser**, starting from a crystal
structure file (CIF). You load a structure, choose the zone axis and the size of the specimen,
pick the kind of simulation and its parameters while live previews show what you are choosing,
then run it and look at the results, add a detector's dose and noise, and export them.

Everything runs on your own computer. The simulations use [abTEM](https://abtem.readthedocs.io)
(multislice and Bloch wave) and a re-implementation of Kirkland's incoherent STEM model
(INCOSTEM). It works on **Windows, macOS and Linux**, uses an **NVIDIA GPU** when there is one, and
otherwise all the cores of the CPU.

## What it can simulate

| Method | Simulation | What you get |
|---|---|---|
| **Multislice** (abTEM) | **HRTEM** | The image after the objective lens (defocus, aberrations, aperture), and the complex exit wave (phase and amplitude) |
| | **SAED** | The selected-area diffraction pattern of a plane wave, including dynamical scattering |
| | **CBED** | The convergent-beam pattern of a focused probe |
| | **STEM** | Images for any annular detectors (BF, ABF, ADF, HAADF), over a scan area you draw |
| | **4D-STEM** | A full diffraction pattern at every scan position; virtual detectors in the viewer |
| **Bloch wave** | **SAED** | The dynamical spot pattern, solved with Bloch waves (fast for thick crystals) |
| | **CBED** | Convergent-beam discs from many incident directions |
| | **LACBED** | One large-angle disc per beam (α up to 60 mrad); pick any disc by its h k l |
| **INCOSTEM** | **ADF-STEM** | An incoherent (thin-specimen) ADF image in seconds, with probe, source size and defocus spread |

All of them can include:

- a **thickness series** (one result per depth);
- a **defocus series** or a **tilt series**, where it applies;
- **frozen phonons** (thermal vibrations).

Afterwards, every result can be **post-processed** without simulating again:

- a target pixel size (Fourier interpolation);
- Gaussian blur;
- an electron dose with Poisson shot noise.

The **results viewer** has:

- thickness and defocus sliders;
- colour maps and linear/log/power scales with vmin/vmax;
- zoom, pan and a scale bar;
- 4D-STEM virtual detectors;
- export as PNG, TIFF, NPY or HDF5 (with the calibration).

---

## Installation (step by step)

You need about **5 GB of free disk space** and an internet connection for the installation. You do
this once.

### Step 1: Install Miniforge (Python and its package manager)

Miniforge gives you `conda`, the tool that installs Python and every package this program needs,
in a separate "environment" that does not touch anything else on your computer.

- **Windows:** download `Miniforge3-Windows-x86_64.exe` from
  <https://github.com/conda-forge/miniforge/releases/latest> and run it. Accept the defaults
  ("Just me" is fine). Afterwards you will find **Miniforge Prompt** in the Start menu. Use that
  window for every command below.
- **macOS:** open the **Terminal** app and run
  ```
  curl -L -O "https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-$(uname)-$(uname -m).sh"
  bash Miniforge3-$(uname)-$(uname -m).sh
  ```
  Answer `yes` to the questions, then **close and reopen** the Terminal.
- **Linux:** the same two commands as macOS, in a terminal.

To check that it worked, type `conda --version` in the Miniforge Prompt / Terminal. It should
print a version number.

### Step 2: Get the program

- **With git:** `git clone https://github.com/saifsiddique/SimulateUI.git`
- **Without git:** on the GitHub page of the repository press the green **Code** button, then
  **Download ZIP**, and unzip it somewhere (for example in your Documents folder).

Then go into the folder in the Miniforge Prompt / Terminal. `cd` means "change directory". Use
your own path:

```
cd Documents/SimulateUI
```

(Tip: type `cd ` and then drag the folder from the file explorer into the window, then press Enter.)

### Step 3: Create the Python environment

Choose **one** of the two commands.

- **Most computers** (no NVIDIA graphics card, and every Mac):
  ```
  conda env create -f environment.yml
  ```
- **Computers with an NVIDIA graphics card** (Windows or Linux), to run multislice on the GPU:
  ```
  conda env create -f environment-cuda.yml
  ```
  The driver must support CUDA 12 or newer. Run `nvidia-smi`: the "CUDA Version" at the top
  must be 12.0 or higher.

This downloads and installs everything: Python, abTEM, the other scientific packages and Node.js
(used to build the web page). It takes 5 to 20 minutes. When it ends you have an environment
called **em-sim**.

### Step 4: Start the program

Every time you want to use SimulateUI, open the Miniforge Prompt / Terminal and run:

```
cd Documents/SimulateUI        (your folder)
conda activate em-sim
```

then start it:

| System | Command |
|---|---|
| Windows (Miniforge Prompt) | `run` |
| Windows (PowerShell) | `./run.ps1` |
| macOS / Linux | `./run.sh` |

The first start takes a minute or two longer. It installs the web page's packages and builds the
page. Then it prints `Open http://localhost:8765`. **Open <http://localhost:8765> in your web
browser** (Chrome, Edge, Firefox or Safari). Keep the Miniforge Prompt / Terminal window open while
you work. It is the server, and the browser only shows the page.

To **stop** the program, click in that window and press **Ctrl + C**.

> If the scripts do not work on your system, these commands do the same in any terminal
> (inside the activated `em-sim` environment):
> ```
> cd frontend
> npm ci
> npm run build
> cd ..
> uvicorn emsim.main:app --app-dir backend --port 8765
> ```

### Updating

Get the new version: `git pull`, or download the ZIP again. Then, if `environment.yml` changed:

```
conda env update -f environment.yml --prune
```

The start script rebuilds the page by itself when its sources have changed.

---

## Using it

The fastest way in is the **Examples…** menu at the top. Pick one, and the structure opens with its
specimen built and the simulation set up. Go to **④ Run · Results** and press **Run simulation**.

| Example | Method |
|---|---|
| Si [110] HAADF-STEM | multislice |
| Si [110] CBED | multislice |
| Si [110] SAED | Bloch wave |
| Si [110] HAADF | INCOSTEM |
| SrTiO₃ [001] 4D-STEM | multislice |
| Au [110] HRTEM | multislice |
| 1T-TaS₂ [001] LACBED | Bloch wave |

The CIFs of the examples are in `examples/cifs/`.

With your own structure, press **Open CIF…** (or drop `.cif` / `.xyz` files on the bar) and work
through the tabs. The tab bar shows what is done.

1. **① Structure:** the crystal in 3D. Turn it with the mouse or type a zone axis [uvw]. The
   direction you look along becomes the beam direction.
2. **② Specimen:** the zone axis, the size (number of unit cells along x, y and the beam), the
   centre, and partial occupancies. Press **Build**: the app finds a periodic, orthogonal box along
   that zone axis (with the smallest strain) and shows what will be simulated.
3. **③ Simulation:** choose the method and the type, then the parameters (voltage, convergence
   angle, aberrations, sampling, scan area, detectors, series). The previews update as you type:
   - the projected potential and the scan area;
   - the diffraction plane with the detectors;
   - the probe;
   - the memory and time estimates.

   Warnings appear when something is off, for example a scan step coarser than Nyquist, a detector
   beyond the simulated angle, or the scan too close to the box edge.
4. **④ Run · Results:**
   - **Compute** shows the device and the cost.
   - **Run** shows the checklist and starts the job. One job runs at a time and the others wait;
     you can cancel.
   - **Postprocessing** applies a pixel size, blur, dose and noise to the finished run.
   - **Output** lists this run and all earlier ones; **Open run folder** opens the folder.
   - The **Results viewer** shows and exports the results.

**Save setup** stores the structure and all your choices in one `.simulateui.json` file, and **Open
setup…** brings them back. The status pill at the top right shows the compute device (GPU or CPU)
and lets you switch.

### Where results are stored

Each run gets its own folder:

```
projects/<structure>_<space group>/<method>_<type>/<date>_<number>/
    project.json      the exact inputs
    versions.json     the package versions and the device
    log.txt
    results/          the results (.npy; 4D-STEM as .zarr; Bloch as .npz), PNG previews, results.json
    Exports/          what you export from the viewer (PNG, TIFF, NPY, HDF5)
```

The number starts at 001 on each new date. Set the environment variable `EMSIM_PROJECTS_DIR` to
keep the projects somewhere else.

Reading the files in Python:

```python
import numpy as np, h5py
img = np.load("results/stem_HAADF.npy")          # (run, depth, x, y)
with np.load("results/lacbed.npz") as z:          # Bloch LACBED: one disc per beam
    disc = z["0_0_0"]                             # (depth, y, x)
with h5py.File("Exports/4dstem_native.h5") as f:  # an HDF5 export, with its calibration
    data, pixel = f["data"][...], f["data"].attrs["pixel"]
```

---

## Troubleshooting

| Problem | What to do |
|---|---|
| `conda env create` takes very long or fails on Windows with long paths | Update conda (`conda update -n base conda`), which brings the fast solver. Then try again in a short folder, e.g. `C:\SimulateUI` |
| `uvicorn not found` | You forgot `conda activate em-sim` |
| "Port 8765 is already in use" | Another program uses it. Start with `run -Port 9000` (Windows) or `EMSIM_PORT=9000 ./run.sh`, and open <http://localhost:9000> |
| The page is blank | Reload it (Ctrl + F5). If it stays blank, press F12 and look at the console for errors |
| "GPU unavailable" in the status pill | The CPU is used instead, which is fine but slower. For the GPU you need `environment-cuda.yml` and an NVIDIA driver with CUDA ≥ 12 |
| A run needs more memory than is free | ④ warns before you start. Use a coarser potential sampling, a smaller scan area, fewer frozen phonons or binning |
| `./run.sh: Permission denied` (macOS/Linux) | Run `chmod +x run.sh` once |

---

## For developers

```
conda activate em-sim
./run.ps1 -Dev                 # or ./run.sh --dev: hot reload at http://localhost:5273
cd backend && pytest           # backend tests
cd frontend
npm run check && npm run lint && npm test     # types, lint, unit tests
npx playwright install chromium               # once
npm run test:e2e                              # browser tests against the real backend
```

`MAKE_EXAMPLES=1 npx playwright test tests/e2e/examples.spec.ts` regenerates the example setups
from `examples/cifs/`. `backend/tests/test_m8_tas2.py` re-checks a folder of stored runs
(`EMSIM_TAS2_RUNS=<folder>`, or `projects/1T-TaS2_P-3m1`). It works on a copy and is skipped when
the folder is not there.

The code is organised like this:

- `backend/`: Python. FastAPI app `emsim.main`, with `api/` (endpoints) and `services/`
  (simulations, jobs, post-processing, viewer). All abTEM calls live in `services/abtem_sim.py`,
  `bloch_sim.py` and `runs.py`.
- `frontend/`: Svelte 5 + TypeScript + three.js. `src/core` holds the pure logic (CIF parsing,
  symmetry, orientation; copied from the strFac_app project), `src/ui` the components, `src/state`
  the stores.
- `examples/cifs/`: the structures of the examples.

Continuous integration (`.github/workflows/ci.yml`) runs the backend and frontend tests on Windows,
macOS and Linux (CPU), and the browser tests on Linux.

### Tested versions

The versions are pinned in `environment.yml`. It was tested together on Windows 11 with an NVIDIA
RTX A4000:

| Package | Version |
|---|---|
| Python | 3.12.16 |
| abTEM | 1.0.11 |
| numpy | 2.5.4 |
| scipy | 1.17.1 |
| ASE | 3.29.0 |
| dask | 2026.8.0 |
| zarr | 3.4.1 |
| h5py | 3.16.0 |
| cupy (GPU only) | 14.2.0 (CUDA 12.9) |
| FastAPI | 0.162.0 |
| Node.js | 24.22.1 |

### Validation

- **Bloch wave:** SAED intensities agree with py4DSTEM 0.14.18 to 3e-6 (Si [110]), 1e-4 (Si [111])
  and 3e-4 (rutile [001]). A Si [110] LACBED agrees with a correlation of 1.0000. The tests keep
  these references.
- **4D-STEM:** virtual BF and ADF images match the STEM detector images of the same angles
  (correlation > 0.99).
- **INCOSTEM:** checked against Kirkland's computem.
- **GPU:** the GPU and CPU results agree.

### Caveats

- abTEM changes its API between releases, so it is pinned. Every abTEM call is in
  `backend/emsim/services/`.
- Do not `pip install py4dstem` into this environment. It needs numpy < 2 and would break the
  installation.
- INCOSTEM ignores channelling, so it is only valid for thin specimens. The app warns above 50 Å.
- Apple-silicon GPUs are not used. abTEM has no Metal backend, so Macs run on the CPU (all cores).

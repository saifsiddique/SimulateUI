# Starts SimulateUI: the backend, which also serves the page (and, with -Dev, the Vite dev server).
# Run from the repository root inside the activated environment:
#     conda activate em-sim
#     ./run.ps1            then open http://localhost:8765
# Ports are deliberately unusual so they do not clash with other projects (8000 and 5173 are
# the defaults of many tools). Override with -Port / -DevPort.
param([switch]$Dev, [int]$Port = 8765, [int]$DevPort = 5273)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontend = Join-Path $root 'frontend'
if (-not (Get-Command uvicorn -ErrorAction SilentlyContinue)) {
    Write-Error "uvicorn not found. Activate the environment first: conda activate em-sim"
    exit 1
}

function Test-PortFree([int]$p) {
    -not (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)
}
if (-not (Test-PortFree $Port)) {
    Write-Error "Port $Port is already in use. Pick another with -Port, or stop the other program."
    exit 1
}

# The first start installs the frontend's packages (frontend/node_modules).
if (-not (Test-Path (Join-Path $frontend 'node_modules'))) {
    Write-Host "Installing the frontend packages (first start only)..."
    Push-Location $frontend; npm ci; $ok = $?; Pop-Location
    if (-not $ok) { Write-Error "npm ci failed (see above)."; exit 1 }
}

# The Vite proxy and the CORS list read these.
$env:EMSIM_PORT = "$Port"
$env:EMSIM_DEV_PORT = "$DevPort"

if ($Dev) {
    if (-not (Test-PortFree $DevPort)) {
        Write-Error "Port $DevPort is already in use. Pick another with -DevPort."
        exit 1
    }
    $fe = Start-Process -PassThru -NoNewWindow npm -ArgumentList "run", "dev", "--", "--port", "$DevPort", "--strictPort" -WorkingDirectory $frontend
    Write-Host "Frontend dev server: http://localhost:$DevPort"
} else {
    # Build the page when it is missing or older than its sources (for example after an update).
    $index = Join-Path $frontend 'dist\index.html'
    $newest = Get-ChildItem (Join-Path $frontend 'src'), (Join-Path $frontend 'public'), (Join-Path $frontend 'index.html') -Recurse -File |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not (Test-Path $index) -or $newest.LastWriteTime -gt (Get-Item $index).LastWriteTime) {
        Write-Host "Building the page (frontend\dist)..."
        Push-Location $frontend; npm run build; $ok = $?; Pop-Location
        if (-not $ok) { Write-Error "The build failed (see above)."; exit 1 }
    }
    Write-Host "Open http://localhost:$Port"
}

try {
    uvicorn emsim.main:app --app-dir (Join-Path $root 'backend') --port $Port --reload
} finally {
    if ($fe) { Stop-Process -Id $fe.Id -ErrorAction SilentlyContinue }
}

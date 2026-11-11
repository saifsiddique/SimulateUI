@echo off
rem Starts SimulateUI from the Windows "Miniforge Prompt" (or any cmd window):
rem     conda activate em-sim
rem     run
rem then open http://localhost:8765 in the browser. Options are passed on to run.ps1,
rem e.g.  run -Port 9000
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*

@echo off
rem Double-click to open Ahmed AI Video Editor (first run installs it). See launcher\start.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0launcher\start.ps1" %*

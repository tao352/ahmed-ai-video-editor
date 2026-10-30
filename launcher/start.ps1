# Ahmed AI Video Editor launcher (Windows). Double-click "Ahmed AI Video Editor.cmd" in the main folder.
# Works from wherever the folder is: every path is relative to this file.
#  1. first run: checks Node, installs the editor and renderer packages (one time, a few minutes),
#     and puts a shortcut with the app icon on the desktop;
#  2. starts the editor server in the background (port 5411) with the optimised build, rebuilding it
#     whenever the source is newer;
#  3. opens the editor in its own window (Chrome or Edge app mode; else the default browser).
# Closing the window leaves the server running, so the next open is instant. -Stop stops it.
param([switch]$Stop, [string]$Project = "")

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$port = 5411
$url = "http://localhost:$port/"
if ($Project) { $url += "?project=" + [uri]::EscapeDataString($Project) }
$log = Join-Path $root "editor\.launch.log"
Add-Type -AssemblyName System.Windows.Forms

function Say([string]$text, [string]$icon = "Information") {
  [System.Windows.Forms.MessageBox]::Show($text, "Ahmed AI Video Editor", "OK", $icon) | Out-Null
}
function Test-Server {
  try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://localhost:$port/api/projects").StatusCode -eq 200 } catch { $false }
}

if ($Stop) {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
  Write-Host "Editor server stopped."
  exit
}

if (-not (Test-Server)) {
  # Node is the one thing the editor cannot install by itself
  if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Say "Node.js is not installed.`n`nInstall the LTS version from https://nodejs.org (or run: winget install OpenJS.NodeJS.LTS), then open the editor again." "Warning"
    Start-Process "https://nodejs.org/en/download"
    exit 1
  }
  if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Say "ffmpeg was not found. The editor opens, but rendering, previews and audio tools need it.`n`nInstall it with: winget install Gyan.FFmpeg" "Warning"
  }

  # first run: packages (shown in a window, since it takes a few minutes)
  $first = -not (Test-Path (Join-Path $root "reel\node_modules\remotion")) -or -not (Test-Path (Join-Path $root "editor\node_modules\vite"))
  if ($first) {
    Say "First start: installing the editor (a few minutes, about 750 MB). A window shows the progress; the editor opens when it is done."
    $install = Start-Process -FilePath "cmd.exe" -Wait -PassThru -WorkingDirectory $root -ArgumentList "/c title Installing Ahmed AI Video Editor && npm --prefix reel ci && npm --prefix editor ci || pause"
    if ($install.ExitCode -ne 0) { Say "The install did not finish. Check your internet connection and open the editor again." "Error"; exit 1 }
    & (Join-Path $PSScriptRoot "make-shortcut.ps1") | Out-Null
  }

  # the optimised build, redone when the source is newer than it
  $dist = Join-Path $root "editor\dist\index.html"
  $stale = -not (Test-Path $dist)
  if (-not $stale) {
    $built = (Get-Item $dist).LastWriteTime
    $sources = @("editor\src", "editor\server", "reel\src") | ForEach-Object { Join-Path $root $_ }
    $stale = [bool](Get-ChildItem $sources -Recurse -File | Where-Object { $_.LastWriteTime -gt $built -and $_.Name -notlike "*.test.*" } | Select-Object -First 1)
  }
  $script = if ($stale) { "app" } else { "serve" }  # app = build, then serve
  Start-Process -WindowStyle Hidden -FilePath "cmd.exe" -ArgumentList "/c npm --prefix `"$root\editor`" run $script > `"$log`" 2>&1" -WorkingDirectory $root
  for ($i = 0; $i -lt 240 -and -not (Test-Server); $i++) { Start-Sleep -Milliseconds 500 }
  if (-not (Test-Server)) { Say "The editor server did not start. Details are in:`n$log" "Error"; exit 1 }
}

# its own window, like an installed app
$browsers = @(@(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ })
if ($browsers.Count) {
  $appProfile = Join-Path $env:LOCALAPPDATA "AhmedAIVideoEditor\browser"
  Start-Process -FilePath $browsers[0] -ArgumentList "--app=$url", "--user-data-dir=`"$appProfile`"", "--window-size=1600,960", "--no-first-run", "--autoplay-policy=no-user-gesture-required"
} else {
  Start-Process $url
}

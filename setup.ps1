# Full setup on Windows, for a person or an AI assistant. Safe to run again (it skips what is done).
#   powershell -ExecutionPolicy Bypass -File setup.ps1             # editor + media tools
#   powershell -ExecutionPolicy Bypass -File setup.ps1 -Tracking   # also tracking (torch, SAM2, models)
# The launcher ("Ahmed AI Video Editor.cmd") only needs Node; this script adds the Python side.
param([switch]$Tracking, [switch]$NoCheck)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
function Step($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Need($cmd, $hint) { if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Write-Host "MISSING $cmd -> $hint" -ForegroundColor Yellow; return $false }; $true }

Step "Programs"
$ok = (Need node "winget install OpenJS.NodeJS.LTS") -and (Need ffmpeg "winget install Gyan.FFmpeg")
$py = if (Get-Command python -ErrorAction SilentlyContinue) { "python" } else { $null }
if (-not $py) { Write-Host "MISSING python -> winget install Python.Python.3.12" -ForegroundColor Yellow; $ok = $false }
if (-not $ok) { Write-Host "`nInstall the missing programs, open a new terminal, and run setup.ps1 again."; exit 1 }
node --version; ffmpeg -hide_banner -version | Select-Object -First 1; & $py --version

Step "Editor and renderer packages"
if (-not (Test-Path "$root\reel\node_modules\remotion")) { npm --prefix "$root\reel" ci } else { "reel: installed" }
if (-not (Test-Path "$root\editor\node_modules\vite")) { npm --prefix "$root\editor" ci } else { "editor: installed" }

Step "Python packages"
& $py -m pip install --disable-pip-version-check -r "$root\requirements.txt"

if ($Tracking) {
  Step "Tracking: torch (GPU build when there is an NVIDIA card)"
  $index = "https://download.pytorch.org/whl/cpu"
  if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
    $driver = [double]((nvidia-smi --query-gpu=driver_version --format=csv,noheader | Select-Object -First 1).Split('.')[0])
    # CUDA 13 wheels need driver 580+, CUDA 12.8 wheels need 570+
    $index = if ($driver -ge 580) { "https://download.pytorch.org/whl/cu130" } elseif ($driver -ge 570) { "https://download.pytorch.org/whl/cu128" } else { "https://download.pytorch.org/whl/cu126" }
  }
  & $py -m pip install --disable-pip-version-check torch torchvision --index-url $index
  & $py -m pip install --disable-pip-version-check sam2
  Step "Tracking: models"
  & $py "$root\tools\track\get_models.py"
  & $py -c "import torch; print('torch', torch.__version__, 'GPU' if torch.cuda.is_available() else 'CPU only')"
}

if (-not $NoCheck) {
  Step "Check"
  npm --prefix "$root\editor" run check
}
Write-Host "`nDone. Open the editor with 'Ahmed AI Video Editor.cmd'." -ForegroundColor Green

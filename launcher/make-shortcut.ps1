# Puts an "Ahmed AI Video Editor" shortcut with the app icon on the desktop (the launcher does this on first run).
$here = $PSScriptRoot
$desktop = [Environment]::GetFolderPath("Desktop")
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut((Join-Path $desktop "Ahmed AI Video Editor.lnk"))
$link.TargetPath = "powershell.exe"
$link.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$here\start.ps1`""
$link.WorkingDirectory = Split-Path -Parent $here
$link.WindowStyle = 7
$link.IconLocation = Join-Path $here "app.ico"
$link.Description = "Open Ahmed AI Video Editor"
$link.Save()
Write-Host "Shortcut created on the desktop: Ahmed AI Video Editor"

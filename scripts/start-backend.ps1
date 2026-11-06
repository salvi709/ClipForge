$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location $projectRoot
if (Get-NetTCPConnection -State Listen -LocalPort 8000 -ErrorAction SilentlyContinue) {
    throw 'Port 8000 is already in use. Stop the existing ClipForge backend with Ctrl+C in its terminal before restarting. Settings are loaded at process startup.'
}
# Reuse a project-local portable FFmpeg installation if present.
$portableFfmpeg = Get-ChildItem -LiteralPath (Join-Path $projectRoot '.runtime\ffmpeg') -Filter ffmpeg.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if ($portableFfmpeg -and -not $env:CLIPFORGE_FFMPEG) { $env:CLIPFORGE_FFMPEG = $portableFfmpeg.FullName }
if ($portableFfmpeg -and -not $env:CLIPFORGE_FFPROBE) { $env:CLIPFORGE_FFPROBE = Join-Path $portableFfmpeg.DirectoryName 'ffprobe.exe' }
& .\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000

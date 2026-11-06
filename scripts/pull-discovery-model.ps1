param([string]$Model = $(if ($env:CLIPFORGE_OLLAMA_MODEL) { $env:CLIPFORGE_OLLAMA_MODEL } else { 'qwen2.5:3b' }))
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$portable = Join-Path $projectRoot '.runtime\ollama\ollama.exe'
Write-Host "Explicit setup download: $Model. Run this only when you intend to download a missing model. Keep Ollama running."
$env:OLLAMA_HOST = '127.0.0.1:11434'
if (Get-Command ollama -ErrorAction SilentlyContinue) { ollama pull $Model } elseif (Test-Path -LiteralPath $portable) { & $portable pull $Model } else { throw 'Ollama is not installed or on PATH.' }

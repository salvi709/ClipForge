$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$portable = Join-Path $projectRoot '.runtime\ollama\ollama.exe'
$env:OLLAMA_HOST = '127.0.0.1:11434'
$env:OLLAMA_NO_CLOUD = '1'
try {
    $null = Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 3
    Write-Host 'Ollama is already reachable at http://127.0.0.1:11434. Reusing its existing local model library.'
    return
} catch { }
if (Get-Command ollama -ErrorAction SilentlyContinue) {
    ollama serve
} elseif (Test-Path -LiteralPath $portable) {
    $env:OLLAMA_HOST = '127.0.0.1:11434'
    $env:OLLAMA_MODELS = Join-Path $projectRoot 'models\ollama'
    $env:OLLAMA_NO_CLOUD = '1'
    $env:OLLAMA_MAX_LOADED_MODELS = '1'
    & $portable serve
} else {
    throw 'Ollama is not installed or on PATH. Install it explicitly; no download was started.'
}

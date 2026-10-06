param([switch]$Install)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$jarvisUv = Join-Path $env:LOCALAPPDATA 'hermes/bin/uv.exe'
if (-not (Test-Path $jarvisUv)) { throw 'uv is required. Install Hermes or uv first.' }
if ($Install -or -not (Test-Path '.venv/Scripts/python.exe')) {
    & $jarvisUv sync --frozen
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed' }
}
& .venv/Scripts/python.exe bootstrap.py
if ($LASTEXITCODE -ne 0) { throw 'Configuration setup failed' }
& docker compose --env-file .env up -d --wait --quiet-pull
if ($LASTEXITCODE -ne 0) { throw 'Start Docker Desktop and retry.' }
Write-Host 'Open http://127.0.0.1:8000/setup'
& .venv/Scripts/python.exe -m uvicorn app:app --host 127.0.0.1 --port 8000

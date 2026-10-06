$ErrorActionPreference = 'Stop'
$jarvisHermesHome = Join-Path $env:LOCALAPPDATA 'hermes'
$jarvisHermesCli = Join-Path $jarvisHermesHome 'hermes-agent/venv/Scripts/hermes.exe'
if (-not (Test-Path $jarvisHermesCli)) { throw 'Local Hermes installation not found.' }
$env:HERMES_HOME = $jarvisHermesHome
# Reauthenticate the existing Nous provider without changing the selected model.
& $jarvisHermesCli auth add nous --type oauth
if ($LASTEXITCODE -ne 0) { throw 'Hermes authentication did not complete.' }

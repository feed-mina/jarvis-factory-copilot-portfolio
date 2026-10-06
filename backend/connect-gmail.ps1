param([Parameter(Mandatory=$true)][string]$ClientFile)
$ErrorActionPreference='Stop'
Set-Location $PSScriptRoot
& .venv/Scripts/python.exe gmail_auth.py --client $ClientFile
if ($LASTEXITCODE -ne 0) { throw 'Gmail authorization did not complete.' }

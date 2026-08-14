# res-compile.ps1 — compile the shared Android resources (icons etc.) with aapt2.
# Usage: powershell -File tools/res-compile.ps1 -OutDir <dir>
# Writes <OutDir>/res.zip to be passed to aapt2 link.
param(
  [Parameter(Mandatory=$true)][string]$OutDir
)
$ErrorActionPreference = 'Stop'
$proj = $PSScriptRoot
$sdk = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $proj '..\..\android-sdk' }
$aapt2 = Join-Path $sdk 'build-tools\34.0.0\aapt2.exe'
if (-not (Test-Path $aapt2)) { throw "aapt2 not found: $aapt2 (set ANDROID_SDK_ROOT or place android-sdk at repo/../android-sdk)" }
$resDir = Join-Path $proj '..\app\common\res'
if (-not (Test-Path (Join-Path $resDir 'mipmap-xxxhdpi\ic_launcher.png'))) { throw 'shared res missing — icons not generated?' }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
& $aapt2 compile --dir $resDir -o (Join-Path $OutDir 'res.zip')
if ($LASTEXITCODE -ne 0) { throw 'aapt2 compile failed' }
Write-Output (Join-Path $OutDir 'res.zip')

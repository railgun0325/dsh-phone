# release-v0.2.0.ps1 — build the GitHub Release v0.2.0 with both APKs.
# Usage: powershell -File tools/release-v0.2.0.ps1
# Requires: gh CLI logged in, both APKs built (app/root/out/dsh-phone-root.apk,
# app/shizuku/out/dsh-phone-shizuku.apk).
$ErrorActionPreference = 'Stop'
$repo = 'D:\AI\DSH\dsh-phone'
$rootApk = Join-Path $repo 'app\root\out\dsh-phone-root.apk'
$shizukuApk = Join-Path $repo 'app\shizuku\out\dsh-phone-shizuku.apk'
$notes = Join-Path $repo 'tools\release-notes-v0.2.0.md'
foreach ($f in @($rootApk, $shizukuApk, $notes)) {
  if (-not (Test-Path $f)) { throw "missing: $f" }
}
$stage = Join-Path $repo 'out-release'
New-Item -ItemType Directory -Force -Path $stage | Out-Null
$rootRelease = Join-Path $stage 'dsh-phone-root-v0.2.0.apk'
$shizukuRelease = Join-Path $stage 'dsh-phone-shizuku-v0.2.0.apk'
Copy-Item $rootApk $rootRelease -Force
Copy-Item $shizukuApk $shizukuRelease -Force

# SHA256SUMS for the release
$sums = Get-FileHash $rootRelease, $shizukuRelease -Algorithm SHA256 | ForEach-Object {
  ('{0}  {1}' -f $_.Hash.ToLower(), ($_.Path | Split-Path -Leaf))
}
$sums | Set-Content (Join-Path $stage 'SHA256SUMS-v0.2.0.txt')
Write-Output $sums

# create + upload
$tag = 'v0.2.0'
$exists = gh release view $tag -R railgun0325/dsh-phone 2>$null
if (-not $exists) {
  gh release create $tag -R railgun0325/dsh-phone --title 'v0.2.0 — 双版本一键部署（Root + Shizuku）' --notes-file $notes $rootRelease $shizukuRelease (Join-Path $stage 'SHA256SUMS-v0.2.0.txt')
} else {
  Write-Output "tag $tag exists — uploading assets instead"
  gh release upload $tag -R railgun0325/dsh-phone --clobber $rootRelease $shizukuRelease (Join-Path $stage 'SHA256SUMS-v0.2.0.txt')
}
Write-Output 'RELEASE DONE'

# fetch-assets.ps1 — download third-party APKs/JARs needed to build the DSH Phone APKs.
# Everything lands in assets/ (gitignored). URLs are pinned; SHA256SUMS.txt is generated.
# Sources:
#   Termux      GPL-3.0  https://github.com/termux/termux-app   (v0.118.3 embeds its bootstrap zip in the APK)
#   Termux:Boot GPL-3.0  https://github.com/termux/termux-boot
#   Termux:API  GPL-3.0  https://github.com/termux/termux-api
#   Shizuku     Apache-2.0 https://github.com/RikkaApps/Shizuku
#   Shizuku API Apache-2.0 https://repo1.maven.org/maven2/dev/rikka/shizuku/api
$ErrorActionPreference = 'Stop'
$assets = Join-Path $PSScriptRoot '..\assets'
New-Item -ItemType Directory -Force -Path $assets | Out-Null

$items = @(
  @{ name = 'termux.apk';       url = 'https://github.com/termux/termux-app/releases/download/v0.118.3/termux-app_v0.118.3+github-debug_arm64-v8a.apk';
     mirrors = @('https://ghfast.top/https://github.com/termux/termux-app/releases/download/v0.118.3/termux-app_v0.118.3+github-debug_arm64-v8a.apk') },
  @{ name = 'termux-boot.apk';  url = 'https://github.com/termux/termux-boot/releases/download/v0.8.1/termux-boot-app_v0.8.1+github.debug.apk';
     mirrors = @('https://ghfast.top/https://github.com/termux/termux-boot/releases/download/v0.8.1/termux-boot-app_v0.8.1+github.debug.apk') },
  @{ name = 'termux-api.apk';   url = 'https://github.com/termux/termux-api/releases/download/v0.53.0/termux-api-app_v0.53.0+github.debug.apk';
     mirrors = @('https://ghfast.top/https://github.com/termux/termux-api/releases/download/v0.53.0/termux-api-app_v0.53.0+github.debug.apk') },
  @{ name = 'shizuku.apk';      url = 'https://github.com/RikkaApps/Shizuku/releases/download/v13.6.0/shizuku-v13.6.0.r1086.2650830c-release.apk';
     mirrors = @('https://ghfast.top/https://github.com/RikkaApps/Shizuku/releases/download/v13.6.0/shizuku-v13.6.0.r1086.2650830c-release.apk') },
  @{ name = 'shizuku-api.aar';      url = 'https://repo1.maven.org/maven2/dev/rikka/shizuku/api/13.1.5/api-13.1.5.aar';
     mirrors = @('https://maven.aliyun.com/repository/central/dev/rikka/shizuku/api/13.1.5/api-13.1.5.aar') },
  @{ name = 'shizuku-provider.aar'; url = 'https://repo1.maven.org/maven2/dev/rikka/shizuku/provider/13.1.5/provider-13.1.5.aar';
     mirrors = @('https://maven.aliyun.com/repository/central/dev/rikka/shizuku/provider/13.1.5/provider-13.1.5.aar') }
)
foreach ($it in $items) {
  $dst = Join-Path $assets $it.name
  if (Test-Path $dst) { Write-Output ("skip     {0}" -f $it.name); continue }
  $urls = @($it.url) + $it.mirrors
  $ok = $false
  foreach ($u in $urls) {
    curl.exe -sL --fail --retry 3 -o $dst $u
    if ($LASTEXITCODE -eq 0 -and (Test-Path $dst) -and (Get-Item $dst).Length -gt 0) { $ok = $true; break }
  }
  if (-not $ok) { throw ("download failed: " + ($urls -join ' | ')) }
  Write-Output ("fetched  {0}  ({1:N1} MB)" -f $it.name, ((Get-Item $dst).Length / 1MB))
}
# shizuku api/provider: Maven artifacts are AARs; only their classes.jar is needed for javac/d8
Add-Type -AssemblyName System.IO.Compression.FileSystem
foreach ($aar in @(@('shizuku-api.aar', 'shizuku-api.jar'), @('shizuku-provider.aar', 'shizuku-provider.jar'))) {
  if ((Test-Path (Join-Path $assets $aar[0])) -and -not (Test-Path (Join-Path $assets $aar[1]))) {
    $tmp = Join-Path $assets ('aar-extracted-' + $aar[0])
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
    [System.IO.Compression.ZipFile]::ExtractToDirectory((Join-Path $assets $aar[0]), $tmp)
    Copy-Item (Join-Path $tmp 'classes.jar') (Join-Path $assets $aar[1])
    Remove-Item -Recurse -Force $tmp
    Write-Output ($aar[1] + ' extracted from ' + $aar[0])
  }
}

Get-FileHash (Join-Path $assets '*') -Algorithm SHA256 | ForEach-Object {
  ("{0}  {1}" -f $_.Hash.ToLower(), ($_.Path | Split-Path -Leaf))
} | Set-Content (Join-Path $assets 'SHA256SUMS.txt')
Write-Output 'SHA256SUMS.txt written'

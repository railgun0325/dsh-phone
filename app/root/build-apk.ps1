$ErrorActionPreference = 'Stop'
# build-apk.ps1 — build the Root one-tap DSH Phone APK.
# Root of the repo = app/root/../.. ; toolchain lives next to the repo at android-deploy/.
$root   = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$deploy = Join-Path (Split-Path -Parent $root) 'android-deploy'

$jdk = if ($env:ANDROID_JDK) { $env:ANDROID_JDK } else { Join-Path $deploy 'jdk17' }
$sdk = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $deploy 'android-sdk' }
$env:ANDROID_SDK_ROOT = $sdk
$env:JAVA_HOME = $jdk

$javac   = Join-Path $jdk 'bin/javac.exe'
$keytool = Join-Path $jdk 'bin/keytool.exe'
if (-not (Test-Path $javac)) { throw 'JDK 17 not found — set $env:ANDROID_JDK or place android-deploy next to the repo' }
$plat = Join-Path $sdk 'platforms/android-34/android.jar'
if (-not (Test-Path $plat)) { throw 'Android SDK platform-34 not found — set $env:ANDROID_SDK_ROOT' }
$bt        = Join-Path $sdk 'build-tools/34.0.0'
$aapt2     = Join-Path $bt 'aapt2.exe'
$d8        = Join-Path $bt 'd8.bat'
$zipalign  = Join-Path $bt 'zipalign.exe'
$apksigner = Join-Path $bt 'apksigner.bat'

# 1. assets must already be downloaded
$assetsDir = Join-Path $root 'assets'
foreach ($a in @('termux.apk','termux-boot.apk','termux-api.apk')) {
  $p = Join-Path $assetsDir $a
  if (-not (Test-Path $p) -or (Get-Item $p).Length -eq 0) {
    throw ("missing/empty asset {0} — run tools/fetch-assets.ps1 first" -f $a)
  }
}

# 2. assemble out/assets (termux APKs + payload: scripts + plugin)
$out = Join-Path $PSScriptRoot 'out'
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Force -Path $out | Out-Null
$outAssets  = Join-Path $out 'assets'
$outPayload = Join-Path $outAssets 'payload'
New-Item -ItemType Directory -Force -Path $outPayload | Out-Null
Copy-Item (Join-Path $assetsDir 'termux.apk')      (Join-Path $outAssets 'termux.apk') -Force
Copy-Item (Join-Path $assetsDir 'termux-boot.apk') (Join-Path $outAssets 'termux-boot.apk') -Force
Copy-Item (Join-Path $assetsDir 'termux-api.apk')  (Join-Path $outAssets 'termux-api.apk') -Force

$scriptsDir = Join-Path $root 'scripts'
foreach ($s in @('setup-root.sh','start-dsh.sh','boot-dsh.sh','dns-fwd.mjs','patch-dsh.mjs','install-api-key.sh','cordis.patch.yml')) {
  Copy-Item (Join-Path $scriptsDir $s) (Join-Path $outPayload $s) -Force
}
$pluginSrc = Join-Path $root 'plugin'
$pluginDst = Join-Path $outPayload 'plugin'
New-Item -ItemType Directory -Force -Path (Join-Path $pluginDst 'lib') | Out-Null
Copy-Item (Join-Path $pluginSrc 'index.js')         $pluginDst -Force
Copy-Item (Join-Path $pluginSrc 'package.json')     $pluginDst -Force
Copy-Item (Join-Path $pluginSrc 'cordis.patch.yml') $pluginDst -Force
Copy-Item (Join-Path $pluginSrc 'lib/client.js')    (Join-Path $pluginDst 'lib') -Force

# 3. compile shared resources
& (Join-Path $root 'tools/res-compile.ps1') -OutDir $out
$resZip = Join-Path $out 'res.zip'

# 4. javac (common + root java)
$classes = Join-Path $out 'classes'
New-Item -ItemType Directory -Force -Path $classes | Out-Null
$commonJava = Join-Path $root 'app/common/java'
$rootJava   = Join-Path $PSScriptRoot 'java'
$javaFiles = @(Get-ChildItem $commonJava -Recurse -Filter *.java | ForEach-Object { $_.FullName }) +
             @(Get-ChildItem $rootJava   -Recurse -Filter *.java | ForEach-Object { $_.FullName })
Write-Output '--- javac ---'
& $javac -encoding UTF-8 -classpath $plat -d $classes @javaFiles
if ($LASTEXITCODE -ne 0) { throw 'javac failed' }

# 5. d8 -> classes.dex
Write-Output '--- d8 ---'
$classFiles = @(Get-ChildItem $classes -Recurse -Filter *.class | ForEach-Object { $_.FullName })
& $d8 --lib $plat --output $out @classFiles
if ($LASTEXITCODE -ne 0) { throw 'd8 failed' }

# 6. aapt2 link (manifest + compiled res + assets)
Write-Output '--- aapt2 link ---'
& $aapt2 link -o (Join-Path $out 'base.apk') -I $plat --manifest (Join-Path $PSScriptRoot 'AndroidManifest.xml') --min-sdk-version 24 --target-sdk-version 34 --version-code 2 --version-name 0.2.0 $resZip
if ($LASTEXITCODE -ne 0) { throw 'aapt2 link failed' }

# 7. add classes.dex + assets into the APK (assets use forward-slash entry names)
Write-Output '--- add dex + assets ---'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open((Join-Path $out 'base.apk'), 'Update')
[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $out 'classes.dex'), 'classes.dex') | Out-Null
$assetFiles = @(Get-ChildItem $outAssets -Recurse -File | ForEach-Object { $_.FullName })
foreach ($f in $assetFiles) {
  $rel = $f.Substring($outAssets.Length + 1).Replace([char]92, '/')
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f, 'assets/' + $rel) | Out-Null
}
$zip.Dispose()

# 8. zipalign
Write-Output '--- zipalign ---'
& $zipalign -f 4 (Join-Path $out 'base.apk') (Join-Path $out 'aligned.apk')
if ($LASTEXITCODE -ne 0) { throw 'zipalign failed' }

# 9. sign
Write-Output '--- sign ---'
$ks = Join-Path $root 'apk/debug.keystore'
if (-not (Test-Path $ks)) {
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & $keytool -genkeypair -keystore $ks -storepass dshphone -keypass dshphone -alias dsh -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=DSH Phone, OU=dev, O=dsh, L=none, ST=none, C=CN' *> (Join-Path $out 'keytool.log')
  $ErrorActionPreference = $prevEap
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $ks)) { throw 'keytool failed' }
}
$final = Join-Path $out 'dsh-phone-root.apk'
$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& $apksigner sign --ks $ks --ks-pass pass:dshphone --key-pass pass:dshphone --out $final (Join-Path $out 'aligned.apk') *> (Join-Path $out 'apksigner.log')
$ErrorActionPreference = $prevEap
if ($LASTEXITCODE -ne 0) { throw 'apksigner failed' }

Write-Output ('APK BUILT: ' + $final)

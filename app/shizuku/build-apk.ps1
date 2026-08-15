$ErrorActionPreference = 'Stop'

# Build the Shizuku (unrooted) flavor APK: dsh-phone-shizuku.apk
# Dependencies: JDK 17 (ANDROID_JDK or D:/AI/DSH/android-deploy/jdk17)
#               Android SDK (ANDROID_SDK_ROOT or D:/AI/DSH/android-deploy/android-sdk)
$proj = $PSScriptRoot                                   # app\shizuku
$repo = Join-Path $proj '..\..'                          # dsh-phone
$jdk  = if ($env:ANDROID_JDK) { $env:ANDROID_JDK } else { Join-Path $proj '..\..\..\android-deploy\jdk17' }
$sdk  = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $proj '..\..\..\android-deploy\android-sdk' }

if (-not (Test-Path (Join-Path $jdk 'bin\javac.exe'))) { throw 'JDK 17 not found: ' + $jdk + ' (set ANDROID_JDK env)' }
if (-not (Test-Path (Join-Path $sdk 'platforms\android-34\android.jar'))) { throw 'Android SDK platform-34 not found: ' + $sdk }

$bt    = Join-Path $sdk 'build-tools\34.0.0'
$plat  = Join-Path $sdk 'platforms\android-34\android.jar'
$aapt2 = Join-Path $bt 'aapt2.exe'
$d8    = Join-Path $bt 'd8.bat'
$zipalign  = Join-Path $bt 'zipalign.exe'
$apksigner = Join-Path $bt 'apksigner.bat'
$javac  = Join-Path $jdk 'bin\javac.exe'
$keytool = Join-Path $jdk 'bin\keytool.exe'
$jar    = Join-Path $jdk 'bin\jar.exe'

# res-compile.ps1 resolves the SDK via ANDROID_SDK_ROOT; d8.bat/apksigner.bat use JAVA_HOME
$env:ANDROID_SDK_ROOT = $sdk
$env:JAVA_HOME = $jdk
$env:PATH = (Join-Path $jdk 'bin') + ';' + $env:PATH

# --- 0. assets present? ---
$assets = Join-Path $repo 'assets'
$required = @('termux.apk','termux-boot.apk','termux-api.apk','shizuku.apk',
              'shizuku-api.jar','shizuku-provider.jar','shizuku-aidl.jar','shizuku-shared.jar',
              'androidx-annotation.jar')
foreach ($r in $required) {
  if (-not (Test-Path (Join-Path $assets $r))) { throw 'missing asset: ' + $r }
}

# --- 1. assemble out/assets (APKs + payload) ---
$out = Join-Path $proj 'out'
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
$outAssets = Join-Path $out 'assets'
New-Item -ItemType Directory -Force -Path $outAssets | Out-Null
foreach ($a in @('termux.apk','termux-boot.apk','termux-api.apk','shizuku.apk')) {
  Copy-Item (Join-Path $assets $a) (Join-Path $outAssets $a)
}
$payload = Join-Path $outAssets 'payload'
New-Item -ItemType Directory -Force -Path (Join-Path $payload 'plugin\lib') | Out-Null
$payloadFiles = @(
  @{ src = 'scripts\setup-shizuku.sh';    dst = 'setup-shizuku.sh' },
  @{ src = 'scripts\start-dsh.sh';        dst = 'start-dsh.sh' },
  @{ src = 'scripts\patch-dsh.mjs';       dst = 'patch-dsh.mjs' },
  @{ src = 'scripts\patch-dsh-link.mjs';  dst = 'patch-dsh-link.mjs' },
  @{ src = 'scripts\cordis.patch.yml';    dst = 'cordis.patch.yml' },
  @{ src = 'scripts\boot-dsh-shizuku.sh'; dst = 'boot-dsh-shizuku.sh' },
  @{ src = 'plugin\index.js';             dst = 'plugin\index.js' },
  @{ src = 'plugin\package.json';         dst = 'plugin\package.json' },
  @{ src = 'plugin\cordis.patch.yml';     dst = 'plugin\cordis.patch.yml' },
  @{ src = 'plugin\lib\client.js';        dst = 'plugin\lib\client.js' }
)
foreach ($pf in $payloadFiles) {
  $src = Join-Path $repo $pf.src
  if (-not (Test-Path $src)) { throw 'payload source missing: ' + $src }
  Copy-Item $src (Join-Path $payload $pf.dst)
}
Write-Output '--- assets assembled ---'

# --- 2. compile shared resources ---
Write-Output '--- aapt2 compile (res) ---'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo 'tools\res-compile.ps1') -OutDir $out
$resZip = Join-Path $out 'res.zip'
if (-not (Test-Path $resZip)) { throw 'res compile failed' }

# --- 3. javac ---
Write-Output '--- javac ---'
$classes = Join-Path $out 'classes'
New-Item -ItemType Directory -Force -Path $classes | Out-Null
$cp = @($plat,
        (Join-Path $assets 'shizuku-api.jar'),
        (Join-Path $assets 'shizuku-provider.jar'),
        (Join-Path $assets 'shizuku-aidl.jar'),
        (Join-Path $assets 'shizuku-shared.jar'),
        (Join-Path $assets 'androidx-annotation.jar')) -join ';'
$srcDirs = @((Join-Path $repo 'app\common\java'), (Join-Path $proj 'java'))
$javaFiles = @()
foreach ($sd in $srcDirs) {
  $javaFiles += Get-ChildItem -Path $sd -Recurse -Filter *.java | ForEach-Object { $_.FullName }
}
& $javac -encoding UTF-8 -classpath $cp -d $classes $javaFiles
if ($LASTEXITCODE -ne 0) { throw 'javac failed' }

# --- 4. jar classes + d8 ---
Write-Output '--- jar classes ---'
$classesJar = Join-Path $out 'classes.jar'
& $jar cf $classesJar -C $classes .
if ($LASTEXITCODE -ne 0) { throw 'jar failed' }
Write-Output '--- d8 ---'
$d8Inputs = @($classesJar,
              (Join-Path $assets 'shizuku-api.jar'),
              (Join-Path $assets 'shizuku-provider.jar'),
              (Join-Path $assets 'shizuku-aidl.jar'),
              (Join-Path $assets 'shizuku-shared.jar'),
              (Join-Path $assets 'androidx-annotation.jar'))
& $d8 --lib $plat --min-api 24 --output $out $d8Inputs
if ($LASTEXITCODE -ne 0) { throw 'd8 failed' }
$dex = Join-Path $out 'classes.dex'
if (-not (Test-Path $dex)) { throw 'd8 did not produce classes.dex' }

# --- 5. aapt2 link ---
Write-Output '--- aapt2 link ---'
$base = Join-Path $out 'base.apk'
& $aapt2 link -o $base -I $plat --manifest (Join-Path $proj 'AndroidManifest.xml') --version-code 9 --version-name 0.2.5 $resZip
if ($LASTEXITCODE -ne 0) { throw 'aapt2 link failed' }

# --- 6. add assets + dex (forward-slash asset names) ---
Write-Output '--- add assets + classes.dex ---'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($base, 'Update')
$assetFiles = Get-ChildItem -Path $outAssets -Recurse -File
foreach ($f in $assetFiles) {
  $rel = $f.FullName.Substring($outAssets.Length).TrimStart('\').Replace('\', '/')
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, 'assets/' + $rel) | Out-Null
}
[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $dex, 'classes.dex') | Out-Null
$zip.Dispose()

# --- 7. zipalign ---
Write-Output '--- zipalign ---'
$aligned = Join-Path $out 'aligned.apk'
& $zipalign -f 4 $base $aligned
if ($LASTEXITCODE -ne 0) { throw 'zipalign failed' }

# --- 8. sign ---
Write-Output '--- apksigner ---'
$ks = Join-Path $repo 'apk\debug.keystore'
if (-not (Test-Path $ks)) {
  & $keytool -genkeypair -keystore $ks -storepass dshphone -keypass dshphone -alias dsh -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=DSH Phone, OU=dev, O=dsh, L=none, ST=none, C=CN' 2>&1 | Out-Null
}
$apk = Join-Path $out 'dsh-phone-shizuku.apk'
& $apksigner sign --ks $ks --ks-pass pass:dshphone --key-pass pass:dshphone --out $apk $aligned
if ($LASTEXITCODE -ne 0) { throw 'apksigner failed' }

Write-Output ('APK BUILT: ' + $apk)

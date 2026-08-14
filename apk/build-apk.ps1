$ErrorActionPreference = 'Stop'
# Dependencies (documented in apk/README.md):
#   JDK 17        -> set $env:ANDROID_JDK, or place at ..\jdk17
#   Android SDK   -> set $env:ANDROID_SDK_ROOT, or place at ..\android-sdk
$proj = $PSScriptRoot
$jdk = if ($env:ANDROID_JDK) { $env:ANDROID_JDK } else { Join-Path $proj '..\jdk17' }
$sdk = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $proj '..\android-sdk' }
if (-not (Test-Path (Join-Path $jdk 'bin\javac.exe'))) { throw 'JDK 17 not found — set $env:ANDROID_JDK or place jdk17 next to the repo' }
if (-not (Test-Path (Join-Path $sdk 'platforms\android-34\android.jar'))) { throw 'Android SDK platform-34 not found — set $env:ANDROID_SDK_ROOT' }
$bt = Join-Path $sdk 'build-tools\34.0.0'
$plat = Join-Path $sdk 'platforms\android-34\android.jar'
$out = Join-Path $proj 'out'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$aapt2 = Join-Path $bt 'aapt2.exe'
$d8 = Join-Path $bt 'd8.bat'
$zipalign = Join-Path $bt 'zipalign.exe'
$apksigner = Join-Path $bt 'apksigner.bat'
# debug keystore (generated once; ignored by git)
$ks = Join-Path $proj 'debug.keystore'
if (-not (Test-Path $ks)) {
  & (Join-Path $jdk 'bin\keytool.exe') -genkeypair -keystore $ks -storepass dshphone -keypass dshphone -alias dsh -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=DSH Phone, OU=dev, O=dsh, L=none, ST=none, C=CN' 2>&1 | Out-Null
}
Write-Output '--- javac ---'
& (Join-Path $jdk 'bin\javac.exe') -classpath $plat -d (Join-Path $out 'classes') (Join-Path $proj 'src\MainActivity.java')
Write-Output '--- d8 ---'
& $d8 --lib $plat --output $out (Join-Path $out 'classes\com\dsh\phone\MainActivity.class')
Write-Output '--- aapt2 link ---'
& $aapt2 link -o (Join-Path $out 'base.apk') -I $plat --manifest (Join-Path $proj 'AndroidManifest.xml') --min-sdk-version 24 --target-sdk-version 34
Write-Output '--- add dex ---'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open((Join-Path $out 'base.apk'), 'Update')
[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $out 'classes.dex'), 'classes.dex') | Out-Null
$zip.Dispose()
Write-Output '--- zipalign ---'
& $zipalign -f 4 (Join-Path $out 'base.apk') (Join-Path $out 'aligned.apk')
Write-Output '--- sign ---'
& $apksigner sign --ks $ks --ks-pass pass:dshphone --key-pass pass:dshphone --out (Join-Path $proj 'dsh-phone.apk') (Join-Path $out 'aligned.apk')
Write-Output 'APK BUILT: ' + (Join-Path $proj 'dsh-phone.apk')

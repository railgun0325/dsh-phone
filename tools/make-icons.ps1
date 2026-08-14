# make-icons.ps1 — generate the full Android icon set (mipmap + adaptive) from one source PNG.
# Usage:  powershell -File tools/make-icons.ps1 [-Source path\to\icon.png]
# Output: app/common/res/mipmap-*/ic_launcher*.png + values/colors.xml + mipmap-anydpi-v26 XMLs
# The generated files are checked into git so builds do not need this script (or System.Drawing).
param(
  [string]$Source = "$PSScriptRoot\..\app\branding\icon-source.png"
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$res = Join-Path $PSScriptRoot '..\app\common\res'
$bg = [System.Drawing.Color]::FromArgb(255, 255, 255, 255)  # white adaptive background

# foreground content = logo scaled to 66% of the canvas (inside the adaptive safe zone)
$scale = 0.66
# legacy density buckets
$legacy = @{ mdpi = 48; hdpi = 72; xhdpi = 96; xxhdpi = 144; xxxhdpi = 192 }
# adaptive foreground canvas sizes (108dp)
$fg = @{ mdpi = 108; hdpi = 162; xhdpi = 216; xxhdpi = 324; xxxhdpi = 432 }

$src = New-Object System.Drawing.Bitmap($Source)
if ($src.Width -ne $src.Height) { throw "icon source must be square, got $($src.Width)x$($src.Height)" }

function Save-Png($bmp, $path) {
  $dir = Split-Path $path -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
}

# 1) adaptive foreground: transparent canvas + logo at scale
foreach ($d in $fg.Keys) {
  $size = $fg[$d]
  $b = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($b)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $s = [int]($size * $scale)
  $o = [int](($size - $s) / 2)
  $g.DrawImage($src, $o, $o, $s, $s)
  $g.Dispose()
  Save-Png $b (Join-Path $res "mipmap-$d\ic_launcher_foreground.png")
  $b.Dispose()
}

# 2) legacy launcher icons: white background + logo at scale (square; launchers mask as needed)
foreach ($d in $legacy.Keys) {
  $size = $legacy[$d]
  $b = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($b)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear($bg)
  $s = [int]($size * $scale)
  $o = [int](($size - $s) / 2)
  $g.DrawImage($src, $o, $o, $s, $s)
  $g.Dispose()
  Save-Png $b (Join-Path $res "mipmap-$d\ic_launcher.png")
  $b2 = New-Object System.Drawing.Bitmap($b)  # same content for the round variant
  Save-Png $b2 (Join-Path $res "mipmap-$d\ic_launcher_round.png")
  $b.Dispose(); $b2.Dispose()
}
$src.Dispose()
Write-Output "icons written under $res"

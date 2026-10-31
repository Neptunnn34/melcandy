# MelCandy uygulama ikonlarını üretir (harici bağımlılık yok, Windows PowerShell + System.Drawing).
# Kullanım: powershell -ExecutionPolicy Bypass -File scripts/make-icons.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'public/icons'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function New-MelCandyIcon([int]$size, [string]$path) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect,
    [System.Drawing.Color]::FromArgb(255, 88, 101, 242),
    [System.Drawing.Color]::FromArgb(255, 235, 69, 158),
    45
  )
  $g.FillRectangle($brush, $rect)

  $glow = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(42, 255, 255, 255))
  $g.FillEllipse($glow, [int]($size * 0.08), [int]($size * 0.06), [int]($size * 0.7), [int]($size * 0.7))

  $s = [float]$size
  $heart = New-Object System.Drawing.Drawing2D.GraphicsPath
  $heart.AddBezier(
    [float](0.50 * $s), [float](0.30 * $s),
    [float](0.41 * $s), [float](0.16 * $s),
    [float](0.20 * $s), [float](0.19 * $s),
    [float](0.20 * $s), [float](0.38 * $s)
  )
  $heart.AddBezier(
    [float](0.20 * $s), [float](0.38 * $s),
    [float](0.20 * $s), [float](0.56 * $s),
    [float](0.40 * $s), [float](0.70 * $s),
    [float](0.50 * $s), [float](0.84 * $s)
  )
  $heart.AddBezier(
    [float](0.50 * $s), [float](0.84 * $s),
    [float](0.60 * $s), [float](0.70 * $s),
    [float](0.80 * $s), [float](0.56 * $s),
    [float](0.80 * $s), [float](0.38 * $s)
  )
  $heart.AddBezier(
    [float](0.80 * $s), [float](0.38 * $s),
    [float](0.80 * $s), [float](0.19 * $s),
    [float](0.59 * $s), [float](0.16 * $s),
    [float](0.50 * $s), [float](0.30 * $s)
  )
  $heart.CloseFigure()

  $shadow = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(48, 0, 0, 0))
  $matrix = New-Object System.Drawing.Drawing2D.Matrix
  $matrix.Translate([float]($size * 0.008), [float]($size * 0.012))
  $shadowPath = $heart.Clone()
  $shadowPath.Transform($matrix)
  $g.FillPath($shadow, $shadowPath)
  $g.FillPath([System.Drawing.Brushes]::White, $heart)

  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)

  $g.Dispose(); $bmp.Dispose(); $brush.Dispose(); $glow.Dispose()
  $shadow.Dispose(); $heart.Dispose(); $shadowPath.Dispose(); $matrix.Dispose()
}

New-MelCandyIcon 64  (Join-Path $outDir 'favicon.png')
New-MelCandyIcon 180 (Join-Path $outDir 'apple-touch-icon.png')
New-MelCandyIcon 192 (Join-Path $outDir 'icon-192.png')
New-MelCandyIcon 512 (Join-Path $outDir 'icon-512.png')

Get-ChildItem $outDir | Select-Object Name, Length | Format-Table -AutoSize

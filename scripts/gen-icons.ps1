# 生成 CodeView 应用图标集：PNG 多尺寸 + ICO + ICNS（供 Tauri 打包）
# 用法: pwsh ./scripts/gen-icons.ps1
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing

$iconDir = Join-Path $PSScriptRoot '..\crates\desktop\icons'
New-Item -ItemType Directory -Force -Path $iconDir | Out-Null

function New-BaseBitmap([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(91, 140, 255)), ([System.Drawing.Color]::FromArgb(188, 140, 255)), 45
    $g.FillRectangle($bg, $rect)
    $fontSize = [Math]::Max(6.0, $size * 0.42)
    $font = New-Object System.Drawing.Font('Segoe UI', $fontSize, [System.Drawing.FontStyle]::Bold)
    $fmt = New-Object System.Drawing.StringFormat
    $fmt.Alignment = 'Center'; $fmt.LineAlignment = 'Center'
    $g.DrawString('CV', $font, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF(0, 0, $size, $size)), $fmt)
    $g.Dispose()
    return $bmp
}

function Save-Png([System.Drawing.Bitmap]$bmp, [string]$path) {
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output "PNG  $path"
}

# ---- PNG 多尺寸 ----
$sizes = @{ 'icon.png' = 1024; 'icon-512.png' = 512; '128x128@2x.png' = 256; '128x128.png' = 128; '32x32.png' = 32 }
$base1024 = New-BaseBitmap 1024
foreach ($name in $sizes.Keys) {
    $target = $sizes[$name]
    if ($target -eq 1024) { Save-Png $base1024 (Join-Path $iconDir $name); continue }
    $resized = New-Object System.Drawing.Bitmap $target, $target
    $g = [System.Drawing.Graphics]::FromImage($resized)
    $g.InterpolationMode = 'HighQualityBicubic'
    $g.DrawImage($base1024, 0, 0, $target, $target)
    $g.Dispose()
    Save-Png $resized (Join-Path $iconDir $name)
    $resized.Dispose()
}

# ---- ICO（多尺寸）----
$icoSizes = @(256, 128, 64, 48, 32, 16)
$pngStreams = @{}
foreach ($s in $icoSizes) {
    $ms = New-Object System.IO.MemoryStream
    $b = if ($s -eq 1024) { $base1024 } else {
        $r = New-Object System.Drawing.Bitmap $s, $s
        $g = [System.Drawing.Graphics]::FromImage($r)
        $g.InterpolationMode = 'HighQualityBicubic'
        $g.DrawImage($base1024, 0, 0, $s, $s)
        $g.Dispose(); $r
    }
    $b.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngStreams[$s] = $ms.ToArray()
    if ($s -ne 1024) { $b.Dispose() }
}
$icoPath = Join-Path $iconDir 'icon.ico'
$ico = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter($ico)
$w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]$icoSizes.Count)
$offset = 6 + 16 * $icoSizes.Count
foreach ($s in $icoSizes) {
    $dim = if ($s -ge 256) { 0 } else { $s }
    $w.Write([Byte]$dim); $w.Write([Byte]$dim); $w.Write([Byte]0); $w.Write([Byte]0)
    $w.Write([UInt16]1); $w.Write([UInt16]32)
    $w.Write([UInt32]$pngStreams[$s].Length); $w.Write([UInt32]$offset)
    $offset += $pngStreams[$s].Length
}
foreach ($s in $icoSizes) { $w.Write($pngStreams[$s]) }
$w.Flush()
[System.IO.File]::WriteAllBytes($icoPath, $ico.ToArray())
Write-Output "ICO  $icoPath ($($ico.Length) bytes)"

# ---- ICNS（PNG 载荷：ic07=128, ic08=256, ic09=512, ic10=1024）----
$icnsEntries = @(
    @{ type = 'ic07'; png = (Join-Path $iconDir '128x128.png') },
    @{ type = 'ic08'; png = (Join-Path $iconDir '128x128@2x.png') },
    @{ type = 'ic09'; png = (Join-Path $iconDir 'icon-512.png') },
    @{ type = 'ic10'; png = (Join-Path $iconDir 'icon.png') }
)
function Write-BEUInt32([System.IO.BinaryWriter]$w, [UInt32]$v) {
    $b = [System.BitConverter]::GetBytes($v)
    [Array]::Reverse($b)
    $w.Write($b)
}
$icns = New-Object System.IO.MemoryStream
$wc = New-Object System.IO.BinaryWriter($icns)
$wc.Write([UInt32]0); $wc.Write([UInt32]0) # header placeholder
$total = 8
foreach ($e in $icnsEntries) {
    $png = [System.IO.File]::ReadAllBytes($e.png)
    $chunk = New-Object System.IO.MemoryStream
    $cw = New-Object System.IO.BinaryWriter($chunk)
    $cw.Write([System.Text.Encoding]::ASCII.GetBytes($e.type))
    Write-BEUInt32 $cw ([UInt32]($png.Length + 8))
    $cw.Write($png)
    $cw.Flush()
    $bytes = $chunk.ToArray()
    $wc.Write($bytes)
    $total += $bytes.Length
}
$wc.Seek(0, 'Begin') | Out-Null
$wc.Write([System.Text.Encoding]::ASCII.GetBytes('icns'))
Write-BEUInt32 $wc ([UInt32]$total)
$wc.Flush()
$icnsPath = Join-Path $iconDir 'icon.icns'
[System.IO.File]::WriteAllBytes($icnsPath, $icns.ToArray())
Write-Output "ICNS $icnsPath ($($icns.Length) bytes)"

$base1024.Dispose()
Write-Output 'DONE'

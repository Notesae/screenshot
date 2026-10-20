# 从几何截图框生成多尺寸 ICO；不依赖字体或网络，供程序、托盘和安装器共用。
param()
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$target = Join-Path $PSScriptRoot '../src/Screenshot.App/Assets/Screenshot.ico'
New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
$images = @()
foreach ($size in @(16, 24, 32, 48, 64, 128, 256)) {
    $bitmap = [Drawing.Bitmap]::new($size, $size)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.ScaleTransform($size / 64.0, $size / 64.0)
    $background = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#133E50'))
    $white = [Drawing.Pen]::new([Drawing.Color]::White, 4)
    $accent = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#5EE1BA'))
    $shape = [Drawing.Drawing2D.GraphicsPath]::new()
    try {
        foreach ($corner in @(@(2,2,180), @(42,2,270), @(42,42,0), @(2,42,90))) {
            $shape.AddArc($corner[0], $corner[1], 20, 20, $corner[2], 90)
        }
        $shape.CloseFigure(); $graphics.FillPath($background, $shape)
        # 四角留出开口，缩到 16px 时仍能辨认截图取景框。
        foreach ($points in @(@(16,27,16,17,27,17), @(37,17,47,17,47,27), @(47,37,47,47,37,47), @(27,47,17,47,17,37))) {
            $graphics.DrawLines($white, [Drawing.PointF[]]@([Drawing.PointF]::new($points[0],$points[1]), [Drawing.PointF]::new($points[2],$points[3]), [Drawing.PointF]::new($points[4],$points[5])))
        }
        $graphics.FillEllipse($accent, 26, 26, 12, 12)
        $stream = [IO.MemoryStream]::new()
        try { $bitmap.Save($stream, [Drawing.Imaging.ImageFormat]::Png); $images += ,@($size, $stream.ToArray()) }
        finally { $stream.Dispose() }
    } finally { $shape.Dispose(); $accent.Dispose(); $white.Dispose(); $background.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
}
$file = [IO.File]::Create($target); $writer = [IO.BinaryWriter]::new($file)
try {
    $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$images.Count)
    $offset = 6 + 16 * $images.Count
    foreach ($entry in $images) {
        $dimension = if ($entry[0] -eq 256) { 0 } else { $entry[0] }
        $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
        $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]32)
        $writer.Write([uint32]$entry[1].Length); $writer.Write([uint32]$offset)
        $offset += $entry[1].Length
    }
    foreach ($entry in $images) { $writer.Write([byte[]]$entry[1]) }
} finally { $writer.Dispose(); $file.Dispose() }
Write-Output "Icon: $target"

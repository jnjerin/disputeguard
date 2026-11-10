# PURPOSE
# Renders fixtures/receipt.png, a fake shop receipt (invented sample data) that Gate 1 (check 1d)
# sends to the model to test reading text from an image: merchant, total and date.
# Uses Windows' built-in System.Drawing, so no image library needs to be installed.
# Run: powershell -File spikes/gate-check/scripts/make-receipt.ps1
Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot "..\fixtures\receipt.png"
$bmp = New-Object System.Drawing.Bitmap 480, 520
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.Clear([System.Drawing.Color]::White)
$title = New-Object System.Drawing.Font "Consolas", 18, ([System.Drawing.FontStyle]::Bold)
$body = New-Object System.Drawing.Font "Consolas", 13
$ink = [System.Drawing.Brushes]::Black
$g.DrawString("SAVANNA CRAFTS LTD", $title, $ink, 100, 24)
$lines = @(
  "12 Moi Avenue, Nairobi",
  "----------------------------------",
  "RECEIPT #R-20431",
  "Date: 2026-10-20  10:42",
  "",
  "Sisal basket (large)  x1   45.00",
  "Gift wrap             x1    3.50",
  "----------------------------------",
  "TOTAL (USD)                48.50",
  "Paid: PayPal",
  "",
  "Thank you for shopping with us!"
)
$y = 70
foreach ($l in $lines) { $g.DrawString($l, $body, $ink, 30, $y); $y += 30 }
$bmp.Save((Resolve-Path (Split-Path $out)).Path + "\receipt.png", [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "wrote $out"

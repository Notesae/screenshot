# 仅合成输入/专用临时库/本测试启动的子进程；不启动Screenshot或执行桌面操作。
param([string]$Output=(Join-Path (Split-Path $PSScriptRoot -Parent) 'artifacts/qa/quality'),[string]$BuildRoot='artifacts/verify-source')
$ErrorActionPreference='Stop'
$taskRoot=Split-Path $PSScriptRoot -Parent
Push-Location $taskRoot
try{
    New-Item -ItemType Directory -Force -Path $Output | Out-Null
    & dotnet (Join-Path $BuildRoot 'bin/Screenshot.Storage.Tests/release/Screenshot.Storage.Tests.dll') --quality (Join-Path $Output 'storage.json')
    if($LASTEXITCODE){throw 'Isolated storage quality failed.'}
    & dotnet (Join-Path $BuildRoot 'bin/Screenshot.Ocr.Tests/release/Screenshot.Ocr.Tests.dll') --build-info (Join-Path $Output 'opencv-build-info.txt')
    if($LASTEXITCODE){throw 'Native build metadata unavailable.'}
    $previousProfile=$env:SCREENSHOT_BENCH_SOFTWARE
    try{$env:SCREENSHOT_BENCH_SOFTWARE='1';& node editor/scripts/benchmark-large-images.cjs (Join-Path $Output 'editor-benchmark.json');if($LASTEXITCODE){throw 'Synthetic image benchmark failed.'}}
    finally{$env:SCREENSHOT_BENCH_SOFTWARE=$previousProfile}
}finally{Pop-Location}

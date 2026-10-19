# 按固定顺序还原、测试并构建编辑器及原生解决方案；任一步失败立即以非零状态停止。
param([ValidateSet('Debug','Release')][string]$Configuration = 'Release', [switch]$SkipRestore, [switch]$WithOcrIntegration)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
Push-Location $taskRoot
try {
    Push-Location editor
    try {
        if (-not $SkipRestore) {
            & npm.cmd ci
            if ($LASTEXITCODE) { throw 'Editor dependency restore failed.' }
        }
        & npm.cmd test
        if ($LASTEXITCODE) { throw 'Editor tests failed.' }
        & npm.cmd run build
        if ($LASTEXITCODE) { throw 'Editor build failed.' }
    } finally { Pop-Location }
    # 隔离构建输出，避免覆盖用户可能仍在运行的应用文件。
    $buildRoot = Join-Path $taskRoot 'artifacts/verify'
    & dotnet build Screenshot.slnx -c $Configuration --artifacts-path $buildRoot --maxcpucount:1
    if ($LASTEXITCODE) { throw '.NET build failed.' }
    foreach ($testName in @('Screenshot.App.Tests','Screenshot.AI.Tests','Screenshot.Ocr.Tests','Screenshot.Storage.Tests')) {
        $runner = Join-Path $buildRoot "bin/$testName/$($Configuration.ToLowerInvariant())/$testName.dll"
        & dotnet $runner
        if ($LASTEXITCODE) { throw "Test runner failed: $testName" }
    }
    if ($WithOcrIntegration) {
        $ocrRunner = Join-Path $buildRoot "bin/Screenshot.Ocr.Tests/$($Configuration.ToLowerInvariant())/Screenshot.Ocr.Tests.dll"
        & dotnet $ocrRunner (Join-Path $taskRoot 'models/pp-ocrv5-mobile') --integration
        if ($LASTEXITCODE) { throw 'Synthetic local OCR inference failed.' }
    }
} finally { Pop-Location }

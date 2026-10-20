# 按固定顺序还原、测试并构建编辑器及原生解决方案；任一步失败立即以非零状态停止。
param([ValidateSet('Debug','Release')][string]$Configuration = 'Release', [switch]$SkipRestore, [switch]$WithOcrIntegration, [ValidateSet('Source','Vendor')][string]$NativeRuntime='Source')
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
Push-Location $taskRoot
try {
    Push-Location editor
    try {
        if (-not $SkipRestore) {
            & npm.cmd ci --ignore-scripts
            if ($LASTEXITCODE) { throw 'Editor dependency restore failed.' }
        }
        New-Item -ItemType Directory -Force -Path ../artifacts/qa/product | Out-Null
        & npm.cmd test -- --reporter=default --reporter=json --outputFile=../artifacts/qa/product/editor-tests.json
        if ($LASTEXITCODE) { throw 'Editor tests failed.' }
        & npm.cmd run build
        if ($LASTEXITCODE) { throw 'Editor build failed.' }
    } finally { Pop-Location }
    & node (Join-Path $PSScriptRoot 'terms-audit.cjs')
    if ($LASTEXITCODE) { throw 'Terms/startup source audit failed.' }
    & python (Join-Path $PSScriptRoot 'test-release-prerelease.py')
    if ($LASTEXITCODE) { throw 'Synthetic release state checks failed.' }
    # 隔离构建输出，避免覆盖用户可能仍在运行的应用文件。
    $buildRoot = Join-Path $taskRoot ('artifacts/verify-'+$NativeRuntime.ToLowerInvariant())
    if($NativeRuntime -eq 'Source'){& node (Join-Path $PSScriptRoot 'verify-native-runtime.cjs');if($LASTEXITCODE){throw 'Native provenance verification failed.'}}
    & dotnet build Screenshot.slnx -c $Configuration "-p:ScreenshotNativeRuntime=$NativeRuntime" --artifacts-path $buildRoot --maxcpucount:1
    if ($LASTEXITCODE) { throw '.NET build failed.' }
    foreach ($testName in @('Screenshot.App.Tests','Screenshot.AI.Tests','Screenshot.Ocr.Tests','Screenshot.Storage.Tests')) {
        $runner = Join-Path $buildRoot "bin/$testName/$($Configuration.ToLowerInvariant())/$testName.dll"
        & dotnet $runner
        if ($LASTEXITCODE) { throw "Test runner failed: $testName" }
    }
    # 显式运行源代码链接的无窗口夹具，只操作 artifacts 下的 GUID 目录及其子进程。
    & dotnet (Join-Path $buildRoot "bin/Screenshot.App.Tests/$($Configuration.ToLowerInvariant())/Screenshot.App.Tests.dll") --update-process-suite
    if ($LASTEXITCODE) { throw 'Isolated Windows update process checks failed.' }
    & dotnet (Join-Path $buildRoot "bin/Screenshot.Ocr.Tests/$($Configuration.ToLowerInvariant())/Screenshot.Ocr.Tests.dll") --native-status
    if($LASTEXITCODE){throw 'Lazy native status check failed.'}
    if ($WithOcrIntegration) {
        $ocrRunner = Join-Path $buildRoot "bin/Screenshot.Ocr.Tests/$($Configuration.ToLowerInvariant())/Screenshot.Ocr.Tests.dll"
        & dotnet $ocrRunner (Join-Path $taskRoot 'models/pp-ocrv5-mobile') --integration
        if ($LASTEXITCODE) { throw 'Synthetic local OCR inference failed.' }
    }
} finally { Pop-Location }

# 先生成本地网页，再发布带 .NET 运行时的 Windows x64 可运行目录。
param([string]$Output = (Join-Path (Split-Path $PSScriptRoot -Parent) 'artifacts/Screenshot-win-x64'), [switch]$SkipRestore,
      [ValidatePattern('^10\.0\.\d+$')][string]$RuntimeVersion = '10.0.13', [ValidateSet('Source','Vendor')][string]$NativeRuntime='Source')
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$Output = [IO.Path]::GetFullPath($Output)
$payload = Join-Path $Output 'app'
# A portable profile must not be merged over an old/user package.
if((Test-Path -LiteralPath $Output) -and @(Get-ChildItem -LiteralPath $Output -Force).Count){throw 'Output is not empty; choose a new portable directory. Existing files were left untouched.'}
Push-Location $taskRoot
try {
    Push-Location editor
    try {
        if (-not $SkipRestore) {
            & npm.cmd ci --ignore-scripts
            if ($LASTEXITCODE) { throw 'Editor dependency restore failed.' }
        }
        & npm.cmd run build
        if ($LASTEXITCODE) { throw 'Editor build failed.' }
    } finally { Pop-Location }
    # 固定已核实的受维护运行时补丁，避免旧 SDK 默认附带较早的自包含运行时。
    if($NativeRuntime -eq 'Source'){& node (Join-Path $PSScriptRoot 'verify-native-runtime.cjs');if($LASTEXITCODE){throw 'Native provenance verification failed.'}}
    & dotnet publish src/Screenshot.App/Screenshot.App.csproj -c Release -r win-x64 --self-contained true "-p:ScreenshotRuntimeVersion=$RuntimeVersion" "-p:ScreenshotNativeRuntime=$NativeRuntime" --maxcpucount:1 --artifacts-path (Join-Path $taskRoot ('artifacts/publish-build-'+$NativeRuntime.ToLowerInvariant())) -o $payload
    if ($LASTEXITCODE) { throw 'Windows publish failed.' }
    & node (Join-Path $PSScriptRoot 'release-audit.cjs') $payload
    if ($LASTEXITCODE) { throw 'Portable package audit failed.' }
    & (Join-Path $PSScriptRoot 'build-launcher.ps1') -Output (Join-Path $Output 'Screenshot.exe')
    Copy-Item -LiteralPath (Join-Path $taskRoot 'packaging/使用说明.txt') -Destination $Output
    & node (Join-Path $PSScriptRoot 'package-layout.cjs') $Output
    if ($LASTEXITCODE) { throw 'Package layout verification failed.' }
    # 本地只保留本次成品和固定缓存；CI 继续按既有流程收集全部证据。
    if ($env:GITHUB_ACTIONS -ne 'true') {
        $cleanup = & (Join-Path $PSScriptRoot 'clean-artifacts.ps1') -Apply -KeepPath $Output
        if ($cleanup.Failed) { Write-Warning '部分历史产物未清理，详见 artifacts/cleanup/last-run.json。' }
        Write-Output ("历史产物已清理：{0:N2} GiB" -f ($cleanup.Bytes / 1GB))
    }
    Write-Output "Runnable output: $Output"
} finally { Pop-Location }

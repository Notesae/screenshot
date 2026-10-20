# 先生成本地网页，再发布带 .NET 运行时的 Windows x64 可运行目录。
param([string]$Output = (Join-Path (Split-Path $PSScriptRoot -Parent) 'artifacts/Screenshot-win-x64'), [switch]$SkipRestore,
      [ValidatePattern('^10\.0\.\d+$')][string]$RuntimeVersion = '10.0.13', [ValidateSet('Source','Vendor')][string]$NativeRuntime='Source',
      [ValidatePattern('^(?:Iv[A-Za-z0-9._-]{6,96})?$')][string]$GitHubClientId='')
# Client ID 是公开应用标识；默认空值保持私有更新未配置。禁止传入 secret/token。
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
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
    & dotnet publish src/Screenshot.App/Screenshot.App.csproj -c Release -r win-x64 --self-contained true "-p:ScreenshotRuntimeVersion=$RuntimeVersion" "-p:ScreenshotNativeRuntime=$NativeRuntime" "-p:ScreenshotGitHubClientId=$GitHubClientId" --maxcpucount:1 --artifacts-path (Join-Path $taskRoot ('artifacts/publish-build-'+$NativeRuntime.ToLowerInvariant())) -o $Output
    if ($LASTEXITCODE) { throw 'Windows publish failed.' }
    & node (Join-Path $PSScriptRoot 'release-audit.cjs') $Output
    if ($LASTEXITCODE) { throw 'Portable package audit failed.' }
    Write-Output "Runnable output: $Output"
} finally { Pop-Location }

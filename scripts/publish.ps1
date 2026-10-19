# 先生成本地网页，再发布带 .NET 运行时的 Windows x64 可运行目录。
param([string]$Output = (Join-Path (Split-Path $PSScriptRoot -Parent) 'artifacts/Screenshot-win-x64'), [switch]$SkipRestore,
      [ValidatePattern('^10\.0\.\d+$')][string]$RuntimeVersion = '10.0.13')
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
        & npm.cmd run build
        if ($LASTEXITCODE) { throw 'Editor build failed.' }
    } finally { Pop-Location }
    # 固定已核实的受维护运行时补丁，避免旧 SDK 默认附带较早的自包含运行时。
    & dotnet publish src/Screenshot.App/Screenshot.App.csproj -c Release -r win-x64 --self-contained true "-p:RuntimeFrameworkVersion=$RuntimeVersion" --maxcpucount:1 --artifacts-path (Join-Path $taskRoot 'artifacts/publish-build') -o $Output
    if ($LASTEXITCODE) { throw 'Windows publish failed.' }
    Write-Output "Runnable output: $Output"
} finally { Pop-Location }

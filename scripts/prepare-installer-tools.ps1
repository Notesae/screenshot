# 显式下载固定版本的免费开源 WiX 工具及中文界面扩展；仅写工程缓存，不安装系统软件。
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$toolDirectory = Join-Path $root 'artifacts/installer-tools'
$wix = Join-Path $toolDirectory 'wix.exe'
$oldRollForward = $env:DOTNET_ROLL_FORWARD
Push-Location $root
try {
    if (-not (Test-Path -LiteralPath $wix)) {
        & dotnet tool install wix --version 4.0.6 --tool-path $toolDirectory
        if ($LASTEXITCODE) { throw 'WiX tool preparation failed.' }
    }
    $env:DOTNET_ROLL_FORWARD = 'Major'
    & $wix extension add WixToolset.UI.wixext/4.0.6
    if ($LASTEXITCODE) { throw 'WiX UI extension preparation failed.' }
} finally { $env:DOTNET_ROLL_FORWARD = $oldRollForward; Pop-Location }

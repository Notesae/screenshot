# 从已校验的便携目录制作当前用户 MSI；不运行安装器，不修改系统注册表或快捷方式。
param([string]$PackagePath = (Join-Path $PSScriptRoot '../artifacts/Screenshot-win-x64'), [string]$Output)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$package = (Resolve-Path -LiteralPath $PackagePath).Path
& node (Join-Path $PSScriptRoot 'package-layout.cjs') $package --verify
if ($LASTEXITCODE) { throw 'Installer source package verification failed.' }
$version = (Get-Content (Join-Path $package 'app/sbom.cdx.json') -Raw | ConvertFrom-Json).metadata.component.version
if (-not $Output) { $Output = Join-Path $root "artifacts/Screenshot-$version-setup-x64.msi" }
$Output = [IO.Path]::GetFullPath($Output)
if (Test-Path -LiteralPath $Output) { throw 'Installer output already exists; choose a new output file.' }
$wix = Join-Path $root 'artifacts/installer-tools/wix.exe'
$extension = Join-Path $root '.wix/extensions/WixToolset.UI.wixext/4.0.6/wixext4/WixToolset.UI.wixext.dll'
if (-not (Test-Path -LiteralPath $wix) -or -not (Test-Path -LiteralPath $extension)) { throw 'Run scripts/prepare-installer-tools.ps1 explicitly before building the MSI.' }
$work = Join-Path $root 'artifacts/installer-build'
New-Item -ItemType Directory -Force $work | Out-Null
$namespace = 'http://wixtoolset.org/schemas/v4/wxs'
$xml = [xml]"<Wix xmlns='$namespace'><Fragment><DirectoryRef Id='INSTALLDIR'/><ComponentGroup Id='PackageFiles'/></Fragment></Wix>"
$directories = @{ '' = $xml.Wix.Fragment.DirectoryRef }
$group = $xml.Wix.Fragment.ComponentGroup
# 所有动态路径均经 XML API 转义，稳定 ID 来自相对路径，不插入可执行脚本文本。
function Add-WixElement($parent, [string]$name, [hashtable]$attributes) {
    $element = $xml.CreateElement($name, $namespace)
    foreach ($key in $attributes.Keys) { $element.SetAttribute($key, [string]$attributes[$key]) }
    [void]$parent.AppendChild($element)
    return $element
}
foreach ($file in Get-ChildItem -LiteralPath $package -File -Recurse | Sort-Object FullName) {
    $relative = [IO.Path]::GetRelativePath($package, $file.FullName).Replace('\','/')
    $directoryPath = ''
    foreach ($part in @($relative.Split('/') | Select-Object -SkipLast 1)) {
        $parent = $directoryPath
        $directoryPath = if ($parent) { "$parent/$part" } else { $part }
        if (-not $directories.ContainsKey($directoryPath)) {
            $id = 'd' + [Convert]::ToHexStringLower([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($directoryPath))).Substring(0,24)
            $directories[$directoryPath] = Add-WixElement $directories[$parent] 'Directory' @{ Id=$id; Name=$part }
            # 每用户目录通过注册表键作为组件锚点，仅在目录为空时卸载清理。
            $cleanup = Add-WixElement $directories[$directoryPath] 'Component' @{ Id="c$id"; Guid='*' }
            $null = Add-WixElement $cleanup 'RegistryValue' @{ Root='HKCU'; Key='Software\Notesae\Screenshot\InstallerFiles'; Name=$id; Value='1'; Type='integer'; KeyPath='yes' }
            $null = Add-WixElement $cleanup 'RemoveFolder' @{ Id="r$id"; On='uninstall' }
            $null = Add-WixElement $group 'ComponentRef' @{ Id="c$id" }
        }
    }
    # 带文件及 HKCU 锚点的组件显式使用稳定 GUID，升级时不随构建目录或内容改变。
    $identity = [Convert]::ToHexStringLower([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes('Screenshot/file/' + $relative)))
    $id = 'f' + $identity.Substring(0,24)
    $componentGuid = [guid]::ParseExact($identity.Substring(0,32), 'N').ToString()
    $component = Add-WixElement $directories[$directoryPath] 'Component' @{ Id="c$id"; Guid=$componentGuid }
    $null = Add-WixElement $component 'File' @{ Id=$id; Source=$file.FullName; KeyPath='no' }
    $null = Add-WixElement $component 'RegistryValue' @{ Root='HKCU'; Key='Software\Notesae\Screenshot\InstallerFiles'; Name=$id; Value=$version; Type='string'; KeyPath='yes' }
    $null = Add-WixElement $group 'ComponentRef' @{ Id="c$id" }
}
$payloadSource = Join-Path $work 'Payload.wxs'; $xml.Save($payloadSource)
# 把原条款按 Unicode RTF 编码提供给中文安装界面，不改写正式条款或替用户同意。
$rtf = [Text.StringBuilder]::new('{\rtf1\ansi\ansicpg936\deff0{\fonttbl{\f0 Microsoft YaHei;}}\f0\fs20 ')
foreach ($character in [IO.File]::ReadAllText((Join-Path $package 'app/legal/TERMS.zh-CN.txt')).ToCharArray()) {
    $code = [int]$character
    if ($character -eq "`n") { [void]$rtf.Append('\par ') }
    elseif ($character -eq "`r") { continue }
    elseif ($code -gt 127) { if ($code -gt 32767) { $code -= 65536 }; [void]$rtf.Append("\u${code}?") }
    else { if ($character -in @('\','{','}')) { [void]$rtf.Append('\') }; [void]$rtf.Append($character) }
}
[void]$rtf.Append('}'); $termsRtf = Join-Path $work 'Terms.rtf'; [IO.File]::WriteAllText($termsRtf, $rtf.ToString(), [Text.Encoding]::ASCII)
$oldRollForward = $env:DOTNET_ROLL_FORWARD
try {
    $env:DOTNET_ROLL_FORWARD = 'Major'
    & $wix build (Join-Path $root 'packaging/Installer.wxs') $payloadSource -arch x64 -culture zh-CN -ext $extension -d "Version=$version" -d "Icon=$(Join-Path $root 'src/Screenshot.App/Assets/Screenshot.ico')" -d "TermsRtf=$termsRtf" -intermediatefolder $work -cc (Join-Path $work 'cab-cache') -pdbtype none -o $Output
    if ($LASTEXITCODE) { throw 'MSI build failed.' }
} finally { $env:DOTNET_ROLL_FORWARD = $oldRollForward }
Write-Output "Installer: $Output"

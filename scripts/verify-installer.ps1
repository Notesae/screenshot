# 离线反编译并逐字节核对 MSI；不注册产品、不运行安装器、不创建真实快捷方式。
param([Parameter(Mandatory)][string]$Installer, [Parameter(Mandatory)][string]$PackagePath, [string]$ReportPath)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$package = (Resolve-Path -LiteralPath $PackagePath).Path
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
$inspection = Join-Path $root ('artifacts/installer-inspection-' + [guid]::NewGuid().ToString('N'))
$source = Join-Path $inspection 'Installer.wxs'
$oldRollForward = $env:DOTNET_ROLL_FORWARD
try {
    $env:DOTNET_ROLL_FORWARD = 'Major'
    & (Join-Path $root 'artifacts/installer-tools/wix.exe') msi decompile $installerPath -x $inspection -o $source
    if ($LASTEXITCODE) { throw 'MSI offline extraction failed.' }
} finally { $env:DOTNET_ROLL_FORWARD = $oldRollForward }
$xml = [xml][IO.File]::ReadAllText($source)
$namespace = [Xml.XmlNamespaceManager]::new($xml.NameTable); $namespace.AddNamespace('w', $xml.DocumentElement.NamespaceURI)
$product = $xml.SelectSingleNode('//w:Package', $namespace)
$version = (Get-Content (Join-Path $package 'app/sbom.cdx.json') -Raw | ConvertFrom-Json).metadata.component.version
if ($product.Version -ne $version -or $product.Scope -ne 'perUser' -or $product.Language -ne '2052') { throw 'Installer version, scope or language differs.' }
$files = @($xml.SelectNodes('//w:File', $namespace))
$expectedFiles = @(Get-ChildItem -LiteralPath $package -File -Recurse)
if ($files.Count -ne $expectedFiles.Count) { throw 'Installer payload file count differs.' }
foreach ($file in $files) {
    # 按 MSI 实际目录树重建路径，不能只按同名文件或声明的大小判断载荷一致。
    $parts = [Collections.Generic.List[string]]::new(); $parts.Add($file.Name)
    for ($ancestor = $file.ParentNode; $ancestor -and $ancestor.Id -ne 'INSTALLDIR'; $ancestor = $ancestor.ParentNode) {
        if ($ancestor.LocalName -eq 'Directory') { $parts.Insert(0, $ancestor.Name) }
    }
    if (-not $ancestor) { throw 'Installer file outside application directory.' }
    $relative = $parts -join '/'
    $original = Join-Path $package $relative
    $extracted = Join-Path $inspection ('File/' + $file.Id)
    if (-not (Test-Path -LiteralPath $original) -or (Get-FileHash -LiteralPath $original).Hash -ne (Get-FileHash -LiteralPath $extracted).Hash) { throw "Installer payload mismatch: $relative" }
}
$shortcuts = @($xml.SelectNodes('//w:Shortcut', $namespace))
if ($shortcuts.Count -ne 2 -or @($shortcuts | Where-Object { $_.Target -ne '[INSTALLDIR]Screenshot.exe' -or $_.Icon -ne 'Screenshot.exe' }).Count) { throw 'Installer shortcuts do not use the root executable and icon.' }
if (-not $xml.SelectSingleNode('//w:RegistryValue[@Name="InstallDirectory" and @Value="[INSTALLDIR]" and @Root="HKCU"]', $namespace)) { throw 'Installer ownership marker missing.' }
if (-not $xml.SelectSingleNode('//w:Launch[contains(@Condition,"WEBVIEW_MACHINE") and contains(@Condition,"Installed")]', $namespace)) { throw 'WebView2 prerequisite or uninstall allowance missing.' }
$installedIcon = Join-Path $inspection 'Icon/Screenshot.exe'
if ((Get-FileHash -LiteralPath $installedIcon).Hash -ne (Get-FileHash -LiteralPath (Join-Path $root 'src/Screenshot.App/Assets/Screenshot.ico')).Hash) { throw 'Installer icon differs.' }
# 从 MSI 真正嵌入的 RTF 还原完整条款，验证中文编码，不依赖打开窗口来判断文字是否完整。
$license = $xml.SelectSingleNode('//w:Control[@Id="LicenseText"]', $namespace).Text
$start = $license.IndexOf('\fs20 ') + 6
if ($start -lt 6) { throw 'Installer license RTF header missing.' }
$license = $license.Substring($start, $license.Length - $start - 1).Replace('\par ', "`n")
$license = [regex]::Replace($license, '\\u(-?\d+)\?', { param($match) $code = [int]$match.Groups[1].Value; if ($code -lt 0) { $code += 65536 }; [string][char]$code })
$license = [regex]::Replace($license, '\\([\\{}])', '$1')
if ($license -ne [IO.File]::ReadAllText((Join-Path $package 'app/legal/TERMS.zh-CN.txt')).Replace("`r`n", "`n")) { throw 'Installer Chinese license differs from original terms.' }
$report = @{ version=$version; scope=$product.Scope; filesCompared=$files.Count; shortcuts=$shortcuts.Count; chineseTermsVerified=$true; installed=$false; desktopTestsPerformed=$false; sourceManifestSha256=(Get-FileHash -LiteralPath (Join-Path $package 'SHA256SUMS.txt')).Hash.ToLowerInvariant(); sha256=(Get-FileHash -LiteralPath $installerPath).Hash.ToLowerInvariant() } | ConvertTo-Json
if ($ReportPath) { [IO.File]::WriteAllText([IO.Path]::GetFullPath($ReportPath), $report) }
Write-Output $report

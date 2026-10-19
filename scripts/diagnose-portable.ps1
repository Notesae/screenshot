# 静态便携诊断，不启动 Screenshot、不打开窗口、不捕获桌面、不读取配置/截图/恢复库。
param([string]$PackagePath=(Join-Path (Split-Path $PSScriptRoot -Parent) 'artifacts/Screenshot-win-x64'),[string]$ReportPath)
$ErrorActionPreference='Stop'
$packageRoot=(Resolve-Path -LiteralPath $PackagePath).Path
$missing=@();foreach($file in @('Screenshot.exe','Screenshot.runtimeconfig.json','web/index.html','sbom.cdx.json','SHA256SUMS.txt')){if(-not(Test-Path -LiteralPath (Join-Path $packageRoot $file))){$missing+=$file}}
$webViewVersions=@()
foreach($key in @('HKCU:\Software\Microsoft\EdgeUpdate\Clients','HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients','HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients')){
    if(Test-Path -LiteralPath $key){foreach($child in Get-ChildItem -LiteralPath $key){$value=Get-ItemProperty -LiteralPath $child.PSPath;if($value.name -like '*WebView2*' -and $value.pv){$webViewVersions+=$value.pv}}}
}
$manifestPath=Join-Path $packageRoot 'models/pp-ocrv5-mobile/manifest.json';$models=@()
if(Test-Path -LiteralPath $manifestPath){$manifest=Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json;foreach($file in $manifest.files){$modelPath=Join-Path $packageRoot ('models/pp-ocrv5-mobile/'+$file.name);$models+=@{name=$file.name;verified=((Test-Path -LiteralPath $modelPath) -and (Get-FileHash -LiteralPath $modelPath -Algorithm SHA256).Hash -ieq $file.sha256)}}}
$report=@{schemaVersion=1;architecture=[System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture.ToString();osVersion=[Environment]::OSVersion.Version.ToString();missingFiles=$missing;webView2Versions=@($webViewVersions|Select-Object -Unique);models=$models;desktopTestsPerformed=$false;message='仅静态依赖诊断；不证明捕获、透明合成、IME或干净机器验收。缺少WebView2时需用户自行准备，不自动安装。'}|ConvertTo-Json -Depth 6
if($ReportPath){[System.IO.File]::WriteAllText($ReportPath,$report,[System.Text.UTF8Encoding]::new($false))}
Write-Output $report
if($missing.Count -or -not $webViewVersions.Count -or $models.Count -ne 2 -or @($models|Where-Object {-not $_.verified}).Count){exit 1}

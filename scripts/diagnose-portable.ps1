# 静态便携诊断，不启动 Screenshot、不打开窗口、不捕获桌面、不读取配置/截图/恢复库。
param([string]$PackagePath,[string]$ReportPath)
if(-not $PackagePath){$PackagePath=if(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'Screenshot.exe')){$PSScriptRoot}else{Join-Path (Split-Path $PSScriptRoot -Parent) 'artifacts/Screenshot-win-x64'}}
$ErrorActionPreference='Stop'
$packageRoot=(Resolve-Path -LiteralPath $PackagePath).Path
# 可从整包根目录或 app 内执行；后续检查仍针对实际宿主和依赖目录。
if(Test-Path -LiteralPath (Join-Path $packageRoot 'app/Screenshot.exe')){$packageRoot=Join-Path $packageRoot 'app'}
$missing=@();foreach($file in @('Screenshot.exe','Screenshot.runtimeconfig.json','web/index.html','sbom.cdx.json','SHA256SUMS.txt')){if(-not(Test-Path -LiteralPath (Join-Path $packageRoot $file))){$missing+=$file}}
$webViewVersions=@()
foreach($key in @('HKCU:\Software\Microsoft\EdgeUpdate\Clients','HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients','HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients')){
    if(Test-Path -LiteralPath $key){foreach($child in Get-ChildItem -LiteralPath $key){$value=Get-ItemProperty -LiteralPath $child.PSPath;if($value.name -like '*WebView2*' -and $value.pv){$webViewVersions+=$value.pv}}}
}
$manifestPath=Join-Path $packageRoot 'models/pp-ocrv5-mobile/manifest.json';$models=@()
if(Test-Path -LiteralPath $manifestPath){$manifest=Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json;foreach($file in $manifest.files){$modelPath=Join-Path $packageRoot ('models/pp-ocrv5-mobile/'+$file.name);$models+=@{name=$file.name;verified=((Test-Path -LiteralPath $modelPath) -and (Get-FileHash -LiteralPath $modelPath -Algorithm SHA256).Hash -ieq $file.sha256)}}}
$nativeRequired=@();$nativeMissing=@();$nativeManifest=Join-Path $packageRoot 'native-dependencies.json'
if(Test-Path -LiteralPath $nativeManifest){
    $native=Get-Content -LiteralPath $nativeManifest -Raw|ConvertFrom-Json
    foreach($dependency in $native.externalRequirements|Where-Object {$_.kind -eq 'direct'}){
        if($dependency.name -notmatch '^[a-zA-Z0-9_.-]+\.dll$'){throw 'Native dependency filename invalid.'}
        $dependencyPath=Join-Path (Join-Path $env:SystemRoot 'System32') $dependency.name
        $present=Test-Path -LiteralPath $dependencyPath
        $version=if($present){[Diagnostics.FileVersionInfo]::GetVersionInfo($dependencyPath).FileVersion}else{$null}
        $nativeRequired+=@{name=$dependency.name;kind=$dependency.resolution;present=$present;version=$version}
        if(-not $present){$nativeMissing+=$dependency.name}
    }
}else{$missing+='native-dependencies.json'}
$report=@{schemaVersion=1;architecture=[System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture.ToString();osVersion=[Environment]::OSVersion.Version.ToString();missingFiles=$missing;webView2Versions=@($webViewVersions|Select-Object -Unique);models=$models;nativeExternalRequirements=$nativeRequired;nativeMissing=$nativeMissing;desktopTestsPerformed=$false;message='仅静态依赖诊断；不证明捕获、透明合成、IME或干净机器验收。缺少WebView2或Visual C++运行时需用户准备，不自动安装。文件存在不证明位数/导出符号/版本兼容或干净机器运行。'}|ConvertTo-Json -Depth 6
if($ReportPath){[System.IO.File]::WriteAllText($ReportPath,$report,[System.Text.UTF8Encoding]::new($false))}
Write-Output $report
if($missing.Count -or $nativeMissing.Count -or -not $webViewVersions.Count -or $models.Count -ne 2 -or @($models|Where-Object {-not $_.verified}).Count){exit 1}

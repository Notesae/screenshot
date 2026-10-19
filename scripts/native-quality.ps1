# Same test driver, isolated processes and synthetic data for both libraries. Never invokes the app.
param([string]$BuildRoot,[string]$Output,[int]$Rounds=3)
$ErrorActionPreference='Stop'
$taskRoot=Split-Path $PSScriptRoot -Parent
if(-not $BuildRoot){$BuildRoot=Join-Path $taskRoot 'artifacts/verify-vendor'}
if(-not $Output){$Output=Join-Path $taskRoot 'artifacts/qa/native-rebuild'}
New-Item -ItemType Directory -Force -Path $Output|Out-Null
$nativeRoot=Join-Path $taskRoot 'artifacts/native-runtime/win-x64'
& node (Join-Path $PSScriptRoot 'verify-native-runtime.cjs') $nativeRoot
if($LASTEXITCODE){throw 'Source runtime provenance invalid.'}
$source=Get-Content -LiteralPath (Join-Path $nativeRoot 'native-build.json') -Raw|ConvertFrom-Json
$baseline=Get-Content -LiteralPath (Join-Path $taskRoot 'native/vendor-baseline.json') -Raw|ConvertFrom-Json
$baselineRoot=Join-Path $taskRoot 'artifacts/native-vendor-baseline'
New-Item -ItemType Directory -Force -Path $baselineRoot|Out-Null
$vendorDll=Join-Path $baselineRoot 'OpenCvSharpExtern.dll'
if(-not(Test-Path -LiteralPath $vendorDll)){
    $archive=Join-Path $baselineRoot 'baseline.nupkg'
    if(-not(Test-Path -LiteralPath $archive)){Invoke-WebRequest -Uri $baseline.url -OutFile $archive -TimeoutSec 300}
    if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ine $baseline.archiveSha256){throw 'Vendor baseline archive hash differs.'}
    $zip=[IO.Compression.ZipFile]::OpenRead($archive)
    try{$entry=$zip.GetEntry($baseline.member);if(-not $entry){throw 'Baseline native member missing.'};[IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$vendorDll,$false)}finally{$zip.Dispose()}
}
if((Get-FileHash -LiteralPath $vendorDll -Algorithm SHA256).Hash -ine $baseline.binarySha256){throw 'Vendor baseline DLL hash differs.'}
# The comparison driver has no production source-loader hook; both handles are explicit.
& dotnet build (Join-Path $taskRoot 'tests/Screenshot.Ocr.Tests/Screenshot.Ocr.Tests.csproj') -c Release -p:ScreenshotNativeRuntime=Vendor --artifacts-path $BuildRoot --maxcpucount:1
if($LASTEXITCODE){throw 'Isolated comparison driver build failed.'}
$runner=Join-Path $BuildRoot 'bin/Screenshot.Ocr.Tests/release/Screenshot.Ocr.Tests.dll'
foreach($round in 1..$Rounds){
    $profiles=if($round%2){@('vendor','source')}else{@('source','vendor')}
    foreach($profile in $profiles){
        $library=if($profile -eq 'vendor'){$vendorDll}else{Join-Path $nativeRoot 'OpenCvSharpExtern.dll'}
        $hash=if($profile -eq 'vendor'){$baseline.binarySha256}else{$source.binary.sha256}
        & dotnet $runner --native-quality (Join-Path $Output "$profile-$round.json") (Join-Path $taskRoot 'models/pp-ocrv5-mobile') $library $hash
        if($LASTEXITCODE){throw "Native OCR quality failed: $profile round $round"}
    }
}
& node (Join-Path $PSScriptRoot 'compare-native-quality.cjs') $Output $Rounds
if($LASTEXITCODE){throw 'Native source/vendor comparison requires repair or investigation.'}

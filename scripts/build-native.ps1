# Builds only pinned sources into artifacts; never installs host tools or changes machine settings.
param([string]$Output,[int]$Parallel=4)
$ErrorActionPreference='Stop'
$taskRoot=Split-Path $PSScriptRoot -Parent
if(-not $Output){$Output=Join-Path $taskRoot 'artifacts/native-runtime/win-x64'}
$Output=[IO.Path]::GetFullPath($Output)
$work=Join-Path $taskRoot 'artifacts/native-build'
$downloads=Join-Path $taskRoot 'artifacts/native-source-downloads'
$sources=Join-Path $work 'sources'
$prefix=Join-Path $work 'prefix'
$evidence=Join-Path $Output 'evidence'
foreach($directory in @($work,$downloads,$sources,$prefix,$Output,$evidence)){New-Item -ItemType Directory -Force -Path $directory|Out-Null}
$lockPath=Join-Path $taskRoot 'native/sources.lock.json'
$lock=Get-Content -LiteralPath $lockPath -Raw|ConvertFrom-Json
$cmake=(Get-Command cmake.exe -ErrorAction SilentlyContinue).Source
$ninja=(Get-Command ninja.exe -ErrorAction SilentlyContinue).Source
if(-not $cmake -or -not $ninja){throw 'Existing CMake and Ninja are required. No tools were installed. Use the native CI job or obtain explicit permission to install tools.'}
if(-not (Get-Command cl.exe -ErrorAction SilentlyContinue)){
    $vswhere=Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
    if(-not(Test-Path -LiteralPath $vswhere)){throw 'Existing MSVC toolchain unavailable; no installation attempted.'}
    $installation=& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if(-not $installation){throw 'Existing MSVC C++ workload unavailable; no installation attempted.'}
    $developerCommand=Join-Path $installation 'Common7/Tools/VsDevCmd.bat'
    # Capture environment in this process only. Never print inherited variables or secrets.
    $lines=& $env:ComSpec /d /s /c "call `"$developerCommand`" -no_logo -arch=x64 -host_arch=x64 >nul && set"
    if($LASTEXITCODE){throw 'Existing MSVC environment initialization failed.'}
    foreach($line in $lines){if($line -match '^([^=][^=]*)=(.*)$'){[Environment]::SetEnvironmentVariable($matches[1],$matches[2],'Process')}}
}
$env:VSLANG='1033'
$env:SOURCE_DATE_EPOCH='1782518400'
$cl=(Get-Command cl.exe -ErrorAction Stop).Source
$sourceDirectories=@{}
$sourceInputs=[Collections.Generic.List[object]]::new()
foreach($source in $lock.sources){
    $archive=Join-Path $downloads ($source.name+'-'+$source.commit+'.zip')
    if(-not(Test-Path -LiteralPath $archive)){
        $temporary=$archive+'.download'
        Invoke-WebRequest -Uri $source.url -OutFile $temporary -TimeoutSec 300
        if((Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash -ine $source.sha256){throw "Source checksum mismatch: $($source.name)"}
        Move-Item -LiteralPath $temporary -Destination $archive
    }
    if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ine $source.sha256){throw "Cached source checksum mismatch: $($source.name)"}
    $destination=Join-Path $sources ($source.name+'-'+$source.commit)
    $marker=Join-Path $destination '.screenshot-source-sha256'
    if(-not(Test-Path -LiteralPath $marker)){
        if(Test-Path -LiteralPath $destination){throw "Unmarked source directory exists: $destination"}
        New-Item -ItemType Directory -Path $destination|Out-Null
        $zip=[IO.Compression.ZipFile]::OpenRead($archive)
        try{
            $archiveRoot=$zip.Entries[0].FullName.Split('/')[0]+'/'
            foreach($entry in $zip.Entries){
                if(-not $entry.FullName.StartsWith($archiveRoot,[StringComparison]::Ordinal)){throw 'Unexpected source archive root.'}
                $relative=$entry.FullName.Substring($archiveRoot.Length)
                if(-not $relative){continue}
                $target=[IO.Path]::GetFullPath((Join-Path $destination $relative))
                if(-not $target.StartsWith($destination+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Source archive path escapes its root.'}
                if(($entry.ExternalAttributes -shr 16 -band 0xf000) -eq 0xa000){throw 'Source archive link is not accepted.'}
                if($entry.FullName.EndsWith('/')){New-Item -ItemType Directory -Force -Path $target|Out-Null;continue}
                New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent)|Out-Null
                [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$target,$false)
            }
        }finally{$zip.Dispose()}
        [IO.File]::WriteAllText($marker,$source.sha256)
    }elseif((Get-Content -LiteralPath $marker -Raw).Trim() -ne $source.sha256){throw 'Source extraction marker mismatch.'}
    # Revalidate every extracted input, including reused caches; zlib only renames zconf.h during configure.
    $zip=[IO.Compression.ZipFile]::OpenRead($archive)
    try{
        $archiveRoot=$zip.Entries[0].FullName.Split('/')[0]+'/'
        $expectedFiles=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        $inputRecords=[Collections.Generic.List[object]]::new()
        foreach($entry in $zip.Entries){
            if($entry.FullName.EndsWith('/')){continue}
            $relative=$entry.FullName.Substring($archiveRoot.Length)
            $file=Join-Path $destination $relative
            if($source.name -eq 'zlib' -and $relative -eq 'zconf.h' -and -not(Test-Path -LiteralPath $file)){$file+='.included'}
            $entryStream=$entry.Open();try{$expected=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($entryStream)).ToLowerInvariant()}finally{$entryStream.Dispose()}
            if(-not(Test-Path -LiteralPath $file) -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ine $expected){throw "Extracted source differs: $($source.name)/$relative"}
            [void]$expectedFiles.Add([IO.Path]::GetFullPath($file));$inputRecords.Add(@{file=$relative;sha256=$expected})
        }
        foreach($file in Get-ChildItem -LiteralPath $destination -File -Recurse){if($file.FullName -ne $marker -and -not $expectedFiles.Contains($file.FullName)){throw "Unexpected source input: $($file.FullName)"}}
        $sourceInputs.Add(@{name=$source.name;commit=$source.commit;archiveSha256=$source.sha256;files=$inputRecords})
    }finally{$zip.Dispose()}
    $sourceDirectories[$source.name]=$destination
}
[IO.File]::WriteAllText((Join-Path $evidence 'source-inputs.json'),($sourceInputs|ConvertTo-Json -Depth 6))
function CMakeRun([string]$Name,[string[]]$Arguments){
    $log=Join-Path $evidence ($Name+'.log')
    $normalizedArguments=@($Arguments|ForEach-Object {$_.Replace('\','/')})
    & $cmake @normalizedArguments 2>&1|Tee-Object -FilePath $log
    if($LASTEXITCODE){throw "Native build failed: $Name (see $log)"}
}
$common=@('-G','Ninja','-DCMAKE_BUILD_TYPE=Release','-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded','-DCMAKE_POLICY_DEFAULT_CMP0091=NEW','-DCMAKE_FIND_USE_PACKAGE_REGISTRY=OFF','-DCMAKE_FIND_USE_SYSTEM_PACKAGE_REGISTRY=OFF')
$zlibBuild=Join-Path $work 'zlib'
CMakeRun 'zlib-configure' (@('-S',$sourceDirectories.zlib,'-B',$zlibBuild)+$common+@('-DZLIB_BUILD_EXAMPLES=OFF'))
CMakeRun 'zlib-build' @('--build',$zlibBuild,'--target','zlibstatic','--parallel',"$Parallel")
$include=Join-Path $prefix 'include';$lib=Join-Path $prefix 'lib'
New-Item -ItemType Directory -Force -Path $include,$lib|Out-Null
Copy-Item -LiteralPath (Join-Path $sourceDirectories.zlib 'zlib.h'),(Join-Path $zlibBuild 'zconf.h') -Destination $include
$zlibLibrary=Join-Path $lib 'zlibstatic.lib';Copy-Item -LiteralPath (Join-Path $zlibBuild 'zlibstatic.lib') -Destination $zlibLibrary
$pngBuild=Join-Path $work 'libpng'
$dependencyOptions=@("-DZLIB_LIBRARY=$zlibLibrary","-DZLIB_INCLUDE_DIR=$include")
CMakeRun 'png-configure' (@('-S',$sourceDirectories.libpng,'-B',$pngBuild)+$common+$dependencyOptions+@('-DPNG_SHARED=OFF','-DPNG_STATIC=ON','-DPNG_TESTS=OFF','-DPNG_TOOLS=OFF','-DPNG_EXECUTABLES=OFF','-DPNG_DEBUG=OFF'))
CMakeRun 'png-build' @('--build',$pngBuild,'--target','png_static','--parallel',"$Parallel")
Copy-Item -LiteralPath (Join-Path $sourceDirectories.libpng 'png.h'),(Join-Path $sourceDirectories.libpng 'pngconf.h'),(Join-Path $pngBuild 'pnglibconf.h') -Destination $include
$pngLibrary=Join-Path $lib 'libpng16_static.lib';Copy-Item -LiteralPath (Join-Path $pngBuild 'libpng16_static.lib') -Destination $pngLibrary
$cvBuild=Join-Path $work 'opencv';$cvInstall=Join-Path $prefix 'opencv'
$options=@("-DOPENCV_DOWNLOAD_PATH=$(Join-Path $work 'opencv-downloads')",'-DBUILD_LIST=core,imgproc,imgcodecs','-DBUILD_SHARED_LIBS=OFF','-DBUILD_WITH_STATIC_CRT=ON','-DBUILD_TESTS=OFF','-DBUILD_PERF_TESTS=OFF','-DBUILD_EXAMPLES=OFF','-DBUILD_opencv_apps=OFF','-DBUILD_opencv_gapi=OFF','-DWITH_ADE=OFF','-DBUILD_JAVA=OFF','-DBUILD_opencv_python2=OFF','-DBUILD_opencv_python3=OFF','-DBUILD_opencv_world=OFF','-DWITH_IPP=OFF','-DBUILD_IPP_IW=OFF','-DWITH_ITT=OFF','-DCV_TRACE=OFF','-DWITH_FLATBUFFERS=OFF','-DWITH_OBSENSOR=OFF','-DWITH_OPENCL=OFF','-DWITH_EIGEN=OFF','-DWITH_TBB=OFF','-DWITH_OPENMP=OFF','-DWITH_FFMPEG=OFF','-DWITH_GSTREAMER=OFF','-DWITH_MSMF=OFF','-DWITH_DSHOW=OFF','-DWITH_WIN32UI=OFF','-DWITH_DIRECTX=OFF','-DWITH_QUIRC=OFF','-DWITH_PROTOBUF=OFF','-DWITH_PNG=ON','-DBUILD_PNG=OFF','-DBUILD_ZLIB=OFF','-DWITH_JPEG=OFF','-DWITH_TIFF=OFF','-DWITH_WEBP=OFF','-DWITH_OPENJPEG=OFF','-DWITH_OPENEXR=OFF','-DWITH_JASPER=OFF','-DWITH_AVIF=OFF','-DWITH_GDAL=OFF','-DWITH_GDCM=OFF','-DWITH_IMGCODEC_HDR=OFF','-DWITH_IMGCODEC_SUNRASTER=OFF','-DWITH_IMGCODEC_PXM=OFF','-DWITH_IMGCODEC_PFM=OFF','-DWITH_IMGCODEC_GIF=OFF','-DWITH_IMGCODEC_BMP=OFF','-DCPU_BASELINE=SSE2','-DCPU_DISPATCH=SSE4_1,SSE4_2,AVX,FP16,AVX2',"-DPNG_LIBRARY=$pngLibrary","-DPNG_PNG_INCLUDE_DIR=$include","-DCMAKE_INSTALL_PREFIX=$cvInstall")
CMakeRun 'opencv-configure' (@('-S',$sourceDirectories.opencv,'-B',$cvBuild)+$common+$dependencyOptions+$options)
CMakeRun 'opencv-build' @('--build',$cvBuild,'--target','opencv_imgcodecs','--parallel',"$Parallel")
CMakeRun 'opencv-stage' @('--install',$cvBuild,'--config','Release')
$cvConfigs=@(Get-ChildItem -LiteralPath $cvInstall -Filter OpenCVConfig.cmake -File -Recurse|Where-Object {$_.Directory.Name -eq 'staticlib'})
if($cvConfigs.Count -ne 1){throw 'Expected exactly one staged static OpenCV configuration.'}
$cvConfig=$cvConfigs[0].Directory.FullName
$wrapperBuild=Join-Path $work 'wrapper'
CMakeRun 'wrapper-configure' (@('-S',(Join-Path $taskRoot 'native'),'-B',$wrapperBuild)+$common+$dependencyOptions+@("-DOpenCV_DIR=$cvConfig","-DSCREENSHOT_OPENCVSHARP_SOURCE=$($sourceDirectories.opencvsharp)","-DPNG_LIBRARY=$pngLibrary","-DPNG_PNG_INCLUDE_DIR=$include"))
CMakeRun 'wrapper-build' @('--build',$wrapperBuild,'--target','OpenCvSharpExtern','--parallel',"$Parallel")
Copy-Item -LiteralPath (Join-Path $wrapperBuild 'OpenCvSharpExtern.dll') -Destination $Output
Copy-Item -LiteralPath (Join-Path $wrapperBuild 'OpenCvSharpExtern.map') -Destination $evidence
foreach($pair in @(@('zlib',$zlibBuild),@('libpng',$pngBuild),@('opencv',$cvBuild),@('wrapper',$wrapperBuild))){Copy-Item -LiteralPath (Join-Path $pair[1] 'CMakeCache.txt') -Destination (Join-Path $evidence ($pair[0]+'-CMakeCache.txt'))}
$tools=@{cmake=(& $cmake --version|Select-Object -First 1);ninja=(& $ninja --version);compiler=(Get-Item -LiteralPath $cl).VersionInfo.FileVersion;compilerPath=$cl;windowsSdkVersion=$env:WindowsSDKVersion;sourceDateEpoch=$env:SOURCE_DATE_EPOCH;platform='windows-x64';configuration='Release';bitReproducibilityClaimed=$false}
$tools|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $evidence 'toolchain.json') -Encoding utf8
$sourceDirectories|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $evidence 'source-directories.json') -Encoding utf8
& node (Join-Path $taskRoot 'scripts/native-build-manifest.cjs') $Output
if($LASTEXITCODE){throw 'Native provenance audit failed.'}
Write-Output "Native runtime built with provenance: $Output"

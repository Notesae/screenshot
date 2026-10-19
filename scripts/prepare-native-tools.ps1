# Explicit portable-tool preparation; scoped to artifacts/tools, no installation or persistent PATH.
$ErrorActionPreference='Stop'
$taskRoot=Split-Path $PSScriptRoot -Parent
$tools=Join-Path $taskRoot 'artifacts/tools'
New-Item -ItemType Directory -Force -Path $tools|Out-Null
$pins=@(
 @{Name='cmake-3.31.11';File='cmake-3.31.11-windows-x86_64.zip';Url='https://github.com/Kitware/CMake/releases/download/v3.31.11/cmake-3.31.11-windows-x86_64.zip';Hash='1210542e49be1a88edfcfd7a3c68407804f5e85945509cf1c5eb5470b5e35beb';Bin='cmake-3.31.11-windows-x86_64/bin'},
 @{Name='ninja-1.13.2';File='ninja-win.zip';Url='https://github.com/ninja-build/ninja/releases/download/v1.13.2/ninja-win.zip';Hash='07fc8261b42b20e71d1720b39068c2e14ffcee6396b76fb7a795fb460b78dc65';Bin='.'}
)
foreach($pin in $pins){
 $directory=Join-Path $tools $pin.Name;New-Item -ItemType Directory -Force -Path $directory|Out-Null
 $archive=Join-Path $tools $pin.File
 if(-not(Test-Path -LiteralPath $archive)){Invoke-WebRequest -Uri $pin.Url -OutFile $archive -TimeoutSec 300}
 if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ine $pin.Hash){throw ('Portable tool checksum differs: '+$pin.Name)}
 $zip=[IO.Compression.ZipFile]::OpenRead($archive)
 try{foreach($entry in $zip.Entries){
  $target=[IO.Path]::GetFullPath((Join-Path $directory $entry.FullName))
  if(-not $target.StartsWith([IO.Path]::GetFullPath($directory)+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe portable tool archive member.'}
  if(-not $entry.Name){New-Item -ItemType Directory -Force -Path $target|Out-Null;continue}
  New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent)|Out-Null
  if(Test-Path -LiteralPath $target){
   $stream=$entry.Open();try{$expected=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($stream))}finally{$stream.Dispose()}
   if((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ine $expected){throw ('Existing tool file differs; left untouched: '+$entry.FullName)}
  }else{[IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$target,$false)}
 }}finally{$zip.Dispose()}
 $env:PATH=(Join-Path $directory $pin.Bin)+[IO.Path]::PathSeparator+$env:PATH
}
& cmake.exe --version
if($LASTEXITCODE){throw 'Portable CMake failed.'}
& ninja.exe --version
if($LASTEXITCODE){throw 'Portable Ninja failed.'}

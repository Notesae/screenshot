# 使用已有 MSVC 编译静态运行时的入口；不安装工具，不启动 Screenshot。
param([Parameter(Mandatory)][string]$Output)
$ErrorActionPreference = 'Stop'
$Output = [IO.Path]::GetFullPath($Output)
$root = Split-Path $PSScriptRoot -Parent
$work = Join-Path $root 'artifacts/launcher-build'
New-Item -ItemType Directory -Force $work | Out-Null
if (-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
    $installation = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if (-not $installation) { throw 'Existing MSVC x64 tools are required to build the launcher.' }
    $developerCommand = Join-Path $installation 'Common7/Tools/VsDevCmd.bat'
    $lines = & $env:ComSpec /d /s /c "call `"$developerCommand`" -no_logo -arch=x64 -host_arch=x64 >nul && set"
    if ($LASTEXITCODE) { throw 'MSVC environment initialization failed.' }
    foreach ($line in $lines) { if ($line -match '^([^=][^=]*)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') } }
}
$version = (Get-Content (Join-Path $root 'editor/package.json') -Raw | ConvertFrom-Json).version
$commit = & git -C $root rev-parse HEAD
if ($LASTEXITCODE) { throw 'Cannot read launcher source revision.' }
$icon = (Join-Path $root 'src/Screenshot.App/Assets/Screenshot.ico').Replace('\','\\')
$manifest = (Join-Path $root 'src/Screenshot.App/app.manifest').Replace('\','\\')
# 版本与宿主一致，发布审查可以直接检查用户实际双击的根目录 EXE。
$resource = @"
#include <windows.h>
1 ICON "$icon"
1 RT_MANIFEST "$manifest"
1 VERSIONINFO
FILEVERSION $($version.Replace('.',',')),0
PRODUCTVERSION $($version.Replace('.',',')),0
FILETYPE VFT_APP
BEGIN
 BLOCK "StringFileInfo" BEGIN BLOCK "040904b0" BEGIN
  VALUE "FileDescription", "Screenshot"
  VALUE "ProductName", "Screenshot"
  VALUE "ProductVersion", "$version+$commit"
  VALUE "FileVersion", "$version"
  VALUE "LegalCopyright", "Copyright 2026 Notesae"
 END END
 BLOCK "VarFileInfo" BEGIN VALUE "Translation", 0x0409, 1200 END
END
"@
$resourcePath = Join-Path $work 'launcher.rc'
[IO.File]::WriteAllText($resourcePath, $resource)
Push-Location $work
try {
    & rc.exe /nologo /fo launcher.res $resourcePath
    if ($LASTEXITCODE) { throw 'Launcher resources failed.' }
    & cl.exe /nologo /utf-8 /W4 /WX /O2 /MT /DUNICODE /D_UNICODE (Join-Path $root 'native/launcher/main.c') launcher.res "/Fe:$([IO.Path]::GetFullPath($Output))" /link /SUBSYSTEM:WINDOWS /DYNAMICBASE /NXCOMPAT /guard:cf user32.lib
    if ($LASTEXITCODE) { throw 'Launcher compilation failed.' }
} finally { Pop-Location }

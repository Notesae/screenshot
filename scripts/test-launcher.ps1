# 只执行原生入口的 --check-package 分支，不启动 WPF、WebView2 或任何窗口。
param([Parameter(Mandatory)][string]$PackagePath)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$fixture = Join-Path $root ('artifacts/launcher-tests/中文 空格 ' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $fixture | Out-Null
$launcher = Join-Path $fixture 'Screenshot.exe'
Copy-Item -LiteralPath (Join-Path $PackagePath 'Screenshot.exe') -Destination $launcher
# 改用无关工作目录，证明入口按自身路径定位依赖，且缺包时给出明确退出码。
$missing = Start-Process -FilePath $launcher -ArgumentList '--check-package' -WorkingDirectory $root -WindowStyle Hidden -Wait -PassThru
if ($missing.ExitCode -ne 2) { throw 'Launcher did not reject a missing application directory.' }
New-Item -ItemType Directory (Join-Path $fixture 'app') | Out-Null
[IO.File]::WriteAllText((Join-Path $fixture 'app/Screenshot.exe'), 'synthetic file; must never execute')
$present = Start-Process -FilePath $launcher -ArgumentList '--check-package' -WorkingDirectory $root -WindowStyle Hidden -Wait -PassThru
if ($present.ExitCode -ne 0) { throw 'Launcher could not resolve a relocated Unicode application path.' }
Write-Output 'PASS native launcher package detection, Unicode/spaces and unrelated working directory (no host or desktop launched)'

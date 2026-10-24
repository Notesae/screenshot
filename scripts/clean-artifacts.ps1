# 只识别当前工作区内的生成物；默认预览，-Apply 才执行删除。
[CmdletBinding()]
param([switch]$Apply, [string[]]$KeepPath = @())
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$artifactRoot = Join-Path $projectRoot 'artifacts'
if (-not (Test-Path -LiteralPath $artifactRoot)) { return }
if ((Get-Item -LiteralPath $artifactRoot -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw 'artifacts 不能是目录联接或符号链接。'
}
$separator = [IO.Path]::DirectorySeparatorChar
# 固定缓存供后续离线编译复用；验证及发布记录不按临时文件删除。
$protectedNames = @('tools', 'dotnet-home', 'headless-tools', 'installer-tools', 'installer-build',
    'native-build', 'native-runtime', 'native-source-downloads', 'native-vendor-baseline',
    'publish-build-source', 'publish-build-vendor', 'verify-source', 'verify-vendor', 'launcher-build', 'qa', 'cleanup')
$keepRoots = @($KeepPath | ForEach-Object { [IO.Path]::TrimEndingDirectorySeparator([IO.Path]::GetFullPath($_)) })
$runningPaths = @(Get-Process -Name Screenshot -ErrorAction SilentlyContinue | ForEach-Object { $_.Path } | Where-Object { $_ })
$candidates = [Collections.Generic.List[object]]::new()

function Test-PortableDirectory([string]$Path) {
    foreach ($payload in @((Join-Path $Path 'app'), $Path)) {
        if ((Test-Path -LiteralPath (Join-Path $payload 'Screenshot.dll')) -and
            (Test-Path -LiteralPath (Join-Path $payload 'Screenshot.runtimeconfig.json')) -and
            (Test-Path -LiteralPath (Join-Path $payload 'web/index.html'))) { return $true }
    }
    return $false
}

function Add-ArtifactCandidate([IO.FileSystemInfo]$Entry, [string]$Reason) {
    $target = [IO.Path]::GetFullPath($Entry.FullName)
    if (-not $target.StartsWith($artifactRoot + $separator, [StringComparison]::OrdinalIgnoreCase)) {
        throw '清理目标越过了当前工作区的 artifacts。'
    }
    foreach ($keep in $keepRoots) {
        if ($target.Equals($keep, [StringComparison]::OrdinalIgnoreCase) -or
            $keep.StartsWith($target + $separator, [StringComparison]::OrdinalIgnoreCase) -or
            $target.StartsWith($keep + $separator, [StringComparison]::OrdinalIgnoreCase)) { return }
    }
    foreach ($executable in $runningPaths) {
        if ($executable.StartsWith($target + $separator, [StringComparison]::OrdinalIgnoreCase)) {
            Write-Warning "目录仍有 Screenshot 进程使用，保留：$target"
            return
        }
    }
    $candidates.Add([pscustomobject]@{ Path = $target; Reason = $Reason })
}

# 不递归猜测未知目录；CI/发行目录只移除已识别的载荷，留下原有报告和校验记录。
foreach ($entry in Get-ChildItem -LiteralPath $artifactRoot -Force) {
    if ($entry.Name -in $protectedNames) { continue }
    if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        Write-Warning "保留重解析点：$($entry.FullName)"
        continue
    }
    if ($entry.PSIsContainer) {
        if ($entry.Name -match '^(ci-\d+|release-.+)$') {
            foreach ($child in Get-ChildItem -LiteralPath $entry.FullName -Force) {
                if ($child.PSIsContainer -and ((Test-PortableDirectory $child.FullName) -or $child.Name -match '^previous-output-\d{8}-\d{6}$')) {
                    Add-ArtifactCandidate $child '下载的历史程序或旧输出备份'
                } elseif (-not $child.PSIsContainer -and $child.Name -match '\.(zip|msi|nupkg)$') {
                    Add-ArtifactCandidate $child '下载的历史发行或 CI 压缩包'
                }
            }
        } elseif (Test-PortableDirectory $entry.FullName) {
            Add-ArtifactCandidate $entry '历史完整程序副本'
        } elseif ((Test-Path -LiteralPath (Join-Path $entry.FullName 'bin')) -and (Test-Path -LiteralPath (Join-Path $entry.FullName 'obj'))) {
            Add-ArtifactCandidate $entry '非固定路径的构建中间文件'
        } elseif ($entry.Name -match '-before-[0-9a-f]{7,40}(?:-\d{8}-\d{6})?$|^slime-web-before-spacing-[0-9a-f]{7,40}$|^assessment-\d{8}$|^(motion-temp|update-tests-temp|windows-process-tests)$|^warmup-diagnostic-tests-[\w-]+$') {
            Add-ArtifactCandidate $entry '历史局部备份或隔离测试临时目录'
        }
    } elseif ($entry.Name -match '^Screenshot-.+\.(zip|msi)(\.sha256)?$|\.log$|^(deploy-|install-|update-).+\.ps1$|^package-.+\.cjs$|^motion-.+-probe\.cjs$|packaging-report-.+\.json$|^package-046-.+\.json$') {
        Add-ArtifactCandidate $entry '历史包、临时部署脚本或构建日志'
    }
}

function Measure-SafeArtifact([string]$Path) {
    # 手动遍历并检查每一级，避免递归删除沿联接走到其它目录。
    $target = [IO.Path]::GetFullPath($Path)
    if (-not $target.StartsWith($artifactRoot + $separator, [StringComparison]::OrdinalIgnoreCase)) { throw '目标越界。' }
    for ($ancestor = $target; $ancestor -ne $projectRoot; $ancestor = [IO.Path]::GetDirectoryName($ancestor)) {
        if ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "目标路径含重解析点：$ancestor" }
    }
    $pending = [Collections.Generic.Stack[IO.FileSystemInfo]]::new()
    $pending.Push((Get-Item -LiteralPath $target -Force))
    [long]$bytes = 0
    [long]$files = 0
    while ($pending.Count) {
        $item = $pending.Pop()
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "目标内部含重解析点：$($item.FullName)" }
        if ($item -is [IO.DirectoryInfo]) {
            foreach ($child in $item.EnumerateFileSystemInfos()) { $pending.Push($child) }
        } else { $bytes += $item.Length; $files++ }
    }
    return [pscustomobject]@{ Bytes = $bytes; Files = $files }
}

$report = [Collections.Generic.List[object]]::new()
foreach ($candidate in $candidates) {
    try {
        $size = Measure-SafeArtifact $candidate.Path
        $status = 'planned'
        if ($Apply) {
            Remove-Item -LiteralPath $candidate.Path -Recurse -Force -ErrorAction Stop
            $status = 'deleted'
        }
        $report.Add([pscustomobject]@{ Path = [IO.Path]::GetRelativePath($projectRoot, $candidate.Path); Reason = $candidate.Reason; Bytes = $size.Bytes; Files = $size.Files; Status = $status })
    } catch {
        Write-Warning "未完成清理：$($candidate.Path)：$($_.Exception.Message)"
        $report.Add([pscustomobject]@{ Path = [IO.Path]::GetRelativePath($projectRoot, $candidate.Path); Reason = $candidate.Reason; Bytes = 0; Files = 0; Status = 'failed'; Error = $_.Exception.Message })
    }
}
$summary = [pscustomobject]@{
    Applied = [bool]$Apply
    Entries = $report.Count
    Failed = @($report | Where-Object Status -eq 'failed').Count
    Bytes = [long](($report | Measure-Object Bytes -Sum).Sum)
    Items = @($report)
}
if ($Apply) {
    $reportDirectory = Join-Path $artifactRoot 'cleanup'
    if (Test-Path -LiteralPath $reportDirectory) {
        if ((Get-Item -LiteralPath $reportDirectory -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '清理报告目录不能是重解析点。' }
    } else { New-Item -ItemType Directory -Path $reportDirectory | Out-Null }
    $summary | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $reportDirectory 'last-run.json') -Encoding utf8
}
$summary

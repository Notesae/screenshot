# 显式准备固定本地模型包；只访问清单列出的公开源，下载后校验 SHA256，应用运行时不执行此脚本。
param([string]$ModelDirectory = (Join-Path (Split-Path $PSScriptRoot -Parent) 'models/pp-ocrv5-mobile'))
$ErrorActionPreference = 'Stop'
$manifestPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'models/pp-ocrv5-mobile/manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$modelRoot = [IO.Path]::GetFullPath($ModelDirectory)
[IO.Directory]::CreateDirectory($modelRoot) | Out-Null
$downloadRoot = Join-Path $modelRoot '.downloads'
[IO.Directory]::CreateDirectory($downloadRoot) | Out-Null
foreach ($model in $manifest.files) {
        $source = [Uri]$model.url
        if ($model.name -notmatch '^[a-zA-Z0-9_-]+\.onnx$' -or $model.sha256 -notmatch '^[a-f0-9]{64}$' -or
            $source.Scheme -ne 'https' -or $source.Host -ne 'www.modelscope.cn' -or $source.UserInfo -or $source.Query -or $source.Fragment) {
            throw 'Invalid pinned model manifest.'
        }
        $destination = Join-Path $modelRoot $model.name
        if ((Test-Path -LiteralPath $destination) -and (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -eq $model.sha256) {
            Write-Output "Verified local model: $($model.name)"
            continue
        }
        $temporary = Join-Path $downloadRoot ([Guid]::NewGuid().ToString('N') + '.partial')
        try {
            Write-Output "Downloading pinned model: $($model.name)"
            # 使用已验证的 PowerShell 下载/重定向路径，不携带密钥、cookie 或自定义登录参数。
            Invoke-WebRequest -Uri $source -OutFile $temporary -TimeoutSec 180 -MaximumRedirection 5
            if ((Get-Item -LiteralPath $temporary).Length -gt 64MB) { throw 'Model download exceeds 64 MB.' }
            if ((Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash -ne $model.sha256) { throw 'Model SHA256 mismatch; model was not installed.' }
            [IO.File]::Move($temporary, $destination, $true)
            Write-Output "Installed verified model: $($model.name)"
        } finally {
            if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
        }
}
    # 分发模型时同时带清单与已经归档的许可证，避免仅复制权重而丢失来源。
    $sourceRoot = Split-Path $manifestPath -Parent
    if ($modelRoot -ne [IO.Path]::GetFullPath($sourceRoot)) {
        foreach ($item in Get-ChildItem -LiteralPath $sourceRoot -File | Where-Object { $_.Name -match '^(manifest\.json|LICENSE.*|NOTICE.*)$' }) {
            [IO.File]::Copy($item.FullName, (Join-Path $modelRoot $item.Name), $true)
        }
    }
Write-Output "Local model package ready: $($manifest.modelVersion)"

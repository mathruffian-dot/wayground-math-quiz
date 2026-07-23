[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$RepositoryRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$source = Join-Path $RepositoryRoot 'skills\wayground-math-quiz'
$pluginSkillsRoot = Join-Path $RepositoryRoot 'plugins\wayground-math-quiz\skills'
$destination = Join-Path $pluginSkillsRoot 'wayground-math-quiz'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'

function Get-TreeManifestText {
    param([Parameter(Mandatory)][string]$Path)

    $resolved = (Resolve-Path -LiteralPath $Path).Path.TrimEnd('\', '/')
    $rows = foreach ($file in Get-ChildItem -LiteralPath $resolved -Recurse -File) {
        [pscustomobject]@{
            Path = $file.FullName.Substring($resolved.Length + 1).Replace('\', '/')
            Hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $file.FullName).Hash
        }
    }
    return (($rows | Sort-Object Path) | ConvertTo-Json -Compress)
}

if (-not (Test-Path -LiteralPath $source -PathType Container)) {
    throw "找不到核心 skill：$source"
}
if (-not (Test-Path -LiteralPath $pluginSkillsRoot -PathType Container)) {
    New-Item -ItemType Directory -Path $pluginSkillsRoot -Force | Out-Null
}

$sourceManifest = Get-TreeManifestText -Path $source
if ((Test-Path -LiteralPath $destination) -and (Get-TreeManifestText -Path $destination) -eq $sourceManifest) {
    Write-Output 'HASH_OK core/plugin'
    exit 0
}

if (-not $PSCmdlet.ShouldProcess($destination, '以核心 skill 更新 Codex plugin mirror')) {
    exit 0
}

$staged = "$destination.staged-$timestamp"
$backup = "$destination.backup-$timestamp"
Copy-Item -LiteralPath $source -Destination $staged -Recurse

if ((Get-TreeManifestText -Path $staged) -ne $sourceManifest) {
    throw "暫存 skill 雜湊驗證失敗：$staged"
}

if (Test-Path -LiteralPath $destination) {
    Move-Item -LiteralPath $destination -Destination $backup
}

try {
    Move-Item -LiteralPath $staged -Destination $destination
    if ((Get-TreeManifestText -Path $destination) -ne $sourceManifest) {
        throw 'plugin mirror 安裝後雜湊不一致。'
    }
}
catch {
    if ((-not (Test-Path -LiteralPath $destination)) -and (Test-Path -LiteralPath $backup)) {
        Move-Item -LiteralPath $backup -Destination $destination
    }
    throw
}

Write-Output 'HASH_OK core/plugin'
if (Test-Path -LiteralPath $backup) {
    Write-Output "舊版備份：$backup"
}

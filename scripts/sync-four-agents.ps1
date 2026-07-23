[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$SourceSkill = (Join-Path (Split-Path -Parent $PSScriptRoot) 'skills\wayground-math-quiz'),
    [string]$ClaudeRoot = (Join-Path $env:USERPROFILE '.claude\skills'),
    [string]$CodexRoot = (Join-Path $env:USERPROFILE '.codex\skills'),
    [string]$AntiGravityRoot = (Join-Path $env:USERPROFILE '.gemini\config\skills'),
    [string]$OpenCodeRoot = (Join-Path $env:USERPROFILE '.config\opencode\skills')
)

$ErrorActionPreference = 'Stop'
$SkillName = 'wayground-math-quiz'
$Timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'

function Get-TreeManifest {
    param([Parameter(Mandatory)][string]$Path)

    $resolved = (Resolve-Path -LiteralPath $Path).Path.TrimEnd('\', '/')
    $manifest = foreach ($file in Get-ChildItem -LiteralPath $resolved -Recurse -File) {
        if ($file.FullName -match '[\\/](node_modules|__pycache__|\.pytest_cache)[\\/]') {
            continue
        }
        if ($file.Extension -in @('.pyc', '.pyo')) {
            continue
        }
        [pscustomobject]@{
            Path = $file.FullName.Substring($resolved.Length + 1).Replace('\', '/')
            Hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $file.FullName).Hash
        }
    }
    return @($manifest | Sort-Object Path)
}

function Convert-ManifestToText {
    param([Parameter(Mandatory)][array]$Manifest)
    return ($Manifest | ConvertTo-Json -Compress)
}

if (-not (Test-Path -LiteralPath $SourceSkill -PathType Container)) {
    throw "找不到核心 skill：$SourceSkill"
}

$SourceSkill = (Resolve-Path -LiteralPath $SourceSkill).Path
$required = @(
    'SKILL.md',
    'scripts\quiz.mjs',
    'assets\quiz.schema.json',
    'references\browser-publishing.md'
)

foreach ($relative in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $SourceSkill $relative) -PathType Leaf)) {
        throw "核心 skill 缺少必要檔案：$relative"
    }
}

$skillText = Get-Content -LiteralPath (Join-Path $SourceSkill 'SKILL.md') -Raw
if ($skillText -notmatch '(?ms)^---\s+name:\s*wayground-math-quiz\s+description:') {
    throw 'SKILL.md frontmatter 無效或名稱不正確。'
}

$sourceManifest = Get-TreeManifest -Path $SourceSkill
$sourceManifestText = Convert-ManifestToText -Manifest $sourceManifest

$targets = @(
    [pscustomobject]@{ Agent = 'Claude Code'; Root = $ClaudeRoot },
    [pscustomobject]@{ Agent = 'Codex'; Root = $CodexRoot },
    [pscustomobject]@{ Agent = 'AntiGravity'; Root = $AntiGravityRoot },
    [pscustomobject]@{ Agent = 'OpenCode'; Root = $OpenCodeRoot }
)

$results = foreach ($target in $targets) {
    $root = [System.IO.Path]::GetFullPath($target.Root)
    $destination = Join-Path $root $SkillName
    $backup = $null

    if (Test-Path -LiteralPath $destination -PathType Container) {
        $currentManifest = Get-TreeManifest -Path $destination
        if ((Convert-ManifestToText -Manifest $currentManifest) -eq $sourceManifestText) {
            [pscustomobject]@{
                Agent = $target.Agent
                Status = 'HASH_OK'
                Destination = $destination
                Backup = ''
            }
            continue
        }
    }

    if (-not $PSCmdlet.ShouldProcess($destination, "安裝或更新 $SkillName")) {
        [pscustomobject]@{
            Agent = $target.Agent
            Status = 'WHAT_IF'
            Destination = $destination
            Backup = ''
        }
        continue
    }

    if (-not (Test-Path -LiteralPath $root -PathType Container)) {
        New-Item -ItemType Directory -Path $root -Force | Out-Null
    }
    $resolvedRoot = (Resolve-Path -LiteralPath $root).Path.TrimEnd('\', '/')
    $fullDestination = [System.IO.Path]::GetFullPath($destination)
    if (-not $fullDestination.StartsWith($resolvedRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "安裝目標超出 agent skill root：$fullDestination"
    }

    if (Test-Path -LiteralPath $destination) {
        $backup = "$destination.backup-$Timestamp"
        Move-Item -LiteralPath $destination -Destination $backup
    }

    try {
        Copy-Item -LiteralPath $SourceSkill -Destination $root -Recurse
        $installedManifest = Get-TreeManifest -Path $destination
        if ((Convert-ManifestToText -Manifest $installedManifest) -ne $sourceManifestText) {
            throw "安裝後檔案雜湊不一致：$destination"
        }
    }
    catch {
        if (Test-Path -LiteralPath $destination) {
            $failed = "$destination.failed-$Timestamp"
            Move-Item -LiteralPath $destination -Destination $failed
        }
        if ($backup -and (Test-Path -LiteralPath $backup)) {
            Move-Item -LiteralPath $backup -Destination $destination
        }
        throw
    }

    [pscustomobject]@{
        Agent = $target.Agent
        Status = 'HASH_OK'
        Destination = $destination
        Backup = $backup
    }
}

$results | Format-Table -AutoSize

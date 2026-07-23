[CmdletBinding()]
param(
    [string]$RepositoryRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$RepositoryRoot = (Resolve-Path -LiteralPath $RepositoryRoot).Path
$coreSkill = Join-Path $RepositoryRoot 'skills\wayground-math-quiz'
$pluginSkill = Join-Path $RepositoryRoot 'plugins\wayground-math-quiz\skills\wayground-math-quiz'
$cli = Join-Path $coreSkill 'scripts\quiz.mjs'
$exampleQuiz = Join-Path $RepositoryRoot 'examples\minimal-text-quiz\quiz.json'

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

$required = @(
    'README.md',
    'AGENTS.md',
    'LICENSE',
    'docs\architecture.md',
    'docs\cross-agent-installation.md',
    'docs\agent-build-guide.md',
    'skills\wayground-math-quiz\SKILL.md',
    'plugins\wayground-math-quiz\.codex-plugin\plugin.json',
    'scripts\sync-four-agents.ps1',
    'examples\minimal-text-quiz\quiz.json'
)

foreach ($relative in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $RepositoryRoot $relative) -PathType Leaf)) {
        throw "缺少公開 repo 必要檔案：$relative"
    }
}
Write-Output 'STRUCTURE_OK'

$skillText = Get-Content -LiteralPath (Join-Path $coreSkill 'SKILL.md') -Raw
if ($skillText -notmatch '(?ms)^---\s+name:\s*wayground-math-quiz\s+description:\s*\S.+?\s+---') {
    throw '核心 SKILL.md frontmatter 驗證失敗。'
}
Write-Output 'SKILL_FORMAT_OK'

if ((Get-TreeManifestText -Path $coreSkill) -ne (Get-TreeManifestText -Path $pluginSkill)) {
    throw '核心 skill 與 Codex plugin mirror 不一致；請執行 scripts\sync-plugin.ps1。'
}
Write-Output 'HASH_OK core/plugin'

$publicRoots = @(
    'README.md',
    'AGENTS.md',
    'LICENSE',
    '.gitignore',
    'docs',
    'examples',
    'skills',
    'plugins',
    'scripts',
    '.github'
)
$textExtensions = @('.md', '.json', '.jsonl', '.mjs', '.js', '.ps1', '.py', '.yaml', '.yml', '.txt', '.gitignore')
$scanFiles = foreach ($relative in $publicRoots) {
    $path = Join-Path $RepositoryRoot $relative
    if (-not (Test-Path -LiteralPath $path)) {
        continue
    }
    $item = Get-Item -LiteralPath $path
    if ($item.PSIsContainer) {
        Get-ChildItem -LiteralPath $path -Recurse -File
    }
    else {
        $item
    }
}
$scanFiles = @($scanFiles | Where-Object {
    $_.Name -notmatch '\.local\.|\.backup-|\.failed-|\.staged-' -and
    ($_.Name -eq 'LICENSE' -or $_.Name -eq '.gitignore' -or $textExtensions -contains $_.Extension)
})

$forbiddenPatterns = [ordered]@{
    'Windows user path' = '(?i)[A-Z]:\\Users\\[^\\\r\n]+'
    'Private Google Drive path' = '(?i)[A-Z]:\\[^\r\n]*我的雲端硬碟'
    'Email address' = '(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b'
    'GitHub token' = '\bgh[opsu]_[A-Za-z0-9]{20,}\b'
    'OpenAI-style key' = '\bsk-[A-Za-z0-9_-]{20,}\b'
    'Google API key' = '\bAIza[A-Za-z0-9_-]{20,}\b'
    'Published Wayground resource id' = '(?i)wayground\.com/activity/admin/quiz/[a-f0-9]{16,}'
}

$issues = @()
foreach ($file in $scanFiles) {
    $content = Get-Content -LiteralPath $file.FullName -Raw
    foreach ($entry in $forbiddenPatterns.GetEnumerator()) {
        if ($content -match $entry.Value) {
            $issues += "$($entry.Key)：$($file.FullName.Substring($RepositoryRoot.Length + 1))"
        }
    }
}
if ($issues.Count -gt 0) {
    throw "PUBLIC_SCAN_FAILED`n$($issues -join "`n")"
}
Write-Output 'PUBLIC_SCAN_OK'

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("wayground-math-quiz-verify-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempRoot | Out-Null
try {
    & node $cli validate --quiz $exampleQuiz --strict --report (Join-Path $tempRoot 'validation.json')
    if ($LASTEXITCODE -ne 0) {
        throw '最小範例 strict validation 失敗。'
    }
    & node $cli preview --quiz $exampleQuiz --out (Join-Path $tempRoot 'preview.html')
    if ($LASTEXITCODE -ne 0) {
        throw '最小範例 preview 失敗。'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $tempRoot 'preview.html') -PathType Leaf)) {
        throw '最小範例未產生 preview.html。'
    }
}
finally {
    $resolvedTemp = (Resolve-Path -LiteralPath $tempRoot).Path
    $systemTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\', '/')
    if ($resolvedTemp.StartsWith($systemTemp + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
    }
}

Write-Output 'EXAMPLE_VALIDATION_OK'
Write-Output 'REPOSITORY_OK'

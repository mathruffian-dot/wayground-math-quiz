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
$visualExampleRoot = Join-Path $RepositoryRoot 'examples\visual-question-factory'
$visualExampleQuiz = Join-Path $visualExampleRoot 'quiz.json'

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
    'examples\minimal-text-quiz\quiz.json',
    'docs\visual-question-factory.md',
    'scripts\build-visual-sharing-pack.ps1',
    'skills\wayground-math-quiz\assets\visual-spec.schema.json',
    'skills\wayground-math-quiz\references\visual-question-factory.md',
    'examples\visual-question-factory\quiz.json'
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

    $visualFolders = Get-ChildItem -LiteralPath (Join-Path $visualExampleRoot 'visual') -Directory | Sort-Object Name
    if ($visualFolders.Count -ne 6) {
        throw "視覺題示範預期六題，實際為 $($visualFolders.Count) 題。"
    }
    foreach ($folder in $visualFolders) {
        $spec = Join-Path $folder.FullName 'visual-spec.json'
        $expectedImage = Join-Path $folder.FullName 'final.png'
        $renderedImage = Join-Path $tempRoot "$($folder.Name)-final.png"
        $visualReport = Join-Path $tempRoot "$($folder.Name)-visual-validation.json"
        & node $cli compose --spec $spec --out $renderedImage
        if ($LASTEXITCODE -ne 0) {
            throw "視覺題 compose 失敗：$($folder.Name)"
        }
        & node $cli visual-validate --spec $spec --image $renderedImage --strict --report $visualReport
        if ($LASTEXITCODE -ne 0) {
            throw "視覺題 strict validation 失敗：$($folder.Name)"
        }
        if ((Get-FileHash -Algorithm SHA256 -LiteralPath $renderedImage).Hash -ne (Get-FileHash -Algorithm SHA256 -LiteralPath $expectedImage).Hash) {
            throw "視覺題重製雜湊不一致：$($folder.Name)"
        }
    }

    & node $cli validate --quiz $visualExampleQuiz --strict --report (Join-Path $tempRoot 'visual-quiz-validation.json')
    if ($LASTEXITCODE -ne 0) {
        throw '六題視覺範例 strict validation 失敗。'
    }
    & node $cli preview --quiz $visualExampleQuiz --out (Join-Path $tempRoot 'visual-preview.html')
    if ($LASTEXITCODE -ne 0) {
        throw '六題視覺範例 preview 失敗。'
    }

    $browserPlan = Join-Path $tempRoot 'wayground-browser.json'
    $publicationState = Join-Path $tempRoot 'publication-state.json'
    $publicationEvidence = Join-Path $tempRoot 'publication-evidence.json'
    $visualQuizData = Get-Content -LiteralPath $visualExampleQuiz -Raw | ConvertFrom-Json
    & node $cli publish --adapter wayground-browser --quiz $visualExampleQuiz --out $browserPlan --state $publicationState
    if ($LASTEXITCODE -ne 0) {
        throw '瀏覽器發布計畫與狀態產生失敗。'
    }
    & node $cli publication-state --action authorize --state $publicationState --resource-only true --account-confirmed true
    if ($LASTEXITCODE -ne 0) {
        throw '資源發布授權狀態設定失敗。'
    }
    for ($index = 0; $index -lt $visualQuizData.questions.Count; $index += 1) {
        $question = $visualQuizData.questions[$index]
        $questionScreenshot = Join-Path $visualExampleRoot ("visual\{0}\final.png" -f $question.id)
        & node $cli publication-state --action mark --state $publicationState --question $question.id --observed-count ($index + 1) --image-loaded true --answer-confirmed true --screenshot $questionScreenshot
        if ($LASTEXITCODE -ne 0) {
            throw "發布檢查點失敗：$($question.id)"
        }
    }
    $resourceUrl = 'https://wayground.com/activity/admin/quiz/' + ('0' * 24)
    $overviewScreenshot = Join-Path $visualExampleRoot 'visual\q001\final.png'
    $representativeScreenshot = Join-Path $visualExampleRoot 'visual\q002\final.png'
    & node $cli publication-state --action finalize --state $publicationState --resource-url $resourceUrl --observed-title $visualQuizData.title --question-count $visualQuizData.questions.Count --reopened true --images-loaded true --answers-confirmed true --overview-screenshot $overviewScreenshot --question-screenshot $representativeScreenshot --out $publicationEvidence
    if ($LASTEXITCODE -ne 0) {
        throw '發布證據產生失敗。'
    }
    & node $cli verify --quiz $visualExampleQuiz --evidence $publicationEvidence
    if ($LASTEXITCODE -ne 0) {
        throw '完整發布證據應通過驗證。'
    }

    $invalidEvidencePath = Join-Path $tempRoot 'invalid-publication-evidence.json'
    $invalidEvidence = [ordered]@{
        schemaVersion = '1.0.0'
        resourceUrl = 'https://wayground.com/admin/my-library/createdByMe?activityStatus=draft'
        questionCount = $visualQuizData.questions.Count
        verifiedAt = (Get-Date).ToUniversalTime().ToString('o')
        screenshots = @($overviewScreenshot, $overviewScreenshot)
    }
    [System.IO.File]::WriteAllText(
        $invalidEvidencePath,
        (($invalidEvidence | ConvertTo-Json -Depth 8) + "`n"),
        [System.Text.UTF8Encoding]::new($false)
    )
    $null = & node $cli verify --quiz $visualExampleQuiz --evidence $invalidEvidencePath 2>&1
    if ($LASTEXITCODE -eq 0) {
        throw '草稿清單 URL 與重複截圖不應通過發布驗證。'
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
Write-Output 'VISUAL_EXAMPLE_VALIDATION_OK'
Write-Output 'PUBLICATION_STATE_VALIDATION_OK'
Write-Output 'REPOSITORY_OK'

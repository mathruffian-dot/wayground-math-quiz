[CmdletBinding()]
param(
    [string]$RepositoryRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$OutputDirectory = '',
    [switch]$SkipRebuild
)

$ErrorActionPreference = 'Stop'
$RepositoryRoot = (Resolve-Path -LiteralPath $RepositoryRoot).Path
$demoRoot = Join-Path $RepositoryRoot 'examples\visual-question-factory'
$cli = Join-Path $RepositoryRoot 'skills\wayground-math-quiz\scripts\quiz.mjs'
$builder = Join-Path $demoRoot 'build-demo.mjs'

if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $RepositoryRoot 'sharing\generated'
}
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
$promptDirectory = Join-Path $OutputDirectory 'prompts'
$portableDirectory = Join-Path $OutputDirectory 'visual-question-factory-package'
$browserPlan = Join-Path $OutputDirectory 'wayground-browser.json'
$preview = Join-Path $demoRoot 'preview.html'
$sharePreview = Join-Path $OutputDirectory '視覺題六題示範.html'

New-Item -ItemType Directory -Force -Path $OutputDirectory, $promptDirectory | Out-Null

if (-not $SkipRebuild) {
    & node $builder
    if ($LASTEXITCODE -ne 0) {
        throw '六題示範規格建立失敗。'
    }
}

$visualFolders = Get-ChildItem -LiteralPath (Join-Path $demoRoot 'visual') -Directory |
    Sort-Object Name

foreach ($folder in $visualFolders) {
    $spec = Join-Path $folder.FullName 'visual-spec.json'
    $image = Join-Path $folder.FullName 'final.png'
    $report = Join-Path $folder.FullName 'visual-validation.json'
    $promptPack = Join-Path $promptDirectory "$($folder.Name)-生圖交接包.md"

    & node $cli compose --spec $spec --out $image --force
    if ($LASTEXITCODE -ne 0) {
        throw "圖片合成失敗：$($folder.Name)"
    }

    & node $cli visual-validate --spec $spec --image $image --strict --report $report
    if ($LASTEXITCODE -ne 0) {
        throw "視覺驗證失敗：$($folder.Name)"
    }

    & node $cli prompt-pack --spec $spec --out $promptPack --force
    if ($LASTEXITCODE -ne 0) {
        throw "提示詞交接包建立失敗：$($folder.Name)"
    }
}

$quiz = Join-Path $demoRoot 'quiz.json'
$validation = Join-Path $demoRoot 'validation.json'

& node $cli validate --quiz $quiz --strict --report $validation
if ($LASTEXITCODE -ne 0) {
    throw '六題示範 quiz strict validation 失敗。'
}

& node $cli preview --quiz $quiz --out $preview --force
if ($LASTEXITCODE -ne 0) {
    throw '六題示範預覽建立失敗。'
}
Copy-Item -LiteralPath $preview -Destination $sharePreview -Force

& node $cli publish --adapter wayground-browser --quiz $quiz --out $browserPlan --force
if ($LASTEXITCODE -ne 0) {
    throw 'Wayground browser plan 建立失敗。'
}

& node $cli publish --adapter export-only --quiz $quiz --out $portableDirectory --force
if ($LASTEXITCODE -ne 0) {
    throw '可攜式分享包建立失敗。'
}

$manifest = [ordered]@{
    schemaVersion = '1.0.0'
    generatedAt = (Get-Date).ToString('o')
    candidateVersion = '0.3.0-rc.1'
    questionCount = 6
    preview = [System.IO.Path]::GetRelativePath($OutputDirectory, $sharePreview).Replace('\', '/')
    promptDirectory = [System.IO.Path]::GetRelativePath($OutputDirectory, $promptDirectory).Replace('\', '/')
    browserPlan = [System.IO.Path]::GetRelativePath($OutputDirectory, $browserPlan).Replace('\', '/')
    portablePackage = [System.IO.Path]::GetRelativePath($OutputDirectory, $portableDirectory).Replace('\', '/')
    published = $false
    installedToOtherAgents = $false
    chezmoiAdded = $false
}
$manifest | ConvertTo-Json -Depth 8 |
    Set-Content -LiteralPath (Join-Path $OutputDirectory '分享包清單.json') -Encoding utf8

Write-Output "SHARING_PACK_READY $OutputDirectory"

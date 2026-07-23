[CmdletBinding()]
param(
    [string]$RepositoryUrl = 'https://github.com/mathruffian-dot/wayground-math-quiz.git',
    [string]$InstallRoot = $(if ($env:WAYGROUND_MATH_QUIZ_HOME) {
        $env:WAYGROUND_MATH_QUIZ_HOME
    }
    else {
        Join-Path $env:LOCALAPPDATA 'wayground-math-quiz'
    })
)

$ErrorActionPreference = 'Stop'

function Invoke-Git {
    param(
        [Parameter(Mandatory)][string[]]$Arguments,
        [switch]$AllowFailure
    )

    & git @Arguments
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0 -and -not $AllowFailure) {
        throw "Git 指令失敗：git $($Arguments -join ' ')"
    }
    return $exitCode
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw '找不到 Git；無法安裝或升級 wayground-math-quiz。'
}
if ([string]::IsNullOrWhiteSpace($InstallRoot)) {
    throw 'InstallRoot 不可為空白。'
}

$InstallRoot = [System.IO.Path]::GetFullPath($InstallRoot)
$parent = Split-Path -Parent $InstallRoot
if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
}

if (-not (Test-Path -LiteralPath $InstallRoot)) {
    Invoke-Git -Arguments @(
        'clone',
        '--branch', 'main',
        '--single-branch',
        $RepositoryUrl,
        $InstallRoot
    ) | Out-Null
    Write-Output "WAYGROUND_REPO_CLONED $InstallRoot"
}
else {
    $gitDir = Join-Path $InstallRoot '.git'
    if (-not (Test-Path -LiteralPath $gitDir -PathType Container)) {
        throw "安裝路徑已存在但不是 Git repo：$InstallRoot"
    }

    $origin = (& git -C $InstallRoot remote get-url origin).Trim()
    if ($LASTEXITCODE -ne 0) {
        throw "無法讀取 origin：$InstallRoot"
    }
    if ($origin -notmatch 'github\.com[/:]mathruffian-dot/wayground-math-quiz(?:\.git)?$') {
        throw "既有 repo 的 origin 不符合預期：$origin"
    }

    $dirty = & git -C $InstallRoot status --porcelain
    if ($LASTEXITCODE -ne 0) {
        throw "無法檢查 repo 狀態：$InstallRoot"
    }

    if ($dirty) {
        Write-Warning 'Wayground repo 有本機修改，為避免覆蓋，跳過 Git 升級並沿用目前版本。'
    }
    else {
        $fetchCode = Invoke-Git -Arguments @(
            '-C', $InstallRoot,
            'fetch', '--prune', 'origin', 'main'
        ) -AllowFailure

        if ($fetchCode -eq 0) {
            Invoke-Git -Arguments @(
                '-C', $InstallRoot,
                'checkout', 'main'
            ) | Out-Null
            Invoke-Git -Arguments @(
                '-C', $InstallRoot,
                'merge', '--ff-only', 'origin/main'
            ) | Out-Null
            Write-Output 'WAYGROUND_REPO_UPDATED'
        }
        else {
            Write-Warning '目前無法連線 GitHub，沿用本機已安裝版本。'
            Write-Output 'WAYGROUND_REPO_OFFLINE_REUSE'
        }
    }
}

$syncScript = Join-Path $InstallRoot 'scripts\sync-four-agents.ps1'
if (-not (Test-Path -LiteralPath $syncScript -PathType Leaf)) {
    throw "公開 repo 缺少四端同步腳本：$syncScript"
}

& $syncScript
if (-not $?) {
    throw '四端 skill 同步失敗。'
}

$packagePath = Join-Path $InstallRoot 'skills\wayground-math-quiz\package.json'
$version = if (Test-Path -LiteralPath $packagePath -PathType Leaf) {
    (Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json).version
}
else {
    'unknown'
}

Write-Output "WAYGROUND_SKILL_READY version=$version"

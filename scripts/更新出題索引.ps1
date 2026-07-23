[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$題庫根目錄,

    [string]$輸出路徑 = (Join-Path (Split-Path -Parent $PSScriptRoot) '索引\題庫統計.json')
)

$ErrorActionPreference = 'Stop'
$題庫根目錄 = [System.IO.Path]::GetFullPath($題庫根目錄)
$輸出路徑 = [System.IO.Path]::GetFullPath($輸出路徑)
$檔案索引路徑 = Join-Path $題庫根目錄 '_索引\檔案索引.json'
$題目索引路徑 = Join-Path $題庫根目錄 '_索引\題目索引.jsonl'
$輸出目錄 = Split-Path -Parent $輸出路徑

if (-not (Test-Path -LiteralPath $檔案索引路徑 -PathType Leaf)) {
    throw "找不到來源檔案索引：$檔案索引路徑"
}
if (-not (Test-Path -LiteralPath $題目索引路徑 -PathType Leaf)) {
    throw "找不到來源題目索引：$題目索引路徑"
}
if (-not (Test-Path -LiteralPath $輸出目錄 -PathType Container)) {
    New-Item -ItemType Directory -Path $輸出目錄 -Force | Out-Null
}

function Add-Count {
    param(
        [Parameter(Mandatory)][hashtable]$Table,
        [AllowNull()][object]$Value
    )

    $key = [string]$Value
    if ([string]::IsNullOrWhiteSpace($key)) {
        $key = '未標註'
    }
    if (-not $Table.ContainsKey($key)) {
        $Table[$key] = 0
    }
    $Table[$key]++
}

$fileIndex = Get-Content -LiteralPath $檔案索引路徑 -Encoding utf8 -Raw | ConvertFrom-Json
$byPath = @{}
foreach ($file in $fileIndex.檔案清單) {
    $byPath[[string]$file.路徑] = $file
}

$counts = @{
    出版社 = @{}
    題型 = @{}
    難易度 = @{}
    年級 = @{}
    學期 = @{}
    章節 = @{}
    題型大類 = @{}
}

$total = 0
$mapped = 0
$unmapped = 0
$withImage = 0
$withExplain = 0

foreach ($line in [System.IO.File]::ReadLines($題目索引路徑, [System.Text.Encoding]::UTF8)) {
    if ([string]::IsNullOrWhiteSpace($line)) {
        continue
    }

    $question = $line | ConvertFrom-Json
    $total++
    Add-Count $counts.出版社 $question.出版社
    Add-Count $counts.題型 $question.題型
    Add-Count $counts.難易度 $question.難易度

    if (@($question.圖片).Count -gt 0) {
        $withImage++
    }
    if (-not [string]::IsNullOrWhiteSpace([string]$question.詳解)) {
        $withExplain++
    }

    $sourcePath = [string]$question.檔案路徑
    if ($byPath.ContainsKey($sourcePath)) {
        $mapped++
        $file = $byPath[$sourcePath]
        Add-Count $counts.年級 $file.年級
        Add-Count $counts.學期 $file.學期
        Add-Count $counts.章節 $file.章節
        Add-Count $counts.題型大類 $file.題型大類
    }
    else {
        $unmapped++
    }
}

$result = [ordered]@{
    統計時間 = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    來源索引總檔數 = $fileIndex.總檔數
    索引題目總數 = $total
    可對應來源檔題目數 = $mapped
    無法對應來源檔題目數 = $unmapped
    含圖片題目數 = $withImage
    含詳解題目數 = $withExplain
    出版社 = $counts.出版社
    題型 = $counts.題型
    難易度 = $counts.難易度
    年級 = $counts.年級
    學期 = $counts.學期
    章節 = $counts.章節
    題型大類 = $counts.題型大類
}

$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $輸出路徑 -Encoding utf8
Write-Output "已更新：$輸出路徑"

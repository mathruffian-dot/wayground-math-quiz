[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
)

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$entrypoint = Join-Path $scriptDirectory "quiz.mjs"
$nodeCommand = Get-Command node -ErrorAction Stop

& $nodeCommand.Source $entrypoint @Arguments
exit $LASTEXITCODE

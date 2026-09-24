$ErrorActionPreference = 'Stop'
$backupToken = $null
$backupTokenPointer = [IntPtr]::Zero
$previousToken = $env:SUPABASE_ACCESS_TOKEN
$backupExit = 1
try {
    $backupToken = Read-Host 'Вставьте Personal Access Token Supabase (не код входа и не ключ копии)' -AsSecureString
    $backupTokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($backupToken)
    $env:SUPABASE_ACCESS_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($backupTokenPointer)
    Set-Clipboard -Value ' '
    & (Get-Command node -ErrorAction Stop).Source (Join-Path $PSScriptRoot 'backup-stage-connection.mjs')
    $backupExit = $LASTEXITCODE
} catch {
    Write-Host 'STAGE_BACKUP_CONNECTION:local_wrapper_failed'
} finally {
    if ($null -eq $previousToken) { Remove-Item Env:\SUPABASE_ACCESS_TOKEN -ErrorAction SilentlyContinue }
    else { $env:SUPABASE_ACCESS_TOKEN = $previousToken }
    $previousToken = $null
    if ($backupTokenPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($backupTokenPointer) }
    if ($backupToken) { $backupToken.Dispose() }
}
exit $backupExit
[CmdletBinding(DefaultParameterSetName='Local')]
param(
    [Parameter(Mandatory=$true,ParameterSetName='Export')][string]$ExportArchive,
    [Parameter(Mandatory=$true,ParameterSetName='Verify')][string]$VerifyArchive,
    [Parameter(Mandatory=$true,ParameterSetName='Verify')][string]$ReferenceArchive
)
$ErrorActionPreference = 'Stop'
$backupProcess = $null
$script:backupPhase = 'start'
function Send-BackupKey($promptText, $writer) {
    $script:backupPhase = 'key-input'
    do {
        $secureKey = Read-Host $promptText -AsSecureString
        $validLength = $secureKey.Length -eq 44
        if (-not $validLength) {
            $secureKey.Dispose()
            Write-Host 'Ключ не введён или имеет неверную длину. Заново скопируйте только значение ключа из KPM и вставьте его сюда, затем нажмите Enter.'
        }
    } until ($validLength)
    $keyPointer = [IntPtr]::Zero
    try {
        $script:backupPhase = 'key-conversion'
        $keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
        $script:backupPhase = 'key-transfer'
        $writer.WriteLine([Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer))
        $writer.Flush()
    } finally {
        if ($keyPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer) }
        $secureKey.Dispose()
        $script:backupPhase = 'clipboard-clear'
        Set-Clipboard -Value ' '
    }
}
try {
    $nodePath = (Get-Command node -ErrorAction Stop).Source
    $drillPath = Join-Path $PSScriptRoot 'backup-restore-drill.mjs'
    $startInfo = New-Object Diagnostics.ProcessStartInfo
    $startInfo.FileName = $nodePath
    $startInfo.Arguments = '"' + $drillPath + '" --synthetic --saved-key-stdin'
    $startInfo.WorkingDirectory = Split-Path $PSScriptRoot -Parent
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardInput = $true
    $startInfo.CreateNoWindow = $true
    foreach ($setting in @('QVESTA_DRILL_ARCHIVE_OUT','QVESTA_DRILL_ARCHIVE_IN','QVESTA_DRILL_EXPECTED_SHA256')) {
        $startInfo.EnvironmentVariables.Remove($setting)
    }
    if ($ExportArchive) {
        $startInfo.EnvironmentVariables['QVESTA_DRILL_ARCHIVE_OUT'] = [IO.Path]::GetFullPath($ExportArchive)
    }
    if ($VerifyArchive) {
        $downloadPath = [IO.Path]::GetFullPath($VerifyArchive)
        $referencePath = [IO.Path]::GetFullPath($ReferenceArchive)
        if ($downloadPath -eq $referencePath) { throw 'Use a separate downloaded copy' }
        $startInfo.EnvironmentVariables['QVESTA_DRILL_ARCHIVE_IN'] = $downloadPath
        $referenceStream = [IO.File]::OpenRead($referencePath)
        $hashAlgorithm = [Security.Cryptography.SHA256]::Create()
        try {
            $referenceHash = [BitConverter]::ToString($hashAlgorithm.ComputeHash($referenceStream)).Replace('-','').ToLowerInvariant()
            $startInfo.EnvironmentVariables['QVESTA_DRILL_EXPECTED_SHA256'] = $referenceHash
        } finally {
            $referenceStream.Dispose()
            $hashAlgorithm.Dispose()
        }
    }
    $backupProcess = New-Object Diagnostics.Process
    $backupProcess.StartInfo = $startInfo
    [void]$backupProcess.Start()
    Send-BackupKey 'Вставьте ключ 01 из KPM для шифрования (ввод скрыт)' $backupProcess.StandardInput
    Send-BackupKey 'Снова скопируйте ключ 01 из KPM для восстановления (ввод скрыт)' $backupProcess.StandardInput
    $script:backupPhase = 'restore-drill'
    $backupProcess.StandardInput.Close()
    $backupProcess.WaitForExit()
    if ($backupProcess.ExitCode -ne 0) { throw 'drill_failed' }
    Write-Host 'Проверка с сохранённым ключом пройдена. Реальные базы не затронуты.'
    if ($ExportArchive) { Write-Host ('Зашифрованный тестовый архив: ' + [IO.Path]::GetFullPath($ExportArchive)) }
    if ($VerifyArchive) { Write-Host 'Скачанный архив совпадает с исходным и успешно восстановлен.' }
} catch {
    Write-Host ('Проверка не завершена. Этап: ' + $script:backupPhase + '; тип: ' + $_.Exception.GetType().Name + '. Ключ не присылайте.')
    exit 1
} finally {
    if ($backupProcess) {
        try { $backupProcess.StandardInput.Close() } catch {}
        $backupProcess.Dispose()
    }
}
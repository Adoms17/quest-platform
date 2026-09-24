param([Parameter(Mandatory=$true)][string]$BackupRoot)
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
    $rootPath = [IO.Path]::GetFullPath($BackupRoot)
    if (-not (Test-Path -LiteralPath $rootPath -PathType Container)) { throw 'Create backup directory first' }
    $startInfo = New-Object Diagnostics.ProcessStartInfo
    $startInfo.FileName = (Get-Command node -ErrorAction Stop).Source
    $startInfo.Arguments = '"' + (Join-Path $PSScriptRoot 'backup-stage-export.mjs') + '" --export-stage'
    $startInfo.WorkingDirectory = Split-Path $PSScriptRoot -Parent
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.StandardOutputEncoding = [Text.UTF8Encoding]::new($false)
    $startInfo.StandardErrorEncoding = [Text.UTF8Encoding]::new($false)
    $startInfo.CreateNoWindow = $true
    $startInfo.EnvironmentVariables['QVESTA_STAGE_BACKUP_ROOT'] = $rootPath
    $backupProcess = New-Object Diagnostics.Process
    $backupProcess.StartInfo = $startInfo
    [void]$backupProcess.Start()
    $outputTask = $backupProcess.StandardOutput.ReadToEndAsync()
    $errorTask = $backupProcess.StandardError.ReadToEndAsync()
    Send-BackupKey 'Вставьте ключ 01 из KPM (ввод скрыт)' $backupProcess.StandardInput
    Send-BackupKey 'Повторно скопируйте тот же ключ 01 из KPM (ввод скрыт)' $backupProcess.StandardInput
    $backupProcess.StandardInput.Close()
    $script:backupPhase = 'export-stage'
    $backupProcess.WaitForExit()
    $safeOutput = $outputTask.GetAwaiter().GetResult()
    $childError = $errorTask.GetAwaiter().GetResult()
    foreach ($line in ($safeOutput -split "\r?\n")) {
        if ($line -match '^(Создан каталог зашифрованной пробной копии: |Выгрузка: |Пять файлов выгружены, |Выгрузки выполнены последовательно;)') { Write-Host $line }
    }
    if ($backupProcess.ExitCode -ne 0) {
        $knownPhases = 'arguments|backup-directory|key-input|key-match|cli-resolution|create-directory|seal-set|verify-set|dump-(roles|schema|data|history-schema|history-data)\.sql\.qvb'
        $safeMatch = [regex]::Match($childError, '(?m)^BACKUP_STAGE_ERROR:(' + $knownPhases + ')\r?$')
        if ($safeMatch.Success) { $script:backupPhase = $safeMatch.Groups[1].Value }
        Write-Host ('Код завершения: ' + $backupProcess.ExitCode)
        throw 'export_failed'
    }
} catch {
    Write-Host ('Выгрузка не завершена. Этап: ' + $script:backupPhase + '. Ключ не присылайте.')
    exit 1
} finally {
    if ($backupProcess) {
        try { $backupProcess.StandardInput.Close() } catch {}
        $backupProcess.Dispose()
    }
}
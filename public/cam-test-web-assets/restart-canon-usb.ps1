# One UAC prompt covers both PnP operations, including recovery in finally.
# The elevated process selects the device itself. No instance ID is interpolated into a command.
$cycle = {
    $ErrorActionPreference = 'Stop'
    $exitCode = 1
    try {
        $cameras = @(Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like 'USB\VID_04A9&PID_3217\*' })
        if ($cameras.Count -ne 1) {
            throw "Ожидалась одна подключённая Canon 04A9:3217. Найдено устройств: $($cameras.Count)."
        }
        $id = $cameras[0].InstanceId
        $pnp = "$env:SystemRoot\System32\pnputil.exe"
        function Wait-CanonState([int]$expected) {
            for ($i = 0; $i -lt 20; $i++) {
                $problem = Get-PnpDeviceProperty -InstanceId $id -KeyName 'DEVPKEY_Device_ProblemCode' -ErrorAction SilentlyContinue
                if ($null -ne $problem.Data -and $problem.Data -eq $expected) { return }
                Start-Sleep -Milliseconds 500
            }
            throw "Windows не подтвердила состояние Canon (ожидался код $expected)."
        }

        try {
            Write-Host "Отключение Canon: $id"
            & $pnp /disable-device $id
            if ($LASTEXITCODE -ne 0) { throw "Отключение Canon: код PnPUtil $LASTEXITCODE." }
            Wait-CanonState 22
            Write-Host 'Windows подтвердила отключение Canon.'
            Start-Sleep -Seconds 2
        } finally {
            Write-Host 'Включение того же устройства Canon…'
            & $pnp /enable-device $id
            if ($LASTEXITCODE -ne 0) { throw "Включение Canon: код PnPUtil $LASTEXITCODE. Включите устройство в диспетчере устройств Windows." }
            Wait-CanonState 0
            Write-Host 'Windows подтвердила включение Canon.'
        }
        Write-Host 'Готово. Откройте тестовую страницу и нажмите «Выбрать камеру».'
        $exitCode = 0
    } catch {
        Write-Host $_.Exception.Message
    }
    [void](Read-Host 'Нажмите Enter, чтобы закрыть окно')
    exit $exitCode
}

# Windows PowerShell accepts UTF-16LE for -EncodedCommand; preserve Russian text and quoting.
try {
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cycle.ToString()))
    $powershell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    $child = Start-Process -FilePath $powershell -Verb RunAs -ArgumentList @('-NoProfile', '-EncodedCommand', $encoded) -Wait -PassThru -ErrorAction Stop
    exit $child.ExitCode
} catch {
    Write-Host $_.Exception.Message
    [void](Read-Host 'Нажмите Enter, чтобы закрыть окно')
    exit 1
}

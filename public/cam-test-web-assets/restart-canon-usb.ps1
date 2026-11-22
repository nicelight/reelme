# Only PnPUtil needs elevation. Start this script from Explorer with "Run with PowerShell".
$ErrorActionPreference = 'Stop'
$exitCode = 1
try {
    $cameras = @(Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like 'USB\VID_04A9&PID_3217\*' })
    if ($cameras.Count -ne 1) {
        throw "Ожидалась одна подключённая Canon 04A9:3217. Найдено устройств: $($cameras.Count)."
    }

    $instanceId = $cameras[0].InstanceId
    Write-Host "Перезапуск $instanceId. Подтвердите запрос Windows."
    $arguments = @('/restart-device', ('"{0}"' -f $instanceId))
    $process = Start-Process -FilePath "$env:SystemRoot\System32\pnputil.exe" -ArgumentList $arguments -Verb RunAs -Wait -PassThru
    $exitCode = $process.ExitCode
    if ($exitCode -eq 0) {
        Write-Host 'Windows перезапустила устройство Canon. Откройте тестовую страницу и выберите камеру.'
    } else {
        Write-Host "PnPUtil вернул код $exitCode. Запишите его для диагностики."
    }
} catch {
    Write-Host $_.Exception.Message
}
[void](Read-Host 'Нажмите Enter, чтобы закрыть окно')
exit $exitCode

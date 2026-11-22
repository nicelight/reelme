#Requires -RunAsAdministrator
# Restart only the connected Canon USB device seen on the ReelMe Windows station.
$ErrorActionPreference = 'Stop'
$cameras = @(Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like 'USB\VID_04A9&PID_3217\*' })
if ($cameras.Count -ne 1) {
    throw "Expected one connected Canon 04A9:3217. Found $($cameras.Count)."
}

$instanceId = $cameras[0].InstanceId
Write-Host "Restarting $instanceId"
& "$env:SystemRoot\System32\pnputil.exe" /restart-device $instanceId
exit $LASTEXITCODE

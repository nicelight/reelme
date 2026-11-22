# Reset one verified Canon EOS 1100D USB port without restarting the computer.
$reset = {
    $ErrorActionPreference = 'Stop'
    $exitCode = 1
    try {
        $cameras = @(Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like 'USB\VID_04A9&PID_3217\*' })
        if ($cameras.Count -ne 1) {
            throw "Expected exactly one connected Canon EOS 1100D (04A9:3217). Found: $($cameras.Count)."
        }

        $id = $cameras[0].InstanceId
        $parent = (Get-PnpDeviceProperty -InstanceId $id -KeyName 'DEVPKEY_Device_Parent').Data
        $driver = (Get-PnpDeviceProperty -InstanceId $id -KeyName 'DEVPKEY_Device_Driver').Data
        if ([string]::IsNullOrWhiteSpace($parent) -or [string]::IsNullOrWhiteSpace($driver)) {
            throw 'Could not identify the parent hub and driver of this Canon.'
        }

        Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

public static class CanonUsbPort {
    // CTL_CODE(FILE_DEVICE_USB, function, METHOD_BUFFERED, FILE_ANY_ACCESS).
    private const uint GetHubInformation = (0x22u << 16) | (258u << 2);
    private const uint GetDriverKey = (0x22u << 16) | (264u << 2);
    private const uint CyclePort = (0x22u << 16) | (273u << 2);
    private const uint GetConnectionInformation = (0x22u << 16) | (274u << 2);

    [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern uint CM_Get_Device_Interface_List_SizeW(out uint length, ref Guid kind, string device, uint flags);

    [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern uint CM_Get_Device_Interface_ListW(ref Guid kind, string device, [Out] char[] buffer, uint length, uint flags);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(string path, uint access, uint share,
        IntPtr security, uint disposition, uint flags, IntPtr template);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool DeviceIoControl(SafeFileHandle hub, uint code, byte[] input,
        int inputSize, [Out] byte[] output, int outputSize, out int bytes, IntPtr overlapped);

    private static string HubPath(string parent) {
        Guid kind = new Guid("f18a0e88-c30c-11d0-8815-00a0c906bed8");
        uint length;
        uint status = CM_Get_Device_Interface_List_SizeW(out length, ref kind, parent, 0);
        if (status != 0) throw new InvalidOperationException("Hub lookup (size): CONFIGRET " + status);
        char[] buffer = new char[length];
        status = CM_Get_Device_Interface_ListW(ref kind, parent, buffer, length, 0);
        if (status != 0) throw new InvalidOperationException("Hub lookup: CONFIGRET " + status);
        string[] paths = new string(buffer).Split(new[] {'\0'}, StringSplitOptions.RemoveEmptyEntries);
        if (paths.Length != 1) throw new InvalidOperationException("Expected one interface for the parent USB hub.");
        return paths[0];
    }

    private static bool Query(SafeFileHandle hub, uint code, byte[] buffer, out int bytes) {
        return DeviceIoControl(hub, code, buffer, buffer.Length, buffer, buffer.Length, out bytes, IntPtr.Zero);
    }

    private static bool MatchesCanon(SafeFileHandle hub, int port, string driver) {
        byte[] info = new byte[4096];
        Array.Copy(BitConverter.GetBytes(port), info, 4);
        int bytes;
        // USB_NODE_CONNECTION_INFORMATION_EX starts with an ULONG and the USB device descriptor.
        if (!Query(hub, GetConnectionInformation, info, out bytes) || bytes < 16
            || BitConverter.ToUInt16(info, 12) != 0x04A9 || BitConverter.ToUInt16(info, 14) != 0x3217) return false;

        byte[] key = new byte[1024];
        Array.Copy(BitConverter.GetBytes(port), key, 4);
        if (!Query(hub, GetDriverKey, key, out bytes) || bytes < 10) return false;
        int length = BitConverter.ToInt32(key, 4);
        if (length < 10 || length > bytes || length > key.Length || (length & 1) != 0) return false;
        string name = Encoding.Unicode.GetString(key, 8, length - 8).TrimEnd('\0');
        return string.Equals(name, driver, StringComparison.OrdinalIgnoreCase);
    }

    public static void Reset(string parent, string driver) {
        using (SafeFileHandle hub = CreateFileW(HubPath(parent), 0x40000000u, 3, IntPtr.Zero, 3, 0, IntPtr.Zero)) {
            if (hub.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            byte[] info = new byte[512];
            int bytes;
            if (!Query(hub, GetHubInformation, info, out bytes)) throw new Win32Exception(Marshal.GetLastWin32Error());
            // USB_NODE_INFORMATION starts with a 4-byte USB_HUB_NODE, then the packed descriptor.
            if (bytes < 7 || info[6] == 0) throw new InvalidOperationException("Hub returned no port information.");
            int selected = 0;
            for (int port = 1; port <= info[6]; port++) {
                if (!MatchesCanon(hub, port, driver)) continue;
                if (selected != 0) throw new InvalidOperationException("Several ports match this Canon.");
                selected = port;
            }
            if (selected == 0 || !MatchesCanon(hub, selected, driver))
                throw new InvalidOperationException("Could not verify which physical port belongs to Canon.");

            Console.WriteLine("Cycling verified Canon USB port #{0} ...", selected);
            byte[] parameters = new byte[8];
            Array.Copy(BitConverter.GetBytes(selected), parameters, 4);
            if (!Query(hub, CyclePort, parameters, out bytes)) {
                int error = Marshal.GetLastWin32Error();
                throw new Win32Exception(error, "USB port cycle failed (" + error + "): " + new Win32Exception(error).Message);
            }
            uint usbStatus = BitConverter.ToUInt32(parameters, 4);
            if (usbStatus != 0) throw new InvalidOperationException("USB port cycle returned status 0x" + usbStatus.ToString("X8"));
            Console.WriteLine("Windows accepted the port cycle.");
        }
    }
}
'@

        Write-Host "Target: $id"
        Write-Host "Parent hub: $parent"
        [CanonUsbPort]::Reset($parent, $driver)
        Start-Sleep -Seconds 2
        $enableAttempted = $false
        for ($i = 0; $i -lt 20; $i++) {
            $device = Get-PnpDevice -PresentOnly -InstanceId $id -ErrorAction SilentlyContinue
            if ($device) {
                $problem = (Get-PnpDeviceProperty -InstanceId $id -KeyName 'DEVPKEY_Device_ProblemCode' -ErrorAction SilentlyContinue).Data
                if ($null -ne $problem -and $problem -eq 0) {
                    Write-Host 'Canon is available in Windows. Open /cam-test-web and select the camera to check PTP.'
                    $exitCode = 0
                    break
                }
                # A previous disable/enable attempt may have left this exact devnode disabled.
                if ($problem -eq 22 -and !$enableAttempted) {
                    $enableAttempted = $true
                    Write-Host 'Windows reports Canon disabled (22). Enabling this device once...'
                    & "$env:SystemRoot\System32\pnputil.exe" /enable-device $id
                    Write-Host "PnPUtil exit code: $LASTEXITCODE"
                }
            }
            Start-Sleep -Milliseconds 500
        }
        if ($exitCode) { throw "The port cycle completed, but Windows did not report Canon ready. Last PnP problem code: $problem." }
    } catch {
        Write-Host $_.Exception.Message
    }
    [void](Read-Host 'Press Enter to close')
    exit $exitCode
}

try {
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($reset.ToString()))
    $powershell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    $child = Start-Process -FilePath $powershell -Verb RunAs -ArgumentList @('-NoProfile', '-EncodedCommand', $encoded) -Wait -PassThru -ErrorAction Stop
    exit $child.ExitCode
} catch {
    Write-Host $_.Exception.Message
    [void](Read-Host 'Press Enter to close')
    exit 1
}

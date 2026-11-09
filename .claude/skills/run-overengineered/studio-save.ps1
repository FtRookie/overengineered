# Saves the place open in Studio as Ctrl+S would: brings Studio's window to the front, sends Ctrl+S, and waits for
# place.rbxl to change on disk, so the dev watcher (scripts/lunewatch.js) runs `lune run savechanges` and the edit
# reaches game/. Takes the keyboard focus from whatever has it, so run it only to finish an edit-place change the
# user asked for. Ported from operators-ts.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File .claude/skills/run-overengineered/studio-save.ps1
#
# Exit codes: 0 saved; 2 no Studio window; 3 could not take the focus; 4 the file did not change in time.
param([int]$TimeoutSeconds = 20)

$ErrorActionPreference = "Stop"
$place = Join-Path (Resolve-Path "$PSScriptRoot/../../..") "place.rbxl"

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Focus {
	[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
	[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
	[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
	[DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
}
"@

$studio = Get-Process RobloxStudioBeta -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($null -eq $studio) { Write-Output "no Studio window"; exit 2 }
$window = $studio.MainWindowHandle

# the Alt+Tab switch: SetForegroundWindow is refused to a process without the focus (the foreground lock), and the
# Alt-tap, AttachThreadInput and minimise-restore tricks were refused too with VS Code in front
if ([Focus]::IsIconic($window)) { [void][Focus]::ShowWindow($window, 9) }
[Focus]::SwitchToThisWindow($window, $true)
Start-Sleep -Milliseconds 400
if ([Focus]::GetForegroundWindow() -ne $window) { Write-Output "could not take the focus"; exit 3 }

$before = (Get-Item $place).LastWriteTimeUtc
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait("^s")

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while ((Get-Date) -lt $deadline) {
	if ((Get-Item $place).LastWriteTimeUtc -gt $before) { Write-Output "saved: $($studio.MainWindowTitle)"; exit 0 }
	Start-Sleep -Milliseconds 250
}
Write-Output "place.rbxl did not change within $TimeoutSeconds s"
exit 4

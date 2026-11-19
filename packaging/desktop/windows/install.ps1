param(
  [switch]$NoLaunch
)

$ErrorActionPreference = "Stop"
$Source = Split-Path -Parent $MyInvocation.MyCommand.Path
$InstallDir = Join-Path $env:LOCALAPPDATA "Service Maestro"
$Exe = Join-Path $InstallDir "ServiceMaestro.exe"

Write-Host "Service Maestro installer"
Write-Host ""

$SourcePath = (Resolve-Path $Source).Path.TrimEnd('\')
$InstallPath = $InstallDir.TrimEnd('\')
if ($SourcePath -ieq $InstallPath) {
  Write-Host "Service Maestro is already installed in $InstallDir"
} else {
  if (Test-Path $Exe) {
    Write-Host "Stopping the running copy..."
    & $Exe --stop | Out-Null
    Start-Sleep -Milliseconds 700
  }
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  $exclude = @("Install Service Maestro.cmd", "install.ps1")
  Get-ChildItem -Force $Source | Where-Object { $exclude -notcontains $_.Name } | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination $InstallDir -Recurse -Force
  }
  Write-Host "Installed to $InstallDir"
}

$WshShell = New-Object -ComObject WScript.Shell
$Desktop = [Environment]::GetFolderPath("Desktop")
$StartMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
$Icon = Join-Path $InstallDir "ServiceMaestro.ico"

function New-Shortcut($Path, $Target, $Arguments, $Description) {
  $Shortcut = $WshShell.CreateShortcut($Path)
  $Shortcut.TargetPath = $Target
  if ($Arguments) { $Shortcut.Arguments = $Arguments }
  $Shortcut.WorkingDirectory = $InstallDir
  $Shortcut.IconLocation = $Icon
  $Shortcut.Description = $Description
  $Shortcut.Save()
}

New-Shortcut (Join-Path $Desktop "Service Maestro.lnk") $Exe "" "Run Service Maestro"
New-Shortcut (Join-Path $StartMenu "Service Maestro.lnk") $Exe "" "Run Service Maestro"
New-Shortcut (Join-Path $StartMenu "Stop Service Maestro.lnk") (Join-Path $InstallDir "Stop Service Maestro.cmd") "" "Stop Service Maestro"
New-Shortcut (Join-Path $StartMenu "Uninstall Service Maestro.lnk") (Join-Path $InstallDir "Uninstall Service Maestro.cmd") "" "Uninstall Service Maestro"

$Registry = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ServiceMaestro"
New-Item -Force $Registry | Out-Null
Set-ItemProperty $Registry "DisplayName" "Service Maestro"
Set-ItemProperty $Registry "DisplayVersion" (Get-Content (Join-Path $InstallDir "version.txt") -Raw).Trim()
Set-ItemProperty $Registry "Publisher" "Service Maestro"
Set-ItemProperty $Registry "InstallLocation" $InstallDir
Set-ItemProperty $Registry "DisplayIcon" $Exe
Set-ItemProperty $Registry "NoModify" 1 -Type DWord
Set-ItemProperty $Registry "NoRepair" 1 -Type DWord
Set-ItemProperty $Registry "UninstallString" "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$InstallDir\uninstall.ps1`""

Write-Host ""
Write-Host "Service Maestro is installed."
Write-Host "Start it from the Desktop or Start Menu shortcut."
Write-Host "Data is stored in: $env:LOCALAPPDATA\ServiceMaestro"
Write-Host ""

if (-not $NoLaunch) {
  Start-Process -FilePath $Exe -WorkingDirectory $InstallDir
}

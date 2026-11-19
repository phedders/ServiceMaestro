$ErrorActionPreference = "SilentlyContinue"
$InstallDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Exe = Join-Path $InstallDir "ServiceMaestro.exe"

& $Exe --stop | Out-Null
Start-Sleep -Milliseconds 500

$Desktop = [Environment]::GetFolderPath("Desktop")
$StartMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
Remove-Item (Join-Path $Desktop "Service Maestro.lnk") -Force
Remove-Item (Join-Path $StartMenu "Service Maestro.lnk") -Force
Remove-Item (Join-Path $StartMenu "Stop Service Maestro.lnk") -Force
Remove-Item (Join-Path $StartMenu "Uninstall Service Maestro.lnk") -Force
Remove-Item "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ServiceMaestro" -Recurse -Force

Write-Host "Service Maestro has been uninstalled."
Write-Host "Your data remains in: $env:LOCALAPPDATA\ServiceMaestro"
Write-Host "Delete that folder manually if you also want to remove songs, set lists and settings."

$Command = 'ping 127.0.0.1 -n 3 >nul & rmdir /s /q "' + $InstallDir + '"'
Start-Process -WindowStyle Hidden -FilePath "cmd.exe" -ArgumentList "/c", $Command

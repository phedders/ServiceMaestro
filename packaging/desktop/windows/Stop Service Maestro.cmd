@echo off
"%~dp0ServiceMaestro.exe" --stop
timeout /t 2 >nul

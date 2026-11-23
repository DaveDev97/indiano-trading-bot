@echo off
rem Indiano Trading Bot - avvio da cmd.exe o con doppio clic. Esempio: start.cmd dashboard
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
if "%~1"=="" pause

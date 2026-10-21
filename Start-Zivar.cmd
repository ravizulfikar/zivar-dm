@echo off
setlocal
cd /d "%~dp0"
set "ZIVAR_NODE=%~dp0.tools\node-v24.22.0-win-x64\node.exe"
if not exist "%ZIVAR_NODE%" (
  echo Node.js portabel tidak ditemukan. Gunakan Node.js 24 atau lebih baru.
  where node >nul 2>nul
  if errorlevel 1 (
    pause
    exit /b 1
  )
  set "ZIVAR_NODE=node"
)
echo.
echo ZIVAR Download Manager
echo Buka http://127.0.0.1:18765 di browser.
echo Biarkan jendela ini terbuka. Tekan Ctrl+C untuk berhenti.
echo.
"%ZIVAR_NODE%" app\server.mjs
if errorlevel 1 pause

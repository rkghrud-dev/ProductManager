@echo off
setlocal
cd /d "%~dp0"
set NAVERTAGV2_PORT=8787

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required.
  pause
  exit /b 1
)

if not exist "node_modules\bcryptjs" (
  echo Installing local dependencies...
  npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

node server.js
pause

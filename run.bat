@echo off
chcp 65001 >nul
echo ============================================
echo   상품 관리 시스템 시작
echo   서버 실행 후 브라우저를 자동으로 엽니다
echo ============================================
cd /d "%~dp0"
set "NAVERTAG_DIR=%~dp0navertagv2"

if exist "%NAVERTAG_DIR%\server.js" (
    echo 네이버 태그 서버 시작: http://127.0.0.1:8787
    start "NaverTagV2" /min powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:NAVERTAGV2_NO_BROWSER='1'; $env:NAVERTAGV2_PORT='8787'; Set-Location -LiteralPath '%NAVERTAG_DIR%'; if (-not (Test-Path -LiteralPath 'node_modules\bcryptjs')) { npm install }; node server.js"
) else (
    echo 네이버 태그 서버 폴더를 찾지 못했습니다: %NAVERTAG_DIR%
)

start "" cmd /c "timeout /t 2 >nul & start http://127.0.0.1:5000"
python app.py
pause

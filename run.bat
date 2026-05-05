@echo off
chcp 65001 >nul
echo ============================================
echo   상품 관리 시스템 시작
echo   서버 실행 후 브라우저를 자동으로 엽니다
echo ============================================
cd /d "%~dp0"
start "" cmd /c "timeout /t 2 >nul & start http://127.0.0.1:5000"
python app.py
pause

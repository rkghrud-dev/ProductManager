@echo off
chcp 65001 >nul
echo ============================================
echo   상품 관리 시스템 시작
echo   브라우저에서 http://localhost:5000 접속
echo ============================================
cd /d "%~dp0"
python app.py
pause

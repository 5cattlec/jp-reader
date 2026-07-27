@echo off
rem 자동 업데이트 — 스케줄러가 호출: 기사 생성 후 gh-pages 자동 배포. 로그=tools\update.log
cd /d "%~dp0\.."
set PYTHONIOENCODING=utf-8
echo ---------- %date% %time% ---------- >> "%~dp0update.log"
"C:\Users\user\AppData\Local\Programs\Python\Python311\pythonw.exe" "%~dp0update.py" >> "%~dp0update.log" 2>&1
echo [deploy] gh-pages push >> "%~dp0update.log"
call "%~dp0deploy_ghpages.cmd" >> "%~dp0update.log" 2>&1
echo [done] exit=%errorlevel% >> "%~dp0update.log"

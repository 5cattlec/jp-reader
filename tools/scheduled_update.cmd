@echo off
rem 자동 업데이트용 — 스케줄러가 호출. 결과는 tools\update.log 에 기록.
cd /d "%~dp0\.."
set PYTHONIOENCODING=utf-8
echo ---------- %date% %time% ---------- >> "%~dp0update.log"
"C:\Users\user\AppData\Local\Programs\Python\Python311\pythonw.exe" "%~dp0update.py" >> "%~dp0update.log" 2>&1

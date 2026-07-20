@echo off
chcp 65001 >nul
set TASK=jp-reader-update
schtasks /Delete /TN "%TASK%" /F
if %errorlevel%==0 (echo [OK] 자동 업데이트 해제됨) else (echo [알림] 등록된 작업이 없습니다)
echo.
pause

@echo off
chcp 65001 >nul
rem jp-reader 자동 업데이트 등록 (Windows 작업 스케줄러)
rem 기본: 6시간마다. 바꾸려면 아래 /MO 숫자(시간) 수정.
set TASK=jp-reader-update
set HOURS=6

schtasks /Create /TN "%TASK%" /TR "\"%~dp0tools\scheduled_update.cmd\"" /SC HOURLY /MO %HOURS% /F
if %errorlevel%==0 (
  echo.
  echo [OK] "%TASK%" 등록됨 — %HOURS%시간마다 자동으로 기사 업데이트합니다.
  echo      로그: tools\update.log
  echo      해제: 자동업데이트_해제.cmd 실행
) else (
  echo [실패] 관리자 권한이 필요할 수 있습니다. 이 파일을 우클릭 후 "관리자 권한으로 실행" 해보세요.
)
echo.
pause

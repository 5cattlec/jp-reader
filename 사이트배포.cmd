@echo off
chcp 65001 >nul
rem site\ 폴더를 gh-pages 브랜치로 배포 (GitHub Actions 없이 동작)
rem 사용: update.cmd 로 기사 갱신 후 이 파일 더블클릭

set SRC=%~dp0site
set DST=%TEMP%\jp-reader-ghp

echo [1/3] 사이트 복사 중...
if exist "%DST%" rmdir /s /q "%DST%"
mkdir "%DST%"
xcopy "%SRC%" "%DST%" /E /I /Q /Y >nul
type nul > "%DST%\.nojekyll"

echo [2/3] 커밋 중...
pushd "%DST%"
git init -q
git checkout -q -b gh-pages
git config user.name "5cattlec"
git config user.email "79951800+5cattlec@users.noreply.github.com"
git config credential.useHttpPath true
git add -A
git commit -q -m "Deploy jp-reader site"

echo [3/3] GitHub 업로드 중... (수 분 걸릴 수 있음)
git remote add origin https://5cattlec@github.com/5cattlec/jp-reader.git
git push -f origin gh-pages
popd

echo.
if %errorlevel%==0 (
  echo [완료] https://5cattlec.github.io/jp-reader/ 에 반영됩니다 ^(1~2분 소요^)
) else (
  echo [실패] 위 오류 메시지를 확인하세요.
)
echo.
pause

@echo off
rem site\ 를 gh-pages 브랜치로 배포 (비대화형 — 스케줄러/수동 공용)
setlocal
set SRC=%~dp0..\site
set DST=%TEMP%\jp-reader-ghp

if exist "%DST%" rmdir /s /q "%DST%"
mkdir "%DST%"
xcopy "%SRC%" "%DST%" /E /I /Q /Y >nul
type nul > "%DST%\.nojekyll"

pushd "%DST%"
git init -q
git checkout -q -b gh-pages
git config user.name "5cattlec"
git config user.email "79951800+5cattlec@users.noreply.github.com"
git config credential.useHttpPath true
git add -A
git commit -q -m "Auto-deploy jp-reader site"
git remote add origin https://5cattlec@github.com/5cattlec/jp-reader.git
git push -f origin gh-pages
set RC=%errorlevel%
popd
endlocal
exit /b %RC%

@echo off
REM UTF-8
chcp 65001 > nul
title MelCandy - Render Hazirla
color 0B

echo ========================================
echo      MelCandy - Render'a Yuklemek Icin
echo ========================================
echo.

cd /d "%~dp0"

if exist melcandy-render.zip (
  echo Eski zip siliniyor...
  del /f /q melcandy-render.zip
  echo.
)

echo Zip olusturuluyor, lutfen bekle...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path '.\*' -DestinationPath '.\melcandy-render.zip' -Force" 2>&1

if exist melcandy-render.zip (
  echo.
  echo ========================================
  echo              BASARILI
  echo ========================================
  echo.
  echo Dosya: melcandy-render.zip
  echo.
  start "" "%~dp0"
) else (
  echo Zip olusturulamadi.
)

pause

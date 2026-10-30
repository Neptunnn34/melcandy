@echo off
chcp 65001 >nul
title MelCandy EXE Oluşturucu
color 0B

echo ========================================
echo      MelCandy - EXE Kurucu (Electron)
echo ========================================
echo.

cd /d "%~dp0Masaüstü-EXE"

if not exist node_modules (
  echo [1/3] Bağımlılıklar yükleniyor (ilk sefer uzun sürebilir)...
  call npm install
  echo.
) else (
  echo [1/3] node_modules mevcut, atlanıyor...
  echo.
)

echo [2/3] EXE paketi oluşturuluyor...
call npm run dist
echo.

echo [3/3] Tamamlandı!
echo.
if exist "dist\*.exe" (
  echo EXE dosyası hazır:
  dir /b dist\*.exe
  echo.
  echo dist\ klasörünü açıyorum...
  start "" "%~dp0Masaüstü-EXE\dist"
) else (
  echo EXE oluşturulamadı. Hataları yukarıda kontrol et.
)

pause

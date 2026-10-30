@echo off
chcp 65001 >nul
title MelCandy APK Oluşturucu (TWA)
color 0E

echo ========================================
echo      MelCandy - Telefon APK Oluşturucu
echo ========================================
echo.
echo Bu işlem Bubblewrap CLI ile TWA APK üretir.
echo Bilgisayar IP adresini girmen istenecek.
echo.

set /p URL="Tamamlanmış HTTPS adresi (örn: https://abc.trycloudflare.com): "
if "%URL%"=="" (
  echo Link boş olamaz.
  pause
  exit /b 1
)
echo.
echo Kullanılacak adres: %URL%
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
  echo Node.js bulunamadı. Lütfen Node.js kurulu olduğundan emin ol.
  pause
  exit /b 1
)

where npm >nul 2>&1
if %errorlevel% neq 0 (
  echo npm bulunamadı.
  pause
  exit /b 1
)

if not exist TELEFON_APK (
  mkdir TELEFON_APK
)

echo [1/4] Bubblewrap CLI yükleniyor/güncelleniyor...
call npm install -g @bubblewrap/cli
echo.

echo [2/4] TWA projesi oluşturuluyor...
if exist "TELEFON_APK\twa" (
  rmdir /s /q "TELEFON_APK\twa"
)

cd /d "%~dp0TELEFON_APK"
call bubblewrap init --manifest %URL%/manifest.webmanifest
echo.

echo [3/4] APK imzalanarak oluşturuluyor (otomatik anahtar)...
call bubblewrap build
echo.

echo [4/4] APK kopyalanıyor...
for %%f in (app-release-signed.apk app-release.apk *.apk) do (
  if exist "%%f" (
    copy /y "%%f" "%~dp0TELEFON_APK\MelCandy.apk" >nul
    echo APK hazır: %~dp0TELEFON_APK\MelCandy.apk
  )
)

echo.
echo ========================================
echo              İŞLEM TAMAMLANDI
echo ========================================
echo.
echo APK dosyası: TELEFON_APK\MelCandy.apk
echo.
echo WhatsApp'tan bu .APK dosyasını kendine veya sevgiline atarak yükletebilirsin.
echo.
echo NOT: cloudflared penceresi açıkken ve sunucu çalışırken üret.
echo.

pause
start "" "%~dp0TELEFON_APK"

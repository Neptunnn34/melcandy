@echo off
chcp 65001 >nul
title MelCandy - Cloudflared ile Public Link
color 0A

echo ========================================
echo      Cloudflared ile HTTPS Link Alma
echo ========================================
echo.
echo Bu işlem sunucunu dışarıdan erişilebilir yapar.
echo Linki kopyalayıp TELEFON_APK_OLUSTUR.bat'a yapıştıracaksın.
echo.

cd /d "%~dp0"

if not exist cloudflared.exe (
  echo [1/2] cloudflared.exe indiriliyor...
  powershell -Command "Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'cloudflared.exe'"
  echo İndirme tamamlandı.
  echo.
) else (
  echo [1/2] cloudflared.exe mevcut, atlanıyor...
  echo.
)

echo [2/2] Tunnel başlatılıyor...
echo.
echo Aşağıdaki https://....trycloudflare.com linkini KOPYALA ve bu pencereyi KAPATMADAN tut.
echo.
cloudflared.exe tunnel --url http://127.0.0.1:4321
pause

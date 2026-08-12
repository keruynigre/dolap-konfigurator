@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

title Vercel Guncelle
echo.
echo  Site guncelleniyor...
echo  Klasor: %CD%
echo.

set "PATH=C:\Program Files\nodejs;%PATH%"

where npx >nul 2>&1
if errorlevel 1 (
  echo [HATA] Node.js / npx bulunamadi.
  echo https://nodejs.org adresinden Node.js kurun.
  pause
  exit /b 1
)

echo Production deploy basliyor...
echo.
call npx.cmd --yes vercel --prod --yes
set "ERR=%ERRORLEVEL%"

echo.
if "%ERR%"=="0" (
  echo  Basarili.
  echo  Canli adres: https://dolap-konfigurator.vercel.app
  echo.
  start "" "https://dolap-konfigurator.vercel.app"
) else (
  echo  [HATA] Deploy basarisiz. Yukaridaki mesaji oku.
  echo  Giris gerekirse: npx vercel login
)

echo.
pause
endlocal

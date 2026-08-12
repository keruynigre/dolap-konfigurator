@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

title Bambi Dolap Konfigurator
set "PORT=5180"
set "URL=http://127.0.0.1:%PORT%/"

echo.
echo  Bambi Dolap Konfigurator
echo  Klasor: %CD%
echo.

REM --- 1) Python (en guvenilir yerel sunucu) ---
set "PY="
if exist "%LocalAppData%\Programs\Python\Python313\python.exe" set "PY=%LocalAppData%\Programs\Python\Python313\python.exe"
if not defined PY if exist "%LocalAppData%\Programs\Python\Python312\python.exe" set "PY=%LocalAppData%\Programs\Python\Python312\python.exe"
if not defined PY if exist "%LocalAppData%\Programs\Python\Python311\python.exe" set "PY=%LocalAppData%\Programs\Python\Python311\python.exe"
if not defined PY (
  where py >nul 2>&1 && set "PY=py"
)
if not defined PY (
  where python >nul 2>&1 && set "PY=python"
)

if defined PY (
  echo Python ile aciliyor: %URL%
  echo Durdurmak icin bu pencereyi kapatin.
  echo.
  start "" "%URL%"
  if /I "%PY%"=="py" (
    py -m http.server %PORT% --bind 127.0.0.1
  ) else (
    "%PY%" -m http.server %PORT% --bind 127.0.0.1
  )
  echo.
  echo Sunucu durdu.
  pause
  exit /b 0
)

REM --- 2) Node (http-server) ---
set "PATH=C:\Program Files\nodejs;%PATH%"
where node >nul 2>&1
if not errorlevel 1 (
  echo Node ile aciliyor: %URL%
  echo Durdurmak icin bu pencereyi kapatin.
  echo.
  start "" "%URL%"
  call npx.cmd --yes -- http-server -p %PORT% -a 127.0.0.1 -c-1 .
  echo.
  echo Sunucu durdu.
  pause
  exit /b 0
)

REM --- 3) Son care: dogrudan tarayicide ac ---
echo [UYARI] Python veya Node bulunamadi.
echo index.html dogrudan tarayicide aciliyor...
echo.
start "" "%CD%\index.html"
echo.
echo Daha iyi calisma icin Python kurun:
echo   https://www.python.org/downloads/
echo Kurarken "Add python.exe to PATH" secenegini isaretleyin.
echo.
pause
endlocal

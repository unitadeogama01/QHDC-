@echo off
rem ============================================================
rem  QHDC! - Arrancar la app (doble clic)
rem  Abre http://localhost:3000 cuando diga "listo".
rem  Cierra esta ventana o presiona Ctrl + C para apagarla.
rem ============================================================
chcp 65001 >nul
title QHDC! - servidor
set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"
cd /d "%~dp0backend"

where node >nul 2>nul
if errorlevel 1 (
  echo No se encontro Node.js. Instalalo desde https://nodejs.org y vuelve a intentar.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Instalando dependencias por primera vez...
  call npm install
)

call npm start
pause

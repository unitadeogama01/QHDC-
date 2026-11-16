@echo off
rem ============================================================
rem  QHDC! - Publicar con DIRECCION FIJA (doble clic)
rem  Usa Tailscale Funnel (gratis). La direccion es siempre la
rem  misma: https://<tu-pc>.<tu-red>.ts.net
rem  La primera vez Tailscale puede pedir que actives HTTPS y
rem  Funnel con un enlace: abrelo, activalo y vuelve aqui.
rem  Cierra esta ventana o presiona Ctrl + C para apagar el enlace.
rem ============================================================
chcp 65001 >nul
title QHDC! - direccion fija
set "PATH=%LOCALAPPDATA%\Programs\nodejs;%ProgramFiles%\Tailscale;%PATH%"
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

call npm run publico -- --fijo
pause

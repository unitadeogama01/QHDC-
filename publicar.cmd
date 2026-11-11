@echo off
rem ============================================================
rem  QHDC! - Publicar con un enlace HTTPS temporal (doble clic)
rem  Usa Cloudflare Tunnel (gratis). Muestra un enlace
rem  https://....trycloudflare.com que cambia cada vez.
rem  Antes cambia las contrasenas de ejemplo en Ajustes.
rem  Cierra esta ventana o presiona Ctrl + C para cerrar el enlace.
rem ============================================================
chcp 65001 >nul
title QHDC! - enlace publico
set "PATH=%LOCALAPPDATA%\Programs\nodejs;%LOCALAPPDATA%\Programs\cloudflared;%PATH%"
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

call npm run publico
pause

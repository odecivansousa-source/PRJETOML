@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Mossoro Ofertas - LinkPronto

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo.
    echo ========================================================
    echo  [ERRO] O Node.js nao foi encontrado no seu computador!
    echo  Para usar o LinkPronto, instale em: https://nodejs.org
    echo ========================================================
    echo.
    pause
    exit /b 1
)

:: Encerra processo anterior que estiver ocupando a porta 4174
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :4174 ^| findstr LISTENING') do taskkill /f /pid %%a >nul 2>nul

cls
echo =====================================================================
echo       MOSSORO OFERTAS - LINKPRONTO v2.0
echo =====================================================================
echo.
echo  [+] Iniciando servidor local...
echo  [+] Link do painel: http://127.0.0.1:4174
echo.
echo  DICA: Mantenha esta janela aberta enquanto estiver usando o painel.
echo =====================================================================
echo.

start "" "http://127.0.0.1:4174"
node server.js
pause

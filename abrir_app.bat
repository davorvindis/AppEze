@echo off
REM ============================================================
REM  Stock Galpones - Abrir la app en localhost
REM ============================================================
REM  Levanta un servidor web local en esta carpeta y abre la app
REM  en el navegador. Para cerrarlo: cerrar esta ventana negra.
REM
REM  Requiere Python instalado (viene por defecto en Windows 10/11
REM  o se baja de https://www.python.org/downloads/ - tildar
REM  "Add Python to PATH" en el instalador).
REM ============================================================

cd /d "%~dp0"

set PORT=8765
set URL=http://localhost:%PORT%/index.html

REM --- Chequear si Python esta disponible ---
where python >nul 2>&1
if %ERRORLEVEL% neq 0 (
    where py >nul 2>&1
    if %ERRORLEVEL% neq 0 (
        echo.
        echo  [ERROR] No se encontro Python en el sistema.
        echo.
        echo  Opcion 1 - Instalar Python desde:
        echo    https://www.python.org/downloads/
        echo    (tildar "Add Python to PATH" en el instalador)
        echo.
        echo  Opcion 2 - Abrir la app directo con doble clic en
        echo    index.html (funciona igual).
        echo.
        pause
        exit /b 1
    )
    set PY=py
) else (
    set PY=python
)

echo.
echo  =====================================================
echo   Stock Galpones - Servidor local
echo  =====================================================
echo.
echo   URL:  %URL%
echo.
echo   Para cerrar: cerrar esta ventana o Ctrl+C
echo  =====================================================
echo.

REM --- Abrir el navegador despues de 1.5s ---
start "" cmd /c "timeout /t 2 /nobreak >nul & start %URL%"

REM --- Levantar el servidor (bloquea esta ventana) ---
%PY% -m http.server %PORT%

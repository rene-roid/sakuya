@echo off
setlocal enabledelayedexpansion

echo ========================================
echo   Sakuya - Dev Server
echo ========================================
echo.

where bun >nul 2>&1
if %errorlevel% neq 0 (
    echo Bun is not installed. Run setup.bat first.
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo Dependencies not found. Running bun install...
    bun install
    if %errorlevel% neq 0 (
        echo Failed to install dependencies.
        pause
        exit /b 1
    )
)

rem Ports, bind address, login and resource limits all come from sakuya.config.json (created with
rem the defaults on first run). The server and web URLs are printed below once each is up.
echo Starting development server...
echo.

bun dev
pause

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

echo Starting development server...
echo   Backend  : http://localhost:3777
echo   Frontend : http://localhost:5173
echo.

bun dev
pause

@echo off
setlocal enabledelayedexpansion

echo ========================================
echo   Sakuya - Setup
echo ========================================
echo.

where bun >nul 2>&1
if %errorlevel% neq 0 (
    echo Bun is not installed. Installing Bun...
    powershell -c "irm bun.sh/install.ps1 | iex"
    if %errorlevel% neq 0 (
        echo Failed to install Bun. Please install it manually from https://bun.sh
        pause
        exit /b 1
    )
    echo Bun installed successfully.
    echo Please restart your terminal and run this script again.
    pause
    exit /b 0
)

echo Bun found: 
bun --version
echo.

echo Installing dependencies...
bun install
if %errorlevel% neq 0 (
    echo Failed to install dependencies.
    pause
    exit /b 1
)

echo.
echo Setup complete. Run run.bat to start the dev server.
pause

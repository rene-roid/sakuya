@echo off
setlocal enabledelayedexpansion

echo ========================================
echo   Sakuya - Update
echo ========================================
echo.

where bun >nul 2>&1
if %errorlevel% neq 0 (
    echo Bun is not installed. Run setup.bat first.
    pause
    exit /b 1
)

echo Pulling latest changes...
git pull
if %errorlevel% neq 0 (
    echo Failed to pull latest changes.
    pause
    exit /b 1
)

echo.
echo Updating dependencies...
bun install
if %errorlevel% neq 0 (
    echo Failed to update dependencies.
    pause
    exit /b 1
)

echo.
echo Update complete. Run run.bat to start the dev server.
pause

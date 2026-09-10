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

if exist "%USERPROFILE%\.sakuya\" (
    echo Data folder: %USERPROFILE%\.sakuya ^(already set up^)
) else if exist "apps\server\data\tbge.db" (
    echo Data folder: apps\server\data ^(existing database found^)
    echo Move it to %USERPROFILE%\.sakuya any time from Settings ^> System in the web UI.
) else (
    echo Where should Sakuya keep its data ^(database, thumbnails, uploads, downloads^)?
    echo   1^) %USERPROFILE%\.sakuya - survives reinstalling or moving the app folder ^(recommended^)
    echo   2^) apps\server\data - inside this project folder
    set /p data_choice="Choice [1]: "
    if "!data_choice!"=="2" (
        mkdir "apps\server\data" 2>nul
        echo Using apps\server\data.
    ) else (
        mkdir "%USERPROFILE%\.sakuya" 2>nul
        echo Using %USERPROFILE%\.sakuya.
    )
)
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

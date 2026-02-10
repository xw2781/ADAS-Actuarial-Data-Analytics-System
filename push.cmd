@echo off
cd /d "%~dp0"

echo ========================================
echo   ArcRho - Sync and Push to GitHub
echo ========================================
echo.

:: ---- Sync core files to repo ----
set "CORE=E:\ADAS\core"
set "DEST=E:\ADAS\repos\ArcRho\backend\src"

echo Syncing core files...

:: utils.py
copy /y "%CORE%\utils.py" "%DEST%\utils.py" >nul

:: ADAS Agent -> agent
for %%f in (main.py build_exe.py requirements.txt) do (
    copy /y "%CORE%\ADAS Agent\%%f" "%DEST%\agent\%%f" >nul 2>nul
)

:: ADAS Master -> master
for %%f in (main.py build_exe.py create_icon.py command.txt requirements.txt) do (
    copy /y "%CORE%\ADAS Master\%%f" "%DEST%\master\%%f" >nul 2>nul
)

:: ADAS Shell -> shell
if not exist "%DEST%\shell" mkdir "%DEST%\shell"
for %%f in (main.py build_exe.py command.txt requirements.txt) do (
    copy /y "%CORE%\ADAS Shell\%%f" "%DEST%\shell\%%f" >nul 2>nul
)

echo Sync complete.
echo.

:: ---- Git pull then push ----
git pull origin main --no-rebase
if errorlevel 1 goto :error

git add -A
if errorlevel 1 goto :error

set "msg=%~1"
if "%msg%"=="" (
    for /f "tokens=*" %%d in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "msg=Update %%d"
)

git commit -m "%msg%"
if errorlevel 1 (
    echo.
    echo Nothing to commit, pushing any unpushed commits...
)

git push origin main
if errorlevel 1 goto :error

echo.
echo ========================================
echo   Pushed successfully!
echo ========================================
timeout /t 3
exit /b 0

:error
echo.
echo ========================================
echo   ERROR - push failed
echo ========================================
pause
exit /b 1

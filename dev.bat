@echo off
if /I not "%BB_DEV_KEEP_OPEN%"=="1" (
  set "BB_DEV_KEEP_OPEN=1"
  cmd /k ""%~f0""
  exit /b
)
setlocal
REM Basebuild Desktop - Dev Launch
REM Runs the Tauri dev server and opens the app window.
cd /d "%~dp0"

set DEV_PORT=1420
set EXIT_CODE=0

echo Starting Basebuild dev...

REM Kill any stale Basebuild app binary from a previous dev run.
REM Cargo cannot overwrite basebuild-app.exe while the old process still holds the file lock.
call :KILL_STALE_EXE

call :CHECK_PORT
if defined PORT_PID (
  echo.
  echo Port %DEV_PORT% is already in use by PID %PORT_PID% - %PORT_PROCESS%.
  echo This usually means another Basebuild/Vite dev server is still running.
  choice /C YN /M "Stop that process and continue"
  if errorlevel 2 (
    echo.
    echo Start cancelled. Close the old dev server or rerun this script and choose Y.
    set EXIT_CODE=1
    goto END
  )

  echo.
  echo Stopping PID %PORT_PID%...
  taskkill /PID %PORT_PID% /T /F
  if errorlevel 1 (
    echo Failed to stop PID %PORT_PID%. Run this terminal as Administrator or close the process manually.
    set EXIT_CODE=1
    goto END
  )

  timeout /t 1 /nobreak >nul
  call :CHECK_PORT
  if defined PORT_PID (
    echo Port %DEV_PORT% is still in use by PID %PORT_PID% - %PORT_PROCESS%.
    set EXIT_CODE=1
    goto END
  )
)

call npm run tauri dev
set EXIT_CODE=%ERRORLEVEL%
echo.
if not "%EXIT_CODE%"=="0" (
  echo Basebuild dev exited with error code %EXIT_CODE%.
  echo The terminal is being kept open so you can copy the error above.
) else (
  echo Basebuild dev exited normally.
)

:END
echo.
pause
exit /b %EXIT_CODE%

:KILL_STALE_EXE
set STALE_FOUND=0
for /f "tokens=2" %%P in ('tasklist /FI "IMAGENAME eq basebuild-app.exe" /NH 2^>nul') do (
  if not "%%P"=="INFO:" (
    if "%STALE_FOUND%"=="0" echo Killing stale basebuild-app.exe ^(PID %%P^) to release the file lock...
    taskkill /PID %%P /T /F >nul 2>&1
    set STALE_FOUND=1
  )
)
if "%STALE_FOUND%"=="1" timeout /t 1 /nobreak >nul
goto :EOF

:CHECK_PORT
set PORT_PID=
set PORT_PROCESS=unknown process
for /f "tokens=5" %%A in ('netstat -ano ^| findstr /R /C:":%DEV_PORT% .*LISTENING"') do (
  set PORT_PID=%%A
  goto :FOUND_PORT
)
goto :EOF

:FOUND_PORT
for /f "tokens=1" %%B in ('tasklist /FI "PID eq %PORT_PID%" /NH') do (
  if not "%%B"=="INFO:" set PORT_PROCESS=%%B
)
goto :EOF

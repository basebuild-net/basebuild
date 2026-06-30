@echo off
REM Basebuild Desktop - Dev Launch
REM Runs the Tauri dev server and opens the app window.
cd /d "%~dp0"
echo Starting Basebuild dev...
npm run tauri dev
pause

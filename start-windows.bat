@echo off
rem Double-click to open the dashboard (Windows). Serves this folder at http://localhost:8000.
rem Close this window to stop.
cd /d "%~dp0"
start "" cmd /c "timeout /t 2 >nul & start http://localhost:8000"
where py >nul 2>nul
if %errorlevel%==0 ( py -3 -m http.server 8000 & goto :eof )
where python >nul 2>nul
if %errorlevel%==0 ( python -m http.server 8000 & goto :eof )
echo Python was not found.
echo Open index.html directly instead, then use "Load CSV..." to pick data\clients.csv.
pause

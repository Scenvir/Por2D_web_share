@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js LTS first: https://nodejs.org/en/download
  pause
  exit /b 1
)
echo Por2D - local server
echo Open http://127.0.0.1:8000 in two browser windows to test co-op.
echo Keep this window open. Press Ctrl+C to stop.
node runtime/server.cjs --host 127.0.0.1 --port 8000
if errorlevel 1 pause

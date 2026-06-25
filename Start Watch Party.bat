@echo off
REM Double-click this to host a WatchTorrent watch party from your own machine.
title WatchTorrent Watch Party
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0WatchParty.ps1"
REM Safety net: if PowerShell itself failed to launch the script, keep the window open.
if errorlevel 1 (
  echo.
  echo The launcher exited unexpectedly. Take a screenshot of any red text above.
  pause
)

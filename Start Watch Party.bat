@echo off
REM Double-click this to host a WatchTorrent watch party from your own machine.
title WatchTorrent
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0WatchParty.ps1"

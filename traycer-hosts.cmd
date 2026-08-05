@echo off
REM One command: serve the Traycer web client on http://localhost with BOTH
REM hosts already listed - Tonberry (local) and whatever
REM ~/.traycer/chat-transfer.hosts.json lists (Altra).
REM
REM It must be http://localhost, not https: a secure page cannot open a
REM ws://127.0.0.1 socket (mixed content), and localhost is the one origin
REM browsers exempt.
REM
REM Tonberry's PORT is read from ~/.traycer/host/pid.json on every request,
REM so a host restart needs nothing here - only the port moves, the id does
REM not.
setlocal
set PORT=%1
if "%PORT%"=="" set PORT=5299
cd /d "%~dp0"
echo Traycer hosts on http://localhost:%PORT%
node serve-web.mjs %PORT%

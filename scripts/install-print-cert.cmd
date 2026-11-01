@echo off
REM ---------------------------------------------------------------------------
REM  Trust the SidGrace print relay certificate on a CLIENT PC (reception laptop,
REM  pharmacy PC, ...) so the online app can print to the clinic's Xprinter.
REM
REM  Right-click this file > "Run as administrator".
REM  Optional: install-print-cert.cmd 192.168.1.214      (host PC address)
REM
REM  It downloads the PUBLIC certificate from the host PC's relay and adds it to
REM  Local Machine > Trusted Root. The certificate is marked CA=false, so it can only
REM  identify the relay; it cannot vouch for any other website.
REM ---------------------------------------------------------------------------
setlocal
set HOST=%~1
if "%HOST%"=="" set HOST=192.168.1.214
set CER=%TEMP%\sidgrace-print-relay.cer

net session >nul 2>&1
if errorlevel 1 (
    echo Please right-click this file and choose "Run as administrator".
    pause
    exit /b 1
)

echo Downloading certificate from https://%HOST%:5443 ...
curl.exe -s -k --fail -o "%CER%" "https://%HOST%:5443/print-relay.cer"
if errorlevel 1 (
    echo Could not reach the print relay on %HOST%:5443.
    echo Check that the host PC is on, the app is running, and this PC is on the clinic network.
    pause
    exit /b 1
)

certutil -addstore -f Root "%CER%" >nul
if errorlevel 1 ( echo Failed to install the certificate. & pause & exit /b 1 )

echo.
echo Installed. Certificate details (thumbprint should match the one shown on the host PC):
certutil -dump "%CER%" | findstr /i /c:"Cert Hash(sha1)" /c:"Subject:"
del "%CER%" >nul 2>&1
echo.
echo Done. Restart Chrome/Edge, then use Print Receipt in the online app.
echo The first time, Chrome may ask to allow access to devices on your local network: click Allow.
pause

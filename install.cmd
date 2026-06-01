@echo off
setlocal enabledelayedexpansion

set REPO=modu/mobi
set INSTALL_DIR=%USERPROFILE%\.local\bin
set BINARY_NAME=mobi.exe

echo [info] Installing mobi...

set PLATFORM=mobi-windows-x64
if "%PROCESSOR_ARCHITECTURE%"=="ARM64" set PLATFORM=mobi-windows-arm64

echo [info] Detected platform: %PLATFORM%

echo [info] Fetching latest version...
for /f "delims=" %%v in ('powershell -command "(Invoke-RestMethod 'https://api.github.com/repos/%REPO%/releases' | Where-Object { $_.tag_name -match '^v\d+\.\d+\.\d+$' } | Select-Object -First 1).tag_name"') do set VERSION=%%v

if "%VERSION%"=="" (
    echo [error] Failed to determine latest version
    exit /b 1
)

echo [info] Latest version: %VERSION%

set TMP_DIR=%TEMP%\mobi-install-%RANDOM%
mkdir %TMP_DIR%

set BASE_URL=https://github.com/%REPO%/releases/download/%VERSION%
set BINARY_FILE=%PLATFORM%.zip

echo [info] Downloading %BINARY_FILE%...
curl -fsSL -o "%TMP_DIR%\%BINARY_FILE%" "%BASE_URL%/%BINARY_FILE%"

echo [info] Downloading checksums...
curl -fsSL -o "%TMP_DIR%\checksums.txt" "%BASE_URL%/checksums.txt"

echo [info] Verifying checksum...
for /f "tokens=1" %%h in ('findstr /c:"%BINARY_FILE%" "%TMP_DIR%\checksums.txt"') do set EXPECTED_HASH=%%h

if "%EXPECTED_HASH%"=="" (
    echo [error] No checksum found for %BINARY_FILE%
    goto :cleanup
)

for /f "delims=" %%a in ('certutil -hashfile "%TMP_DIR%\%BINARY_FILE%" SHA256 ^| findstr /v ":" ^| findstr /v "CertUtil"') do set ACTUAL_HASH=%%a
set ACTUAL_HASH=%ACTUAL_HASH: =%

if /i not "%EXPECTED_HASH%"=="%ACTUAL_HASH%" (
    echo [error] Checksum mismatch!
    echo Expected: %EXPECTED_HASH%
    echo Actual:   %ACTUAL_HASH%
    goto :cleanup
)

echo [info] Extracting...
powershell -command "Expand-Archive -Path '%TMP_DIR%\%BINARY_FILE%' -DestinationPath '%TMP_DIR%' -Force"

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
copy /y "%TMP_DIR%\%BINARY_NAME%" "%INSTALL_DIR%\%BINARY_NAME%"

echo [info] Adding to PATH...
powershell -command "$p = [Environment]::GetEnvironmentVariable('PATH', 'User'); if ($p -notlike '*\.local\bin*') { [Environment]::SetEnvironmentVariable('PATH', $p + ';%USERPROFILE%\.local\bin', 'User') }"

"%INSTALL_DIR%\%BINARY_NAME%" version
echo [info] Successfully installed mobi

:cleanup
rmdir /s /q "%TMP_DIR%" 2>nul
endlocal

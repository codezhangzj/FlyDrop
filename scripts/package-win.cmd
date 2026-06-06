@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0\.."

if "%WINDOWS_ELECTRON_VERSION%"=="" set "WINDOWS_ELECTRON_VERSION=22.3.27"
if "%WINDOWS_ARCHES%"=="" set "WINDOWS_ARCHES=x64 ia32"

echo ==^> Checking dependencies
where node >nul 2>nul || (
  echo Error: node is required but was not found in PATH.
  exit /b 1
)
where npm >nul 2>nul || (
  echo Error: npm is required but was not found in PATH.
  exit /b 1
)

if not exist node_modules (
  echo ==^> node_modules not found; installing with npm ci
  call npm ci || exit /b 1
) else (
  echo OK: node_modules found
)

echo ==^> Preparing icons
node scripts\gen-icons.mjs || exit /b 1

echo ==^> Cleaning previous Windows package output
if exist release\win-unpacked rmdir /s /q release\win-unpacked
if exist release\win-ia32-unpacked rmdir /s /q release\win-ia32-unpacked
if exist release\win-arm64-unpacked rmdir /s /q release\win-arm64-unpacked
del /q release\*.exe release\*.exe.blockmap release\*.nsis.7z >nul 2>nul

set "ARCH_FLAGS="
for %%A in (%WINDOWS_ARCHES%) do (
  if /I "%%A"=="x64" set "ARCH_FLAGS=!ARCH_FLAGS! --x64"
  if /I "%%A"=="ia32" set "ARCH_FLAGS=!ARCH_FLAGS! --ia32"
  if /I "%%A"=="arm64" set "ARCH_FLAGS=!ARCH_FLAGS! --arm64"
)
if "%ARCH_FLAGS%"=="" (
  echo Error: WINDOWS_ARCHES must include x64, ia32, and/or arm64.
  exit /b 1
)

echo ==^> Building Windows application for: %WINDOWS_ARCHES%
echo ==^> Using Electron %WINDOWS_ELECTRON_VERSION% for Windows 7 compatibility
call npm run build:web || exit /b 1
call npm run build:electron || exit /b 1
call npx electron-builder --win nsis %ARCH_FLAGS% -c.electronVersion=%WINDOWS_ELECTRON_VERSION% || exit /b 1

echo ==^> Package output
dir /b release\*.exe 2>nul
echo OK: Windows packaging finished

endlocal

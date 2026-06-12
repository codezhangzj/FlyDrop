@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0\.."

if "%WINDOWS_ELECTRON_VERSION%"=="" set "WINDOWS_ELECTRON_VERSION=33.4.11"
REM sharp 0.33.5 仅提供 win32 x64 / ia32 预编译二进制（无 win32-arm64）。
if "%WINDOWS_ARCHES%"=="" set "WINDOWS_ARCHES=x64"

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
set "SHARP_CPUS="
for %%A in (%WINDOWS_ARCHES%) do (
  if /I "%%A"=="x64" (
    set "ARCH_FLAGS=!ARCH_FLAGS! --x64"
    set "SHARP_CPUS=!SHARP_CPUS! x64"
  ) else if /I "%%A"=="ia32" (
    set "ARCH_FLAGS=!ARCH_FLAGS! --ia32"
    set "SHARP_CPUS=!SHARP_CPUS! ia32"
  ) else if /I "%%A"=="arm64" (
    echo Error: sharp 0.33.5 has no win32-arm64 prebuilt binary. Use x64 and/or ia32.
    exit /b 1
  ) else (
    echo Error: Unsupported Windows architecture: %%A. Use x64 and/or ia32.
    exit /b 1
  )
)
if "%ARCH_FLAGS%"=="" (
  echo Error: WINDOWS_ARCHES must include x64 and/or ia32.
  exit /b 1
)

echo ==^> Building Windows application for: %WINDOWS_ARCHES%
echo ==^> Using Electron %WINDOWS_ELECTRON_VERSION%
call npm run build:web || exit /b 1
call npm run build:electron || exit /b 1

REM 关键：为每个目标架构安装 win32 平台的 sharp 原生二进制。
REM npm 安装可选依赖时只装「当前平台/架构」对应的包，若不显式拉取，
REM node_modules 里可能缺少目标架构的 sharp 二进制，导致安装后报
REM "Could not load the sharp module using the win32-x64 runtime"。
for /f "delims=" %%V in ('node -p "require('./node_modules/sharp/package.json').version"') do set "SHARP_VERSION=%%V"
for %%C in (%SHARP_CPUS%) do (
  echo ==^> Installing sharp@!SHARP_VERSION! native binary for win32-%%C
  call npm install --no-save --os=win32 --cpu=%%C "sharp@!SHARP_VERSION!" || (
    echo Error: failed to install win32-%%C sharp binary. Check network/registry mirror and retry.
    exit /b 1
  )
)
for %%C in (%SHARP_CPUS%) do (
  if not exist "node_modules\@img\sharp-win32-%%C\lib\sharp-win32-%%C.node" (
    echo Error: @img/sharp-win32-%%C binary missing; packaged app would fail to launch.
    exit /b 1
  )
  echo OK: win32-%%C sharp binary in place
)

call npx electron-builder --win nsis %ARCH_FLAGS% -c.electronVersion=%WINDOWS_ELECTRON_VERSION% || exit /b 1

echo ==^> Package output
dir /b release\*.exe 2>nul
echo OK: Windows packaging finished

endlocal

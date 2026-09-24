@echo off
rem ============================================================================
rem  Build the Windows x64 Desktop application from this checkout.
rem
rem  Runs the repository's unsigned Windows x64 Desktop pipeline
rem  (package:desktop:win:x64:unsigned) and reports the artifacts it produced.
rem  The resulting installer is unsigned and carries no auto-update
rem  configuration.
rem
rem  Usage:
rem    build-windows.bat [clean] [run]
rem
rem    clean   Delete the target's build state first. The verified download
rem            cache under .desktop-build/downloads is kept, so a clean build
rem            does not re-download verified archives.
rem    run     Start the unpacked application after a successful build.
rem
rem  The application identifier defaults to com.deepseek.harness. Set
rem  DSH_DESKTOP_APP_ID before running to replace it, and set PYTHON when
rem  Python is absent from PATH.
rem
rem  The build bridges this machine's proxy into its child processes, since
rem  Node's fetch ignores the WinINET setting that other Windows tools follow.
rem  Only the single host:port registry form is adopted; set HTTP_PROXY and
rem  HTTPS_PROXY before running for per-protocol lists and PAC scripts.
rem
rem  The equivalent PowerShell entry point is scripts/build-windows.ps1.
rem ============================================================================

rem Delayed expansion keeps this process's command line out of the parsed text:
rem a literal expansion hands any "&" in the invoking command back to cmd.exe,
rem which then re-runs this script.
setlocal EnableExtensions EnableDelayedExpansion

set "PAUSEATEND=0"
set "CLEAN=0"
set "RUN=0"

rem Explorer launches a batch file as: cmd /c ""<path>" " -- with a trailing
rem space before the closing quote. A console invocation has no such tail.
echo(!cmdcmdline!| findstr /r /c:"\" \"$" >nul 2>nul
if not errorlevel 1 set "PAUSEATEND=1"

setlocal DisableDelayedExpansion

:parse
if "%~1"=="" goto :parsed
if /i "%~1"=="clean" set "CLEAN=1"
if /i "%~1"=="run" set "RUN=1"
if /i "%~1"=="-clean" set "CLEAN=1"
if /i "%~1"=="-run" set "RUN=1"
if /i "%~1"=="--clean" set "CLEAN=1"
if /i "%~1"=="--run" set "RUN=1"
shift
goto :parse
:parsed

if not defined DSH_DESKTOP_APP_ID set "DSH_DESKTOP_APP_ID=com.deepseek.harness"

where pnpm >nul 2>nul
if errorlevel 1 goto :no_pnpm
where node >nul 2>nul
if errorlevel 1 goto :no_node

pushd "%~dp0..\..\.." || goto :no_repo
set "REPO=%CD%"

set "TARGET=%REPO%\apps\desktop\.desktop-build\targets\win-x64"
set "ARTIFACTS=%TARGET%\unsigned-artifacts"
set "APP=%ARTIFACTS%\win-unpacked\DeepSeek Harness.exe"

if not defined HTTP_PROXY (
  for /f "tokens=2,*" %%A in ('reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyServer 2^>nul ^| findstr /r /c:"REG_SZ[ ]*[^=;]*:[0-9][0-9]*$"') do set "HTTP_PROXY=http://%%B"
)
if not defined HTTP_PROXY goto :proxy_bridged
if not defined HTTPS_PROXY set "HTTPS_PROXY=%HTTP_PROXY%"
set "NODE_USE_ENV_PROXY=1"
if defined NO_PROXY (set "NO_PROXY=localhost,127.0.0.1,::1,%NO_PROXY%") else (set "NO_PROXY=localhost,127.0.0.1,::1")
:proxy_bridged

echo Repository  : %REPO%
echo Application : %DSH_DESKTOP_APP_ID%
if defined PYTHON echo Python      : %PYTHON%
if defined HTTP_PROXY echo Proxy       : %HTTP_PROXY%
echo.

if "%CLEAN%"=="1" (
  echo ==^> Removing target build state at %TARGET%
  if exist "%TARGET%" rmdir /s /q "%TARGET%"
)

echo ==^> Building the unsigned Windows x64 installer
call pnpm run package:desktop:win:x64:unsigned
set "BUILD_STATUS=%errorlevel%"
if not "%BUILD_STATUS%"=="0" goto :build_failed

if not exist "%ARTIFACTS%\*.exe" goto :no_artifact

echo.
echo ==^> Artifacts
for %%F in ("%ARTIFACTS%\*.exe") do echo   installer : %%F
if exist "%APP%" echo   unpacked  : %APP%

if "%RUN%"=="1" (
  if not exist "%APP%" goto :no_app
  echo.
  echo ==^> Starting the unpacked application
  start "" "%APP%"
)

echo.
echo Desktop build completed.
popd
set "EXITCODE=0"
goto :finish

:no_pnpm
echo Desktop build failed: pnpm is not on PATH. 1>&2
set "EXITCODE=1"
goto :finish

:no_node
echo Desktop build failed: node is not on PATH. 1>&2
echo The build requires Node.js 22.19 or newer. 1>&2
set "EXITCODE=1"
goto :finish

:no_repo
echo Desktop build failed: cannot resolve the repository root from "%~dp0". 1>&2
set "EXITCODE=1"
goto :finish

:build_failed
echo Desktop build failed: package:desktop:win:x64:unsigned exited with %BUILD_STATUS%. 1>&2
popd
set "EXITCODE=%BUILD_STATUS%"
goto :finish

:no_artifact
echo Desktop build failed: no installer was produced under %ARTIFACTS%. 1>&2
popd
set "EXITCODE=1"
goto :finish

:no_app
echo Desktop build failed: unpacked application not found at %APP%. 1>&2
popd
set "EXITCODE=1"
goto :finish

:finish
if "%PAUSEATEND%"=="1" pause
exit /b %EXITCODE%

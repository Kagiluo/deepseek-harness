<#
.SYNOPSIS
Build the Windows x64 Desktop application from this checkout.

.DESCRIPTION
Runs the repository's unsigned Windows x64 Desktop pipeline
(`package:desktop:win:x64:unsigned`) and reports the artifacts it produced.

The pipeline builds the repository, packs the first-party dsh and private
Desktop Host production closures, prepares the bundled upstream Node.js and
pnpm executables, materializes `resources/dsh`, and creates an NSIS installer
under `apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts`.

Signing, notarization, and update hosting stay out of this command: the
resulting installer is unsigned and carries no auto-update configuration. Use
`package:desktop:win:x64` with the release environment when a signed artifact
is required.

The script runs under both Windows PowerShell 5.1 and PowerShell 7+, and
accepts either `powershell` or `pwsh` as the host.

.PARAMETER AppId
Reverse-DNS application identifier written into the packaged application
defaults. Every target requires this value.

.PARAMETER Python
Python 3 executable used by node-gyp for native module builds. When omitted the
script uses the `python` found on PATH.

.PARAMETER Clean
Delete the target's build state before building. The shared Node.js and
electron-builder download caches under `.desktop-build/downloads` are kept, so
a clean build does not re-download verified archives.

.PARAMETER Install
Run the produced installer silently after a successful build.

.PARAMETER Run
Start the unpacked application after a successful build.

.EXAMPLE
pwsh -NoProfile -File apps/desktop/scripts/build-windows.ps1

Build the installer with the default application identifier.

.EXAMPLE
pwsh -NoProfile -File apps/desktop/scripts/build-windows.ps1 -Clean -Run

Rebuild from scratch and launch the unpacked application.
#>
[CmdletBinding()]
param(
  [string]$AppId = 'com.deepseek.harness',
  [string]$Python,
  [switch]$Clean,
  [switch]$Install,
  [switch]$Run
)

$ErrorActionPreference = 'Stop'

$desktopRoot = Split-Path $PSScriptRoot -Parent
$repositoryRoot = Split-Path (Split-Path $desktopRoot -Parent) -Parent
$targetRoot = Join-Path $desktopRoot '.desktop-build/targets/win-x64'
$artifactRoot = Join-Path $targetRoot 'unsigned-artifacts'
$unpackedRoot = Join-Path $artifactRoot 'win-unpacked'
$executableName = 'DeepSeek Harness.exe'

function Write-Step([string]$Message) {
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Assert-BuildHost {
  # Windows PowerShell 5.1 has no $IsWindows automatic variable, so read the platform directly.
  if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
    throw 'This script builds the Windows target and requires a Windows build host.'
  }
  if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64') {
    throw "The Windows x64 target requires an x64 build host; found $env:PROCESSOR_ARCHITECTURE."
  }
  if ($null -eq (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    throw 'pnpm is not on PATH; install the package manager pinned by the root packageManager field.'
  }
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($null -eq $node) { throw 'node is not on PATH; the build requires Node.js ^22.19 || >=24.' }
  $nodeVersion = [string](& $node.Source -p 'process.versions.node')
  $major = [int]($nodeVersion.Split('.')[0])
  if ($major -lt 22) { throw "Node.js $nodeVersion is too old; the build requires ^22.19 || >=24." }
}

function Resolve-Python {
  if ($Python) {
    if (-not (Test-Path -LiteralPath $Python)) { throw "Python executable not found: $Python" }
    return (Resolve-Path -LiteralPath $Python).Path
  }
  $found = Get-Command python -ErrorAction SilentlyContinue
  if ($null -eq $found) {
    Write-Warning 'python is not on PATH; native module builds may fail. Pass -Python <executable>.'
    return $null
  }
  return $found.Source
}

function Invoke-DesktopBuild {
  Assert-BuildHost
  $env:DSH_DESKTOP_APP_ID = $AppId
  $pythonPath = Resolve-Python
  if ($pythonPath) { $env:PYTHON = $pythonPath }

  Write-Host "repository : $repositoryRoot"
  Write-Host "application: $AppId"
  if ($pythonPath) { Write-Host "python     : $pythonPath" }

  if ($Clean) {
    Write-Step "Removing target build state at $targetRoot"
    Remove-Item -LiteralPath $targetRoot -Recurse -Force -ErrorAction SilentlyContinue
  }

  Write-Step 'Building the unsigned Windows x64 installer'
  Push-Location $repositoryRoot
  try {
    & pnpm run package:desktop:win:x64:unsigned
    if ($LASTEXITCODE -ne 0) { throw "package:desktop:win:x64:unsigned exited with $LASTEXITCODE" }
  } finally {
    Pop-Location
  }

  $installers = @(Get-ChildItem -LiteralPath $artifactRoot -Filter '*.exe' -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notlike '*.blockmap' })
  if ($installers.Count -eq 0) { throw "No installer was produced under $artifactRoot" }

  Write-Step 'Artifacts'
  foreach ($installer in $installers) {
    Write-Host ("  installer : {0} ({1:N1} MB)" -f $installer.FullName, ($installer.Length / 1MB))
  }
  $application = Join-Path $unpackedRoot $executableName
  if (Test-Path -LiteralPath $application) {
    Write-Host "  unpacked  : $application"
  }

  if ($Install) {
    Write-Step 'Installing silently'
    & $installers[0].FullName /S
    if ($LASTEXITCODE -ne 0) { throw "Installer exited with $LASTEXITCODE" }
  }

  if ($Run) {
    if (-not (Test-Path -LiteralPath $application)) { throw "Unpacked application not found: $application" }
    Write-Step 'Starting the unpacked application'
    Start-Process -FilePath $application | Out-Null
  }

  Write-Host 'Desktop build completed.' -ForegroundColor Green
}

# Exit explicitly so the process status reports this script's outcome rather than
# whatever the last native command left behind.
$exitCode = 0
try {
  Invoke-DesktopBuild
} catch {
  Write-Host "Desktop build failed: $($_.Exception.Message)" -ForegroundColor Red
  $exitCode = 1
}
exit $exitCode

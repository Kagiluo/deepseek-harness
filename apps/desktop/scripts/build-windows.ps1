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

Downloads behind a network proxy need that proxy in the child environment:
Node's fetch reads `NODE_USE_ENV_PROXY` and `HTTP(S)_PROXY`, never the per-user
proxy setting that other Windows tools follow. The script bridges the configured
proxy into the build's child processes and keeps loopback direct.

The script runs under both Windows PowerShell 5.1 and PowerShell 7+, and
accepts either `powershell` or `pwsh` as the host.

.PARAMETER AppId
Reverse-DNS application identifier written into the packaged application
defaults. Every target requires this value.

.PARAMETER Python
Python 3 executable used by node-gyp for native module builds. When omitted the
script uses the `python` found on PATH.

.PARAMETER Proxy
HTTP proxy origin (for example `http://proxy.example.com:8080`) that the
build's downloads use. Replaces the per-user proxy setting.

.PARAMETER NoProxy
Ignore the per-user proxy setting.

.PARAMETER Clean
Delete the target's build state before building. The shared Node.js and
electron-builder download caches under `.desktop-build/downloads` are kept, so
a clean build does not re-download verified archives.

.PARAMETER Install
Run the produced installer silently after a successful build.

.PARAMETER Run
Start the unpacked application after a successful build.

.EXAMPLE
powershell -NoProfile -File apps/desktop/scripts/build-windows.ps1

Build the installer with the default application identifier.

.EXAMPLE
powershell -NoProfile -File apps/desktop/scripts/build-windows.ps1 -Clean -Run

Rebuild from scratch and launch the unpacked application.

.EXAMPLE
powershell -NoProfile -File apps/desktop/scripts/build-windows.ps1 -Proxy http://proxy.example.com:8080

Route the build's downloads through an explicit proxy.
#>
[CmdletBinding()]
param(
  [string]$AppId = 'com.deepseek.harness',
  [string]$Python,
  [string]$Proxy,
  [switch]$NoProxy,
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
  return $major
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

function Resolve-DownloadProxy {
  if ($Proxy) {
    $explicit = $null
    if (-not [uri]::TryCreate($Proxy, [System.UriKind]::Absolute, [ref]$explicit) -or $explicit.Scheme -notin @('http', 'https')) {
      throw "-Proxy expects an http or https origin; found '$Proxy'."
    }
    return $explicit.GetLeftPart([System.UriPartial]::Authority)
  }
  if ($NoProxy) { return $null }
  $settings = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue
  if ($null -eq $settings) { return $null }
  $configured = [string]$settings.ProxyServer
  if ([string]::IsNullOrWhiteSpace($configured)) {
    if (-not [string]::IsNullOrWhiteSpace([string]$settings.AutoConfigURL)) {
      Write-Host 'proxy      : this user resolves the proxy from a PAC script; pass -Proxy to route the build downloads through it.'
    }
    return $null
  }
  if ($configured.Contains('=')) {
    # WinINET also stores one entry per protocol, as in `http=host:port;https=...`.
    $entries = @{}
    foreach ($entry in $configured.Split(';')) {
      $pair = $entry.Split('=', 2)
      if ($pair.Count -eq 2) { $entries[$pair[0].Trim().ToLowerInvariant()] = $pair[1].Trim() }
    }
    $configured = if ($entries.ContainsKey('http')) { $entries['http'] } else { $entries['https'] }
  }
  if ([string]::IsNullOrWhiteSpace($configured)) { return $null }
  $ambient = $null
  if (-not [uri]::TryCreate("http://$($configured.Trim())", [System.UriKind]::Absolute, [ref]$ambient)) { return $null }
  return $ambient.GetLeftPart([System.UriPartial]::Authority)
}

function Use-DownloadProxy([string]$Origin) {
  if (-not $Origin) { return }
  $env:NODE_USE_ENV_PROXY = '1'
  $env:HTTP_PROXY = $Origin
  $env:HTTPS_PROXY = $Origin
  # The Desktop Host and the payload's own checks listen on loopback, which an
  # environment proxy would otherwise route to the proxy.
  $bypass = @('localhost', '127.0.0.1', '::1')
  foreach ($entry in @([string]$env:NO_PROXY -split ',')) {
    $trimmed = $entry.Trim()
    if ($trimmed -and ($bypass -notcontains $trimmed)) { $bypass += $trimmed }
  }
  $env:NO_PROXY = $bypass -join ','
}

function Invoke-DesktopBuild {
  $nodeMajor = Assert-BuildHost
  $env:DSH_DESKTOP_APP_ID = $AppId
  $pythonPath = Resolve-Python
  if ($pythonPath) { $env:PYTHON = $pythonPath }

  Write-Host "repository : $repositoryRoot"
  Write-Host "application: $AppId"
  if ($pythonPath) { Write-Host "python     : $pythonPath" }
  $proxyOrigin = Resolve-DownloadProxy
  if ($proxyOrigin) {
    if ($nodeMajor -lt 24) {
      Write-Warning "Node.js major $nodeMajor ignores NODE_USE_ENV_PROXY; only child tools that read HTTP_PROXY themselves use the proxy."
    }
    Use-DownloadProxy $proxyOrigin
    Write-Host "proxy      : $proxyOrigin (loopback direct)"
  }

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

<#
.SYNOPSIS
    Belgian eID Service — Installer for Windows

.DESCRIPTION
    Downloads and installs the eID service from GitHub Releases.

.EXAMPLE
    # Install latest version
    irm https://raw.githubusercontent.com/johancoppens/eid-service/main/install.ps1 | iex

    # Install with allowed origin
    .\install.ps1 -Origin "https://mijn-app.example.com"

    # Install specific version
    .\install.ps1 -Version "1.0.0"

    # Uninstall
    .\install.ps1 -Uninstall
#>

param(
    [string]$Origin,
    [string]$Version,
    [switch]$Uninstall,
    [switch]$Help
)

$ErrorActionPreference = "Stop"

# --- Defaults ---

$EidRepo = if ($env:EID_REPO) { $env:EID_REPO } else { "johancoppens/eid-service" }
$InstallDir = Join-Path $env:LOCALAPPDATA "eid-service"
$ConfigDir = Join-Path $env:APPDATA "eid-service"
$ConfigFile = Join-Path $ConfigDir "config.json"
$DefaultPort = 17365

# --- Helpers ---

function Write-Info  { param([string]$Msg) Write-Host "  ✓ $Msg" -ForegroundColor Green }
function Write-Warn  { param([string]$Msg) Write-Host "  ⚠  $Msg" -ForegroundColor Yellow }
function Write-Err   { param([string]$Msg) Write-Host "  ✗ $Msg" -ForegroundColor Red }
function Write-Fatal { param([string]$Msg) Write-Err $Msg; exit 1 }

# --- Help ---

if ($Help) {
    Write-Host @"

  eID Service Installer

  Usage:
    .\install.ps1                                    Install latest version
    .\install.ps1 -Origin "https://example.com"      Set allowed origin
    .\install.ps1 -Version "1.2.0"                   Install specific version
    .\install.ps1 -Uninstall                         Remove eID service

  Environment:
    EID_REPO    GitHub repo (default: johancoppens/eid-service)

"@
    exit 0
}

# --- Uninstall ---

if ($Uninstall) {
    Write-Host ""
    Write-Host "  eID Service — Uninstall" -ForegroundColor White
    Write-Host ""

    if (Test-Path $InstallDir) {
        Remove-Item -Recurse -Force $InstallDir
        Write-Info "Removed $InstallDir"
    } else {
        Write-Warn "Install directory not found: $InstallDir"
    }

    # Remove from PATH
    $UserPath = [Environment]::GetEnvironmentVariable("PATH", "User")
    if ($UserPath -and $UserPath.Contains($InstallDir)) {
        $NewPath = ($UserPath.Split(";") | Where-Object { $_ -ne $InstallDir }) -join ";"
        [Environment]::SetEnvironmentVariable("PATH", $NewPath, "User")
        Write-Info "Removed from PATH"
    }


    # Remove autostart registry key
    $RegPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
    if (Get-ItemProperty -Path $RegPath -Name "EidService" -ErrorAction SilentlyContinue) {
        Remove-ItemProperty -Path $RegPath -Name "EidService"
        Write-Info "Removed autostart registry key"
    }

    if (Test-Path $ConfigDir) {
        Write-Host ""
        $Confirm = Read-Host "  Remove configuration ($ConfigDir)? [y/N]"
        if ($Confirm -match "^[yY]") {
            Remove-Item -Recurse -Force $ConfigDir
            Write-Info "Removed $ConfigDir"
        } else {
            Write-Info "Configuration kept"
        }
    }

    Write-Host ""
    Write-Info "eID service uninstalled."
    Write-Host ""
    exit 0
}

# --- Detect architecture ---

$RawArch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
switch ($RawArch) {
    "X64"   { $Arch = "x64" }
    "Arm64" { $Arch = "arm64" }
    default { Write-Fatal "Unsupported architecture: $RawArch" }
}

# --- Resolve version ---

if (-not $Version) {
    Write-Host "  Fetching latest version..." -NoNewline
    try {
        $Release = Invoke-RestMethod -Uri "https://api.github.com/repos/$EidRepo/releases/latest" -Headers @{ "User-Agent" = "eid-installer" }
        $Version = $Release.tag_name -replace "^v", ""
    } catch {
        Write-Fatal "Could not determine latest version. Use -Version to specify."
    }
    Write-Host " v$Version"
} else {
    $Version = $Version -replace "^v", ""
}

# --- Main ---

Write-Host ""
Write-Host "  eID Service — Installer" -ForegroundColor White
Write-Host "  ========================" -ForegroundColor White
Write-Host ""

Write-Info "Platform: windows/$Arch"
Write-Info "Version:  v$Version"
Write-Host ""

# --- Download and extract ---

$Archive = "eid-service-windows-$Arch.zip"
$DownloadUrl = "https://github.com/$EidRepo/releases/download/v$Version/$Archive"
$TmpDir = Join-Path $env:TEMP "eid-service-install"
$TmpZip = Join-Path $TmpDir $Archive

try {
    if (Test-Path $TmpDir) { Remove-Item -Recurse -Force $TmpDir }
    New-Item -ItemType Directory -Path $TmpDir -Force | Out-Null

    Write-Host "  Downloading $Archive..."
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $TmpZip -UseBasicParsing

    Write-Host "  Extracting..."
    if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Expand-Archive -Path $TmpZip -DestinationPath $InstallDir -Force

    Write-Info "Installed to $InstallDir\"
} catch {
    Write-Fatal "Download failed. Check that version v$Version exists at:`n    https://github.com/$EidRepo/releases"
} finally {
    if (Test-Path $TmpDir) { Remove-Item -Recurse -Force $TmpDir }
}

# --- Configure ---

Write-Host ""
New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null


# --- Allowed origins ---

$OriginsJson = "[]"

if ($Origin) {
    # From -Origin parameter
    $OriginList = $Origin.Split(",") | ForEach-Object { $_.Trim().TrimEnd("/") } | Where-Object { $_ }
    $OriginsJson = "[" + (($OriginList | ForEach-Object { "`"$_`"" }) -join ",") + "]"
    Write-Info "Origins configured: $OriginsJson"
} elseif ([Environment]::UserInteractive) {
    # Interactive prompt
    Write-Host ""
    Write-Host "  Which website(s) may use the eID service?"
    Write-Host "  Enter full URL(s), e.g. https://mijn-app.example.com"
    Write-Host "  Separate multiple origins with commas."
    Write-Host "  Leave empty to allow all origins (development only)."
    Write-Host ""

    if (Test-Path $ConfigFile) {
        try {
            $Cfg = Get-Content $ConfigFile -Raw | ConvertFrom-Json
            if ($Cfg.allowedOrigins -and $Cfg.allowedOrigins.Count -gt 0) {
                Write-Host "  Current: $($Cfg.allowedOrigins -join ', ')"
            }
        } catch {}
    }

    $OriginsInput = Read-Host "  Origin(s)"

    if ($OriginsInput) {
        $OriginList = $OriginsInput.Split(",") | ForEach-Object { $_.Trim().TrimEnd("/") } | Where-Object { $_ }
        $OriginsJson = "[" + (($OriginList | ForEach-Object { "`"$_`"" }) -join ",") + "]"
        Write-Info "Origins configured: $OriginsJson"
    } else {
        Write-Warn "No origins configured — all origins allowed (development mode)"
    }
}

# Write config
$ConfigContent = @"
{
  "port": $DefaultPort,
  "allowedOrigins": $OriginsJson
}
"@
Set-Content -Path $ConfigFile -Value $ConfigContent -Encoding UTF8
Write-Info "Config saved: $ConfigFile"

# --- Add to PATH ---

Write-Host ""
$UserPath = [Environment]::GetEnvironmentVariable("PATH", "User")
if (-not $UserPath.Contains($InstallDir)) {
    [Environment]::SetEnvironmentVariable("PATH", "$InstallDir;$UserPath", "User")
    Write-Info "Added to PATH (restart terminal to take effect)"
} else {
    Write-Info "Already in PATH"
}

# --- Autostart ---

$ExePath = Join-Path $InstallDir "eid-service.exe"
$RegPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
Set-ItemProperty -Path $RegPath -Name "EidService" -Value "`"$ExePath`""
Write-Info "Autostart enabled (registry)"

# Start the service now
$Existing = Get-Process -Name "eid-service" -ErrorAction SilentlyContinue
if ($Existing) {
    Stop-Process -Name "eid-service" -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
}
Start-Process -FilePath $ExePath -WindowStyle Hidden
Write-Info "Service is running"

Write-Host ""
Write-Host "  Port:        $DefaultPort"
Write-Host ""

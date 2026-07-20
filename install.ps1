#Requires -Version 5.1
[CmdletBinding()]
param(
    [switch]$Silent,
    [switch]$DownloadOnly,
    [string]$DownloadDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repo = "basebuild-net/basebuild"
$asset = "Basebuild-windows-x86_64-setup.exe"
$downloadUri = "https://github.com/$repo/releases/latest/download/$asset"

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw "install.ps1 supports Windows only. Use install.sh on Linux or macOS."
}

# Detect the OS architecture from environment variables. Avoid
# [RuntimeInformation]::OSArchitecture: on some Windows PowerShell 5.1 / older
# .NET Framework builds that property is missing, and Set-StrictMode -Version
# Latest turns the missing member into a hard "property cannot be found"
# failure that aborts the whole `irm ... | iex` install. PROCESSOR_ARCHITEW6432
# carries the real architecture when a 32-bit shell runs on 64-bit Windows
# (WOW64); otherwise PROCESSOR_ARCHITECTURE is authoritative.
$architecture = if ($env:PROCESSOR_ARCHITEW6432) {
    $env:PROCESSOR_ARCHITEW6432
}
else {
    $env:PROCESSOR_ARCHITECTURE
}
if ($architecture -ne "AMD64") {
    throw "Basebuild currently publishes Windows x64 releases only; detected $architecture."
}

$ownsDownloadDirectory = [string]::IsNullOrWhiteSpace($DownloadDirectory) -and -not $DownloadOnly
if ([string]::IsNullOrWhiteSpace($DownloadDirectory)) {
    $DownloadDirectory = if ($DownloadOnly) {
        (Get-Location).Path
    }
    else {
        Join-Path ([IO.Path]::GetTempPath()) ("basebuild-install-" + [Guid]::NewGuid().ToString("N"))
    }
}

$DownloadDirectory = [IO.Path]::GetFullPath($DownloadDirectory)
$installerPath = Join-Path $DownloadDirectory $asset
New-Item -ItemType Directory -Path $DownloadDirectory -Force | Out-Null

function Save-LatestInstaller {
    param([string]$Path)

    try {
        Invoke-WebRequest -Uri $downloadUri -OutFile $Path -UseBasicParsing
        return
    }
    catch {
        # Releases published before stable asset names used the embedded
        # version in the Windows filename. Keep the latest installer usable
        # during the migration to the cross-platform pipeline.
        $headers = @{ "User-Agent" = "Basebuild installer" }
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest" -Headers $headers
        $candidates = @(
            $release.assets | Where-Object {
                $_.name -eq $asset -or $_.name -match '^Basebuild_[0-9]+\.[0-9]+\.[0-9]+_x64-setup\.exe$'
            }
        )
        if ($candidates.Count -eq 0) {
            throw "The latest Basebuild release has no Windows x64 installer."
        }
        $fallbackUri = [Uri]$candidates[0].browser_download_url
        if ($fallbackUri.Scheme -ne "https" -or $fallbackUri.Host -ne "github.com") {
            throw "GitHub returned an unexpected installer URL: $fallbackUri"
        }
        Invoke-WebRequest -Uri $fallbackUri -OutFile $Path -UseBasicParsing
    }
}

try {
    Write-Host "Downloading the latest Basebuild release..."
    Save-LatestInstaller -Path $installerPath

    $file = Get-Item -LiteralPath $installerPath
    if ($file.Length -lt 100KB) {
        throw "Downloaded installer is unexpectedly small ($($file.Length) bytes)."
    }

    $stream = [IO.File]::OpenRead($installerPath)
    try {
        if ($stream.ReadByte() -ne 0x4D -or $stream.ReadByte() -ne 0x5A) {
            throw "Downloaded file is not a Windows executable."
        }
    }
    finally {
        $stream.Dispose()
    }

    if ($DownloadOnly) {
        Write-Host "Downloaded the latest Basebuild installer to $installerPath"
        return
    }

    if ($Silent) {
        $process = Start-Process -FilePath $installerPath -ArgumentList "/S" -Wait -PassThru
    }
    else {
        $process = Start-Process -FilePath $installerPath -Wait -PassThru
    }
    if ($process.ExitCode -ne 0) {
        throw "Basebuild installer exited with code $($process.ExitCode)."
    }

    Write-Host "Basebuild installed successfully."
}
finally {
    if ($ownsDownloadDirectory -and (Test-Path -LiteralPath $DownloadDirectory)) {
        Remove-Item -LiteralPath $DownloadDirectory -Recurse -Force
    }
}

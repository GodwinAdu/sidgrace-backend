<#
  One-time setup of the print relay on the HOST PC (the one running the backend).
  Run as Administrator:
      powershell -ExecutionPolicy Bypass -File scripts\setup-print-relay.ps1
      powershell -ExecutionPolicy Bypass -File scripts\setup-print-relay.ps1 -Ip 192.168.1.214

  What it does:
   1. Creates a self-signed HTTPS certificate for this PC's LAN IP (+ localhost).
      It is an end-entity certificate (CA=false): it can identify the relay only and
      cannot be used to sign certificates for any other website.
   2. Saves it to certs\print-relay.pfx (private key, password-protected, git-ignored)
      and certs\print-relay.cer (public part, for the other clinic PCs).
   3. Trusts it on this PC (Local Machine > Trusted Root) so Chrome/Edge accept it.
   4. Opens TCP 5443 in Windows Firewall (Private networks) for the other clinic PCs.
   5. Writes PRINT_RELAY_PFX_PASSPHRASE into .env.
  Re-run it if the host PC's IP address changes, then re-run install-print-cert.cmd on
  the other PCs.
#>
param(
    [string]$Ip,
    [int]$Port = 5443
)
$ErrorActionPreference = "Stop"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Write-Host "Please run this script as Administrator." -ForegroundColor Red; exit 1 }

$root = Split-Path -Parent $PSScriptRoot
$certDir = Join-Path $root "certs"
New-Item -ItemType Directory -Path $certDir -Force | Out-Null

if (-not $Ip) {
    $Ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -like "192.168.*" -or $_.IPAddress -like "10.*" -or $_.IPAddress -like "172.*" } |
        Where-Object { $_.PrefixOrigin -ne "WellKnown" } | Select-Object -First 1).IPAddress
}
if (-not $Ip) { Write-Host "Could not detect the LAN IP. Pass it with -Ip 192.168.x.x" -ForegroundColor Red; exit 1 }
Write-Host "Host LAN IP: $Ip"

$subject = "CN=SidGrace Print Relay"

# Remove certificates from earlier runs
Get-ChildItem Cert:\LocalMachine\Root, Cert:\LocalMachine\My | Where-Object { $_.Subject -eq $subject } | Remove-Item -Force -ErrorAction SilentlyContinue

$cert = New-SelfSignedCertificate `
    -Subject $subject `
    -FriendlyName "SidGrace Print Relay ($Ip)" `
    -Type SSLServerAuthentication `
    -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 `
    -KeyUsage DigitalSignature, KeyEncipherment `
    -KeyExportPolicy Exportable `
    -NotAfter (Get-Date).AddYears(5) `
    -CertStoreLocation Cert:\LocalMachine\My `
    -TextExtension @(
        "2.5.29.17={text}IPAddress=$Ip&IPAddress=127.0.0.1&DNS=localhost",
        "2.5.29.19={critical}{text}ca=false"
    )

# Random passphrase for the .pfx
$bytes = New-Object byte[] 24
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$pass = -join ($bytes | ForEach-Object { $_.ToString("x2") })
$secure = ConvertTo-SecureString $pass -AsPlainText -Force

$pfxPath = Join-Path $certDir "print-relay.pfx"
$cerPath = Join-Path $certDir "print-relay.cer"
Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $secure | Out-Null
Export-Certificate -Cert $cert -FilePath $cerPath | Out-Null

# Keep the private key only in the .pfx file; trust the public part on this PC.
Remove-Item "Cert:\LocalMachine\My\$($cert.Thumbprint)" -Force
Import-Certificate -FilePath $cerPath -CertStoreLocation Cert:\LocalMachine\Root | Out-Null

# Only the backend's service account (this user) and Administrators should read the key.
icacls $pfxPath /inheritance:r /grant:r "$($env:USERNAME):(R,W)" "Administrators:(F)" "SYSTEM:(F)" | Out-Null

# Firewall: let other clinic PCs reach the relay (private network only)
if (-not (Get-NetFirewallRule -DisplayName "SidGrace Print Relay $Port" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName "SidGrace Print Relay $Port" -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Private, Domain | Out-Null
}

# Store the passphrase in .env (replace any previous value)
$envPath = Join-Path $root ".env"
$lines = if (Test-Path $envPath) { Get-Content $envPath } else { @() }
$lines = $lines | Where-Object { $_ -notmatch '^PRINT_RELAY_PFX_PASSPHRASE=' }
$lines += "PRINT_RELAY_PFX_PASSPHRASE=$pass"
Set-Content -Path $envPath -Value $lines -Encoding utf8

Write-Host ""
Write-Host "Print relay certificate ready." -ForegroundColor Green
Write-Host "  URL for the app:   https://${Ip}:$Port"
Write-Host "  Thumbprint:        $($cert.Thumbprint)   (compare on the other PCs)"
Write-Host "  Public cert:       $cerPath"
Write-Host ""
Write-Host "Next: restart the backend, then on every OTHER PC that prints from the online app,"
Write-Host "run scripts\install-print-cert.cmd as Administrator."

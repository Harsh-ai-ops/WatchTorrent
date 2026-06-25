# WatchTorrent — one-click watch-party host.
# Runs the server on THIS machine (so torrents actually work) and tries to open
# a free public link to share. Designed to NEVER close silently: any error is
# shown and the window waits for you.

$ErrorActionPreference = 'Continue'   # don't die on the first error
$root = $PSScriptRoot
if (-not $root) { $root = Split-Path -Parent $MyInvocation.MyCommand.Path }
Set-Location $root

function Banner($text, $color) {
  Write-Host ""
  Write-Host "  ============================================" -ForegroundColor $color
  Write-Host "     $text" -ForegroundColor $color
  Write-Host "  ============================================" -ForegroundColor $color
}

$server = $null
$tunnel = $null

try {
  Banner "WatchTorrent — hosting a watch party" "Magenta"

  # --- Node.js required ---
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "`n  Node.js isn't installed." -ForegroundColor Red
    Write-Host "  Install the LTS build from https://nodejs.org, then run this again."
    return
  }
  Write-Host "  node: $((Get-Command node).Source)" -ForegroundColor DarkGray

  # --- Free a stuck port 3000 from a previous run ---
  $busy = Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue
  if ($busy) {
    Write-Host "  Port 3000 was busy — stopping the previous server..." -ForegroundColor Yellow
    $busy | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
  }

  # --- First run: install deps + build the UI (only once) ---
  if (-not (Test-Path "$root\client\dist\index.html")) {
    Banner "First-time setup — a few minutes, only happens once" "Cyan"
    Push-Location "$root\server"; & npm install --no-audit --no-fund; Pop-Location
    Push-Location "$root\client"; & npm install --no-audit --no-fund; & npm run build; Pop-Location
    if (-not (Test-Path "$root\client\dist\index.html")) {
      Write-Host "`n  Setup failed (see messages above). Make sure you have internet and try again." -ForegroundColor Red
      return
    }
  }

  # --- Start the server FIRST so the app works even if the public link fails ---
  Write-Host "`n  Starting the server..." -ForegroundColor Cyan
  $server = Start-Process node -ArgumentList "server/index.js" -WorkingDirectory $root -PassThru -WindowStyle Hidden `
            -RedirectStandardOutput "$root\.server.log" -RedirectStandardError "$root\.server.err.log"
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    try { if ((Invoke-WebRequest "http://localhost:3000/api/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { $ready = $true; break } } catch { }
  }
  if (-not $ready) {
    Write-Host "`n  The server didn't start. Error detail:" -ForegroundColor Red
    Get-Content "$root\.server.err.log" -ErrorAction SilentlyContinue | Select-Object -Last 15
    return
  }
  Write-Host "  Server is up on http://localhost:3000" -ForegroundColor Green

  # --- Try to get a free public link (cloudflared). All optional. ---
  $cf = "$root\cloudflared.exe"
  if ((Test-Path $cf) -and ((Get-Item $cf).Length -lt 1MB)) { Remove-Item $cf -Force -ErrorAction SilentlyContinue }
  if (-not (Test-Path $cf)) {
    Write-Host "`n  Downloading the public-link tool (one time)..." -ForegroundColor Cyan
    $url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
    # Prefer Windows' built-in curl.exe (handles redirects + proxies well), fall back to Invoke-WebRequest.
    try { & curl.exe -L --ssl-no-revoke -o $cf $url 2>$null } catch { }
    if (-not (Test-Path $cf) -or (Get-Item $cf).Length -lt 1MB) {
      try { $pp = $ProgressPreference; $ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest $url -OutFile $cf -UseBasicParsing; $ProgressPreference = $pp } catch { }
    }
    if (Test-Path $cf) { Unblock-File $cf -ErrorAction SilentlyContinue }
  }

  $publicUrl = "http://localhost:3000"
  if ((Test-Path $cf) -and ((Get-Item $cf).Length -gt 1MB)) {
    Write-Host "  Creating your public link..." -ForegroundColor Cyan
    $tlog = "$root\.tunnel.log"; $telog = "$root\.tunnel.err.log"
    foreach ($f in @($tlog, $telog)) { if (Test-Path $f) { Remove-Item $f -Force -ErrorAction SilentlyContinue } }
    try {
      $tunnel = Start-Process $cf -ArgumentList "tunnel --url http://localhost:3000 --no-autoupdate" -WorkingDirectory $root -PassThru -WindowStyle Hidden `
                -RedirectStandardOutput $tlog -RedirectStandardError $telog
      for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Seconds 1
        $c = (Get-Content $tlog, $telog -Raw -ErrorAction SilentlyContinue) -join "`n"
        if ($c -match 'https://[a-z0-9-]+\.trycloudflare\.com') { $publicUrl = $matches[0]; break }
      }
    } catch { Write-Host "  Couldn't start the tunnel: $($_.Exception.Message)" -ForegroundColor Yellow }
  } else {
    Write-Host "  (Couldn't get the link tool — running locally only. Friends on your" -ForegroundColor Yellow
    Write-Host "   Wi-Fi can still use http://YOUR-PC-IP:3000)" -ForegroundColor Yellow
  }

  # --- Show + open ---
  Banner "YOUR WATCH PARTY IS LIVE" "Green"
  Write-Host ""
  if ($publicUrl -like 'http://localhost*') {
    Write-Host "   Open on this PC:  $publicUrl" -ForegroundColor White
  } else {
    Write-Host "   Share THIS link with your friends:"
    Write-Host "     $publicUrl" -ForegroundColor White
  }
  Write-Host ""
  Write-Host "   1. The app is opening in your browser."
  Write-Host "   2. Create a Room, paste your magnet / torrent."
  Write-Host "   3. Click 'Invite' to copy the room link -> send it to friends."
  Write-Host ""
  Write-Host "   Keep this window OPEN during the party." -ForegroundColor Yellow
  Start-Process $publicUrl
}
catch {
  Write-Host "`n  Something went wrong:" -ForegroundColor Red
  Write-Host "  $($_.Exception.Message)" -ForegroundColor Red
}
finally {
  Write-Host ""
  Read-Host "  >>> Press Enter to STOP the server and exit"
  if ($tunnel -and -not $tunnel.HasExited) { Stop-Process $tunnel.Id -Force -ErrorAction SilentlyContinue }
  if ($server -and -not $server.HasExited) { Stop-Process $server.Id -Force -ErrorAction SilentlyContinue }
}

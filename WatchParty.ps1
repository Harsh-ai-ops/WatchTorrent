# WatchTorrent — one-click watch-party host.
# Runs the server on THIS machine (so torrents actually work) and opens a free
# public link to share with friends. No terminal commands needed — just run it.

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location $root

function Banner($text, $color) {
  Write-Host ""
  Write-Host "  ============================================" -ForegroundColor $color
  Write-Host "     $text" -ForegroundColor $color
  Write-Host "  ============================================" -ForegroundColor $color
}

Banner "WatchTorrent — hosting a watch party" "Magenta"

# --- Node.js required ---
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host ""
  Write-Host "  Node.js isn't installed." -ForegroundColor Red
  Write-Host "  Install the LTS version from https://nodejs.org, then run this again."
  Read-Host "  Press Enter to exit"
  exit 1
}

# --- First run: install dependencies + build the UI (only once) ---
if (-not (Test-Path "$root\client\dist\index.html")) {
  Banner "First-time setup — a few minutes, only happens once" "Cyan"
  Push-Location "$root\server"; npm install --no-audit --no-fund; Pop-Location
  Push-Location "$root\client"; npm install --no-audit --no-fund; npm run build; Pop-Location
}

# --- Free public tunnel tool (no account needed) ---
$cf = "$root\cloudflared.exe"
if (-not (Test-Path $cf)) {
  Write-Host ""
  Write-Host "  Downloading the link tool (one time)..." -ForegroundColor Cyan
  try {
    Invoke-WebRequest "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile $cf -UseBasicParsing
  } catch {
    Write-Host "  Couldn't download it ($_). Friends won't get a public link, but local play still works." -ForegroundColor Yellow
  }
}

# --- Start the server ---
Write-Host ""
Write-Host "  Starting the server..." -ForegroundColor Cyan
$server = Start-Process node -ArgumentList "server/index.js" -WorkingDirectory $root -PassThru -WindowStyle Hidden `
  -RedirectStandardOutput "$root\.server.log" -RedirectStandardError "$root\.server.err.log"

$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  try { if ((Invoke-WebRequest "http://localhost:3000/api/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { $ready = $true; break } } catch { }
}
if (-not $ready) {
  Write-Host "  The server didn't start — see .server.err.log" -ForegroundColor Red
  if ($server -and -not $server.HasExited) { Stop-Process $server.Id -Force -ErrorAction SilentlyContinue }
  Read-Host "  Press Enter to exit"; exit 1
}

# --- Open the public tunnel and grab the URL ---
$publicUrl = "http://localhost:3000"
$tunnel = $null
if (Test-Path $cf) {
  Write-Host "  Creating your public link..." -ForegroundColor Cyan
  $tlog = "$root\.tunnel.log"; $telog = "$root\.tunnel.err.log"
  foreach ($f in @($tlog, $telog)) { if (Test-Path $f) { Remove-Item $f -Force -ErrorAction SilentlyContinue } }
  $tunnel = Start-Process $cf -ArgumentList "tunnel --url http://localhost:3000 --no-autoupdate" -WorkingDirectory $root -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $tlog -RedirectStandardError $telog
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    $c = (Get-Content $tlog, $telog -Raw -ErrorAction SilentlyContinue) -join "`n"
    if ($c -match 'https://[a-z0-9-]+\.trycloudflare\.com') { $publicUrl = $matches[0]; break }
  }
}

# --- Show the link + open the app ---
Banner "YOUR WATCH PARTY IS LIVE" "Green"
Write-Host ""
Write-Host "   Share THIS link with your friends:"
Write-Host "     $publicUrl" -ForegroundColor White
Write-Host ""
Write-Host "   How it works:"
Write-Host "     1. The app just opened in your browser."
Write-Host "     2. Click 'Create a Room' and paste your magnet / torrent link."
Write-Host "     3. Click the 'Invite' button to copy the room link — send it to friends."
Write-Host "        (They click it and drop straight into your room.)"
Write-Host ""
Write-Host "   Keep this window OPEN for the whole party." -ForegroundColor Yellow
Write-Host ""
Start-Process $publicUrl
Read-Host "   >>> Press Enter here to END the watch party"

# --- Cleanup ---
Write-Host "  Shutting down..."
if ($tunnel -and -not $tunnel.HasExited) { Stop-Process $tunnel.Id -Force -ErrorAction SilentlyContinue }
if ($server -and -not $server.HasExited) { Stop-Process $server.Id -Force -ErrorAction SilentlyContinue }

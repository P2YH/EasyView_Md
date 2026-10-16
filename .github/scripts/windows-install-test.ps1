# Installs the Squirrel Setup.exe the way a user does (no --silent, so Update.exe builds its progress
# window and loads setupIcon through WPF), smoke-launches the installed app, then uninstalls it.
# Install + launch + uninstall MUST stay in one GHA step (see windows-smoke-launch.ps1).
param(
  [Parameter(Mandatory = $true)][string]$SetupPath,
  [Parameter(Mandatory = $true)][string]$ExpectedVersion,
  [Parameter(Mandatory = $true)][string]$SetupIconPath,
  [Parameter(Mandatory = $true)][string]$TestFile,
  [Parameter(Mandatory = $false)][string]$LogsDir = "logs-install",
  [Parameter(Mandatory = $false)][int]$InstallTimeoutSeconds = 300
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null
$LogsDir = (Resolve-Path $LogsDir).Path
$SetupPath = (Resolve-Path $SetupPath).Path
$installRoot = Join-Path $env:LOCALAPPDATA "easyview_md"
$appDir = Join-Path $installRoot "app-$ExpectedVersion"
$stubExe = Join-Path $installRoot "EasyView_Md.exe"
$progIdKey = "HKCU:\Software\Classes\EasyViewMd.Markdown"
$failures = New-Object System.Collections.Generic.List[string]

function Save-InstallerLogs {
  foreach ($log in @(
    (Join-Path $env:LOCALAPPDATA "SquirrelTemp\Squirrel-Install.log"),
    (Join-Path $installRoot "Squirrel-Shortcut.log"),
    (Join-Path $installRoot "Squirrel-Uninstall.log"),
    (Join-Path $appDir "Squirrel-UpdateSelf.log")
  )) {
    if (Test-Path $log) { Copy-Item $log (Join-Path $LogsDir (Split-Path $log -Leaf)) -Force }
  }
}

function Get-InstallerCrashes([datetime]$Since) {
  Get-WinEvent -FilterHashtable @{ LogName = 'Application'; StartTime = $Since } -ErrorAction SilentlyContinue |
    Where-Object {
      ($_.ProviderName -in '.NET Runtime', 'Application Error', 'Windows Error Reporting') -and
      ($_.Message -match 'Update\.exe|Setup\.exe|Squirrel|EasyView_Md\.exe')
    }
}

function Stop-InstallerProcesses {
  Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -in 'EasyView_Md', 'Update', 'Squirrel' -or $_.Path -eq $SetupPath } |
    Stop-Process -Force -ErrorAction SilentlyContinue
}

Write-Host "=== 1. setupIcon must decode with WPF (Update.exe loads it via BitmapFrame) ==="
Add-Type -AssemblyName PresentationCore
try {
  $frame = [System.Windows.Media.Imaging.BitmapFrame]::Create([Uri](Resolve-Path $SetupIconPath).Path)
  Write-Host "OK: $($frame.Decoder.Frames.Count) frames"
}
catch {
  throw "setupIcon $SetupIconPath cannot be decoded by WPF; Setup.exe would crash on user machines: $($_.Exception.InnerException.Message)"
}

Write-Host "=== 2. Install $SetupPath (interactive mode) ==="
if (Test-Path $installRoot) { throw "Install directory already exists before the test: $installRoot" }
$started = Get-Date
$setup = Start-Process -FilePath $SetupPath -PassThru
if (-not $setup.WaitForExit($InstallTimeoutSeconds * 1000)) {
  $failures.Add("Setup.exe did not exit within ${InstallTimeoutSeconds}s (an installer error dialog is likely waiting)")
  Stop-InstallerProcesses
}
elseif ($setup.ExitCode -ne 0) {
  $failures.Add("Setup.exe exited with code $($setup.ExitCode)")
}
Write-Host "Setup.exe finished after $([int]((Get-Date) - $started).TotalSeconds)s"

# Squirrel hooks (shortcuts, file association) may keep running after Setup.exe exits.
$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $deadline -and -not ((Test-Path $stubExe) -and (Test-Path $progIdKey))) { Start-Sleep -Seconds 2 }

Save-InstallerLogs
$crashes = @(Get-InstallerCrashes $started)
$crashes | Format-List TimeCreated, ProviderName, Id, Message | Out-String -Width 400 | Out-File (Join-Path $LogsDir "installer-events.txt") -Encoding utf8
if ($crashes.Count -gt 0) { $failures.Add("Installer/app crash events were logged: $($crashes.Count) (see installer-events.txt)") }
if (-not (Test-Path (Join-Path $appDir "EasyView_Md.exe"))) { $failures.Add("Missing $appDir\EasyView_Md.exe") }
if (-not (Test-Path $stubExe)) { $failures.Add("Missing execution stub $stubExe") }
if (-not (Test-Path (Join-Path $installRoot "Update.exe"))) { $failures.Add("Missing $installRoot\Update.exe") }
if (-not (Test-Path $progIdKey)) { $failures.Add("Squirrel install hook did not register $progIdKey") }

if ($failures.Count -gt 0) {
  Get-ChildItem $LogsDir -Filter *.log | ForEach-Object { Write-Host "--- $($_.Name) ---"; Get-Content $_.FullName }
  Get-Content (Join-Path $LogsDir "installer-events.txt")
  Stop-InstallerProcesses
  throw "Installer test failed:`n - $($failures -join "`n - ")"
}
Write-Host "Installed $ExpectedVersion into $installRoot"

Write-Host "=== 3. Launch the installed app ==="
# Squirrel starts the app after a first install; the smoke test needs its own instance.
# The stub only forwards to app-<version>\EasyView_Md.exe and exits, so watch the installed binary.
Stop-InstallerProcesses
Start-Sleep -Seconds 2
& (Join-Path $PSScriptRoot "windows-smoke-launch.ps1") -ExePath (Join-Path $appDir "EasyView_Md.exe") -TestFile $TestFile -LogsDir (Join-Path $LogsDir "launch") -WaitSeconds 25 -JobLabel "installed-app"
if ($LASTEXITCODE -ne 0) { throw "Installed app smoke test failed" }

Write-Host "=== 4. Uninstall ==="
Stop-InstallerProcesses
$uninstall = Start-Process -FilePath (Join-Path $installRoot "Update.exe") -ArgumentList "--uninstall" -PassThru
if (-not $uninstall.WaitForExit(120000)) { Stop-InstallerProcesses; throw "Uninstall did not finish within 120s" }
$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline -and (Test-Path $progIdKey)) { Start-Sleep -Seconds 2 }
Save-InstallerLogs
if ($uninstall.ExitCode -ne 0) { throw "Update.exe --uninstall exited with code $($uninstall.ExitCode)" }
if (Test-Path $progIdKey) { throw "Squirrel uninstall hook did not remove $progIdKey" }

Write-Host "Installer test passed for $ExpectedVersion"
exit 0

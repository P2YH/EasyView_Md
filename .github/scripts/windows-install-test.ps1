# Installs the NSIS setup in both scopes ("only for me" = /currentuser, "all users" = /allusers), each into
# a custom directory with spaces, verifies files / uninstall entry / "Open with" keys / shortcuts,
# smoke-launches the installed app, uninstalls silently and verifies the cleanup.
# Install + launch + uninstall MUST stay in one GHA step (see windows-smoke-launch.ps1).
param(
  [Parameter(Mandatory = $true)][string]$SetupPath,
  [Parameter(Mandatory = $true)][string]$ExpectedVersion,
  [Parameter(Mandatory = $true)][string]$TestFile,
  [Parameter(Mandatory = $false)][string]$LogsDir = "logs-install",
  [Parameter(Mandatory = $false)][string[]]$Modes = @("currentuser", "allusers"),
  [Parameter(Mandatory = $false)][int]$TimeoutSeconds = 300
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null
$LogsDir = (Resolve-Path $LogsDir).Path
$SetupPath = (Resolve-Path $SetupPath).Path
$TestFile = (Resolve-Path $TestFile).Path
$progId = "EasyViewMd.Markdown"
$extensions = @(".md", ".markdown", ".mdx")
$shell = New-Object -ComObject WScript.Shell

function Get-ModeLayout([string]$Mode) {
  $base = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { $env:TEMP }
  if ($Mode -eq "allusers") {
    return @{
      Dir        = Join-Path $base "EasyView Md all users"
      Hive       = "HKLM:"
      Uninstall  = @("HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall", "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall")
      StartMenu  = Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\EasyView_Md.lnk"
      Desktop    = Join-Path $env:PUBLIC "Desktop\EasyView_Md.lnk"
    }
  }
  return @{
    Dir        = Join-Path $base "EasyView Md only me"
    Hive       = "HKCU:"
    Uninstall  = @("HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall")
    StartMenu  = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\EasyView_Md.lnk"
    Desktop    = Join-Path ([Environment]::GetFolderPath("Desktop")) "EasyView_Md.lnk"
  }
}

function Get-UninstallEntry($Layout) {
  foreach ($root in $Layout.Uninstall) {
    if (-not (Test-Path $root)) { continue }
    $entry = Get-ChildItem $root -ErrorAction SilentlyContinue |
      ForEach-Object { Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue } |
      Where-Object { $_.DisplayName -like "EasyView_Md*" } |
      Select-Object -First 1
    if ($entry) { return $entry }
  }
  return $null
}

function Get-DefaultValue([string]$Key) {
  if (-not (Test-Path $Key)) { return $null }
  return (Get-Item $Key).GetValue("")
}

function Stop-AppProcesses {
  Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq "EasyView_Md" -or $_.Path -eq $SetupPath -or $_.Name -like "Un_*" -or $_.Name -like "Uninstall EasyView_Md*" } |
    Stop-Process -Force -ErrorAction SilentlyContinue
}

function Save-RegistryDump([string]$Mode, $Layout) {
  $out = Join-Path $LogsDir "registry-$Mode.txt"
  foreach ($key in @("$($Layout.Hive)\Software\Classes\$progId", "$($Layout.Hive)\Software\Classes\Applications\EasyView_Md.exe") + ($extensions | ForEach-Object { "$($Layout.Hive)\Software\Classes\$_" })) {
    "=== $key" | Out-File $out -Append -Encoding utf8
    if (Test-Path $key) { Get-ChildItem $key -Recurse -ErrorAction SilentlyContinue | Out-String -Width 400 | Out-File $out -Append -Encoding utf8 }
  }
  Get-UninstallEntry $Layout | Format-List | Out-String -Width 400 | Out-File $out -Append -Encoding utf8
}

function Test-Mode([string]$Mode) {
  $layout = Get-ModeLayout $Mode
  $dir = $layout.Dir
  $exe = Join-Path $dir "EasyView_Md.exe"
  $uninstaller = Join-Path $dir "Uninstall EasyView_Md.exe"
  $classes = "$($layout.Hive)\Software\Classes"
  $failures = New-Object System.Collections.Generic.List[string]
  $defaultsBefore = @{}
  foreach ($ext in $extensions) { $defaultsBefore[$ext] = Get-DefaultValue "$classes\$ext" }

  Write-Host "=== [$Mode] Install into '$dir' ==="
  if (Test-Path $dir) { throw "[$Mode] install directory already exists before the test: $dir" }
  if (Get-UninstallEntry $layout) { throw "[$Mode] an EasyView_Md uninstall entry already exists before the test" }
  $started = Get-Date
  # NSIS: /D= must be last and unquoted, even when the path contains spaces.
  $setup = Start-Process -FilePath $SetupPath -ArgumentList "/S /$Mode /D=$dir" -PassThru
  if (-not $setup.WaitForExit($TimeoutSeconds * 1000)) {
    Stop-AppProcesses
    throw "[$Mode] setup did not exit within ${TimeoutSeconds}s"
  }
  if ($setup.ExitCode -ne 0) { $failures.Add("setup exited with code $($setup.ExitCode)") }
  Write-Host "[$Mode] setup finished after $([int]((Get-Date) - $started).TotalSeconds)s"

  if (-not (Test-Path $exe)) { $failures.Add("missing $exe") }
  else {
    $productVersion = (Get-Item $exe).VersionInfo.ProductVersion
    if ($productVersion -notlike "$ExpectedVersion*") { $failures.Add("EasyView_Md.exe ProductVersion is '$productVersion', expected $ExpectedVersion") }
  }
  if (-not (Test-Path $uninstaller)) { $failures.Add("missing $uninstaller") }

  $entry = Get-UninstallEntry $layout
  if (-not $entry) { $failures.Add("no uninstall entry under $($layout.Uninstall -join ', ')") }
  else {
    if ($entry.DisplayVersion -ne $ExpectedVersion) { $failures.Add("uninstall DisplayVersion is '$($entry.DisplayVersion)', expected $ExpectedVersion") }
    if ($entry.InstallLocation -and ($entry.InstallLocation.TrimEnd('\') -ne $dir.TrimEnd('\'))) { $failures.Add("uninstall InstallLocation is '$($entry.InstallLocation)', expected $dir") }
  }

  $openCommand = "`"$exe`" `"%1`""
  if ((Get-DefaultValue "$classes\$progId\shell\open\command") -ne $openCommand) { $failures.Add("$classes\$progId\shell\open\command is not $openCommand") }
  if ((Get-DefaultValue "$classes\Applications\EasyView_Md.exe\shell\open\command") -ne $openCommand) { $failures.Add("Applications\EasyView_Md.exe open command is not $openCommand") }
  foreach ($ext in $extensions) {
    $openWith = Get-ItemProperty "$classes\$ext\OpenWithProgids" -ErrorAction SilentlyContinue
    if (-not $openWith -or -not ($openWith.PSObject.Properties.Name -contains $progId)) { $failures.Add("$classes\$ext\OpenWithProgids lacks $progId") }
    if ((Get-DefaultValue "$classes\$ext") -ne $defaultsBefore[$ext]) { $failures.Add("the default handler of $ext was changed") }
  }

  foreach ($link in @($layout.StartMenu, $layout.Desktop)) {
    if (-not (Test-Path $link)) { $failures.Add("missing shortcut $link"); continue }
    $target = $shell.CreateShortcut($link).TargetPath
    if ($target -ne $exe) { $failures.Add("shortcut $link points to '$target', expected $exe") }
  }

  if ($failures.Count -gt 0) {
    Save-RegistryDump $Mode $layout
    Get-ChildItem $dir -ErrorAction SilentlyContinue | Out-String | Write-Host
    Stop-AppProcesses
    throw "[$Mode] install verification failed:`n - $($failures -join "`n - ")"
  }
  Write-Host "[$Mode] installed $ExpectedVersion into $dir"

  Write-Host "=== [$Mode] Launch the installed app ==="
  Stop-AppProcesses
  & (Join-Path $PSScriptRoot "windows-smoke-launch.ps1") -ExePath $exe -TestFile $TestFile -LogsDir (Join-Path $LogsDir "launch-$Mode") -WaitSeconds 25 -JobLabel "installed-$Mode"
  if ($LASTEXITCODE -ne 0) { throw "[$Mode] installed app smoke test failed" }

  Write-Host "=== [$Mode] Uninstall ==="
  Stop-AppProcesses
  Start-Sleep -Seconds 2
  # The NSIS uninstaller re-launches itself from %TEMP% and returns immediately; poll for the cleanup.
  $uninstall = Start-Process -FilePath $uninstaller -ArgumentList "/S /$Mode" -PassThru
  [void]$uninstall.WaitForExit($TimeoutSeconds * 1000)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline -and ((Test-Path $exe) -or (Get-UninstallEntry $layout))) { Start-Sleep -Seconds 2 }

  $leftovers = New-Object System.Collections.Generic.List[string]
  if (Test-Path $exe) { $leftovers.Add($exe) }
  if (Get-UninstallEntry $layout) { $leftovers.Add("uninstall entry") }
  if (Test-Path "$classes\$progId") { $leftovers.Add("$classes\$progId") }
  if (Test-Path "$classes\Applications\EasyView_Md.exe") { $leftovers.Add("$classes\Applications\EasyView_Md.exe") }
  foreach ($ext in $extensions) {
    $openWith = Get-ItemProperty "$classes\$ext\OpenWithProgids" -ErrorAction SilentlyContinue
    if ($openWith -and ($openWith.PSObject.Properties.Name -contains $progId)) { $leftovers.Add("$classes\$ext\OpenWithProgids\$progId") }
  }
  foreach ($link in @($layout.StartMenu, $layout.Desktop)) { if (Test-Path $link) { $leftovers.Add($link) } }
  if ($leftovers.Count -gt 0) {
    Save-RegistryDump "$Mode-after-uninstall" $layout
    throw "[$Mode] uninstall left behind:`n - $($leftovers -join "`n - ")"
  }
  if (Test-Path $dir) { Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue }
  Write-Host "[$Mode] uninstall cleaned up"
}

foreach ($mode in $Modes) {
  if ($mode -notin @("currentuser", "allusers")) { throw "Unknown install mode '$mode'" }
  Test-Mode $mode
}

Write-Host "Installer test passed for $ExpectedVersion ($($Modes -join ', '))"
exit 0

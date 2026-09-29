# One-command install for Windows. Paste into Command Prompt or PowerShell:
#   powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072; irm https://raw.githubusercontent.com/FtRookie/overengineered/main/scripts/install.ps1 | iex"
#
# Builds place.rbxl and opens it in Roblox Studio, showing only a progress bar; a failing step prints the end of
# its output. Any of Node.js, Git or Lune the machine lacks is downloaded into a temporary folder for this run only
# and deleted when the run ends, whether it succeeded or not; nothing is installed system-wide. Roblox Studio is
# installed when missing and is kept.
#
# $env:OE_DIR sets where the project goes (default: %USERPROFILE%\overengineered).
#
# Must stay ASCII-only and Windows PowerShell 5.1 compatible: 5.1's irm decodes text/plain without a charset as
# ISO-8859-1, and 5.1 is the only PowerShell a fresh Windows install has. The bar is redrawn with a carriage return
# over a line of fixed width because 5.1's console does not reliably interpret ANSI escape sequences.

& {
	$ErrorActionPreference = "Stop"
	$ProgressPreference = "SilentlyContinue"
	[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

	$RepoUrl = "https://github.com/FtRookie/overengineered.git"
	$NodeVersion = "22.22.2"
	$NodeRange = "a stable release: 20.19+, 22.12+, 24, 26, or 27 and newer"
	# Portable Git from GitHub Desktop's dugite-native; URLs and checksums from dugite 3.2.3's script/embedded-git.json.
	$GitRelease = "https://github.com/desktop/dugite-native/releases/download/v2.53.0-4"
	$GitAsset = "dugite-native-v2.53.0-4098283"
	$StudioInstallerUrl = "https://setup.rbxcdn.com/RobloxStudioInstaller.exe"
	$BarWidth = 30

	$fancy = -not [Console]::IsOutputRedirected
	$bar = @{ Label = ""; Start = 0; End = 0; K = 1.0; Watch = $null; Active = $false }
	$state = @{ Log = $null; Reported = $false; Built = $null }

	function Write-Bar($label, $percent) {
		$fill = [int][Math]::Floor($percent * $BarWidth / 100)
		$line = "  Installing {0,-15} [{1}{2}] {3,3}%" -f $label, ("=" * $fill), (" " * ($BarWidth - $fill)), $percent
		[Console]::Write("`r" + $line)
	}

	# step LABEL START% END% EXPECTED_SECONDS. The bar eases towards the end of the step without reaching it: a
	# third of the way through the expected time it is halfway, and it keeps slowing down if the step takes longer.
	function Start-Step($label, $start, $end, $seconds) {
		$bar.Label = $label
		$bar.Start = $start
		$bar.End = $end
		$bar.K = $seconds * 10 / 3 + 1
		$bar.Watch = [Diagnostics.Stopwatch]::StartNew()
		$bar.Active = $true
		if ($fancy) { Update-Bar } else { Write-Host "Installing $label..." }
	}

	function Update-Bar {
		if (-not $fancy -or -not $bar.Active) { return }
		$t = $bar.Watch.ElapsedMilliseconds / 100
		Write-Bar $bar.Label ([int][Math]::Floor($bar.Start + ($bar.End - $bar.Start) * $t / ($t + $bar.K)))
	}

	function Complete-Step {
		if ($fancy -and $bar.Active) { Write-Bar $bar.Label $bar.End }
	}

	function Complete-Bar($label) {
		if ($fancy) {
			Write-Bar $label 100
			[Console]::WriteLine()
		}
		$bar.Active = $false
	}

	function Clear-Bar {
		if ($fancy -and $bar.Active) { [Console]::Write("`r" + (" " * 72) + "`r") }
		$bar.Active = $false
	}

	function Say($msg) {
		Clear-Bar
		Write-Host $msg
	}

	function Warn($msg) {
		Clear-Bar
		Write-Host "Note: $msg" -ForegroundColor Yellow
	}

	function Fail($msg) { throw $msg }

	function Has($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }

	# Quoting for a Windows command line, as CommandLineToArgvW reads it.
	function ConvertTo-Argument($arg) {
		if ($arg -and $arg -notmatch '[\s"]') { return $arg }
		$escaped = $arg -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1'
		return "`"$escaped`""
	}

	# Runs a program with its output kept in the log, redrawing the bar while it runs; on failure shows the end of
	# that output, unless -NoReport. Its input is closed rather than the console, so nothing it starts can wait on
	# a prompt nobody sees (cmd.exe running npm.cmd asks "Terminate batch job (Y/N)?" after Ctrl+C).
	function Invoke-Quiet {
		param([string]$Exe, [string[]]$Arguments, [switch]$NoReport)
		$info = New-Object System.Diagnostics.ProcessStartInfo
		$info.FileName = $Exe
		$info.Arguments = ($Arguments | ForEach-Object { ConvertTo-Argument $_ }) -join " "
		$info.UseShellExecute = $false
		$info.RedirectStandardOutput = $true
		$info.RedirectStandardError = $true
		$info.RedirectStandardInput = $true
		$info.WorkingDirectory = (Get-Location).ProviderPath
		$process = [Diagnostics.Process]::Start($info)
		$process.StandardInput.Close()
		$stdout = $process.StandardOutput.ReadToEndAsync()
		$stderr = $process.StandardError.ReadToEndAsync()
		while (-not $process.WaitForExit(200)) { Update-Bar }
		$process.WaitForExit()
		$output = $stdout.Result + $stderr.Result
		Add-Content -Path $state.Log -Value $output
		if ($process.ExitCode -eq 0) { return }
		if ($NoReport) { throw "installing $($bar.Label) failed" }

		Clear-Bar
		Write-Host "Error: installing $($bar.Label) failed. The last lines it printed:" -ForegroundColor Red
		($output -split "`r?`n" | Where-Object { $_ } | Select-Object -Last 25) | ForEach-Object { Write-Host "    $_" }
		$state.Reported = $true
		throw "installing $($bar.Label) failed"
	}

	# Async downloads have no read timeout (HttpWebRequest.Timeout "has no effect on asynchronous requests"), so a
	# download whose file stops growing for a minute is abandoned and retried under a new name, since the abandoned
	# one may still hold its file open.
	function Get-Download($url, $out) {
		for ($attempt = 1; $attempt -le 3; $attempt++) {
			$part = "$out.part$attempt"
			$client = New-Object System.Net.WebClient
			try {
				$task = $client.DownloadFileTaskAsync($url, $part)
				$size = -1
				$idle = [Diagnostics.Stopwatch]::StartNew()
				while (-not $task.Wait(200)) {
					Update-Bar
					$now = 0
					if (Test-Path -LiteralPath $part) { $now = (Get-Item -LiteralPath $part).Length }
					if ($now -ne $size) {
						$size = $now
						$idle.Restart()
					} elseif ($idle.Elapsed.TotalSeconds -ge 60) {
						$client.CancelAsync()
						throw "download stalled"
					}
				}
				Move-Item -LiteralPath $part -Destination $out -Force
				return
			} catch {
				if ($attempt -eq 3) { Fail "Could not download $url. Check your internet connection and run the command again." }
				Start-Sleep -Seconds (2 * $attempt)
			} finally {
				$client.Dispose()
			}
		}
	}

	function Get-VerifiedDownload($url, $out, $expected) {
		Get-Download $url $out
		$actual = (Get-FileHash -Algorithm SHA256 -Path $out).Hash
		if ($actual -ne $expected) { Fail "Download of $url is corrupted (checksum mismatch). Run the command again." }
	}

	# In a child PowerShell so the bar keeps moving; -EncodedCommand avoids quoting the paths twice. The error is
	# written with [Console] because with -EncodedCommand and a redirected error stream PowerShell serialises errors
	# as CLIXML.
	function Expand-Zip($zip, $dest) {
		$command = "`$ErrorActionPreference = 'Stop'; `$ProgressPreference = 'SilentlyContinue'; try {{ Expand-Archive -LiteralPath '{0}' -DestinationPath '{1}' -Force }} catch {{ [Console]::Error.WriteLine(`$_.Exception.Message); exit 1 }}" -f ($zip -replace "'", "''"), ($dest -replace "'", "''")
		$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
		Invoke-Quiet (Get-Process -Id $PID).Path @("-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $encoded)
	}

	function Expand-TarGz($archive, $dest) {
		$tar = Join-Path $env:SystemRoot "System32\tar.exe"
		if (-not (Test-Path $tar)) { Fail "This version of Windows is too old (tar.exe is missing). Windows 10 version 1803 or newer is required." }
		New-Item -ItemType Directory -Force -Path $dest | Out-Null
		Invoke-Quiet $tar @("-xzf", $archive, "-C", $dest)
	}

	function Test-Runs($exe, $expectedVersion) {
		try {
			$output = & $exe --version
			return ($LASTEXITCODE -eq 0 -and $output -eq $expectedVersion)
		} catch {
			return $false
		}
	}

	function Get-Arch {
		$arch = $env:PROCESSOR_ARCHITEW6432
		if (-not $arch) { $arch = $env:PROCESSOR_ARCHITECTURE }
		switch ($arch) {
			"AMD64" { return "x64" }
			"ARM64" { return "arm64" }
			default { Fail "Unsupported processor: $arch. Only 64-bit Windows is supported." }
		}
	}

	# The compiler requires yargs 18, an ES module, which Node can only require() from 20.19 and 22.12 on (yargs'
	# engines: ^20.19.0 || ^22.12.0 || >=23); on older versions the build fails with ERR_REQUIRE_ESM. Odd majors up
	# to 25 are short-lived and never reach LTS; from 27 every major does (nodejs.org/en/about/previous-releases).
	function Test-NodeVersionSupported($version) {
		$parts = "$version".Split(".")
		$major = 0
		$minor = 0
		if ($parts.Count -lt 2 -or -not [int]::TryParse($parts[0], [ref]$major) -or -not [int]::TryParse($parts[1], [ref]$minor)) { return $false }
		if ($major -ge 27) { return $true }
		if ($major -ge 24) { return ($major % 2 -eq 0) }
		if ($major -eq 22) { return ($minor -ge 12) }
		if ($major -eq 20) { return ($minor -ge 19) }
		return $false
	}

	function Add-Node($tools, $arch) {
		if ((Has node.exe) -and (Has npm.cmd)) {
			$version = ""
			try { $version = ([string](& node.exe --version)).Trim() -replace "^v", "" } catch { }
			if (Test-NodeVersionSupported $version) { return (Get-Command npm.cmd).Source }
			Add-Content -Path $state.Log -Value "Your Node.js is v$version; this project needs $NodeRange. A temporary copy is used instead."
		}

		$sums = @{
			"x64" = "7c93e9d92bf68c07182b471aa187e35ee6cd08ef0f24ab060dfff605fcc1c57c"
			"arm64" = "380d375cf650c5a7f2ef3ce29ac6ea9a1c9d2ec8ea8e8391e1a34fd543886ab3"
		}
		$name = "node-v$NodeVersion-win-$arch"
		$zip = Join-Path $tools "node.zip"
		Start-Step "Node.js" 2 15 30
		Get-VerifiedDownload "https://nodejs.org/dist/v$NodeVersion/$name.zip" $zip $sums[$arch]
		Expand-Zip $zip $tools
		Remove-Item $zip
		$dir = Join-Path $tools $name
		$env:Path = "$dir;$env:Path"
		if (-not (Test-Runs (Join-Path $dir "node.exe") "v$NodeVersion")) { Fail "The downloaded Node.js does not run on this system." }
		Complete-Step
		return (Join-Path $dir "npm.cmd")
	}

	function Test-GitUsable {
		if (-not (Has git.exe)) { return $false }
		try {
			& git.exe --version | Out-Null
			return ($LASTEXITCODE -eq 0)
		} catch {
			return $false
		}
	}

	function Add-Git($tools, $arch) {
		if (Test-GitUsable) { return }

		$assets = @{
			"x64" = @("windows-x64", "7b76bc5c32c0d7c5984efdc2a8a32697cf1e8a43bc55176fbf9869c0ee995130", "mingw64")
			"arm64" = @("windows-arm64", "1abbeb3a2ce06e9b80e75bb888dce959b6c73bdb11ccc670a01a71d64f4422a5", "clangarm64")
		}
		$asset = $assets[$arch]
		$archive = Join-Path $tools "git.tar.gz"
		$dir = Join-Path $tools "git"
		Start-Step "Git" 15 25 20
		Get-VerifiedDownload "$GitRelease/$GitAsset-$($asset[0]).tar.gz" $archive $asset[1]
		Expand-TarGz $archive $dir
		Remove-Item $archive

		# The environment dugite's setupEnvironment gives its bundled Git (lib/git-environment.ts).
		$sub = Join-Path $dir $asset[2]
		$env:Path = "$dir\cmd;$sub\bin;$sub\usr\bin;$env:Path"
		$env:GIT_EXEC_PATH = Join-Path $sub "libexec\git-core"
		if (-not (Test-GitUsable)) { Fail "The downloaded Git does not run on this system." }
		Complete-Step
	}

	function Enter-Project {
		Start-Step "game files" 25 35 20
		if ($PSScriptRoot -and (Test-Path (Join-Path $PSScriptRoot "..\rokit.toml")) -and (Test-Path (Join-Path $PSScriptRoot "..\package.json"))) {
			Set-Location (Join-Path $PSScriptRoot "..")
			Complete-Step
			return
		}

		$dir = $env:OE_DIR
		if (-not $dir) { $dir = Join-Path $HOME "overengineered" }
		if (Test-Path (Join-Path $dir ".git")) {
			Set-Location $dir
			$status = & git.exe status --porcelain
			if ($status) {
				Warn "The project in $(Get-Location) has local changes, so it was not updated."
			} else {
				try {
					Invoke-Quiet (Get-Command git.exe).Source @("pull", "--ff-only", "--quiet") -NoReport
				} catch {
					Warn "Could not update the project in $(Get-Location); building the version already there."
				}
			}
			Complete-Step
			return
		}

		if ((Test-Path $dir) -and (Get-ChildItem -Force -Path $dir | Select-Object -First 1)) {
			Fail "$dir already exists and is not this project. Move or rename it, then run the command again."
		}
		Invoke-Quiet (Get-Command git.exe).Source @("clone", "--quiet", $RepoUrl, $dir)
		Set-Location $dir
		Complete-Step
	}

	function Add-Lune($tools, $arch) {
		$match = [regex]::Match((Get-Content -Raw -Path "rokit.toml"), 'lune\s*=\s*"lune-org/lune@([^"]+)"')
		if (-not $match.Success) { Fail "Could not read the Lune version from rokit.toml." }
		$version = $match.Groups[1].Value

		if ((Has lune.exe) -and (Test-Runs (Get-Command lune.exe).Source "lune $version")) { return (Get-Command lune.exe).Source }

		$platform = @{ "x64" = "windows-x86_64"; "arm64" = "windows-aarch64" }[$arch]
		$zip = Join-Path $tools "lune.zip"
		$dir = Join-Path $tools "lune"
		Start-Step "Lune" 35 40 10
		Get-Download "https://github.com/lune-org/lune/releases/download/v$version/lune-$version-$platform.zip" $zip
		Expand-Zip $zip $dir
		Remove-Item $zip
		$lune = Join-Path $dir "lune.exe"
		if (-not (Test-Runs $lune "lune $version")) { Fail "The downloaded Lune does not run on this system." }
		Complete-Step
		return $lune
	}

	function Build-Project($npm, $lune) {
		Start-Step "packages" 40 70 90
		Invoke-Quiet $npm @("ci", "--no-audit", "--no-fund")
		Complete-Step

		Start-Step "game" 70 92 60
		Invoke-Quiet $npm @("run", "build")
		Complete-Step

		Start-Step "game" 92 99 15
		Remove-Item -Force -ErrorAction SilentlyContinue "place.rbxl"
		Invoke-Quiet $lune @("run", "assemble")
		if (-not (Test-Path "place.rbxl")) { Fail "The build finished but place.rbxl was not created." }
		Complete-Step
	}

	function Test-Studio { Test-Path "Registry::HKEY_CLASSES_ROOT\.rbxl" }

	function Open-Place($tools) {
		$place = Join-Path (Get-Location) "place.rbxl"

		if (-not (Test-Studio)) {
			$installer = Join-Path $tools "RobloxStudioInstaller.exe"
			try {
				Start-Step "Roblox Studio" 0 50 20
				Get-Download $StudioInstallerUrl $installer
				Say "The Roblox Studio installer is open. Follow it; this continues once it closes."
				# Start-Process -Wait would also wait for Studio, which the installer launches when it finishes.
				$process = Start-Process -FilePath $installer -PassThru
				$process.WaitForExit()
			} catch {
				Warn "The Roblox Studio installer could not run: $($_.Exception.Message)"
			}
		}

		if (-not (Test-Studio)) {
			Warn "Roblox Studio was not found. Install it from https://create.roblox.com/, then open $place"
			return $false
		}

		try {
			Start-Process -FilePath $place
			return $true
		} catch {
			Warn "Could not open Roblox Studio. Open $place from Studio."
		}
	}

	$savedEnv = @{}
	foreach ($name in @("Path", "TEMP", "TMP", "GIT_EXEC_PATH", "GIT_TERMINAL_PROMPT", "npm_config_cache", "npm_config_update_notifier", "npm_config_logs_max")) {
		$savedEnv[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
	}
	$originalLocation = Get-Location
	$tools = $null
	$failed = $false
	$finished = $false

	try {
		$arch = Get-Arch
		$tools = Join-Path ([IO.Path]::GetTempPath()) ("overengineered-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))
		New-Item -ItemType Directory -Force -Path (Join-Path $tools "tmp") | Out-Null
		$state.Log = Join-Path $tools "output.log"
		# Node, npm and git leave caches in the temp folder and npm keeps one in the user profile; pointing both
		# into $tools removes them with it.
		$env:TEMP = Join-Path $tools "tmp"
		$env:TMP = $env:TEMP
		$env:npm_config_cache = Join-Path $tools "npm-cache"
		$env:npm_config_update_notifier = "false"
		# npm's own failure message points at a debug log in its cache, which is deleted with $tools.
		$env:npm_config_logs_max = "0"
		$env:GIT_TERMINAL_PROMPT = "0"

		Say "Installing Underengineered. This takes a few minutes."
		$npm = Add-Node $tools $arch
		Add-Git $tools $arch
		Enter-Project
		$lune = Add-Lune $tools $arch
		Build-Project $npm $lune
		Complete-Bar "Underengineered"
		$state.Built = (Get-Location).ProviderPath

		$project = $state.Built
		foreach ($name in $savedEnv.Keys) {
			[Environment]::SetEnvironmentVariable($name, $savedEnv[$name], "Process")
		}
		if (Open-Place $tools) {
			Say "Done! The game is in $project and is opening in Roblox Studio."
		} else {
			Say "Done! The game is built in $project."
		}
		$finished = $true
	} catch {
		$failed = $true
		Clear-Bar
		if (-not $state.Reported) { Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red }
	} finally {
		Clear-Bar
		Set-Location $originalLocation
		foreach ($name in $savedEnv.Keys) {
			[Environment]::SetEnvironmentVariable($name, $savedEnv[$name], "Process")
		}
		if ($tools -and (Test-Path $tools)) {
			for ($attempt = 1; $attempt -le 5; $attempt++) {
				try {
					Remove-Item -Recurse -Force -Path $tools
					break
				} catch {
					if ($attempt -eq 5) { Write-Host "Could not delete $tools; delete it by hand." -ForegroundColor Yellow }
					Start-Sleep -Seconds 2
				}
			}
		}
		# A catch block does not run on Ctrl+C, but this finally does.
		if (-not $finished) {
			$message = if ($failed) { "`nInstallation failed." } else { "`nCancelled." }
			if ($state.Built) {
				$message += " The game is built in $($state.Built), but setting up Roblox Studio did not finish."
			} else {
				$message += " Nothing was installed on your system."
			}
			Write-Host $message -ForegroundColor Red
		}
	}

	# Report failure to whatever started "powershell -Command", but never close a window someone ran irm | iex in.
	$hostArgs = [Environment]::GetCommandLineArgs()
	$ranCommand = @($hostArgs | Where-Object { $_ -match '^[-/]c(o(m(m(a(n(d)?)?)?)?)?)?$' }).Count -gt 0
	$keepsWindow = @($hostArgs | Where-Object { $_ -match '^[-/]noe(x(i(t)?)?)?$' }).Count -gt 0
	if ($failed -and $ranCommand -and -not $keepsWindow) { exit 1 }
}

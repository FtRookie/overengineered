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
	$state = @{ Log = $null; Reported = $false; Project = $null; Built = $null }

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

	# The only way anything is deleted: an absolute path inside $tools, a folder this run created. Directory.Delete
	# "does not recurse through the reparse point", unlike Windows PowerShell 5.1's Remove-Item -Recurse, which can
	# follow a junction into the folder it points to.
	function Remove-ToolPath($path) {
		if (-not $tools -or -not [IO.Path]::IsPathRooted($tools) -or -not ([IO.Path]::GetFileName($tools)).StartsWith("overengineered-tools.")) { return }
		$root = [IO.Path]::GetFullPath($tools)
		$full = [IO.Path]::GetFullPath($path)
		if ($full -ne $root -and -not $full.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { return }
		if ([IO.Directory]::Exists($full)) {
			[IO.Directory]::Delete($full, $true)
		} elseif ([IO.File]::Exists($full)) {
			[IO.File]::Delete($full)
		}
	}

	# Runs git and returns its output read as UTF-8 (the console code page would mangle file names), keeping its
	# errors in the log instead of printing them over the bar.
	function Get-GitOutput([string[]]$Arguments) {
		$info = New-Object System.Diagnostics.ProcessStartInfo
		$info.FileName = (Get-Command git.exe).Source
		$info.Arguments = ($Arguments | ForEach-Object { ConvertTo-Argument $_ }) -join " "
		$info.UseShellExecute = $false
		$info.RedirectStandardOutput = $true
		$info.RedirectStandardError = $true
		$info.RedirectStandardInput = $true
		$info.StandardOutputEncoding = [Text.Encoding]::UTF8
		$info.WorkingDirectory = (Get-Location).ProviderPath
		$process = [Diagnostics.Process]::Start($info)
		$process.StandardInput.Close()
		$stdout = $process.StandardOutput.ReadToEndAsync()
		$stderr = $process.StandardError.ReadToEndAsync()
		$process.WaitForExit()
		Add-Content -LiteralPath $state.Log -Value $stderr.Result
		return @{ Code = $process.ExitCode; Output = $stdout.Result }
	}

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
		Add-Content -LiteralPath $state.Log -Value $output
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
		$actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $out).Hash
		if ($actual -ne $expected) { Fail "Download of $url is corrupted (checksum mismatch). Run the command again." }
	}

	# In a child PowerShell so the bar keeps moving, with .NET's ZipFile rather than Expand-Archive, which is slow on
	# the thousands of small files in the Node.js zip. -EncodedCommand avoids quoting the paths twice. The error is
	# written with [Console] because with -EncodedCommand and a redirected error stream PowerShell serialises errors
	# as CLIXML. With a member, only that one file is extracted, so no path inside an unverified zip can write
	# outside $dest.
	function Expand-Zip($zip, $dest, $member) {
		[void][IO.Directory]::CreateDirectory($dest)
		$quote = { param($text) "'" + ($text -replace "'", "''") + "'" }
		if ($member) {
			$extract = "`$z = [IO.Compression.ZipFile]::OpenRead({0}); try {{ `$e = `$z.GetEntry({1}); if (-not `$e) {{ throw 'The zip does not contain {2}.' }}; [IO.Compression.ZipFileExtensions]::ExtractToFile(`$e, {3}, `$true) }} finally {{ `$z.Dispose() }}" -f (& $quote $zip), (& $quote $member), $member, (& $quote (Join-Path $dest $member))
		} else {
			$extract = "[IO.Compression.ZipFile]::ExtractToDirectory({0}, {1})" -f (& $quote $zip), (& $quote $dest)
		}
		$command = "`$ErrorActionPreference = 'Stop'; try {{ Add-Type -AssemblyName System.IO.Compression.FileSystem; {0} }} catch {{ [Console]::Error.WriteLine(`$_.Exception.Message); exit 1 }}" -f $extract
		$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
		Invoke-Quiet (Get-Process -Id $PID).Path @("-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $encoded)
	}

	function Expand-TarGz($archive, $dest) {
		$tar = Join-Path $env:SystemRoot "System32\tar.exe"
		if (-not (Test-Path -LiteralPath $tar)) { Fail "This version of Windows is too old (tar.exe is missing). Windows 10 version 1803 or newer is required." }
		[void][IO.Directory]::CreateDirectory($dest)
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
			Add-Content -LiteralPath $state.Log -Value "Your Node.js is v$version; this project needs $NodeRange. A temporary copy is used instead."
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
		Remove-ToolPath $zip
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
		Remove-ToolPath $archive

		# The environment dugite's setupEnvironment gives its bundled Git (lib/git-environment.ts).
		$sub = Join-Path $dir $asset[2]
		$env:Path = "$dir\cmd;$sub\bin;$sub\usr\bin;$env:Path"
		$env:GIT_EXEC_PATH = Join-Path $sub "libexec\git-core"
		if (-not (Test-GitUsable)) { Fail "The downloaded Git does not run on this system." }
		Complete-Step
	}

	# The build deletes and rewrites files in the folder it runs in (npm ci replaces node_modules), so it only ever
	# runs in a folder that is this project.
	function Test-Project($dir) {
		(Test-Path -LiteralPath (Join-Path $dir "rokit.toml")) -and (Test-Path -LiteralPath (Join-Path $dir "lune/assemble.luau")) -and (Test-Path -LiteralPath (Join-Path $dir "default.project.json"))
	}

	# A clone of this repository specifically, not upstream OverEngineered or another fork, whichever URL form it uses.
	function Test-OurClone {
		$result = Get-GitOutput @("remote", "get-url", "origin")
		if ($result.Code -ne 0) { return $false }
		$url = $result.Output.Trim().ToLowerInvariant().TrimEnd("/") -replace "\.git$", ""
		return @("https://github.com/ftrookie/overengineered", "git@github.com:ftrookie/overengineered", "ssh://git@github.com/ftrookie/overengineered") -contains $url
	}

	# Git overwrites an ignored file without asking when an update adds a tracked file at the same path, so the
	# update is skipped when anything it would add is already on disk. Names are read NUL-separated so that none is
	# quoted or escaped past the check.
	function Update-Project {
		Invoke-Quiet (Get-Command git.exe).Source @("fetch", "--quiet") -NoReport
		$result = Get-GitOutput @("diff", "-z", "--name-only", "--no-renames", "--diff-filter=A", "HEAD", "@{upstream}")
		if ($result.Code -ne 0) { throw "no upstream" }
		$root = (Get-Location).ProviderPath
		foreach ($path in $result.Output.Split([char]0)) {
			if (-not $path) { continue }
			$current = $path
			$first = $true
			while ($current) {
				$item = Get-Item -LiteralPath (Join-Path $root $current) -Force -ErrorAction SilentlyContinue
				if ($item -and ($first -or -not $item.PSIsContainer -or $item.LinkType)) { return "overwrite" }
				$first = $false
				$slash = $current.LastIndexOf("/")
				if ($slash -lt 0) { break }
				$current = $current.Substring(0, $slash)
			}
		}
		Invoke-Quiet (Get-Command git.exe).Source @("merge", "--ff-only", "--quiet", "@{upstream}") -NoReport
		return "updated"
	}

	function Enter-Project {
		Start-Step "game files" 25 35 20
		if ($PSScriptRoot -and (Test-Project (Join-Path $PSScriptRoot ".."))) {
			Set-Location -LiteralPath (Join-Path $PSScriptRoot "..")
			$state.Project = (Get-Location).ProviderPath
			Complete-Step
			return
		}

		$dir = $env:OE_DIR
		if (-not $dir) { $dir = Join-Path $HOME "overengineered" }
		if (Test-Path -LiteralPath (Join-Path $dir ".git")) {
			if (-not (Test-Project $dir)) { Fail "$dir holds a different project or a different copy of this one. Move or rename it, then run the command again." }
			Set-Location -LiteralPath $dir
			if (-not (Test-OurClone)) { Fail "$dir holds a different project or a different copy of this one. Move or rename it, then run the command again." }
			$state.Project = (Get-Location).ProviderPath
			$status = Get-GitOutput @("status", "--porcelain")
			if ($status.Code -ne 0 -or $status.Output) {
				Warn "The project in $($state.Project) has local changes, so it was not updated."
			} else {
				try {
					if ((Update-Project) -eq "overwrite") { Warn "Updating the project in $($state.Project) would overwrite files you have, so it was not updated." }
				} catch {
					Warn "Could not update the project in $($state.Project); building the version already there."
				}
			}
			Complete-Step
			return
		}

		if ((Test-Path -LiteralPath $dir) -and (Get-ChildItem -LiteralPath $dir -Force | Select-Object -First 1)) {
			Fail "$dir already exists and is not this project. Move or rename it, then run the command again."
		}
		Invoke-Quiet (Get-Command git.exe).Source @("clone", "--quiet", $RepoUrl, $dir)
		Set-Location -LiteralPath $dir
		$state.Project = (Get-Location).ProviderPath
		Complete-Step
	}

	function Add-Lune($tools, $arch) {
		$match = [regex]::Match((Get-Content -Raw -Path "rokit.toml"), 'lune\s*=\s*"lune-org/lune@([^"]+)"')
		if (-not $match.Success) { Fail "Could not read the Lune version from rokit.toml." }
		$version = $match.Groups[1].Value

		if ((Has lune.exe) -and (Test-Runs (Get-Command lune.exe).Source "lune $version")) { return (Get-Command lune.exe).Source }

		# Lune publishes no checksums; these are of the 0.10.5 release files, taken when that version was pinned.
		# Another version in rokit.toml is downloaded unverified, and only lune.exe is extracted from it.
		$platform = @{ "x64" = "windows-x86_64"; "arm64" = "windows-aarch64" }[$arch]
		$sums = @{
			"x64" = "ad0305f5cc6d7ff20996644b40bf7de0de613812f431ca241456e16f9fc89cda"
			"arm64" = "b98bc49ded9183951c1d01b428872cd8ce518f200b48824ea3b31e3d7dec28ae"
		}
		$zip = Join-Path $tools "lune.zip"
		$dir = Join-Path $tools "lune"
		$url = "https://github.com/lune-org/lune/releases/download/v$version/lune-$version-$platform.zip"
		Start-Step "Lune" 35 40 10
		if ($version -eq "0.10.5") { Get-VerifiedDownload $url $zip $sums[$arch] } else { Get-Download $url $zip }
		Expand-Zip $zip $dir "lune.exe"
		Remove-ToolPath $zip
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

		Start-Step "place file" 92 99 15
		# The one file deleted outside $tools: the build's own output, by absolute path in the checked project.
		if (-not $state.Project -or -not [IO.Path]::IsPathRooted($state.Project)) { Fail "The project folder is unknown." }
		$place = Join-Path $state.Project "place.rbxl"
		if ([IO.File]::Exists($place)) { [IO.File]::Delete($place) }
		Invoke-Quiet $lune @("run", "assemble")
		if (-not [IO.File]::Exists($place)) { Fail "The build finished but place.rbxl was not created." }
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
				# In case the installer hands off to another process and exits before registering Studio.
				if (-not (Test-Studio)) {
					Say "Waiting for Roblox Studio to finish installing..."
					for ($wait = 0; $wait -lt 60 -and -not (Test-Studio); $wait++) { Start-Sleep -Seconds 2 }
				}
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
		# A new folder with a random name, absolute, and recorded only once this run has created it, so the cleanup
		# can never delete a folder that already existed.
		$candidate = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) ("overengineered-tools." + [Guid]::NewGuid().ToString("N"))))
		if ([IO.Directory]::Exists($candidate) -or [IO.File]::Exists($candidate)) { Fail "Could not create a temporary folder." }
		[void][IO.Directory]::CreateDirectory($candidate)
		$tools = $candidate
		[void][IO.Directory]::CreateDirectory((Join-Path $tools "tmp"))
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
		$state.Built = $state.Project

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
		Set-Location -LiteralPath $originalLocation
		foreach ($name in $savedEnv.Keys) {
			[Environment]::SetEnvironmentVariable($name, $savedEnv[$name], "Process")
		}
		if ($tools -and [IO.Directory]::Exists($tools)) {
			for ($attempt = 1; $attempt -le 5; $attempt++) {
				try {
					Remove-ToolPath $tools
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
			} elseif ($state.Project) {
				$message += " The game files are in $($state.Project); run the command again to finish."
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

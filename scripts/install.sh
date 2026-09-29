#!/usr/bin/env bash
# One-command install for macOS and Linux (fresh Ubuntu has wget but not curl, hence both):
#   (if command -v curl >/dev/null; then curl -fsSL URL; else wget --no-hsts -qO- URL; fi || echo "..." >&2) | bash
# where URL is https://raw.githubusercontent.com/FtRookie/overengineered/main/scripts/install.sh
#
# Builds place.rbxl and opens it in Roblox Studio, showing only a progress bar; a failing step prints the end of
# its output. Any of Node.js, Git or Lune the machine lacks is downloaded into a temporary folder for this run only
# and deleted when the run ends, whether it succeeded or not; nothing is installed system-wide. Roblox Studio is
# installed when missing and is kept: on macOS from Roblox, on Linux as Vinegar from Flathub (installing Flatpak
# first if needed, which asks for the password).
#
# Must run on macOS's /bin/bash 3.2, where set -e does not stop the script when a ( subshell ) fails.
#
# OE_DIR sets where the project goes (default: ~/overengineered).

set -euo pipefail

REPO_URL="https://github.com/FtRookie/overengineered.git"
NODE_VERSION="22.22.2"
NODE_RANGE="a stable release: 20.19+, 22.12+, 24, 26, or 27 and newer"
# Portable Git from GitHub Desktop's dugite-native; URLs and checksums from dugite 3.2.3's script/embedded-git.json.
GIT_RELEASE="https://github.com/desktop/dugite-native/releases/download/v2.53.0-4"
GIT_ASSET="dugite-native-v2.53.0-4098283"
STUDIO_DMG_URL="https://setup.rbxcdn.com/mac/RobloxStudio.dmg"
VINEGAR_ID="org.vinegarhq.Vinegar"
FLATHUB_REPO="https://dl.flathub.org/repo/flathub.flatpakrepo"
BAR_WIDTH=30

TOOLS_DIR=""
LOG=""
LABEL=""
STEP_END=0
OS=""
ARCH=""
SCRIPT_PID=$$
ORIGINAL_PATH="$PATH"
ORIGINAL_TMPDIR="${TMPDIR-}"
TMPDIR_WAS_SET="${TMPDIR+1}"
STUDIO_OPENED=""
PROJECT_DIR=""
BUILT_DIR=""
SYSTEM_CHANGED=""
FANCY=""
if [ -t 1 ]; then
	FANCY=1
fi
RED=""
YELLOW=""
PLAIN=""
if [ -t 2 ]; then
	RED=$(printf '\033[1;31m')
	YELLOW=$(printf '\033[1;33m')
	PLAIN=$(printf '\033[0m')
fi

has() { command -v "$1" >/dev/null 2>&1; }

# The only way anything is deleted: an absolute path inside TOOLS_DIR, which this run created with mktemp.
remove_tool_path() {
	case "$TOOLS_DIR" in /*/overengineered-tools.*) ;; *) return 1 ;; esac
	case "$1" in */../* | */.. | */./* | */.) return 1 ;; esac
	case "$1" in "$TOOLS_DIR" | "$TOOLS_DIR"/*) ;; *) return 1 ;; esac
	rm -rf -- "$1"
}

repeat() {
	local out="" i=0
	while [ "$i" -lt "$2" ]; do
		out="$out$1"
		i=$((i + 1))
	done
	printf '%s' "$out"
}

draw() {
	local fill=$(($2 * BAR_WIDTH / 100))
	printf '\r\033[K  Installing %-15s [%s%s] %3d%%' "$1" "$(repeat '=' "$fill")" "$(repeat ' ' $((BAR_WIDTH - fill)))" "$2"
}

# Eases towards the end of the step without reaching it: a third of the way through the expected time it is
# halfway, and it keeps slowing down if the step takes longer than expected.
animate() {
	local label="$1" start="$2" end="$3" k=$(($4 * 10 / 3 + 1)) t=0
	while kill -0 "$SCRIPT_PID" 2>/dev/null; do
		draw "$label" $((start + (end - start) * t / (t + k)))
		sleep 0.2
		t=$((t + 2))
	done
}

stop_animation() {
	[ -n "$TOOLS_DIR" ] && [ -f "$TOOLS_DIR/animation.pid" ] || return 0
	local pid
	pid="$(cat "$TOOLS_DIR/animation.pid")"
	remove_tool_path "$TOOLS_DIR/animation.pid" || true
	kill "$pid" 2>/dev/null || true
	wait "$pid" 2>/dev/null || true
}

# step LABEL START% END% EXPECTED_SECONDS
step() {
	stop_animation
	LABEL="$1"
	STEP_END="$3"
	if [ -z "$FANCY" ]; then
		printf 'Installing %s...\n' "$1"
		return
	fi
	animate "$1" "$2" "$3" "$4" &
	echo $! >"$TOOLS_DIR/animation.pid"
}

step_done() {
	stop_animation
	if [ -n "$FANCY" ]; then
		draw "$LABEL" "$STEP_END"
	fi
}

finish_bar() {
	stop_animation
	if [ -n "$FANCY" ]; then
		draw "$1" 100
		printf '\n'
	fi
}

end_bar() {
	stop_animation
	if [ -n "$FANCY" ]; then
		printf '\r\033[K'
	fi
}

say() {
	end_bar
	printf '%s\n' "$*"
}

warn() {
	end_bar
	printf '%sNote:%s %s\n' "$YELLOW" "$PLAIN" "$*" >&2
}

fail() {
	end_bar
	printf '%sError:%s %s\n' "$RED" "$PLAIN" "$*" >&2
	exit 1
}

# Runs a command with its output kept in the log; on failure shows the end of that command's output and returns
# its status.
try_quiet() {
	local status=0 start
	start=$(wc -c <"$LOG")
	"$@" >>"$LOG" 2>&1 </dev/null || status=$?
	if [ "$status" -eq 0 ]; then
		return 0
	fi
	end_bar
	printf '%sError:%s installing %s failed. The last lines it printed:\n' "$RED" "$PLAIN" "$LABEL" >&2
	tail -c +$((start + 1)) "$LOG" | tail -n 25 | sed 's/^/    /' >&2
	return "$status"
}

quiet() {
	try_quiet "$@" || exit 1
}

# shellcheck disable=SC2329 # run by the EXIT trap that main sets
cleanup() {
	local status=$?
	# Nothing may stop the removal below: not another signal, and not a failed write to a terminal that was closed.
	trap '' HUP INT TERM
	set +e
	end_bar
	if [ -n "$TOOLS_DIR" ] && [ -d "$TOOLS_DIR" ]; then
		if [ -d "$TOOLS_DIR/studio-dmg" ]; then
			hdiutil detach -quiet "$TOOLS_DIR/studio-dmg" >/dev/null 2>&1 || true
		fi
		case "$TOOLS_DIR" in
		/*/overengineered-tools.*) chmod -R u+w -- "$TOOLS_DIR" 2>/dev/null ;;
		esac
		remove_tool_path "$TOOLS_DIR"
	fi
	if [ "$status" -ne 0 ]; then
		if [ "$status" -eq 130 ]; then
			printf '\nCancelled.' >&2
		else
			printf '\n%sInstallation failed.%s' "$RED" "$PLAIN" >&2
		fi
		if [ -n "$BUILT_DIR" ]; then
			printf ' The game is built in %s, but setting up Roblox Studio did not finish.' "$BUILT_DIR" >&2
		elif [ -n "$PROJECT_DIR" ]; then
			printf ' The game files are in %s; run the command again to finish.' "$PROJECT_DIR" >&2
		fi
		if [ -n "$SYSTEM_CHANGED" ]; then
			printf ' Flatpak and its Flathub source may already have been added for Vinegar.\n' >&2
		elif [ -z "$PROJECT_DIR" ]; then
			printf ' Nothing was installed on your system.\n' >&2
		else
			printf '\n' >&2
		fi
	fi
	exit "$status"
}

detect_platform() {
	case "$(uname -s)" in
	Darwin) OS="darwin" ;;
	Linux) OS="linux" ;;
	*) fail "This script is for macOS and Linux. On Windows, use the command for Windows in the README." ;;
	esac
	case "$(uname -m)" in
	x86_64 | amd64) ARCH="x64" ;;
	arm64 | aarch64) ARCH="arm64" ;;
	*) fail "Unsupported processor: $(uname -m). Only 64-bit Intel/AMD and ARM are supported." ;;
	esac
}

try_download() {
	local url="$1" out="$2"
	if has curl; then
		curl -fsSL --retry 3 --retry-delay 2 --connect-timeout 30 --speed-limit 1024 --speed-time 60 -o "$out" "$url" 2>>"$LOG"
	elif has wget; then
		wget --no-hsts -q --tries=3 --timeout=30 -O "$out" "$url" 2>>"$LOG"
	else
		fail "Neither curl nor wget is available to download files."
	fi
}

download() {
	try_download "$1" "$2" || fail "Could not download $1. Check your internet connection and run the command again."
}

sha256_of() {
	if has sha256sum; then
		sha256sum "$1" | cut -d ' ' -f 1
	elif has shasum; then
		shasum -a 256 "$1" | cut -d ' ' -f 1
	fi
}

download_verified() {
	local url="$1" out="$2" expected="$3" actual
	download "$url" "$out"
	actual="$(sha256_of "$out")"
	[ -n "$actual" ] || fail "Neither sha256sum nor shasum is available to verify downloads."
	[ "$actual" = "$expected" ] || fail "Download of $url is corrupted (checksum mismatch). Run the command again."
}

# Extracts only the named member: the archive is not checksum-verified, and naming the one file it should contain
# means no path inside it can write outside DEST.
extract_member() {
	local zip="$1" member="$2" dest="$3"
	mkdir -p "$dest"
	if has unzip; then
		quiet unzip -q -o "$zip" "$member" -d "$dest"
	elif has bsdtar; then
		quiet bsdtar -xf "$zip" -C "$dest" "$member"
	elif has python3; then
		quiet python3 -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extract(sys.argv[2], sys.argv[3])' "$zip" "$member" "$dest"
	else
		fail "Cannot extract $zip: install unzip (for example: sudo apt install unzip) and run the command again."
	fi
	[ -f "$dest/$member" ] || fail "The downloaded $zip does not contain $member."
}

# The compiler requires yargs 18, an ES module, which Node can only require() from 20.19 and 22.12 on (yargs'
# engines: ^20.19.0 || ^22.12.0 || >=23); on older versions the build fails with ERR_REQUIRE_ESM. Odd majors up
# to 25 are short-lived and never reach LTS; from 27 every major does (nodejs.org/en/about/previous-releases).
node_version_supported() {
	local major minor rest
	major="${1%%.*}"
	rest="${1#*.}"
	minor="${rest%%.*}"
	case "$1" in *.*) ;; *) return 1 ;; esac
	case "$major" in '' | *[!0-9]*) return 1 ;; esac
	case "$minor" in '' | *[!0-9]*) return 1 ;; esac
	if [ "$major" -ge 27 ]; then
		return 0
	elif [ "$major" -ge 24 ]; then
		[ $((major % 2)) -eq 0 ]
	elif [ "$major" -eq 22 ]; then
		[ "$minor" -ge 12 ]
	elif [ "$major" -eq 20 ]; then
		[ "$minor" -ge 19 ]
	else
		return 1
	fi
}

# On macOS /usr/bin/git is a stub until the Xcode Command Line Tools are installed, and running it opens an
# install dialog, so it must not be invoked to find out.
git_usable() {
	has git || return 1
	if [ "$OS" = "darwin" ] && [ "$(command -v git)" = "/usr/bin/git" ] && ! xcode-select -p >/dev/null 2>&1; then
		return 1
	fi
	git --version >/dev/null 2>&1
}

provide_node() {
	if has node && has npm; then
		local version
		version="$(node -p 'process.versions.node' 2>/dev/null)" || version=""
		if node_version_supported "$version"; then
			return
		fi
		printf 'Your Node.js is v%s; this project needs %s. A temporary copy is used instead.\n' "$version" "$NODE_RANGE" >>"$LOG"
	fi

	local sum
	case "$OS-$ARCH" in
	darwin-arm64) sum="db4b275b83736df67533529a18cc55de2549a8329ace6c7bcc68f8d22d3c9000" ;;
	darwin-x64) sum="12a6abb9c2902cf48a21120da13f87fde1ed1b71a13330712949e8db818708ba" ;;
	linux-arm64) sum="b2f3a96f31486bfc365192ad65ced14833ad2a3c2e1bcefec4846902f264fa28" ;;
	linux-x64) sum="978978a635eef872fa68beae09f0aad0bbbae6757e444da80b570964a97e62a3" ;;
	esac

	local name="node-v$NODE_VERSION-$OS-$ARCH"
	step "Node.js" 2 15 20
	download_verified "https://nodejs.org/dist/v$NODE_VERSION/$name.tar.gz" "$TOOLS_DIR/node.tar.gz" "$sum"
	quiet tar -xzf "$TOOLS_DIR/node.tar.gz" -C "$TOOLS_DIR"
	remove_tool_path "$TOOLS_DIR/node.tar.gz"
	export PATH="$TOOLS_DIR/$name/bin:$PATH"
	node --version >/dev/null 2>&1 || fail "The downloaded Node.js does not run on this system."
	step_done
}

provide_git() {
	if git_usable; then
		return
	fi

	local platform sum
	case "$OS-$ARCH" in
	darwin-arm64) platform="macOS-arm64" sum="f9dc64635a5b62fbd7ad95db73268bbb8912255ac516d65d37bf7af22fcb8ffe" ;;
	darwin-x64) platform="macOS-x64" sum="ae6686718aa34f4140424db16b92a47dcffd6d1f312eb8b5f3b267f7404e2680" ;;
	linux-arm64) platform="ubuntu-arm64" sum="a161f45af4626bb7e0c688854bd4a9aee47cc514bca404cff0a5e3536ef1c0af" ;;
	linux-x64) platform="ubuntu-x64" sum="cca76aa31ad9e835e771ee7f55b73934777fbd8d16757a10d307ba06de860901" ;;
	esac

	local dir="$TOOLS_DIR/git"
	step "Git" 15 25 15
	download_verified "$GIT_RELEASE/$GIT_ASSET-$platform.tar.gz" "$TOOLS_DIR/git.tar.gz" "$sum"
	mkdir -p "$dir"
	quiet tar -xzf "$TOOLS_DIR/git.tar.gz" -C "$dir"
	remove_tool_path "$TOOLS_DIR/git.tar.gz"

	# The environment dugite's setupEnvironment gives its bundled Git (lib/git-environment.ts), set only for git
	# through a wrapper: exported for the whole run, PREFIX would also become npm's global prefix.
	local bin="$TOOLS_DIR/git-bin"
	mkdir -p "$bin"
	{
		printf '#!/bin/sh\n'
		printf "export GIT_EXEC_PATH='%s/libexec/git-core'\n" "$dir"
		printf "export GIT_TEMPLATE_DIR='%s/share/git-core/templates'\n" "$dir"
		printf "export GIT_CONFIG_SYSTEM=\"\${GIT_CONFIG_SYSTEM:-%s/etc/gitconfig}\"\n" "$dir"
		if [ "$OS" = "linux" ]; then
			printf "export PREFIX='%s'\n" "$dir"
			printf "export GIT_SSL_CAINFO=\"\${GIT_SSL_CAINFO:-%s/ssl/cacert.pem}\"\n" "$dir"
		fi
		printf "exec '%s/bin/git' \"\$@\"\n" "$dir"
	} >"$bin/git"
	chmod +x "$bin/git"
	export PATH="$bin:$PATH"
	git --version >/dev/null 2>&1 || fail "The downloaded Git does not run on this system."
	step_done
}

# The build deletes and rewrites files in the folder it runs in (npm ci replaces node_modules), so it only ever
# runs in a folder that is this project.
is_project() {
	[ -f "$1/rokit.toml" ] && [ -f "$1/lune/assemble.luau" ] && [ -f "$1/default.project.json" ]
}

# A clone of this repository specifically, not upstream OverEngineered or another fork, whichever URL form it uses.
is_our_clone() {
	local url
	url="$(git -C "$1" remote get-url origin 2>/dev/null)" || return 1
	url="$(printf '%s' "$url" | tr '[:upper:]' '[:lower:]')"
	url="${url%/}"
	url="${url%.git}"
	case "$url" in
	https://github.com/ftrookie/overengineered | git@github.com:ftrookie/overengineered | ssh://git@github.com/ftrookie/overengineered) return 0 ;;
	*) return 1 ;;
	esac
}

# Git overwrites an ignored file without asking when an update adds a tracked file at the same path, so the update
# is skipped (status 2) when anything it would add is already on disk. Names are read NUL-separated so that none is
# quoted or escaped past the check.
update_project() {
	git fetch --quiet >>"$LOG" 2>&1 </dev/null || return 1
	git diff -z --name-only --no-renames --diff-filter=A HEAD '@{upstream}' >"$TOOLS_DIR/added" 2>>"$LOG" || return 1
	local path first
	while IFS= read -r -d '' path; do
		first=1
		while :; do
			if [ -L "$path" ] || { [ -e "$path" ] && { [ -n "$first" ] || [ ! -d "$path" ]; }; }; then
				return 2
			fi
			first=""
			case "$path" in */*) path="${path%/*}" ;; *) break ;; esac
		done
	done <"$TOOLS_DIR/added"
	git merge --ff-only --quiet '@{upstream}' >>"$LOG" 2>&1 </dev/null
}

enter_project() {
	step "game files" 25 35 20
	local script_dir=""
	if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
		script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
	fi
	if [ -n "$script_dir" ] && is_project "$script_dir/.."; then
		cd "$script_dir/.."
		PROJECT_DIR="$(pwd -P)"
		step_done
		return
	fi

	local dir="${OE_DIR:-$HOME/overengineered}"
	if [ -d "$dir/.git" ]; then
		if ! is_project "$dir" || ! is_our_clone "$dir"; then
			fail "$dir holds a different project or a different copy of this one. Move or rename it, then run the command again."
		fi
		cd "$dir"
		PROJECT_DIR="$(pwd -P)"
		local status=0
		if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
			warn "The project in $(pwd) has local changes, so it was not updated."
		else
			update_project || status=$?
			if [ "$status" -eq 2 ]; then
				warn "Updating the project in $(pwd) would overwrite files you have, so it was not updated."
			elif [ "$status" -ne 0 ]; then
				warn "Could not update the project in $(pwd); building the version already there."
			fi
		fi
		step_done
		return
	fi

	if [ -e "$dir" ] && [ -n "$(ls -A "$dir" 2>/dev/null)" ]; then
		fail "$dir already exists and is not this project. Move or rename it, then run the command again."
	fi
	quiet git clone --quiet "$REPO_URL" "$dir"
	cd "$dir"
	PROJECT_DIR="$(pwd -P)"
	step_done
}

provide_lune() {
	local version
	version="$(sed -n 's/^lune *= *"lune-org\/lune@\([^"]*\)".*/\1/p' rokit.toml)"
	[ -n "$version" ] || fail "Could not read the Lune version from rokit.toml."

	if has lune && [ "$(lune --version 2>/dev/null)" = "lune $version" ]; then
		return
	fi

	# Lune publishes no checksums; these are of the 0.10.5 release files, taken when that version was pinned. Another
	# version in rokit.toml is downloaded unverified, which extract_member keeps inside TOOLS_DIR.
	local platform sum=""
	case "$OS-$ARCH" in
	darwin-arm64) platform="macos-aarch64" sum="bdb94f47bc1d3af3e3fe796cfce9c7f406042d4aada9cc41a1c53836f3e3b411" ;;
	darwin-x64) platform="macos-x86_64" sum="f4b43cfd495994b7ef783ac2bb0aa24f1f940f3804b28018121bb3cc2171c1a7" ;;
	linux-arm64) platform="linux-aarch64" sum="176e1272d41ba3d9ea30087b528048a4a97e3d74cfa0eaa5d35d9e0d4122caa6" ;;
	linux-x64) platform="linux-x86_64" sum="1fb5dee6a1afa1d300092805c6e660fe06144d29dd68c45cf6956f040667f791" ;;
	esac

	step "Lune" 35 40 10
	local url="https://github.com/lune-org/lune/releases/download/v$version/lune-$version-$platform.zip"
	if [ "$version" = "0.10.5" ]; then
		download_verified "$url" "$TOOLS_DIR/lune.zip" "$sum"
	else
		download "$url" "$TOOLS_DIR/lune.zip"
	fi
	extract_member "$TOOLS_DIR/lune.zip" lune "$TOOLS_DIR/lune"
	remove_tool_path "$TOOLS_DIR/lune.zip"
	chmod +x "$TOOLS_DIR/lune/lune"
	export PATH="$TOOLS_DIR/lune:$PATH"
	[ "$(lune --version 2>/dev/null)" = "lune $version" ] || fail "The downloaded Lune does not run on this system."
	step_done
}

build() {
	step "packages" 40 70 90
	quiet npm ci --no-audit --no-fund
	step_done

	step "game" 70 92 60
	quiet npm run build
	step_done

	step "place file" 92 99 15
	# The one file deleted outside TOOLS_DIR: the build's own output, by absolute path in the checked project.
	case "$PROJECT_DIR" in /?*) ;; *) fail "The project folder is unknown." ;; esac
	rm -f -- "$PROJECT_DIR/place.rbxl"
	quiet lune run assemble
	[ -f "$PROJECT_DIR/place.rbxl" ] || fail "The build finished but place.rbxl was not created."
	step_done
}

# Studio gets the environment the script started with, not one pointing into TOOLS_DIR.
restore_environment() {
	export PATH="$ORIGINAL_PATH"
	if [ -n "$TMPDIR_WAS_SET" ]; then
		export TMPDIR="$ORIGINAL_TMPDIR"
	else
		unset TMPDIR
	fi
	unset npm_config_cache npm_config_update_notifier npm_config_logs_max GIT_TERMINAL_PROMPT
}

vinegar_installed() {
	has flatpak && flatpak info "$VINEGAR_ID" >/dev/null 2>&1
}

# Asks for the password in the open, before the progress bar hides the output.
get_root() {
	if [ "$(id -u)" -eq 0 ]; then
		return 0
	fi
	has sudo || return 1
	say "Roblox Studio on Linux needs Flatpak. Enter your password to install it."
	# The shell opening the terminal for sudo's input is intended: stdin is the piped script.
	# shellcheck disable=SC2024
	sudo -v </dev/tty
}

as_root() {
	if [ "$(id -u)" -eq 0 ]; then
		"$@"
	else
		sudo -n "$@"
	fi
}

# Keeps sudo's cached password alive through long package manager waits.
refresh_root() {
	if [ "$(id -u)" -ne 0 ]; then
		sudo -n -v 2>/dev/null || true
	fi
}

# Right after a fresh Ubuntu boots, its automatic updates hold apt's locks. DPkg::Lock::Timeout makes apt-get wait
# for the dpkg lock, but not for the package lists lock that "apt-get update" takes, so that one is retried.
apt_update() {
	local attempt=0 out="$TOOLS_DIR/apt-update.log"
	while [ "$attempt" -lt 30 ]; do
		refresh_root
		if as_root env DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=600 update >"$out" 2>&1 </dev/null; then
			cat "$out" >>"$LOG"
			return 0
		fi
		cat "$out" >>"$LOG"
		grep -q 'Could not get lock' "$out" || return 1
		if [ "$attempt" -eq 0 ]; then
			say "Ubuntu is installing updates in the background; waiting for it to finish (this can take a few minutes)."
			step "Flatpak" 0 20 300
		fi
		attempt=$((attempt + 1))
		sleep 10
	done
	return 1
}

# Commands from https://flathub.org/setup; apt needs an index refresh first or a stale one fails with 404s. None of
# them may remove a package: apt aborts on that with --no-remove, dnf only erases with --allowerasing, and pacman's
# conflict question defaults to No, which --noconfirm takes. zypper's documentation does not say what its
# non-interactive mode answers to a conflict, so it is not used. Called only on the left of ||, where set -e is
# off, so every step returns explicitly.
install_flatpak() {
	get_root || return 1
	step "Flatpak" 0 20 60
	SYSTEM_CHANGED=1
	if has apt-get; then
		apt_update || true
		refresh_root
		try_quiet as_root env DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=600 install -y --no-remove flatpak || return 1
	elif has dnf; then
		try_quiet as_root dnf install -y flatpak || return 1
	elif has pacman; then
		try_quiet as_root pacman -S --needed --noconfirm flatpak || return 1
	else
		end_bar
		return 1
	fi
	step_done
}

install_vinegar() {
	if ! has flatpak; then
		install_flatpak || return 1
		has flatpak || return 1
	fi
	step "Roblox Studio" 20 99 240
	SYSTEM_CHANGED=1
	try_quiet flatpak remote-add --user --if-not-exists flathub "$FLATHUB_REPO" || return 1
	try_quiet flatpak install --user -y --noninteractive flathub "$VINEGAR_ID" || return 1
	finish_bar "Roblox Studio"
}

find_studio_app() {
	local app
	for app in "/Applications/RobloxStudio.app" "$HOME/Applications/RobloxStudio.app"; do
		if [ -d "$app" ]; then
			printf '%s\n' "$app"
			return 0
		fi
	done
	return 1
}

install_studio_macos() {
	step "Roblox Studio" 0 50 20
	if ! try_download "$STUDIO_DMG_URL" "$TOOLS_DIR/RobloxStudio.dmg"; then
		warn "Could not download the Roblox Studio installer."
		return
	fi
	local mount="$TOOLS_DIR/studio-dmg"
	mkdir -p "$mount"
	if ! hdiutil attach -quiet -nobrowse -readonly -mountpoint "$mount" "$TOOLS_DIR/RobloxStudio.dmg" >>"$LOG" 2>&1; then
		warn "Could not open the Roblox Studio installer."
		return
	fi
	say "The Roblox Studio installer is open. Follow it; this continues once it closes."
	open -W "$mount/RobloxStudioInstaller.app" || warn "The Roblox Studio installer did not finish."
	hdiutil detach -quiet "$mount" >/dev/null 2>&1 || true
}

open_place() {
	local place
	place="$(pwd)/place.rbxl"

	if [ "$OS" = "darwin" ]; then
		local app
		app="$(find_studio_app)" || {
			install_studio_macos
			app="$(find_studio_app)"
		} || {
			warn "Roblox Studio was not found. Install it from https://create.roblox.com/, then open $place"
			return
		}
		if open -a "$app" "$place"; then
			STUDIO_OPENED=1
		else
			warn "Could not open Roblox Studio. Open $place from Studio."
		fi
		return
	fi

	local open_cmd="flatpak run --file-forwarding $VINEGAR_ID @@u \"$place\" @@"
	if [ "$ARCH" != "x64" ]; then
		warn "Roblox Studio runs on Linux through Vinegar, which only exists for 64-bit Intel/AMD processors. The game is built at $place"
		return
	fi

	local first_run=""
	if ! vinegar_installed; then
		install_vinegar || {
			warn "Could not install Vinegar, which runs Roblox Studio on Linux. Install it from https://vinegarhq.org, then run: $open_cmd"
			return
		}
		first_run=1
	fi

	# Vinegar's sandbox cannot see the project folder, so the place goes through the document portal, the same way
	# as when the file is double-clicked (flatpak export turns Vinegar's "Exec=vinegar %u" into this form). Its own
	# session, so closing this terminal does not close Studio.
	if has setsid; then
		setsid flatpak run --file-forwarding "$VINEGAR_ID" @@u "$place" @@ </dev/null >/dev/null 2>&1 &
	else
		nohup flatpak run --file-forwarding "$VINEGAR_ID" @@u "$place" @@ </dev/null >/dev/null 2>&1 &
	fi
	# flatpak keeps running while Vinegar does, or exits 0 at once after handing the file to a Vinegar that is
	# already open; anything else within a couple of seconds is a failure to start.
	local pid=$! status=0
	sleep 2
	if ! kill -0 "$pid" 2>/dev/null; then
		wait "$pid" || status=$?
	fi
	if [ "$status" -ne 0 ]; then
		warn "Roblox Studio (Vinegar) did not start. Run: $open_cmd"
		return
	fi
	STUDIO_OPENED=1
	if [ -n "$first_run" ]; then
		say "Vinegar shows its first-time setup instead of the game this once. When it is done, run: $open_cmd"
	fi
}

main() {
	detect_platform
	trap cleanup EXIT
	trap 'exit 130' INT
	trap 'exit 143' TERM
	trap 'exit 129' HUP
	# Absolute, so no later cd can make a deletion resolve somewhere else, even when TMPDIR is a relative path.
	local created
	created="$(mktemp -d "${TMPDIR:-/tmp}/overengineered-tools.XXXXXX")"
	TOOLS_DIR="$(cd -- "$created" && pwd -P)"
	LOG="$TOOLS_DIR/output.log"
	mkdir -p "$TOOLS_DIR/tmp"

	# Node, npm and git leave caches in the temp folder and npm keeps one in the home folder; pointing both into
	# TOOLS_DIR removes them with it.
	export TMPDIR="$TOOLS_DIR/tmp"
	export npm_config_cache="$TOOLS_DIR/npm-cache"
	export npm_config_update_notifier=false
	# npm's own failure message points at a debug log in its cache, which is deleted with TOOLS_DIR.
	export npm_config_logs_max=0
	export GIT_TERMINAL_PROMPT=0

	say "Installing Underengineered. This takes a few minutes."
	provide_node
	provide_git
	enter_project
	provide_lune
	build
	finish_bar "Underengineered"
	BUILT_DIR="$PROJECT_DIR"

	local project="$BUILT_DIR"
	restore_environment
	open_place
	if [ -n "$STUDIO_OPENED" ]; then
		say "Done! The game is in $project and is opening in Roblox Studio."
	else
		say "Done! The game is built in $project."
	fi
}

# On one line so bash has read it whole before running it, and never reads the file past it: when the script runs
# from a file that changes meanwhile, whatever lies at the old offset would otherwise run next.
main "$@"; exit

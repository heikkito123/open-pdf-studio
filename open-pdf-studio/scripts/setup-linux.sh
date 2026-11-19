#!/usr/bin/env bash
# Run as your normal user; only the system package steps use sudo.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
app_dir="$(cd -- "$script_dir/.." && pwd)"
repo_dir="$(cd -- "$app_dir/.." && pwd)"
rust_toolchain='1.99.1' # Matches .github/workflows/ci.yml.

if [[ "$(id -u)" == 0 ]]; then
  printf '%s\n' 'Run this script as your normal user, without sudo. It requests sudo for APT itself.' >&2
  exit 1
fi
if ! command -v apt-get >/dev/null; then
  printf '%s\n' 'This setup script supports Debian/Ubuntu systems with APT.' >&2
  exit 1
fi

# GUI terminals do not always load nvm before running a script.
if ! command -v node >/dev/null && [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  source "$HOME/.nvm/nvm.sh"
fi
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  printf '%s\n' 'Install Node.js 22.13+ or 24+ and npm, then run this script again.' >&2
  exit 1
fi
node -e 'const [major, minor] = process.versions.node.split(".").map(Number);
  if (!((major === 22 && minor >= 13) || major >= 24)) {
    console.error("The locked PDF.js dependency needs Node.js 22.13+ or 24+."); process.exit(1);
  }'

printf '%s\n' 'Installing system build dependencies (Ayatana AppIndicator)...'
sudo apt-get update
sudo apt-get install -y --no-remove \
  build-essential cmake curl pkg-config \
  libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
  librsvg2-dev patchelf libssl-dev libxdo-dev

if ! command -v rustup >/dev/null && [[ -f "$HOME/.cargo/env" ]]; then
  source "$HOME/.cargo/env"
fi
if ! command -v rustup >/dev/null; then
  installer="$(mktemp "${TMPDIR:-/tmp}/opds-rustup.XXXXXX")"
  trap 'rm -f -- "$installer"' EXIT
  curl --proto '=https' --tlsv1.2 --fail --silent --show-error \
    --location --retry 3 https://sh.rustup.rs -o "$installer"
  sh "$installer" -y --profile minimal --default-toolchain "$rust_toolchain"
  source "$HOME/.cargo/env"
else
  rustup toolchain install "$rust_toolchain" --profile minimal
fi

cd -- "$repo_dir"
rustup override set "$rust_toolchain"
cd -- "$app_dir"
npm ci
npm run prepare:native-runtime
npm run prepare:ocr-runtime

printf '\n%s\n' 'Verifying build tools and native development libraries...'
node --version
npm --version
rustc --version
cargo --version
cmake --version
pkg-config --modversion gtk+-3.0 webkit2gtk-4.1 ayatana-appindicator3-0.1
printf '\n%s\n' 'Development dependencies are ready.'
printf 'Application directory: %s\n' "$app_dir"
if [[ -f "$HOME/.cargo/env" ]]; then
  printf '%s\n' 'In your terminal, run: source "$HOME/.cargo/env"'
fi
printf '%s\n' 'Next: npm run tauri:dev (close the installed app first).'

#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  printf 'Usage: bash scripts/install-gitleaks.sh <bin-directory>\n' >&2
  exit 1
fi
if [[ "$(uname -sm)" != 'Linux x86_64' ]]; then
  printf 'This installer supports Linux x64. See README.md for other platforms.\n' >&2
  exit 1
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
version="$(cat "$script_dir/../.gitleaks-version")"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  printf 'Invalid version in .gitleaks-version.\n' >&2
  exit 1
fi

install_dir="$1"
download_dir="$(mktemp -d)"
trap 'rm -rf -- "$download_dir"' EXIT
archive="gitleaks_${version}_linux_x64.tar.gz"
base_url="https://github.com/gitleaks/gitleaks/releases/download/v${version}"
curl_args=(--fail --silent --show-error --location --proto '=https' --proto-redir '=https' --connect-timeout 10 --max-time 60 --retry 2)

curl "${curl_args[@]}" "$base_url/$archive" --output "$download_dir/$archive"
curl "${curl_args[@]}" "$base_url/gitleaks_${version}_checksums.txt" --output "$download_dir/checksums.txt"
(cd "$download_dir" && sha256sum --check --ignore-missing checksums.txt)
tar -xzf "$download_dir/$archive" -C "$download_dir" gitleaks
mkdir -p -- "$install_dir"
install -m 755 -- "$download_dir/gitleaks" "$install_dir/gitleaks"
"$install_dir/gitleaks" version

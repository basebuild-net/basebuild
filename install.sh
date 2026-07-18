#!/bin/sh
set -eu

repo="basebuild-net/basebuild"
os="$(uname -s)"
arch="$(uname -m)"
tmpdir="$(mktemp -d 2>/dev/null || mktemp -d -t basebuild-install)"
mountpoint=""

cleanup() {
  if [ -n "$mountpoint" ]; then
    hdiutil detach "$mountpoint" -quiet >/dev/null 2>&1 || true
  fi
  rm -rf "$tmpdir"
}
trap cleanup EXIT HUP INT TERM

require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Basebuild installer requires '$1'." >&2
    exit 1
  }
}

case "$os" in
  Darwin)
    case "$arch" in
      arm64|x86_64) ;;
      *)
        echo "Basebuild's universal macOS release does not support architecture '$arch'." >&2
        exit 1
        ;;
    esac

    require curl
    require hdiutil
    require ditto

    asset="Basebuild-macos-universal.dmg"
    artifact="$tmpdir/$asset"
    url="https://github.com/$repo/releases/latest/download/$asset"
    destination="${BASEBUILD_INSTALL_DIR:-$HOME/Applications}"
    mountpoint="$tmpdir/mount"
    mkdir -p "$mountpoint" "$destination"

    echo "Downloading the latest Basebuild release..."
    curl --fail --location --proto '=https' --tlsv1.2 "$url" --output "$artifact"
    [ -s "$artifact" ] || {
      echo "Downloaded disk image is empty." >&2
      exit 1
    }

    hdiutil attach "$artifact" -nobrowse -readonly -mountpoint "$mountpoint" -quiet
    [ -d "$mountpoint/Basebuild.app" ] || {
      echo "Basebuild.app is missing from the downloaded disk image." >&2
      exit 1
    }

    rm -rf "$destination/Basebuild.app"
    ditto "$mountpoint/Basebuild.app" "$destination/Basebuild.app"
    echo "Basebuild installed at $destination/Basebuild.app"
    echo "This build is ad-hoc signed. macOS may require Open or Control-click > Open on first launch."
    ;;

  Linux)
    case "$arch" in
      x86_64|amd64) ;;
      *)
        echo "Basebuild currently publishes Linux x86_64 releases only; detected '$arch'." >&2
        exit 1
        ;;
    esac

    require curl
    require od
    require tr
    require install

    asset="Basebuild-linux-x86_64.AppImage"
    artifact="$tmpdir/$asset"
    url="https://github.com/$repo/releases/latest/download/$asset"
    destination="${BASEBUILD_INSTALL_DIR:-$HOME/.local/bin}"
    target="$destination/basebuild"
    mkdir -p "$destination"

    echo "Downloading the latest Basebuild release..."
    curl --fail --location --proto '=https' --tlsv1.2 "$url" --output "$artifact"
    [ -s "$artifact" ] || {
      echo "Downloaded AppImage is empty." >&2
      exit 1
    }

    magic="$(od -An -t x1 -N4 "$artifact" | tr -d ' \n')"
    [ "$magic" = "7f454c46" ] || {
      echo "Downloaded file is not an ELF executable." >&2
      exit 1
    }

    install -m 0755 "$artifact" "$target"
    echo "Basebuild installed at $target"
    case ":$PATH:" in
      *":$destination:"*) ;;
      *) echo "Add $destination to PATH, then run: basebuild" ;;
    esac
    echo "For Debian/Ubuntu desktop-menu integration, install the .deb asset documented in README.md."
    ;;

  *)
    echo "Unsupported operating system '$os'. Basebuild releases target Windows, Linux, and macOS." >&2
    exit 1
    ;;
esac

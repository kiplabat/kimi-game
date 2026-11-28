#!/bin/sh
# Installs Sundown City for this user from the Linux .tar.gz (no root, no FUSE needed: works on
# KimiOS, Fedora Silverblue and other immutable systems). Usage:
#   sh install-linux.sh sundown-city-0.2.0-linux-x64.tar.gz
# Remove it again with: sh install-linux.sh --remove
set -e
DEST="$HOME/.local/share/sundown-city"
APPS="$HOME/.local/share/applications"
ICONS="$HOME/.local/share/icons/hicolor/512x512/apps"
if [ "$1" = "--remove" ]; then
  rm -rf "$DEST" "$APPS/sundown-city.desktop" "$ICONS/sundown-city.png"
  echo "Sundown City removed."; exit 0
fi
TGZ="${1:-$(ls sundown-city-*-linux-x64.tar.gz 2>/dev/null | head -n 1)}"
[ -f "$TGZ" ] || { echo "Give the path to sundown-city-…-linux-x64.tar.gz"; exit 1; }
rm -rf "$DEST" && mkdir -p "$DEST" "$APPS" "$ICONS"
tar -xzf "$TGZ" -C "$DEST" --strip-components=1
cp "$DEST/resources/icon.png" "$ICONS/sundown-city.png"
cat > "$APPS/sundown-city.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Sundown City
Comment=Open-world action game (offline)
Exec="$DEST/sundown-city" %U
Icon=sundown-city
Categories=Game;ActionGame;
Terminal=false
DESKTOP
chmod +x "$DEST/sundown-city"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS" >/dev/null 2>&1 || true
echo "Installed. Find Sundown City in your apps, or run: $DEST/sundown-city"

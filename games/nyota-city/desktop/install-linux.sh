#!/bin/sh
# Installs Nyota City for this user from the Linux .tar.gz (no root, no FUSE needed: works on
# KimiOS, Fedora Silverblue and other immutable systems). Usage:
#   sh install-linux.sh nyota-city-0.1.0-linux-x64.tar.gz
# Remove it again with: sh install-linux.sh --remove
set -e
DEST="$HOME/.local/share/nyota-city"
APPS="$HOME/.local/share/applications"
ICONS="$HOME/.local/share/icons/hicolor/512x512/apps"
if [ "$1" = "--remove" ]; then
  rm -rf "$DEST" "$APPS/nyota-city.desktop" "$ICONS/nyota-city.png"
  echo "Nyota City removed."; exit 0
fi
TGZ="${1:-$(ls nyota-city-*-linux-x64.tar.gz 2>/dev/null | head -n 1)}"
[ -f "$TGZ" ] || { echo "Give the path to nyota-city-…-linux-x64.tar.gz"; exit 1; }
rm -rf "$DEST" && mkdir -p "$DEST" "$APPS" "$ICONS"
tar -xzf "$TGZ" -C "$DEST" --strip-components=1
cp "$DEST/resources/icon.png" "$ICONS/nyota-city.png"
cat > "$APPS/nyota-city.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Nyota City
Comment=Open-world action game (offline)
Exec="$DEST/nyota-city" %U
Icon=nyota-city
Categories=Game;ActionGame;
Terminal=false
DESKTOP
chmod +x "$DEST/nyota-city"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS" >/dev/null 2>&1 || true
echo "Installed. Find Nyota City in your apps, or run: $DEST/nyota-city"

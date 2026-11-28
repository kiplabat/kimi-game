// Copies the built game (one self-contained HTML file: three.js, kimi/game and the game inlined)
// into app/, which is what the desktop app loads. Run `npm run build` at the repository root first.
const fs = require("fs");
const path = require("path");
const src = path.join(__dirname, "..", "..", "..", "dist", "play", "sundown-city.html");
if (!fs.existsSync(src)) {
  console.error("Build the game first: npm ci && npm run build (at the repository root)");
  process.exit(1);
}
fs.mkdirSync(path.join(__dirname, "app"), { recursive: true });
fs.copyFileSync(src, path.join(__dirname, "app", "index.html"));
console.log("app/index.html", (fs.statSync(src).size / 1024).toFixed(0), "KB");

// Nyota City desktop app: a window around the game, fully offline.
// The game is one HTML file (app/index.html); nothing is fetched from the internet.
const { app, BrowserWindow, Menu, session } = require("electron");
const path = require("path");

// games want the graphics card even on machines Chromium is cautious about, and full speed when unfocused
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

function create() {
  const win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 960, minHeight: 540,
    backgroundColor: "#000000", title: "Nyota City", show: false, autoHideMenuBar: true,
    icon: path.join(process.resourcesPath ?? __dirname, "icon.png"),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, spellcheck: false },
  });
  Menu.setApplicationMenu(null);
  win.once("ready-to-show", () => win.show());
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F11" || (input.alt && input.key === "Enter")) { win.setFullScreen(!win.isFullScreen()); event.preventDefault(); }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, "app", "index.html"));
}

app.whenReady().then(() => {
  const s = session.defaultSession;
  s.setPermissionRequestHandler((_wc, permission, done) => done(["pointerLock", "fullscreen"].includes(permission)));
  // offline by design: only the game's own file and in-memory data
  s.webRequest.onBeforeRequest((d, done) => done({ cancel: !/^(file|data|blob|devtools):/.test(d.url) }));
  create();
});
app.on("window-all-closed", () => app.quit());

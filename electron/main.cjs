const { app, BrowserWindow, Menu } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

// The renderer is a local, bundled game. No development server is used in a release.
app.setName("Eternal Realms");
let gameWindow;
const indexPath = path.join(__dirname, "..", "dist", "index.html");
const indexURL = pathToFileURL(indexPath).href;

function createWindow() {
  Menu.setApplicationMenu(null);
  gameWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: "Eternal Realms — Shadow of the Ancients",
    backgroundColor: "#102020",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged || process.argv.includes("--diagnostics"),
      backgroundThrottling: false,
    },
  });
  gameWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  gameWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== indexURL) event.preventDefault();
  });
  gameWindow.webContents.session.setPermissionRequestHandler(
    (_contents, permission, callback) => {
      callback(permission === "fullscreen" || permission === "pointerLock");
    },
  );
  gameWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "F11") {
      gameWindow.setFullScreen(!gameWindow.isFullScreen());
      event.preventDefault();
    }
  });
  gameWindow.once("ready-to-show", () => gameWindow.show());
  gameWindow.on("closed", () => {
    gameWindow = null;
  });
  // Explicit opt-in for the automated desktop smoke test; ordinary launches expose no diagnostics.
  gameWindow.loadFile(
    indexPath,
    process.argv.includes("--diagnostics")
      ? { query: { test: "1" } }
      : undefined,
  );
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { spawn } = require("child_process");

let win;
let py;

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  win.loadURL("http://localhost:3000"); // React dev server
}

app.whenReady().then(() => {
  // 1. Start Python engine
  const pythonPath = path.join(__dirname, "..", "python", "engine.py");

  console.log("PYTHON ENTRY PATH:", pythonPath); // add this for debugging

  py = spawn("python", [pythonPath]);

  console.log("PYTHON PROCESS STARTED:", py.pid);

  py.on("error", (err) => {
    console.log("PYTHON ERROR:", err);
  });

  py.stdout.on("data", (data) => {
    console.log("PYTHON STDOUT:", data.toString());
  });

  py.stderr.on("data", (data) => {
    console.log("PYTHON STDERR:", data.toString());
  });

  ipcMain.on("python-task", (event, msg) => {
    console.log("MAIN RECEIVED FROM REACT:", msg);
    py.stdin.write(JSON.stringify(msg) + "\n");
  });

  // 3. Receive responses from Python and forward to React
  py.stdout.on("data", (data) => {
    let text = data.toString().trim();

    const messages = text.split("\n");

    messages.forEach((line) => {
      if (!line) return;
      try {
        const msg = JSON.parse(line);
        win.webContents.send("python-response", msg);
      } catch (err) {
        console.error("Invalid JSON from Python:", line);
      }
    });
  });

  // 4. Create the window LAST
  createWindow();
});

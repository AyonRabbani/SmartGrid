const { contextBridge, ipcRenderer } = require("electron");

// Debug to confirm preload is running
console.log("PRELOAD LOADED");

contextBridge.exposeInMainWorld("electron", {
  ipcRenderer: {
    send: (channel, data) => {
      const validChannels = ["python-task"];
      if (validChannels.includes(channel)) {
        console.log("PRELOAD SEND:", channel, data);
        ipcRenderer.send(channel, data);
      } else {
        console.warn("PRELOAD BLOCKED SEND on channel:", channel);
      }
    },

    on: (channel, func) => {
      const validChannels = ["python-response"];
      if (validChannels.includes(channel)) {
        console.log("PRELOAD LISTEN:", channel);
        ipcRenderer.on(channel, (event, ...args) => func(event, ...args));
      } else {
        console.warn("PRELOAD BLOCKED LISTENER on channel:", channel);
      }
    }
  }
});

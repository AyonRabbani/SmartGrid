const waiting = new Map();

export function usePythonTask() {

  function callPython(task, payload) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();

      waiting.set(id, { resolve, reject });

      window.electron.ipcRenderer.send("python-task", {
        task,
        payload,
        id,
      });
    });
  }

  window.electron.ipcRenderer.on("python-response", (_, msg) => {
    const entry = waiting.get(msg.id);
    if (!entry) return;

    waiting.delete(msg.id);

    if (msg.error) entry.reject(msg.error);
    else entry.resolve(msg.result);
  });

  return { callPython };
}


function withAckTimeout(socket, eventName, payload, timeoutMs = 1200) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ ok: false, error: "Timed out." });
    }, timeoutMs);

    socket.emit(eventName, payload, (res) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(res && typeof res === "object" ? res : { ok: false, error: "Bad ack." });
    });
  });
}

export function createSocketClient(handlers) {
  const h = handlers || {};
  
  let socket = null;

  function ensureSocket() {
    if (socket) return socket;

    const url =
      typeof window.COLLAB_CANVAS_SOCKET_URL === "string" && window.COLLAB_CANVAS_SOCKET_URL.length > 0
        ? window.COLLAB_CANVAS_SOCKET_URL
        : window.location.origin;

    socket = window.io(url, {
     
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 250,
      reconnectionDelayMax: 1500,
      timeout: 5000
    });

    socket.on("connect", () => h.onConnectionState?.({ connected: true }));
    socket.on("disconnect", () => h.onConnectionState?.({ connected: false }));
    socket.on("connect_error", (err) =>
      h.onConnectionState?.({ connected: false, error: err?.message || "connect_error" })
    );

    socket.on("init", (data) => h.onInit?.(data));
    socket.on("users:update", (data) => h.onUsersUpdate?.(data));
    socket.on("cursor:update", (data) => h.onCursorUpdate?.(data));
    socket.on("cursor:remove", (data) => h.onCursorRemove?.(data));

    socket.on("stroke:start", (data) => h.onStrokeStart?.(data));
    socket.on("stroke:point", (data) => h.onStrokePoint?.(data));
    socket.on("stroke:end", (data) => h.onStrokeEnd?.(data));

    socket.on("history:state", (data) => h.onHistoryState?.(data));

    return socket;
  }

  async function startStroke(payload) {
    const s = ensureSocket();
    if (!s.connected) return { ok: false, error: "Not connected." };
    return await withAckTimeout(s, "stroke:start", payload, 1200);
  }

  function sendPoint(payload) {
    const s = ensureSocket();
    if (!s.connected) return;
    s.emit("stroke:point", payload);
  }

  function endStroke(payload) {
    const s = ensureSocket();
    if (!s.connected) return;
    s.emit("stroke:end", payload);
  }

  function sendCursor(payload) {
    const s = ensureSocket();
    if (!s.connected) return;
    s.emit("cursor:update", payload);
  }

  async function undo() {
    const s = ensureSocket();
    if (!s.connected) return { ok: false, error: "Not connected." };
    return await withAckTimeout(s, "history:undo", {}, 1200);
  }

  async function redo() {
    const s = ensureSocket();
    if (!s.connected) return { ok: false, error: "Not connected." };
    return await withAckTimeout(s, "history:redo", {}, 1200);
  }

  function disconnect() {
    if (!socket) return;
    try {
      socket.disconnect();
    } catch {
     
    }
  }

  
  function connect() {
    ensureSocket();
  }

  return {
    connect,
    disconnect,
    startStroke,
    sendPoint,
    endStroke,
    sendCursor,
    undo,
    redo
  };
}


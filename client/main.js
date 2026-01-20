import { createSocketClient } from "./websocket.js";
import { createCanvasController } from "./canvas.js";

/**
 * App initialization / wiring.
 *
 * WHY this file exists:
 * - Keep the "glue code" (DOM + canvas + websocket) in one obvious place.
 * - Make it easy for a reviewer to follow the data flow top-to-bottom.
 */

const els = {
  canvas: document.getElementById("canvas"),
  canvasWrap: document.getElementById("canvasWrap"),
  cursorLayer: document.getElementById("cursorLayer"),
  usersList: document.getElementById("usersList"),
  meLabel: document.getElementById("meLabel"),
  connectionPill: document.getElementById("connectionPill"),
  connectionText: document.getElementById("connectionText"),
  toolBrush: document.getElementById("toolBrush"),
  toolEraser: document.getElementById("toolEraser"),
  colorPicker: document.getElementById("colorPicker"),
  strokeWidth: document.getElementById("strokeWidth"),
  strokeWidthValue: document.getElementById("strokeWidthValue"),
  undoBtn: document.getElementById("undoBtn"),
  redoBtn: document.getElementById("redoBtn"),
  clearLocalOverlayBtn: document.getElementById("clearLocalOverlayBtn")
};

function setConnectionUI({ connected, error }) {
  const dot = els.connectionPill.querySelector(".dot");
  if (connected) {
    dot.style.background = "var(--ok)";
    els.connectionText.textContent = "Connected";
  } else {
    dot.style.background = "var(--danger)";
    els.connectionText.textContent = error ? `Disconnected (${error})` : "Disconnected";
  }
}

function renderUsers(users, meId) {
  els.usersList.innerHTML = "";
  (users || []).forEach((u) => {
    const li = document.createElement("li");
    li.className = "user";

    const swatch = document.createElement("div");
    swatch.className = "swatch";
    swatch.style.background = u.color || "#60a5fa";

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = u.name || "User";

    const id = document.createElement("div");
    id.className = "id";
    id.textContent = u.id === meId ? "me" : u.id.slice(0, 4);

    li.appendChild(swatch);
    li.appendChild(name);
    li.appendChild(id);
    els.usersList.appendChild(li);
  });
}

function setActiveTool(tool) {
  els.toolBrush.classList.toggle("active", tool === "brush");
  els.toolEraser.classList.toggle("active", tool === "eraser");

  // Color doesn't apply to eraser; disabling avoids confusion.
  els.colorPicker.disabled = tool === "eraser";
}

const canvas = createCanvasController({
  canvas: els.canvas,
  canvasWrap: els.canvasWrap,
  cursorLayer: els.cursorLayer
});

let initialized = false;
let me = null;

const ws = createSocketClient({
  onConnectionState: (st) => {
    setConnectionUI(st);
    canvas.updateConnectionCursorVisibility(!!st.connected);

    // Keep drawing disabled until we have an authoritative init snapshot.
    canvas.setEnabled(!!st.connected && initialized);
  },

  onInit: (data) => {
    // This is the authoritative snapshot for late-join + reconnect.
    initialized = true;

    me = data.me;
    canvas.setMe(me);
    els.meLabel.textContent = me ? `You are ${me.name} (${me.id.slice(0, 4)})` : "";

    const users = data.users || [];
    canvas.setUsers(users);
    renderUsers(users, me?.id);

    const ops = data?.drawing?.ops || [];
    canvas.setOps(ops);

    // Seed existing cursors (best-effort; cursors are ephemeral).
    for (const cur of data.cursors || []) {
      canvas.updateCursor(cur.userId, cur);
    }

    // Now allow local drawing.
    canvas.setEnabled(true);
  },

  onUsersUpdate: (data) => {
    const users = data?.users || [];
    canvas.setUsers(users);
    renderUsers(users, me?.id);
  },

  onCursorUpdate: (data) => {
    if (!data || typeof data.userId !== "string") return;
    canvas.updateCursor(data.userId, data);
  },

  onCursorRemove: (data) => {
    const userId = data?.userId;
    if (typeof userId !== "string") return;
    canvas.removeCursor(userId);
  },

  onStrokeStart: (data) => {
    // These are other users' strokes; the server does not echo to the sender.
    const stroke = data?.stroke;
    canvas.handleRemoteStrokeStart(stroke);
  },

  onStrokePoint: (data) => {
    canvas.handleRemoteStrokePoint(data?.strokeId, data?.point);
  },

  onStrokeEnd: (data) => {
    canvas.handleRemoteStrokeEnd(data?.strokeId);
  },

  onHistoryState: (data) => {
    // Global undo/redo is easiest to apply as a full authoritative snapshot.
    const ops = data?.drawing?.ops || [];
    canvas.setOps(ops);
  }
});

canvas.setCallbacks({
  onStrokeStart: async (payload) => await ws.startStroke(payload),
  onStrokePoint: (payload) => ws.sendPoint(payload),
  onStrokeEnd: (payload) => ws.endStroke(payload),
  onCursor: (payload) => ws.sendCursor(payload)
});

// UI wiring
els.strokeWidthValue.textContent = String(els.strokeWidth.value);
canvas.setToolState({ tool: "brush", color: els.colorPicker.value, width: Number(els.strokeWidth.value) });
setActiveTool("brush");

els.toolBrush.addEventListener("click", () => {
  canvas.setToolState({ tool: "brush" });
  setActiveTool("brush");
});

els.toolEraser.addEventListener("click", () => {
  canvas.setToolState({ tool: "eraser" });
  setActiveTool("eraser");
});

els.colorPicker.addEventListener("input", () => {
  canvas.setToolState({ color: els.colorPicker.value });
});

els.strokeWidth.addEventListener("input", () => {
  els.strokeWidthValue.textContent = String(els.strokeWidth.value);
  canvas.setToolState({ width: Number(els.strokeWidth.value) });
});

els.undoBtn.addEventListener("click", async () => {
  const res = await ws.undo();
  if (!res?.ok) {
    // Keep feedback subtle; this is an interview assignment, not a polished product.
    els.connectionText.textContent = res?.error ? `Undo failed: ${res.error}` : "Undo failed";
  }
});

els.redoBtn.addEventListener("click", async () => {
  const res = await ws.redo();
  if (!res?.ok) {
    els.connectionText.textContent = res?.error ? `Redo failed: ${res.error}` : "Redo failed";
  }
});

els.clearLocalOverlayBtn.addEventListener("click", () => canvas.clearCursorOverlays());

// Kick off connection
setConnectionUI({ connected: false });
ws.connect();


function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function nowMs() {
  return Date.now();
}

function normalizePointFromEvent(canvas, ev) {
  const rect = canvas.getBoundingClientRect();
  const x = (ev.clientX - rect.left) / rect.width;
  const y = (ev.clientY - rect.top) / rect.height;
  return { x: clamp01(x), y: clamp01(y) };
}

function denormalizePoint(point, viewW, viewH) {
  return { x: point.x * viewW, y: point.y * viewH };
}

function makeStrokeStyle(stroke) {
  return {
    tool: stroke.tool,
    color: stroke.tool === "eraser" ? "#000000" : stroke.color,
    width: stroke.width
  };
}

function applyStyle(ctx, style) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = style.width;

  if (style.tool === "eraser") {
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "rgba(0,0,0,1)";
  } else {
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = style.color;
  }
}

function drawSegment(ctx, style, from, to) {
  applyStyle(ctx, style);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

function isValidOp(op) {
  return op && typeof op === "object" && typeof op.type === "string";
}

export function createCanvasController({ canvas, canvasWrap, cursorLayer }) {
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) throw new Error("Canvas 2D context not available.");

  let ops = [];
  const strokeStyleById = new Map();
  const lastPointByStrokeId = new Map();
  const usersById = new Map();
  const cursorElByUserId = new Map();

  let enabled = false;
  let toolState = { tool: "brush", color: "#2563eb", width: 6 };
  let me = null;

  let localStrokeId = null;
  let localStartPoint = null;
  let localBufferedPoints = [];
  let localPreviewLast = null;
  let localStrokeStyle = null;
  let localStrokeToken = 0;
  let pendingStrokeToken = 0;
  let pendingShouldEnd = false;
  let isPointerDown = false;
  let activePointerId = null;

  let cursorRaf = 0;
  let pendingCursor = null;

  let viewW = 1200;
  let viewH = 800;

  let callbacks = {};

  function setCallbacks(next) {
    callbacks = next || {};
  }

  function setEnabled(v) {
    enabled = !!v;
  }

  function setMe(user) {
    me = user;
  }

  function setToolState(next) {
    toolState = { ...toolState, ...next };
  }

  function setUsers(users) {
    usersById.clear();
    (users || []).forEach((u) => usersById.set(u.id, u));
  }

  function updateConnectionCursorVisibility(connected) {
    cursorLayer.style.opacity = connected ? "1" : "0.35";
  }

  function clearCanvasToWhite() {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.restore();
  }

  function resetReplayCaches() {
    strokeStyleById.clear();
    lastPointByStrokeId.clear();
  }

  function applyOp(op, { draw } = { draw: true }) {
    if (!isValidOp(op)) return;

    if (op.type === "start") {
      const stroke = op.stroke;
      if (!stroke || typeof stroke.id !== "string") return;
      if (!op.point || typeof op.point.x !== "number" || typeof op.point.y !== "number") return;

      strokeStyleById.set(stroke.id, makeStrokeStyle(stroke));
      lastPointByStrokeId.set(stroke.id, denormalizePoint(op.point, viewW, viewH));
      return;
    }

    if (op.type === "point") {
      const sid = op.strokeId;
      if (typeof sid !== "string") return;
      if (!op.point || typeof op.point.x !== "number" || typeof op.point.y !== "number") return;

      const style = strokeStyleById.get(sid);
      const last = lastPointByStrokeId.get(sid);
      if (!style || !last) return;

      const next = denormalizePoint(op.point, viewW, viewH);
      if (draw) drawSegment(ctx, style, last, next);
      lastPointByStrokeId.set(sid, next);
      return;
    }

    if (op.type === "end") {
      const sid = op.strokeId;
      if (typeof sid !== "string") return;
      lastPointByStrokeId.delete(sid);
    }
  }

  function redrawFromOps() {
    clearCanvasToWhite();
    resetReplayCaches();
    for (const op of ops) applyOp(op, { draw: true });
  }

  function abortLocalDrawing() {
    isPointerDown = false;
    activePointerId = null;
    localStrokeToken += 1;
    pendingStrokeToken = 0;
    pendingShouldEnd = false;
    localStrokeId = null;
    localStartPoint = null;
    localBufferedPoints = [];
    localPreviewLast = null;
    localStrokeStyle = null;
  }

  function setOps(newOps) {
    abortLocalDrawing();
    ops = Array.isArray(newOps) ? newOps.slice() : [];
    redrawFromOps();
  }

  function appendOp(op) {
    ops.push(op);
    applyOp(op, { draw: true });
  }

  function handleRemoteStrokeStart(stroke) {
    // We render based on server events (including our own), so ordering is authoritative.
    if (!stroke || typeof stroke !== "object") return;
    if (typeof stroke.id !== "string") return;
    const p0 = Array.isArray(stroke.points) && stroke.points[0] ? stroke.points[0] : null;
    if (!p0 || typeof p0.x !== "number" || typeof p0.y !== "number") return;
    appendOp({
      type: "start",
      stroke: {
        id: stroke.id,
        userId: stroke.userId,
        tool: stroke.tool,
        color: stroke.color,
        width: stroke.width,
        startedAt: stroke.startedAt
      },
      point: { x: clamp01(p0.x), y: clamp01(p0.y) },
      t: nowMs()
    });
  }

  function handleRemoteStrokePoint(strokeId, point) {
    if (typeof strokeId !== "string") return;
    if (!point || typeof point !== "object") return;
    if (typeof point.x !== "number" || typeof point.y !== "number") return;
    appendOp({
      type: "point",
      strokeId,
      point: { x: clamp01(point.x), y: clamp01(point.y) },
      t: nowMs()
    });
  }

  function handleRemoteStrokeEnd(strokeId) {
    if (typeof strokeId !== "string") return;
    appendOp({ type: "end", strokeId, t: nowMs() });
  }

  function resizeToContainer() {
    const rect = canvasWrap.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));

    viewW = w;
    viewH = h;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redrawFromOps();
  }

  function ensureCursorEl(userId) {
    let el = cursorElByUserId.get(userId);
    if (el) return el;

    const user = usersById.get(userId);
    el = document.createElement("div");
    el.className = "cursor";

    const dot = document.createElement("div");
    dot.className = "cursor-dot";
    dot.style.background = user?.color || "#60a5fa";

    const label = document.createElement("div");
    label.className = "cursor-label";
    label.textContent = user?.name || userId.slice(0, 4);

    el.appendChild(dot);
    el.appendChild(label);
    cursorLayer.appendChild(el);

    cursorElByUserId.set(userId, el);
    return el;
  }

  function updateCursor(userId, cursor) {
    if (!cursor || typeof cursor.x !== "number" || typeof cursor.y !== "number") return;
    if (me && userId === me.id) return;

    const el = ensureCursorEl(userId);
    el.style.left = `${cursor.x * 100}%`;
    el.style.top = `${cursor.y * 100}%`;
    el.classList.toggle("drawing", !!cursor.isDrawing);
  }

  function removeCursor(userId) {
    const el = cursorElByUserId.get(userId);
    if (!el) return;
    el.remove();
    cursorElByUserId.delete(userId);
  }

  function clearCursorOverlays() {
    for (const [userId, el] of cursorElByUserId.entries()) {
      el.remove();
      cursorElByUserId.delete(userId);
    }
  }

  function flushCursor() {
    cursorRaf = 0;
    if (!pendingCursor) return;
    callbacks.onCursor?.(pendingCursor);
    pendingCursor = null;
  }

  function scheduleCursorSend(cursor) {
    pendingCursor = cursor;
    if (cursorRaf) return;
    cursorRaf = window.requestAnimationFrame(flushCursor);
  }

  function shouldHandlePointer(ev) {
    // WHY: avoid "ghost drawing" when the app is not initialized/connected.
    if (!enabled) return false;
    if (!ev) return false;
    if (activePointerId !== null && ev.pointerId !== activePointerId) return false;
    return true;
  }

  async function beginStrokeAt(point01) {
    const myToken = (localStrokeToken += 1);
    pendingStrokeToken = myToken;
    pendingShouldEnd = false;

    localStrokeId = null;
    localStartPoint = point01;
    localBufferedPoints = [];

    const payload = {
      tool: toolState.tool,
      color: toolState.color,
      width: toolState.width,
      point: point01
    };

    const res = await callbacks.onStrokeStart?.(payload);
    if (pendingStrokeToken !== myToken) return; // stale

    if (!res || res.ok !== true || typeof res.strokeId !== "string") {
      // Server rejected; stop cleanly (don’t keep drawing locally).
      pendingStrokeToken = 0;
      localStrokeId = null;
      localStartPoint = null;
      localBufferedPoints = [];
      return;
    }

    localStrokeId = res.strokeId;
    pendingStrokeToken = 0;

    // Flush any points that happened before the ack came back.
    for (const p of localBufferedPoints) {
      callbacks.onStrokePoint?.({ strokeId: localStrokeId, point: p });
    }
    localBufferedPoints = [];

    if (pendingShouldEnd) {
      pendingShouldEnd = false;
      callbacks.onStrokeEnd?.({ strokeId: localStrokeId });
      localStrokeId = null;
      localStartPoint = null;
    }
  }

  function attachPointerListeners() {
    function onPointerDown(ev) {
      if (!enabled) return;
      if (ev.button !== undefined && ev.button !== 0) return; // left click only

      isPointerDown = true;
      activePointerId = ev.pointerId;
      try {
        canvas.setPointerCapture(ev.pointerId);
      } catch {}

      const p = normalizePointFromEvent(canvas, ev);
      scheduleCursorSend({ ...p, isDrawing: true });
      beginStrokeAt(p);
    }

    function onPointerMove(ev) {
      if (!shouldHandlePointer(ev)) return;
      const p = normalizePointFromEvent(canvas, ev);

      // Always share cursor position (ephemeral).
      scheduleCursorSend({ ...p, isDrawing: isPointerDown });

      if (!isPointerDown) return;

      // If start ack hasn't returned yet, buffer points so we don't drop motion.
      if (!localStrokeId) {
        localBufferedPoints.push(p);
        return;
      }

      callbacks.onStrokePoint?.({ strokeId: localStrokeId, point: p });
    }

    function onPointerUp(ev) {
      if (!shouldHandlePointer(ev)) return;
      isPointerDown = false;
      scheduleCursorSend({ ...normalizePointFromEvent(canvas, ev), isDrawing: false });

      // If start is still pending, remember to end once we have the id.
      if (pendingStrokeToken) {
        pendingShouldEnd = true;
        activePointerId = null;
        return;
      }

      if (localStrokeId) {
        callbacks.onStrokeEnd?.({ strokeId: localStrokeId });
      }

      localStrokeId = null;
      localStartPoint = null;
      localBufferedPoints = [];
      activePointerId = null;
    }

    function onPointerCancel(ev) {
      if (!shouldHandlePointer(ev)) return;
      isPointerDown = false;
      scheduleCursorSend({ ...normalizePointFromEvent(canvas, ev), isDrawing: false });

      pendingShouldEnd = true;
      activePointerId = null;
    }

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);

    // Store for detach.
    canvas._ccHandlers = { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
  }

  function detachPointerListeners() {
    const h = canvas._ccHandlers;
    if (!h) return;
    canvas.removeEventListener("pointerdown", h.onPointerDown);
    canvas.removeEventListener("pointermove", h.onPointerMove);
    window.removeEventListener("pointerup", h.onPointerUp);
    window.removeEventListener("pointercancel", h.onPointerCancel);
    delete canvas._ccHandlers;
  }

  attachPointerListeners();
  resizeToContainer();
  window.addEventListener("resize", resizeToContainer);

  return {
    setCallbacks,
    setEnabled,
    setMe,
    setToolState,
    setUsers,
    updateConnectionCursorVisibility,
    setOps,
    appendOp,
    handleRemoteStrokeStart,
    handleRemoteStrokePoint,
    handleRemoteStrokeEnd,
    redrawFromOps,
    resizeToContainer,
    updateCursor,
    removeCursor,
    clearCursorOverlays,
    detach: () => {
      detachPointerListeners();
      window.removeEventListener("resize", resizeToContainer);
    }
  };
}

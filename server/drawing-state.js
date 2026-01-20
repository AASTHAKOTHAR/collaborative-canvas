const ALLOWED_TOOLS = new Set(["brush", "eraser"]);

function isFiniteNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function sanitizeCoord01(n) {
  if (!isFiniteNumber(n)) return null;
  return Math.min(1, Math.max(0, n));
}

function clampWidth(w, min, max) {
  if (!isFiniteNumber(w)) return min;
  return Math.min(max, Math.max(min, w));
}

function isValidColorString(s) {
  return typeof s === "string" && /^#[0-9a-fA-F]{6}$/.test(s);
}

function sanitizeTool(tool) {
  return ALLOWED_TOOLS.has(tool) ? tool : null;
}

function sanitizePoint(point) {
  if (!point || typeof point !== "object") return null;
  const x = sanitizeCoord01(point.x);
  const y = sanitizeCoord01(point.y);
  if (x === null || y === null) return null;
  return { x, y };
}

function createStrokeIdFactory() {
  let next = 1;
  return function makeStrokeId(socketId) {
    const id = `${socketId}:${next}`;
    next += 1;
    return id;
  };
}

function serializeStroke(stroke) {
  return {
    id: stroke.id,
    userId: stroke.userId,
    tool: stroke.tool,
    color: stroke.color,
    width: stroke.width,
    points: stroke.points.slice(),
    startedAt: stroke.startedAt,
    endedAt: stroke.endedAt ?? null
  };
}

function opStrokeId(op) {
  if (!op || typeof op !== "object") return null;
  if (op.type === "start" && op.stroke && typeof op.stroke.id === "string") return op.stroke.id;
  if ((op.type === "point" || op.type === "end") && typeof op.strokeId === "string") return op.strokeId;
  return null;
}

function createDrawingState(opts = {}) {
  const maxStrokes = isFiniteNumber(opts.maxStrokes) ? opts.maxStrokes : 1000;
  const maxPointsPerStroke = isFiniteNumber(opts.maxPointsPerStroke)
    ? opts.maxPointsPerStroke
    : 10000;

  const makeStrokeId = createStrokeIdFactory();

  let ops = [];
  let activeCompletedStrokeIds = [];
  let redoStrokeIds = [];
  const inProgressBySocket = new Map();
  let version = 0;

  function bumpVersion() {
    version += 1;
    return version;
  }

  function getVersion() {
    return version;
  }

  function getSnapshot() {
    return { version, ops: getVisibleOps() };
  }

  function getVisibleOps() {
    const active = new Set(activeCompletedStrokeIds);
    for (const stroke of inProgressBySocket.values()) active.add(stroke.id);

    return ops.filter((op) => {
      const sid = opStrokeId(op);
      return sid ? active.has(sid) : false;
    });
  }

  function pruneRedoOpsIfRedoCleared(previousRedoIds) {
    const toRemove = new Set(previousRedoIds);
    if (toRemove.size === 0) return;

    ops = ops.filter((op) => {
      const sid = opStrokeId(op);
      return sid ? !toRemove.has(sid) : true;
    });
  }

  function enforceMaxStrokes() {
    if (activeCompletedStrokeIds.length <= maxStrokes) return;

    const overflow = activeCompletedStrokeIds.length - maxStrokes;
    const evicted = activeCompletedStrokeIds.slice(0, overflow);
    activeCompletedStrokeIds = activeCompletedStrokeIds.slice(overflow);

    const evictedSet = new Set(evicted);
    redoStrokeIds = redoStrokeIds.filter((id) => !evictedSet.has(id));

    ops = ops.filter((op) => {
      const sid = opStrokeId(op);
      return sid ? !evictedSet.has(sid) : true;
    });
  }

  function forceEndAllInProgress() {
    const previousRedoIds = redoStrokeIds.slice();
    const endedStrokeIds = [];

    for (const [socketId, stroke] of inProgressBySocket.entries()) {
      inProgressBySocket.delete(socketId);
      if (stroke.points.length >= 2) {
        stroke.endedAt = Date.now();
        activeCompletedStrokeIds.push(stroke.id);
        endedStrokeIds.push(stroke.id);
        ops.push({ type: "end", strokeId: stroke.id, t: Date.now() });
      }
    }

    if (endedStrokeIds.length > 0) {
      redoStrokeIds = [];
      pruneRedoOpsIfRedoCleared(previousRedoIds);
      enforceMaxStrokes();
      bumpVersion();
    }

    return endedStrokeIds;
  }

  function startStroke({ socketId, userId, tool, color, width, point }) {
    const safeTool = sanitizeTool(tool);
    if (!safeTool) return { ok: false, error: "Invalid tool." };

    const safeColor = safeTool === "eraser" ? "#000000" : color;
    if (safeTool !== "eraser" && !isValidColorString(safeColor)) {
      return { ok: false, error: "Invalid color." };
    }

    const safeWidth = clampWidth(width, 1, 60);
    const p0 = sanitizePoint(point);
    if (!p0) return { ok: false, error: "Invalid point." };

    if (inProgressBySocket.has(socketId)) {
      return { ok: false, error: "Stroke already in progress." };
    }

    const previousRedoIds = redoStrokeIds.slice();
    redoStrokeIds = [];
    pruneRedoOpsIfRedoCleared(previousRedoIds);

    const stroke = {
      id: makeStrokeId(socketId),
      userId,
      tool: safeTool,
      color: safeColor,
      width: safeWidth,
      points: [p0],
      startedAt: Date.now(),
      endedAt: null
    };

    inProgressBySocket.set(socketId, stroke);
    ops.push({
      type: "start",
      stroke: {
        id: stroke.id,
        userId: stroke.userId,
        tool: stroke.tool,
        color: stroke.color,
        width: stroke.width,
        startedAt: stroke.startedAt
      },
      point: p0,
      t: Date.now()
    });

    bumpVersion();
    return { ok: true, stroke: serializeStroke(stroke), version };
  }

  function addPoint({ socketId, strokeId, point }) {
    const stroke = inProgressBySocket.get(socketId);
    if (!stroke) return { ok: false, error: "No stroke in progress." };
    if (stroke.id !== strokeId) return { ok: false, error: "Stroke id mismatch." };

    const p = sanitizePoint(point);
    if (!p) return { ok: false, error: "Invalid point." };

    if (stroke.points.length >= maxPointsPerStroke) {
      return { ok: false, error: "Too many points in stroke." };
    }

    const last = stroke.points[stroke.points.length - 1];
    if (last && last.x === p.x && last.y === p.y) return { ok: true, point: null, version };

    stroke.points.push(p);
    ops.push({ type: "point", strokeId: stroke.id, point: p, t: Date.now() });
    bumpVersion();
    return { ok: true, point: p, version };
  }

  function endStroke({ socketId, strokeId }) {
    const stroke = inProgressBySocket.get(socketId);
    if (!stroke) return { ok: false, error: "No stroke in progress." };
    if (stroke.id !== strokeId) return { ok: false, error: "Stroke id mismatch." };

    inProgressBySocket.delete(socketId);

    if (stroke.points.length < 2) {
      ops = ops.filter((op) => opStrokeId(op) !== stroke.id);
      bumpVersion();
      return { ok: true, committed: null, version };
    }

    stroke.endedAt = Date.now();
    activeCompletedStrokeIds.push(stroke.id);
    enforceMaxStrokes();
    ops.push({ type: "end", strokeId: stroke.id, t: Date.now() });
    bumpVersion();
    return { ok: true, committed: serializeStroke(stroke), version };
  }

  function handleDisconnect(socketId) {
    const stroke = inProgressBySocket.get(socketId);
    if (!stroke) return { endedStroke: null, version };

    inProgressBySocket.delete(socketId);

    if (stroke.points.length < 2) {
      ops = ops.filter((op) => opStrokeId(op) !== stroke.id);
      bumpVersion();
      return { endedStroke: null, version };
    }

    stroke.endedAt = Date.now();
    activeCompletedStrokeIds.push(stroke.id);

    const previousRedoIds = redoStrokeIds.slice();
    redoStrokeIds = [];
    pruneRedoOpsIfRedoCleared(previousRedoIds);
    enforceMaxStrokes();

    ops.push({ type: "end", strokeId: stroke.id, t: Date.now() });
    bumpVersion();
    return { endedStroke: serializeStroke(stroke), version };
  }

  function undo() {
    forceEndAllInProgress();

    if (activeCompletedStrokeIds.length === 0) {
      return { ok: false, changed: false, version, reason: "Nothing to undo." };
    }

    const lastId = activeCompletedStrokeIds.pop();
    redoStrokeIds.push(lastId);
    bumpVersion();
    return { ok: true, changed: true, version, reason: null };
  }

  function redo() {
    forceEndAllInProgress();

    if (redoStrokeIds.length === 0) {
      return { ok: false, changed: false, version, reason: "Nothing to redo." };
    }

    const id = redoStrokeIds.pop();
    activeCompletedStrokeIds.push(id);
    enforceMaxStrokes();
    bumpVersion();
    return { ok: true, changed: true, version, reason: null };
  }

  function getUsersInProgressStroke(socketId) {
    const stroke = inProgressBySocket.get(socketId);
    return stroke ? serializeStroke(stroke) : null;
  }

  function hasInProgress(socketId) {
    return inProgressBySocket.has(socketId);
  }

  return {
    getVersion,
    getSnapshot,
    startStroke,
    addPoint,
    endStroke,
    undo,
    redo,
    handleDisconnect,
    getUsersInProgressStroke,
    hasInProgress,
    _internal: { sanitizePoint, sanitizeTool, isValidColorString, clampWidth }
  };
}

module.exports = { createDrawingState };

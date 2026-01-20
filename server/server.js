

const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const { createRooms } = require("./rooms");
const { createDrawingState } = require("./drawing-state");

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const ROOM_ID = "main";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});


const rooms = createRooms();
const drawing = createDrawingState({ maxStrokes: 1500, maxPointsPerStroke: 15000 });



const cursors = new Map();

function safeBool(v) {
  return typeof v === "boolean" ? v : false;
}

function sanitizeCursorPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const x = drawing._internal.sanitizePoint({ x: payload.x, y: payload.y })?.x;
  const y = drawing._internal.sanitizePoint({ x: payload.x, y: payload.y })?.y;
  if (typeof x !== "number" || typeof y !== "number") return null;
  return { x, y, isDrawing: safeBool(payload.isDrawing) };
}

function broadcastUsers(roomId) {
  io.to(roomId).emit("users:update", { users: rooms.listUsers(roomId) });
}


app.use(express.static(path.join(__dirname, "..", "client")));


app.get("/health", (_req, res) => res.json({ ok: true }));

io.on("connection", (socket) => {

  try {
    socket.join(ROOM_ID);
    const user = rooms.join(ROOM_ID, socket);

    
    socket.emit("init", {
      roomId: ROOM_ID,
      me: user,
      users: rooms.listUsers(ROOM_ID),
      cursors: Array.from(cursors.entries()).map(([userId, cur]) => ({ userId, ...cur })),
      drawing: drawing.getSnapshot()
    });

    broadcastUsers(ROOM_ID);

    socket.on("cursor:update", (payload) => {
      try {
        const cur = sanitizeCursorPayload(payload);
        if (!cur) return;
        cursors.set(socket.id, { ...cur, updatedAt: Date.now() });
        socket.to(ROOM_ID).emit("cursor:update", { userId: socket.id, ...cur });
      } catch (_err) {
       
      }
    });

    socket.on("stroke:start", (payload, ack) => {
      try {
        const safeAck = typeof ack === "function" ? ack : () => {};
        if (!payload || typeof payload !== "object") return safeAck({ ok: false, error: "Bad payload." });

        const res = drawing.startStroke({
          socketId: socket.id,
          userId: socket.id,
          tool: payload.tool,
          color: payload.color,
          width: payload.width,
          point: payload.point
        });

        if (!res.ok) return safeAck({ ok: false, error: res.error || "Rejected." });

        // Broadcast to everyone (including sender) so the server is the true ordering authority.
        io.to(ROOM_ID).emit("stroke:start", { stroke: res.stroke, version: res.version });
        return safeAck({ ok: true, strokeId: res.stroke.id, version: res.version });
      } catch (_err) {
        const safeAck = typeof ack === "function" ? ack : () => {};
        return safeAck({ ok: false, error: "Server error." });
      }
    });

    socket.on("stroke:point", (payload) => {
      try {
        if (!payload || typeof payload !== "object") return;
        const res = drawing.addPoint({
          socketId: socket.id,
          strokeId: payload.strokeId,
          point: payload.point
        });
        if (!res.ok) return;
        if (!res.point) return; 
        io.to(ROOM_ID).emit("stroke:point", {
          strokeId: payload.strokeId,
          point: res.point,
          version: res.version
        });
      } catch (_err) {
       
      }
    });

    socket.on("stroke:end", (payload) => {
      try {
        if (!payload || typeof payload !== "object") return;
        const res = drawing.endStroke({ socketId: socket.id, strokeId: payload.strokeId });
        if (!res.ok) return;
        io.to(ROOM_ID).emit("stroke:end", { strokeId: payload.strokeId, version: res.version });
      } catch (_err) {
       
      }
    });

    socket.on("history:undo", (_payload, ack) => {
      try {
        const safeAck = typeof ack === "function" ? ack : () => {};
        const res = drawing.undo();
        if (!res.ok) return safeAck({ ok: false, error: res.reason || "Cannot undo." });

        
        io.to(ROOM_ID).emit("history:state", { drawing: drawing.getSnapshot() });
        return safeAck({ ok: true, version: drawing.getVersion() });
      } catch (_err) {
        const safeAck = typeof ack === "function" ? ack : () => {};
        return safeAck({ ok: false, error: "Server error." });
      }
    });

    socket.on("history:redo", (_payload, ack) => {
      try {
        const safeAck = typeof ack === "function" ? ack : () => {};
        const res = drawing.redo();
        if (!res.ok) return safeAck({ ok: false, error: res.reason || "Cannot redo." });

        io.to(ROOM_ID).emit("history:state", { drawing: drawing.getSnapshot() });
        return safeAck({ ok: true, version: drawing.getVersion() });
      } catch (_err) {
        const safeAck = typeof ack === "function" ? ack : () => {};
        return safeAck({ ok: false, error: "Server error." });
      }
    });

    socket.on("disconnect", () => {
      try {
        rooms.leave(ROOM_ID, socket.id);
        cursors.delete(socket.id);

      
        const { endedStroke } = drawing.handleDisconnect(socket.id);
        if (endedStroke) {
          io.to(ROOM_ID).emit("history:state", { drawing: drawing.getSnapshot() });
        }

      
        socket.to(ROOM_ID).emit("cursor:remove", { userId: socket.id });
        broadcastUsers(ROOM_ID);
      } catch (_err) {
       
      }
    });
  } catch (_err) {
    
    try {
      socket.disconnect(true);
    } catch {
      
    }
  }
});

server.listen(PORT, () => {
  
 
  console.log(`Server listening on http://localhost:${PORT}`);
});


# Architecture

This project is intentionally small and explainable: **server is authoritative**, clients render by replaying an ordered log of operations.

## Data flow diagram (text)

```
           (pointer events)                     (incremental broadcast)
Browser A --------------------> Server ------------------------------> Browser B
  |                               |                                      |
  |  stroke:start (ack -> id)     |  validate + append ordered op        |
  |------------------------------>|------------------------------------->| stroke:start
  |                               |                                      |
  |  stroke:point (mousemove)     |  validate + append ordered op        |
  |------------------------------>|------------------------------------->| stroke:point
  |                               |                                      |
  |  stroke:end                   |  finalize stroke                     |
  |------------------------------>|------------------------------------->| stroke:end
  |                               |
  |  history:undo / history:redo  |  update global history               |
  |------------------------------>|------------------------------------->| history:state (full snapshot)
  |                               |
  |  cursor:update                |  broadcast ephemeral cursor          |
  |------------------------------>|------------------------------------->| cursor:update
```

Late joiner / reconnect:

```
Browser C ---- connect ----> Server
             <---- init (users + cursors + ordered ops snapshot)
Browser C replays ops to reconstruct pixels
```

## Canvas state model (server)

### Ordered op log

The server stores an ordered list of **drawing operations** (`ops`). Segment ordering matters when strokes overlap.

- `start`: defines stroke style and first point
- `point`: adds a point (renders a line segment from previous point to this point)
- `end`: marks stroke completion (useful for lifecycle; not required to render pixels)

### Why ops (not just strokes)?

If two users draw concurrently, the correct layering depends on the **time-ordered segments**, not “stroke A then stroke B”. Storing ops makes replay match what everyone saw live.

## WebSocket message protocol

Direction key:
- `C -> S`: client to server
- `S -> C`: server to client

### Connection bootstrap

**`S -> C`** `init`

```json
{
  "roomId": "main",
  "me": { "id": "socketId", "name": "User-xxxx", "color": "#2563eb" },
  "users": [{ "id": "...", "name": "...", "color": "..." }],
  "cursors": [{ "userId": "...", "x": 0.1, "y": 0.2, "isDrawing": false, "updatedAt": 123 }],
  "drawing": { "version": 42, "ops": [/* ordered visible ops */] }
}
```

### Drawing (incremental)

All coordinates are **normalized**: `x` and `y` are in `[0, 1]`.

**`C -> S`** `stroke:start` (ack required)

```json
{ "tool": "brush", "color": "#ff0000", "width": 6, "point": { "x": 0.2, "y": 0.3 } }
```

Ack:

```json
{ "ok": true, "strokeId": "socketId:12", "version": 43 }
```

**`S -> C`** `stroke:start` (broadcast to other users)

```json
{ "stroke": { "id": "socketId:12", "userId": "socketId", "tool": "brush", "color": "#ff0000", "width": 6, "points": [{ "x": 0.2, "y": 0.3 }], "startedAt": 123, "endedAt": null } }
```

**`C -> S`** `stroke:point`

```json
{ "strokeId": "socketId:12", "point": { "x": 0.21, "y": 0.31 } }
```

**`S -> C`** `stroke:point` (broadcast to other users)

```json
{ "strokeId": "socketId:12", "point": { "x": 0.21, "y": 0.31 } }
```

**`C -> S`** `stroke:end`

```json
{ "strokeId": "socketId:12" }
```

**`S -> C`** `stroke:end`

```json
{ "strokeId": "socketId:12" }
```

### Cursor sharing

**`C -> S`** `cursor:update`

```json
{ "x": 0.4, "y": 0.6, "isDrawing": true }
```

**`S -> C`** `cursor:update`

```json
{ "userId": "socketId", "x": 0.4, "y": 0.6, "isDrawing": true }
```

**`S -> C`** `cursor:remove`

```json
{ "userId": "socketId" }
```

### Global undo / redo

**`C -> S`** `history:undo` (ack)
**`C -> S`** `history:redo` (ack)

**`S -> C`** `history:state`

```json
{ "drawing": { "version": 99, "ops": [] } }
```

## Undo/redo strategy (global)

- The server keeps:
  - an ordered `ops` log (all operations ever accepted)
  - a stack of **active completed stroke IDs**
  - a stack of **redo stroke IDs**
- **Undo** pops the latest active stroke ID and moves it to redo.
- **Redo** pops from redo and pushes back to active.
- After undo/redo, the server sends a **full snapshot** (`history:state`) containing only ops for:
  - active completed strokes
  - in-progress strokes

This guarantees consistency across all clients with minimal client-side complexity.

## Performance decisions

- **Normalized coordinates**: avoids resizing drift across clients with different canvas sizes.
- **Incremental updates**: server broadcasts points immediately; clients draw segments without waiting for mouseup.
- **Full replay only when needed**: init, undo/redo, reconnect, or resize triggers a replay of ops.
- **Cursor throttling**: cursor updates are sent at most once per animation frame.

## Conflict resolution strategy

No CRDTs: all conflicts are resolved by the server’s sequential processing.

- The server validates each incoming event.
- The server appends accepted operations to an ordered log.
- That ordering becomes the canonical layering order for overlapping segments.


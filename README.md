# Collaborative Canvas (Real-time)

Real-time multi-user drawing canvas using **HTML5 Canvas API** on the frontend and **Socket.IO** on the backend.

## Setup

From the project root:

```bash
npm install
npm start
```

Then open `http://localhost:3000` in your browser.

## How to test with multiple users

- **Two tabs**: open two browser tabs to `http://localhost:3000`
- **Incognito**: open one normal window and one incognito window
- **Multiple devices**: open the URL from another device on the same network (adjust host/port as needed)

You should see:
- Both users drawing simultaneously (updates stream on mousemove)
- Online users list updating on connect/disconnect
- Live cursor positions for other users
- Global undo/redo affecting everyone

## Known limitations / bugs

- **In-memory only**: the server does not persist drawings. Restarting the server clears the canvas.
- **No auth / identities**: users are identified only by their Socket.IO connection id.
- **History trimming**: to avoid unbounded memory, the server trims very old strokes; extremely long sessions will lose oldest content.
- **No pressure / smoothing**: stroke smoothing is intentionally minimal (straight segments between points).

## Time spent

~5 hours (implementation + documentation).

## Deployment (Vercel + WebSocket backend)

This app uses WebSockets (Socket.IO). Vercel is great for hosting the **static client**, but the **Socket.IO server**
should be deployed to a platform that supports long-lived connections (Render/Fly/Railway/etc).

High-level steps:
- Deploy the **server** first (you get a backend URL).
- Set `window.COLLAB_CANVAS_SOCKET_URL = "https://your-backend-url"` inside `client/index.html`.
- Deploy the **client** folder to Vercel as a static site.


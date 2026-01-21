# 🎨 Collaborative Canvas — Real-Time Multi-User Drawing

A real-time collaborative drawing application where multiple users can draw simultaneously on a shared canvas.  
Built using the **HTML5 Canvas API** on the frontend and **Node.js + Socket.IO** on the backend.

This project was developed as part of an interview assignment with a focus on correctness, real-time synchronization, and clear architecture.

---

## 🔗 Repository & Live Demo

- **GitHub Repository:**  
  https://github.com/<your-username>/collaborative-canvas

- **Live Demo:**  
  https://<your-deployed-app-url>

The demo works immediately in the browser.  
No installation or setup is required for users.

---

## ✨ Features

- Real-time multi-user drawing on a shared canvas
- Brush and eraser tools
- Color picker and adjustable stroke width
- Live cursor position sharing
- Online users list
- **Global undo / redo** (affects all connected users)
- Late joiners receive the full canvas state
- Server-authoritative canvas state

---

## 🧱 Tech Stack

### Frontend
- HTML
- CSS
- Vanilla JavaScript
- HTML5 Canvas API

### Backend
- Node.js
- Express
- Socket.IO (WebSockets)

> No drawing libraries or frontend frameworks are used.

---

## 🛠️ Setup Instructions (Local Development)

These steps are required only if you want to run the project locally.

### Prerequisites
- Node.js (v16 or later)
- npm (comes with Node.js)

### Steps

From the project root directory, run:

```bash
npm install
npm start
## 🧪 How to Test with Multiple Users

You can test real-time collaboration using any of the following methods:

- Open the application in **two different browser tabs**
- Open one **normal window** and one **incognito window**
- Open the demo link on **two different browsers or devices**

While testing, you should observe:
- Drawings appearing in real time across all users
- Cursor positions updating live
- Online users list updating on connect/disconnect
- Undo and redo actions affecting all users globally

---

## ⚠️ Known Limitations / Bugs

- **In-memory storage only**  
  Canvas state is not persisted. Restarting the server clears the drawing.

- **No authentication or user accounts**  
  Users are identified only by their Socket.IO connection ID.

- **History trimming**  
  To prevent unbounded memory growth, very old strokes may be trimmed during long sessions.

- **Minimal stroke smoothing**  
  Lines are rendered as straight segments between points for simplicity and clarity.

---

## ⏱️ Time Spent on the Project

Approximately **5–6 hours**, including:
- Architecture design
- Frontend and backend implementation
- Real-time synchronization logic
- Global undo/redo handling
- Testing with multiple users
- Documentation


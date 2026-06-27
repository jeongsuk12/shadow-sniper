import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Player {
  id: string;
  ws: WebSocket;
  name: string;
  x: number;
  y: number;
  facingX: number;
  facingY: number;
  hp: number;
  score: number;
  inputDx: number;
  inputDy: number;
  isMoving: boolean;
  lastDashTime: number;
  dashActiveUntil: number;
  lastShootTime: number;
  revealUntil: number;
}

interface Bullet {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface Room {
  id: string;
  players: Player[];
  bullets: Bullet[];
  status: 'waiting' | 'playing' | 'ended';
  winnerId: string | null;
  roundCount: number;
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

const PORT = 3000;

// Game State Storage
const rooms = new Map<string, Room>();
const clientRooms = new Map<string, string>(); // clientId -> roomId

// Helper to broadcast to a room
function broadcastToRoom(room: Room, message: any) {
  const payload = JSON.stringify(message);
  for (const player of room.players) {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(payload);
    }
  }
}

// Generate room code (4-digit uppercase letters)
function generateRoomCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Reset room state for a new round
function resetRoomForRound(room: Room) {
  room.bullets = [];
  room.status = 'playing';
  room.winnerId = null;

  if (room.players[0]) {
    room.players[0].x = 120;
    room.players[0].y = 300;
    room.players[0].facingX = 1;
    room.players[0].facingY = 0;
    room.players[0].hp = 3;
    room.players[0].inputDx = 0;
    room.players[0].inputDy = 0;
    room.players[0].isMoving = false;
    room.players[0].lastDashTime = 0;
    room.players[0].dashActiveUntil = 0;
    room.players[0].lastShootTime = 0;
    room.players[0].revealUntil = 0;
  }

  if (room.players[1]) {
    room.players[1].x = 680;
    room.players[1].y = 300;
    room.players[1].facingX = -1;
    room.players[1].facingY = 0;
    room.players[1].hp = 3;
    room.players[1].inputDx = 0;
    room.players[1].inputDy = 0;
    room.players[1].isMoving = false;
    room.players[1].lastDashTime = 0;
    room.players[1].dashActiveUntil = 0;
    room.players[1].lastShootTime = 0;
    room.players[1].revealUntil = 0;
  }
}

// Global physics and update loop (approx 60 ticks per second)
setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms.entries()) {
    if (room.status !== 'playing') continue;

    // 1. Move players
    for (const player of room.players) {
      const isDashing = now < player.dashActiveUntil;
      const speed = isDashing ? 8.5 : 3.0; // Sharp speed boost during dash

      const dx = player.inputDx;
      const dy = player.inputDy;

      if (dx !== 0 || dy !== 0) {
        // Normalize direction vector
        const len = Math.hypot(dx, dy);
        const ndx = dx / len;
        const ndy = dy / len;

        player.x += ndx * speed;
        player.y += ndy * speed;

        // Update facing direction
        player.facingX = ndx;
        player.facingY = ndy;
        player.isMoving = true;
      } else {
        player.isMoving = false;
      }

      // Boundaries clamp with radius 18
      const radius = 18;
      player.x = Math.max(radius, Math.min(800 - radius, player.x));
      player.y = Math.max(radius, Math.min(600 - radius, player.y));
    }

    // 2. Update bullets and collision checks
    for (let i = room.bullets.length - 1; i >= 0; i--) {
      const bullet = room.bullets[i];
      bullet.x += bullet.vx;
      bullet.y += bullet.vy;

      // Wall boundary removal (bullet is off-canvas)
      if (bullet.x < -10 || bullet.x > 810 || bullet.y < -10 || bullet.y > 610) {
        room.bullets.splice(i, 1);
        continue;
      }

      // Collision with players
      let hit = false;
      for (const target of room.players) {
        if (target.id === bullet.ownerId) continue; // Can't self-harm

        const dist = Math.hypot(target.x - bullet.x, target.y - bullet.y);
        const targetRadius = 18;
        const bulletRadius = 4;

        if (dist <= targetRadius + bulletRadius) {
          hit = true;
          target.hp = Math.max(0, target.hp - 1);
          target.revealUntil = now + 500; // Visible for 0.5 seconds on damage

          // Broadcast hit event
          broadcastToRoom(room, {
            type: "hit",
            targetId: target.id,
            bulletId: bullet.id,
            x: bullet.x,
            y: bullet.y,
            hp: target.hp,
          });

          // Check Win/Loss
          if (target.hp <= 0) {
            room.status = 'ended';
            room.winnerId = bullet.ownerId;

            // Increment score for the winner
            const winner = room.players.find(p => p.id === bullet.ownerId);
            if (winner) {
              winner.score += 1;
            }

            broadcastToRoom(room, {
              type: "round_over",
              winnerId: bullet.ownerId,
              players: room.players.map(p => ({
                id: p.id,
                name: p.name,
                score: p.score,
                hp: p.hp
              }))
            });
          }
          break;
        }
      }

      if (hit) {
        room.bullets.splice(i, 1);
      }
    }

    // 3. Broadcast state update to room
    broadcastToRoom(room, {
      type: "state",
      players: room.players.map(p => ({
        id: p.id,
        name: p.name,
        x: p.x,
        y: p.y,
        facingX: p.facingX,
        facingY: p.facingY,
        hp: p.hp,
        score: p.score,
        isDashing: now < p.dashActiveUntil,
        dashCooldownLeft: Math.max(0, 1500 - (now - p.lastDashTime)),
        shootCooldownLeft: Math.max(0, 3000 - (now - p.lastShootTime)),
        revealed: now < p.revealUntil,
        isMoving: p.isMoving
      })),
      bullets: room.bullets.map(b => ({
        id: b.id,
        x: b.x,
        y: b.y,
        ownerId: b.ownerId
      }))
    });
  }
}, 16); // ~60 FPS

// Handle WebSocket connections
wss.on("connection", (ws) => {
  const clientId = Math.random().toString(36).substring(2, 9);
  console.log(`[WS] Connection established. Client ID: ${clientId}`);

  ws.on("message", (rawMessage) => {
    try {
      const message = JSON.parse(rawMessage.toString());
      const now = Date.now();

      switch (message.type) {
        case "join": {
          const { name, roomId: requestedRoomId } = message;
          let roomId = (requestedRoomId || "").trim().toUpperCase();

          // Quick Match Matchmaking
          if (!roomId) {
            // Find an existing room with exactly 1 player waiting
            let foundRoomId = "";
            for (const [rId, room] of rooms.entries()) {
              if (room.status === 'waiting' && room.players.length === 1) {
                foundRoomId = rId;
                break;
              }
            }

            if (foundRoomId) {
              roomId = foundRoomId;
            } else {
              // Create a brand new room code
              roomId = generateRoomCode();
            }
          }

          let room = rooms.get(roomId);
          if (!room) {
            room = {
              id: roomId,
              players: [],
              bullets: [],
              status: 'waiting',
              winnerId: null,
              roundCount: 1,
            };
            rooms.set(roomId, room);
          }

          if (room.players.length >= 2) {
            ws.send(JSON.stringify({ type: "error", message: "방이 이미 가득 찼습니다! (최대 2명)" }));
            return;
          }

          // Setup new player object
          const isPlayer1 = room.players.length === 0;
          const player: Player = {
            id: clientId,
            ws,
            name: name || `Shadow-${clientId}`,
            x: isPlayer1 ? 120 : 680,
            y: 300,
            facingX: isPlayer1 ? 1 : -1,
            facingY: 0,
            hp: 3,
            score: 0,
            inputDx: 0,
            inputDy: 0,
            isMoving: false,
            lastDashTime: 0,
            dashActiveUntil: 0,
            lastShootTime: 0,
            revealUntil: 0,
          };

          room.players.push(player);
          clientRooms.set(clientId, roomId);

          // Confirm join to client
          ws.send(JSON.stringify({
            type: "init",
            playerId: clientId,
            roomId,
            playerIndex: isPlayer1 ? 0 : 1,
            name: player.name
          }));

          // If room now has 2 players, start the game
          if (room.players.length === 2) {
            room.status = 'playing';
            broadcastToRoom(room, {
              type: "start",
              roomId,
              players: room.players.map(p => ({ id: p.id, name: p.name, score: p.score }))
            });
          } else {
            broadcastToRoom(room, {
              type: "waiting_for_opponent",
              roomId,
              players: room.players.map(p => ({ id: p.id, name: p.name, score: p.score }))
            });
          }
          break;
        }

        case "move": {
          const roomId = clientRooms.get(clientId);
          if (!roomId) return;
          const room = rooms.get(roomId);
          if (!room || room.status !== 'playing') return;

          const player = room.players.find(p => p.id === clientId);
          if (player) {
            player.inputDx = Number(message.dx || 0);
            player.inputDy = Number(message.dy || 0);
          }
          break;
        }

        case "dash": {
          const roomId = clientRooms.get(clientId);
          if (!roomId) return;
          const room = rooms.get(roomId);
          if (!room || room.status !== 'playing') return;

          const player = room.players.find(p => p.id === clientId);
          if (player) {
            // Check 1.5s dash cooldown (1500ms)
            if (now - player.lastDashTime >= 1500) {
              player.dashActiveUntil = now + 500; // Dash duration 0.5s
              player.lastDashTime = now;

              // Dash effect broadcast (triggers sonar ripple + trace lines)
              broadcastToRoom(room, {
                type: "dash_effect",
                ownerId: clientId,
                x: player.x,
                y: player.y
              });
            }
          }
          break;
        }

        case "shoot": {
          const roomId = clientRooms.get(clientId);
          if (!roomId) return;
          const room = rooms.get(roomId);
          if (!room || room.status !== 'playing') return;

          const player = room.players.find(p => p.id === clientId);
          if (player) {
            // Check strict 3-second cooldown (3000ms)
            if (now - player.lastShootTime >= 3000) {
              player.lastShootTime = now;
              player.revealUntil = now + 500; // Reveal shooter for exactly 0.5 seconds

              // Calculate bullet direction
              let fx = player.facingX;
              let fy = player.facingY;

              // If player has no facing direction (stationary and never moved), default to facing opponent side
              if (fx === 0 && fy === 0) {
                fx = player.x < 400 ? 1 : -1;
                fy = 0;
              }

              // Normalize direction
              const len = Math.hypot(fx, fy);
              const vx = (fx / len) * 24; // Bullet speed 24 pixels per tick ( extremely fast )
              const vy = (fy / len) * 24;

              const bullet: Bullet = {
                id: Math.random().toString(36).substring(2, 9),
                ownerId: clientId,
                x: player.x + (fx / len) * 20, // Spawn slightly in front
                y: player.y + (fy / len) * 20,
                vx,
                vy
              };

              room.bullets.push(bullet);

              // Broadcast shoot effect (triggers sonar sound ripple)
              broadcastToRoom(room, {
                type: "shoot_effect",
                ownerId: clientId,
                x: player.x,
                y: player.y
              });
            }
          }
          break;
        }

        case "restart": {
          const roomId = clientRooms.get(clientId);
          if (!roomId) return;
          const room = rooms.get(roomId);
          if (!room) return;

          // Restart to a new round
          resetRoomForRound(room);
          room.roundCount += 1;

          broadcastToRoom(room, {
            type: "round_started",
            roundCount: room.roundCount,
            players: room.players.map(p => ({
              id: p.id,
              name: p.name,
              score: p.score,
              hp: p.hp,
              x: p.x,
              y: p.y
            }))
          });
          break;
        }
      }
    } catch (err) {
      console.error("[WS] Message parsing error:", err);
    }
  });

  ws.on("close", () => {
    console.log(`[WS] Connection closed. Client ID: ${clientId}`);
    const roomId = clientRooms.get(clientId);
    if (roomId) {
      const room = rooms.get(roomId);
      if (room) {
        // Remove player
        room.players = room.players.filter(p => p.id !== clientId);
        clientRooms.delete(clientId);

        if (room.players.length === 0) {
          // Room is empty, clean it up
          rooms.delete(roomId);
          console.log(`[WS] Cleaned up empty Room ID: ${roomId}`);
        } else {
          // Notify remaining player that the opponent disconnected
          room.status = 'waiting';
          broadcastToRoom(room, {
            type: "opponent_disconnected",
            message: "상대방이 게임을 떠났습니다. 새로운 참여자를 대기 중입니다."
          });
        }
      }
    }
  });
});

// Upgrade HTTP Server requests to WebSocket
server.on("upgrade", (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

// API routes first
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", roomsActive: rooms.size });
});

// Setup Vite Dev server middleware or Production Static client
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[SERVER] Ready. Running on http://localhost:${PORT}`);
  });
}

startServer();

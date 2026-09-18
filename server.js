// ============================================================
// PIXEL QUEST - CO-OP MULTIPLAYER SERVER V3
// ============================================================

const http = require("http");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;
const rooms = new Map();
let playerNumber = 1;

const httpServer = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Pixel Quest Multiplayer Server läuft! 🎮");
});

const wss = new WebSocket.Server({ server: httpServer });

function send(ws, data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

function broadcast(room, data, except = null) {
    for (const player of room.players.values()) {
        if (player.ws !== except) send(player.ws, data);
    }
}

function createRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code;
    do {
        code = "";
        for (let i = 0; i < 6; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
    } while (rooms.has(code));
    return code;
}

function publicPlayer(player) {
    return {
        id: player.id,
        name: player.name,
        x: player.x,
        y: player.y,
        scaleX: player.scaleX,
        state: player.state,
        health: player.health,
        maxHealth: player.maxHealth,
        currentSword: player.currentSword
    };
}

function sendRoomState(room) {
    const players = [...room.players.values()].map(publicPlayer);
    for (const player of room.players.values()) {
        send(player.ws, {
            type: "roomState",
            roomCode: room.code,
            hostId: room.hostId,
            started: room.started,
            players
        });
    }
}

function removePlayerFromRoom(ws) {
    if (!ws.roomCode) return;

    const room = rooms.get(ws.roomCode);
    if (!room) {
        ws.roomCode = null;
        return;
    }

    room.players.delete(ws.id);

    broadcast(room, {
        type: "playerLeft",
        playerId: ws.id
    });

    if (room.hostId === ws.id && room.players.size > 0) {
        const newHost = room.players.values().next().value;
        room.hostId = newHost.id;
        broadcast(room, {
            type: "hostChanged",
            hostId: room.hostId
        });
    }

    if (room.players.size === 0) {
        rooms.delete(room.code);
    } else {
        sendRoomState(room);
    }

    ws.roomCode = null;
}

wss.on("connection", ws => {
    ws.id = crypto.randomUUID();
    ws.roomCode = null;
    ws.player = {
        id: ws.id,
        ws,
        name: "Spieler " + playerNumber++,
        x: 0,
        y: 500,
        scaleX: 0.5,
        state: "idle",
        health: 100,
        maxHealth: 100,
        currentSword: "Holzschwert"
    };

    send(ws, { type: "connected", playerId: ws.id });

    ws.on("message", raw => {
        let message;
        try {
            message = JSON.parse(raw.toString());
        } catch {
            send(ws, { type: "error", message: "Ungültige Nachricht." });
            return;
        }

        if (message.type === "createRoom") {
            removePlayerFromRoom(ws);
            const code = createRoomCode();
            const room = {
                code,
                hostId: ws.id,
                started: false,
                players: new Map()
            };
            rooms.set(code, room);
            ws.roomCode = code;
            if (typeof message.name === "string" && message.name.trim()) {
                ws.player.name = message.name.trim().slice(0, 20);
            }
            room.players.set(ws.id, ws.player);
            send(ws, { type: "roomCreated", roomCode: code, hostId: ws.id });
            sendRoomState(room);
            return;
        }

        if (message.type === "joinRoom") {
            const code = String(message.roomCode || "").trim().toUpperCase();
            const room = rooms.get(code);

            if (!room) {
                send(ws, { type: "error", message: "Dieser Raum existiert nicht." });
                return;
            }
            if (room.started) {
                send(ws, { type: "error", message: "Das Spiel wurde bereits gestartet." });
                return;
            }
            if (room.players.size >= 4) {
                send(ws, { type: "error", message: "Der Raum ist voll. Maximal 4 Spieler." });
                return;
            }

            removePlayerFromRoom(ws);
            ws.roomCode = code;
            if (typeof message.name === "string" && message.name.trim()) {
                ws.player.name = message.name.trim().slice(0, 20);
            }
            room.players.set(ws.id, ws.player);

            broadcast(room, {
                type: "playerJoined",
                player: publicPlayer(ws.player)
            }, ws);

            send(ws, {
                type: "roomJoined",
                roomCode: code,
                hostId: room.hostId
            });
            sendRoomState(room);
            return;
        }

        const room = ws.roomCode ? rooms.get(ws.roomCode) : null;
        if (!room) {
            if (["startGame", "playerState", "worldState", "coopAttack", "collectCoin"].includes(message.type)) {
                send(ws, { type: "error", message: "Du bist in keinem Raum." });
            }
            return;
        }

        if (message.type === "startGame") {
            if (room.hostId !== ws.id) return;
            room.started = true;
            broadcast(room, { type: "gameStart" });
            return;
        }

        if (message.type === "playerState") {
            const player = room.players.get(ws.id);
            if (!player) return;

            // V3 akzeptiert die Werte direkt im Nachrichtenobjekt.
            // Die alte verschachtelte Form wird ebenfalls unterstützt.
            const data = message.player || message;

            if (Number.isFinite(Number(data.x))) player.x = Number(data.x);
            if (Number.isFinite(Number(data.y))) player.y = Number(data.y);
            if (Number.isFinite(Number(data.scaleX))) player.scaleX = Number(data.scaleX);
            if (typeof data.state === "string") player.state = data.state;
            if (Number.isFinite(Number(data.health))) player.health = Number(data.health);
            if (Number.isFinite(Number(data.maxHealth))) player.maxHealth = Number(data.maxHealth);
            if (typeof data.currentSword === "string") player.currentSword = data.currentSword;

            broadcast(room, {
                type: "playerState",
                player: publicPlayer(player)
            }, ws);
            return;
        }

        // Host sendet die komplette gemeinsame Welt an die anderen Spieler.
        if (message.type === "worldState") {
            if (room.hostId !== ws.id || !room.started) return;
            broadcast(room, message, ws);
            return;
        }

        // Ein Client möchte angreifen. Nur der Host verarbeitet den Angriff.
        if (message.type === "coopAttack") {
            if (!room.started) return;
            const host = room.players.get(room.hostId);
            if (host) send(host.ws, {
                type: "coopAttack",
                playerId: ws.id
            });
            return;
        }

        // Ein Client möchte eine gemeinsame Münze einsammeln.
        if (message.type === "collectCoin") {
            if (!room.started || typeof message.coinId !== "string") return;
            const host = room.players.get(room.hostId);
            if (host) send(host.ws, {
                type: "collectCoinRequest",
                playerId: ws.id,
                coinId: message.coinId
            });
            return;
        }

        if (message.type === "coinCollected") {
            if (room.hostId !== ws.id || !room.started) return;
            if (typeof message.coinId !== "string") return;
            broadcast(room, {
                type: "coinCollected",
                coinId: message.coinId,
                playerId: message.playerId || ws.id
            });
            return;
        }

        if (message.type === "leaveRoom") {
            removePlayerFromRoom(ws);
            send(ws, { type: "leftRoom" });
        }
    });

    ws.on("close", () => removePlayerFromRoom(ws));
});

httpServer.listen(PORT, "0.0.0.0", () => {
    console.log("====================================");
    console.log(" PIXEL QUEST CO-OP SERVER V3");
    console.log(" Server läuft auf Port " + PORT);
    console.log("====================================");
});

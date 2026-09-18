const http = require("http");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;

const rooms = new Map();
let playerNumber = 1;

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

function send(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

function broadcast(room, data, except = null) {
    for (const player of room.players.values()) {
        if (player.ws !== except) {
            send(player.ws, data);
        }
    }
}

function getRoomState(room) {
    return {
        type: "roomState",
        roomCode: room.code,
        hostId: room.hostId,
        started: room.started,
        players: [...room.players.values()].map(player => ({
            id: player.id,
            name: player.name,
            x: player.x,
            y: player.y,
            scaleX: player.scaleX,
            state: player.state,
            health: player.health,
            maxHealth: player.maxHealth,
            currentSword: player.currentSword
        }))
    };
}


// ============================================================
// HTTP SERVER
// ============================================================

const server = http.createServer((req, res) => {

    res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8"
    });

    res.end("Pixel Quest Multiplayer Server läuft! 🎮");
});


// ============================================================
// WEBSOCKET SERVER
// ============================================================

const wss = new WebSocket.Server({
    server: server
});


// ============================================================
// VERBINDUNG
// ============================================================

wss.on("connection", (ws) => {

    const playerId =
        crypto.randomUUID();

    const player = {
        id: playerId,
        ws: ws,

        name: `Spieler ${playerNumber++}`,

        roomCode: null,

        x: 0,
        y: 500,

        scaleX: 1,

        state: "idle",

        health: 100,
        maxHealth: 100,

        currentSword: "wood"
    };


    console.log(
        `Spieler verbunden: ${player.id}`
    );


    send(ws, {
        type: "connected",
        playerId: player.id
    });


    // ========================================================
    // NACHRICHTEN
    // ========================================================

    ws.on("message", raw => {

        let message;

        try {
            message =
                JSON.parse(raw.toString());
        }

        catch (error) {

            send(ws, {
                type: "error",
                message: "Ungültige Nachricht."
            });

            return;
        }


        // ====================================================
        // RAUM ERSTELLEN
        // ====================================================

        if (message.type === "createRoom") {

            if (player.roomCode) {
                send(ws, {
                    type: "error",
                    message: "Du bist bereits in einem Raum."
                });

                return;
            }


            const roomCode =
                createRoomCode();


            const room = {

                code: roomCode,

                hostId: player.id,

                started: false,

                players: new Map()
            };


            rooms.set(
                roomCode,
                room
            );


            player.roomCode =
                roomCode;


            room.players.set(
                player.id,
                player
            );


            send(ws, {
                type: "roomCreated",
                roomCode: roomCode,
                playerId: player.id,
                hostId: player.id
            });


            console.log(
                `Raum erstellt: ${roomCode}`
            );


            return;
        }


        // ====================================================
        // RAUM BEITRETEN
        // ====================================================

        if (message.type === "joinRoom") {

            const roomCode =
                String(message.roomCode || "")
                    .trim()
                    .toUpperCase();


            const room =
                rooms.get(roomCode);


            if (!room) {

                send(ws, {
                    type: "error",
                    message: "Raum nicht gefunden."
                });

                return;
            }


            if (room.players.size >= 4) {

                send(ws, {
                    type: "error",
                    message: "Der Raum ist voll."
                });

                return;
            }


            if (room.started) {

                send(ws, {
                    type: "error",
                    message: "Das Spiel in diesem Raum wurde bereits gestartet."
                });

                return;
            }


            player.roomCode =
                roomCode;


            room.players.set(
                player.id,
                player
            );


            send(ws, {
                type: "roomJoined",
                roomCode: roomCode,
                playerId: player.id,
                hostId: room.hostId
            });


            broadcast(
                room,
                {
                    type: "playerJoined",
                    player: {
                        id: player.id,
                        name: player.name,
                        x: player.x,
                        y: player.y,
                        scaleX: player.scaleX,
                        state: player.state,
                        health: player.health,
                        maxHealth: player.maxHealth,
                        currentSword: player.currentSword
                    }
                },
                ws
            );


            broadcast(
                room,
                getRoomState(room)
            );


            console.log(
                `Spieler ${player.id} ist Raum ${roomCode} beigetreten`
            );


            return;
        }


        // ====================================================
        // SPIEL STARTEN
        // ====================================================

        if (message.type === "startGame") {

            if (!player.roomCode) {
                return;
            }


            const room =
                rooms.get(player.roomCode);


            if (!room) {
                return;
            }


            if (room.hostId !== player.id) {

                send(ws, {
                    type: "error",
                    message: "Nur der Host kann das Spiel starten."
                });

                return;
            }


            room.started = true;


            broadcast(
                room,
                {
                    type: "gameStart"
                }
            );


            console.log(
                `Spiel gestartet: ${room.code}`
            );


            return;
        }


        // ====================================================
        // SPIELER POSITION / STATUS
        // ====================================================

        if (message.type === "playerState") {

            if (!player.roomCode) {
                return;
            }


            const room =
                rooms.get(player.roomCode);


            if (!room) {
                return;
            }


            if (typeof message.x === "number") {
                player.x = message.x;
            }

            if (typeof message.y === "number") {
                player.y = message.y;
            }

            if (typeof message.scaleX === "number") {
                player.scaleX = message.scaleX;
            }

            if (typeof message.state === "string") {
                player.state = message.state;
            }

            if (typeof message.health === "number") {
                player.health = message.health;
            }

            if (typeof message.maxHealth === "number") {
                player.maxHealth = message.maxHealth;
            }

            if (typeof message.currentSword === "string") {
                player.currentSword =
                    message.currentSword;
            }


            broadcast(
                room,
                {
                    type: "playerState",
                    player: {
                        id: player.id,
                        x: player.x,
                        y: player.y,
                        scaleX: player.scaleX,
                        state: player.state,
                        health: player.health,
                        maxHealth: player.maxHealth,
                        currentSword: player.currentSword
                    }
                },
                ws
            );


            return;
        }


        // ====================================================
        // RAUM VERLASSEN
        // ====================================================

        if (message.type === "leaveRoom") {

            leaveRoom(player);

            return;
        }

    });


    // ========================================================
    // VERBINDUNG GETRENNT
    // ========================================================

    ws.on("close", () => {

        console.log(
            `Spieler getrennt: ${player.id}`
        );

        leaveRoom(player);
    });

});


// ============================================================
// RAUM VERLASSEN
// ============================================================

function leaveRoom(player) {

    if (!player.roomCode) {
        return;
    }


    const room =
        rooms.get(player.roomCode);


    if (!room) {

        player.roomCode = null;

        return;
    }


    room.players.delete(
        player.id
    );


    broadcast(
        room,
        {
            type: "playerLeft",
            playerId: player.id
        }
    );


    // Host wechseln
    if (room.hostId === player.id) {

        const nextPlayer =
            room.players.values().next().value;


        if (nextPlayer) {

            room.hostId =
                nextPlayer.id;


            broadcast(
                room,
                {
                    type: "hostChanged",
                    hostId: room.hostId
                }
            );

        }
    }


    player.roomCode = null;


    if (room.players.size === 0) {

        rooms.delete(
            room.code
        );

        console.log(
            `Raum gelöscht: ${room.code}`
        );

    }

    else {

        broadcast(
            room,
            getRoomState(room)
        );
    }


    send(player.ws, {
        type: "leftRoom"
    });
}


// ============================================================
// SERVER START
// ============================================================

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            "======================================"
        );

        console.log(
            "Pixel Quest Multiplayer Server läuft!"
        );

        console.log(
            `Port: ${PORT}`
        );

        console.log(
            "WebSocket Server bereit."
        );

        console.log(
            "======================================"
        );
    }
);
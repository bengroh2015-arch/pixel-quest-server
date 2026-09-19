// ============================================================
// PIXEL QUEST - CO-OP MULTIPLAYER SERVER V4
// ============================================================

const http = require("http");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;

// ============================================================
// ROOMS
// ============================================================

const rooms = new Map();
let playerNumber = 1;


// ============================================================
// HTTP SERVER
// ============================================================

const httpServer = http.createServer((req, res) => {
    res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8"
    });

    res.end("Pixel Quest Multiplayer Server V4 läuft! 🎮");
});


// ============================================================
// WEBSOCKET SERVER
// ============================================================

const wss = new WebSocket.Server({
    server: httpServer
});


// ============================================================
// SEND
// ============================================================

function send(ws, data) {

    if (
        ws &&
        ws.readyState === WebSocket.OPEN
    ) {
        ws.send(JSON.stringify(data));
    }
}


// ============================================================
// BROADCAST
// ============================================================

function broadcast(room, data, except = null) {

    if (!room) return;

    for (const player of room.players.values()) {

        if (player.ws === except) continue;

        send(player.ws, data);
    }
}


// ============================================================
// ROOM CODE
// ============================================================

function createRoomCode() {

    const chars =
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let code;

    do {

        code = "";

        for (let i = 0; i < 6; i++) {

            code += chars[
                Math.floor(
                    Math.random() * chars.length
                )
            ];
        }

    } while (rooms.has(code));

    return code;
}


// ============================================================
// PUBLIC PLAYER DATA
// ============================================================
//
// WICHTIG:
// Diese Werte gehören IMMER nur zu diesem Spieler.
//
// Sie werden NICHT zu gemeinsamen Werten gemacht.
//
// ============================================================

function publicPlayer(player) {

    return {

        id: player.id,

        name: player.name,

        // persönliche Position
        x: player.x,
        y: player.y,

        scaleX: player.scaleX,

        state: player.state,

        // persönliche HP
        health: player.health,
        maxHealth: player.maxHealth,

        // persönliches Schwert
        currentSword: player.currentSword,

        // persönlicher Schaden
        swordDamage: player.swordDamage,

        // persönliche Geschwindigkeit
        playerSpeed: player.playerSpeed,

        // persönlicher Highscore
        highScore: player.highScore
    };
}


// ============================================================
// ROOM STATE
// ============================================================

function sendRoomState(room) {

    if (!room) return;

    const players = [
        ...room.players.values()
    ].map(publicPlayer);

    for (const player of room.players.values()) {

        send(player.ws, {

            type: "roomState",

            roomCode: room.code,

            hostId: room.hostId,

            started: room.started,

            // gemeinsame Welt
            selectedWorld: room.selectedWorld,

            players
        });
    }
}


// ============================================================
// ROOM PLAYER CHECK
// ============================================================

function playerIsInRoom(room, playerId) {

    if (!room) return false;

    return room.players.has(playerId);
}


// ============================================================
// REMOVE PLAYER
// ============================================================

function removePlayerFromRoom(ws) {

    if (!ws.roomCode) return;

    const room = rooms.get(ws.roomCode);

    if (!room) {

        ws.roomCode = null;

        return;
    }

    const wasHost =
        room.hostId === ws.id;

    room.players.delete(ws.id);


    // Spieler verlassen
    broadcast(room, {

        type: "playerLeft",

        playerId: ws.id

    });


    // ========================================================
    // HOST WECHSEL
    // ========================================================

    if (
        wasHost &&
        room.players.size > 0
    ) {

        const newHost =
            room.players.values().next().value;

        room.hostId = newHost.id;

        broadcast(room, {

            type: "hostChanged",

            hostId: room.hostId

        });
    }


    // ========================================================
    // ROOM LEER
    // ========================================================

    if (room.players.size === 0) {

        rooms.delete(room.code);

    } else {

        sendRoomState(room);
    }


    ws.roomCode = null;
}


// ============================================================
// NEW CONNECTION
// ============================================================

wss.on("connection", ws => {

    // ========================================================
    // STABILE PLAYER ID
    // ========================================================

    ws.id = crypto.randomUUID();

    ws.roomCode = null;


    // ========================================================
    // PERSÖNLICHE SPIELERDATEN
    // ========================================================

    ws.player = {

        id: ws.id,

        ws,

        name:
            "Spieler " +
            playerNumber++,

        // Position
        x: 0,
        y: 500,

        scaleX: 0.5,

        state: "idle",

        // HP
        health: 100,
        maxHealth: 100,

        // Schwert
        currentSword: "Holzschwert",

        // Schwertschaden
        swordDamage: 100,

        // Geschwindigkeit
        playerSpeed: 3,

        // Highscore
        highScore: 0
    };


    // ========================================================
    // CLIENT ID
    // ========================================================

    send(ws, {

        type: "connected",

        playerId: ws.id

    });


    // ========================================================
    // MESSAGE
    // ========================================================

    ws.on("message", raw => {

        let message;


        // ====================================================
        // JSON
        // ====================================================

        try {

            message =
                JSON.parse(raw.toString());

        } catch {

            send(ws, {

                type: "error",

                message:
                    "Ungültige Nachricht."

            });

            return;
        }


        // ====================================================
        // CREATE ROOM
        // ====================================================

        if (message.type === "createRoom") {

            removePlayerFromRoom(ws);

            const code =
                createRoomCode();


            const room = {

                code,

                hostId: ws.id,

                started: false,

                // gemeinsame Welt
                selectedWorld: 0,

                players: new Map()
            };


            rooms.set(
                code,
                room
            );


            ws.roomCode = code;


            // Name
            if (
                typeof message.name === "string" &&
                message.name.trim()
            ) {

                ws.player.name =
                    message.name
                        .trim()
                        .slice(0, 20);
            }


            room.players.set(
                ws.id,
                ws.player
            );


            send(ws, {

                type: "roomCreated",

                roomCode: code,

                hostId: ws.id

            });


            sendRoomState(room);

            return;
        }


        // ====================================================
        // JOIN ROOM
        // ====================================================

        if (message.type === "joinRoom") {

            const code =
                String(
                    message.roomCode || ""
                )
                .trim()
                .toUpperCase();


            const room =
                rooms.get(code);


            if (!room) {

                send(ws, {

                    type: "error",

                    message:
                        "Dieser Raum existiert nicht."

                });

                return;
            }


            if (room.started) {

                send(ws, {

                    type: "error",

                    message:
                        "Das Spiel wurde bereits gestartet."

                });

                return;
            }


            if (room.players.size >= 4) {

                send(ws, {

                    type: "error",

                    message:
                        "Der Raum ist voll. Maximal 4 Spieler."

                });

                return;
            }


            removePlayerFromRoom(ws);

            ws.roomCode = code;


            if (
                typeof message.name === "string" &&
                message.name.trim()
            ) {

                ws.player.name =
                    message.name
                        .trim()
                        .slice(0, 20);
            }


            room.players.set(
                ws.id,
                ws.player
            );


            // Neue Spieler melden
            broadcast(
                room,
                {
                    type: "playerJoined",

                    player:
                        publicPlayer(
                            ws.player
                        )
                },
                ws
            );


            send(ws, {

                type: "roomJoined",

                roomCode: code,

                hostId:
                    room.hostId

            });


            sendRoomState(room);

            return;
        }


        // ====================================================
        // ROOM CHECK
        // ====================================================

        const room =
            ws.roomCode
                ? rooms.get(ws.roomCode)
                : null;


        if (!room) {

            if (
                [
                    "startGame",
                    "playerState",
                    "worldState",
                    "coopAttack",
                    "collectCoin",
                    "collectCoinRequest",
                    "playerDamage"
                ].includes(message.type)
            ) {

                send(ws, {

                    type: "error",

                    message:
                        "Du bist in keinem Raum."

                });
            }

            return;
        }


        // ====================================================
        // START GAME
        // ====================================================

        if (message.type === "startGame") {

            // Nur Host
            if (
                room.hostId !== ws.id
            ) {
                return;
            }


            // Welt vom Host übernehmen
            if (
                Number.isInteger(
                    Number(message.selectedWorld)
                )
            ) {

                const world =
                    Number(
                        message.selectedWorld
                    );


                if (
                    world >= 0 &&
                    world <= 4
                ) {

                    room.selectedWorld =
                        world;
                }
            }


            room.started = true;


            broadcast(room, {

                type: "gameStart",

                selectedWorld:
                    room.selectedWorld

            });


            return;
        }


        // ====================================================
        // PERSONAL PLAYER STATE
        // ====================================================
        //
        // Dieser Bereich synchronisiert NICHT die Spieler
        // untereinander.
        //
        // Er sorgt nur dafür, dass jeder Spieler seine
        // eigenen Daten besitzt und die anderen Spieler
        // diese Daten sehen können.
        //
        // ====================================================

        if (message.type === "playerState") {

            const player =
                room.players.get(ws.id);


            if (!player) return;


            // Unterstützt:
            //
            // {
            //   type:"playerState",
            //   player:{...}
            // }
            //
            // UND
            //
            // {
            //   type:"playerState",
            //   x:...
            // }

            const data =
                message.player || message;


            // Position
            if (
                Number.isFinite(
                    Number(data.x)
                )
            ) {

                player.x =
                    Number(data.x);
            }


            if (
                Number.isFinite(
                    Number(data.y)
                )
            ) {

                player.y =
                    Number(data.y);
            }


            // Blickrichtung
            if (
                Number.isFinite(
                    Number(data.scaleX)
                )
            ) {

                player.scaleX =
                    Number(data.scaleX);
            }


            // Animation
            if (
                typeof data.state === "string"
            ) {

                player.state =
                    data.state;
            }


            // Persönliche HP
            if (
                Number.isFinite(
                    Number(data.health)
                )
            ) {

                player.health =
                    Number(data.health);
            }


            if (
                Number.isFinite(
                    Number(data.maxHealth)
                )
            ) {

                player.maxHealth =
                    Number(data.maxHealth);
            }


            // Persönliches Schwert
            if (
                typeof data.currentSword === "string"
            ) {

                player.currentSword =
                    data.currentSword;
            }


            // Persönlicher Schwertschaden
            if (
                Number.isFinite(
                    Number(data.swordDamage)
                )
            ) {

                player.swordDamage =
                    Number(data.swordDamage);
            }


            // Persönliche Geschwindigkeit
            if (
                Number.isFinite(
                    Number(data.playerSpeed)
                )
            ) {

                player.playerSpeed =
                    Number(data.playerSpeed);
            }


            // Persönlicher Highscore
            if (
                Number.isFinite(
                    Number(data.highScore)
                )
            ) {

                player.highScore =
                    Number(data.highScore);
            }


            // =================================================
            // NUR DIESEN SPIELER BROADCASTEN
            // =================================================

            broadcast(
                room,
                {
                    type: "playerState",

                    player:
                        publicPlayer(player)
                },
                ws
            );


            return;
        }


        // ====================================================
        // SHARED WORLD STATE
        // ====================================================
        //
        // NUR DER HOST DARF DIE GEMEINSAME WELT VERÄNDERN.
        //
        // Dazu gehören z.B.:
        //
        // - Welle
        // - Zombies
        // - Zombie HP
        // - Boss
        // - Boss HP
        // - Welt-Münzen
        //
        // ====================================================

        if (message.type === "worldState") {

            if (
                room.hostId !== ws.id ||
                !room.started
            ) {
                return;
            }


            // Welt synchron halten
            if (
                Number.isInteger(
                    Number(message.selectedWorld)
                )
            ) {

                const world =
                    Number(
                        message.selectedWorld
                    );


                if (
                    world >= 0 &&
                    world <= 4
                ) {

                    room.selectedWorld =
                        world;
                }
            }


            broadcast(
                room,
                {
                    ...message,

                    selectedWorld:
                        room.selectedWorld
                },
                ws
            );


            return;
        }


        // ====================================================
        // CO-OP ATTACK
        // ====================================================
        //
        // Spieler greift an.
        //
        // Der Host entscheidet anschließend,
        // wie viel Schaden der Spieler macht.
        //
        // ====================================================

        if (message.type === "coopAttack") {

            if (!room.started) {
                return;
            }


            const host =
                room.players.get(
                    room.hostId
                );


            if (!host) return;


            send(host.ws, {

                type: "coopAttack",

                playerId: ws.id,

                // Persönliche Werte mitgeben
                swordDamage:
                    ws.player.swordDamage,

                currentSword:
                    ws.player.currentSword

            });


            return;
        }


        // ====================================================
        // COIN REQUEST
        // ====================================================
        //
        // Neuer Name:
        //
        // collectCoinRequest
        //
        // Der alte Name "collectCoin" wird ebenfalls
        // akzeptiert, damit ältere Clients nicht sofort
        // kaputtgehen.
        //
        // ====================================================

        if (
            message.type === "collectCoinRequest" ||
            message.type === "collectCoin"
        ) {

            if (!room.started) {
                return;
            }


            if (
                typeof message.coinId !== "string"
            ) {
                return;
            }


            const host =
                room.players.get(
                    room.hostId
                );


            if (!host) return;


            send(host.ws, {

                type:
                    "collectCoinRequest",

                playerId:
                    ws.id,

                coinId:
                    message.coinId

            });


            return;
        }


        // ====================================================
        // COIN COLLECTED
        // ====================================================
        //
        // NUR DER HOST darf eine gemeinsame Münze
        // endgültig entfernen.
        //
        // playerId sagt, WER die Münze bekommen hat.
        //
        // ====================================================

        if (
            message.type === "coinCollected"
        ) {

            if (
                room.hostId !== ws.id ||
                !room.started
            ) {
                return;
            }


            if (
                typeof message.coinId !== "string"
            ) {
                return;
            }


            let collectorId = ws.id;


            if (
                typeof message.playerId === "string" &&
                playerIsInRoom(
                    room,
                    message.playerId
                )
            ) {

                collectorId =
                    message.playerId;
            }


            broadcast(room, {

                type:
                    "coinCollected",

                coinId:
                    message.coinId,

                playerId:
                    collectorId

            });


            return;
        }


        // ====================================================
        // PLAYER DAMAGE
        // ====================================================
        //
        // Der Host kann einem bestimmten Spieler Schaden
        // melden.
        //
        // Beispiel:
        //
        // Zombie greift Spieler B an
        //
        // Host ->
        // playerDamage
        // targetPlayerId = Spieler B
        //
        // Nur Spieler B bekommt den Schaden.
        //
        // ====================================================

        if (
            message.type === "playerDamage"
        ) {

            if (
                room.hostId !== ws.id ||
                !room.started
            ) {
                return;
            }


            const targetId =
                String(
                    message.targetPlayerId || ""
                );


            if (
                !playerIsInRoom(
                    room,
                    targetId
                )
            ) {
                return;
            }


            const amount =
                Number(message.amount);


            if (
                !Number.isFinite(amount) ||
                amount <= 0
            ) {
                return;
            }


            const target =
                room.players.get(
                    targetId
                );


            if (!target) return;


            send(target.ws, {

                type:
                    "playerDamage",

                playerId:
                    targetId,

                amount:
                    amount

            });


            return;
        }


        // ====================================================
        // LEAVE ROOM
        // ====================================================

        if (
            message.type === "leaveRoom"
        ) {

            removePlayerFromRoom(ws);

            send(ws, {

                type:
                    "leftRoom"

            });

            return;
        }

    });


    // ========================================================
    // DISCONNECT
    // ========================================================

    ws.on("close", () => {

        removePlayerFromRoom(ws);

    });

});


// ============================================================
// START SERVER
// ============================================================

httpServer.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            "===================================="
        );

        console.log(
            " PIXEL QUEST CO-OP SERVER V4"
        );

        console.log(
            " Server läuft auf Port " +
            PORT
        );

        console.log(
            " Maximal 4 Spieler pro Raum"
        );

        console.log(
            " Persönliche Spielerwerte getrennt"
        );

        console.log(
            " Gemeinsame Welt über Host"
        );

        console.log(
            "===================================="
        );
    }
);
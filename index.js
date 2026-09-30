const WebSocket = require("ws");

const PORT = 26395;

const wss = new WebSocket.Server({
    port: PORT
});


// ============================================================
// DATA
// ============================================================

let players = {};
let lobbies = {};
let matchmaking = [];

let nextPlayerId = 1;
let nextLobbyId = 1;


// ============================================================
// SKILLS
// ============================================================

const skills = {
    dash: {
        cd: 3,
        r: 10
    },

    teleport: {
        cd: 40,
        r: 20
    },

    speed: {
        cd: 5,
        r: 20
    }
};


// ============================================================
// SERVER
// ============================================================

console.log(`Multiplayer server running on port ${PORT}`);


// ============================================================
// CONNECTION
// ============================================================

wss.on("connection", (socket) => {

    const id = nextPlayerId++;

    players[id] = {
        id: id,

        socket: socket,

        lobbyId: null,

        team: null,

        x: 0,
        y: 0,

        walls: 0,

        skill: null,
        health: 100,
        radius: 10
    };

    console.log(`Player ${id} connected`);


    // --------------------------------------------------------
    // Give player their ID
    // --------------------------------------------------------

    socket.send(JSON.stringify({
        type: "welcome",
        id: id
    }));


    // --------------------------------------------------------
    // Player requests matchmaking
    // --------------------------------------------------------

    socket.on("message", (data) => {

        try {

            const message = JSON.parse(data);


            // =================================================
            // JOIN MATCHMAKING
            // =================================================

            if (message.type === "matchmaking") {

                addToMatchmaking(id);

            }


            // =================================================
            // LEAVE MATCHMAKING
            // =================================================

            if (message.type === "cancel matchmaking") {

                removeFromMatchmaking(id);

            }


            // =================================================
            // POSITION
            // =================================================

            if (message.type === "position") {

                const player = players[id];

                if (!player) return;

                if (!player.lobbyId) return;


                player.x += Number(message.x) || 0;
                player.y += Number(message.y) || 0;


                const lobby = lobbies[player.lobbyId];

                if (!lobby) return;


                lobby.players[id].x = player.x;
                lobby.players[id].y = player.y;


                broadcastToLobby(
                    player.lobbyId,
                    {
                        type: "players",
                        players: getPublicPlayers(lobby)
                    }
                );

            }
            if(message.type === "bullet fired") {
                const player = players[message.playerId];
                console.log(`Bullet fired by player ${message.playerId} at (${message.x}, ${message.y})`);
                const bullet = {
                    x: Number(message.x) || 0,
                    y: Number(message.y) || 0,
                    radius: 2
                };
                if (!player){
                    broadcastToLobby(
                        player.lobbyId,
                        {
                            type: "bullet fired",
                            bullet: bullet,
                            shooter: players[id],
                            players: getPublicPlayers(lobby)
                        }
                    );
                    return;
                } 
                if (!player.lobbyId) return;

                const lobby = lobbies[player.lobbyId];

                if (!lobby) return;
                if(bulletHitPlayer(bullet, player)){
                    player.health -= 10; // Reduce health by 10 when hit
                    lobby.players[message.playerId].health = player.health;
                    console.log(`Player ${message.playerId} hit! Health: ${player.health}`);
                    if(player.health <= 0){
                        console.log(`Player ${message.playerId} has been eliminated!`);
                        player.health = 100;
                        player.x = 0;
                        player.y = 0;
                        lobby.players[message.playerId].health = player.health;
                        lobby.players[message.playerId].x = player.x;
                        lobby.players[message.playerId].y = player.y;
                        if(lobby.players[message.playerId].team === "red"){
                            lobby.blue += 1;
                        } else if(lobby.players[message.playerId].team === "blue"){
                            lobby.red += 1;
                        }
                        if(lobby.red >= 10){
                            console.log("Red team has won!");
                            lobby.end = true;
                            lobby.winner = "red";
                        }else if(lobby.blue >= 10){
                            console.log("Blue team has won!");
                            lobby.end = true;
                            lobby.winner = "blue";
                        }
                    }
                }

                // Broadcast the bullet fired event to all players in the lobby
                broadcastToLobby(
                    player.lobbyId,
                    {
                        type: "bullet fired",
                        bullet: bullet,
                        shooter: players[id],
                        players: getPublicPlayers(lobby)
                    }
                );
            }


            // =================================================
            // PING
            // =================================================

            if (message.type === "ping") {

                socket.send(JSON.stringify({
                    type: "pong"
                }));

            }


            // =================================================
            // SELECT SKILL
            // =================================================

            if (message.type === "select skill") {

                const player = players[id];

                if (!player) return;


                const skill = skills[message.skill];

                if (!skill) return;


                player.skill = message.skill;


                if (player.lobbyId) {

                    broadcastToLobby(
                        player.lobbyId,
                        {
                            type: "select skill",

                            player: id,

                            skill: message.skill
                        }
                    );

                }

            }


            // =================================================
            // CREATE PRIVATE LOBBY
            // =================================================

            if (message.type === "create lobby") {

                createLobbyForPlayer(id);

            }


            // =================================================
            // JOIN LOBBY
            // =================================================

            if (message.type === "join lobby") {

                const lobbyId = Number(message.lobbyId);

                joinLobby(id, lobbyId);

            }


        } catch (error) {

            console.log(
                "Invalid message:",
                error.message
            );

        }

    });


    // ========================================================
    // DISCONNECT
    // ========================================================

    socket.on("close", () => {

        console.log(
            `Player ${id} disconnected`
        );


        removeFromMatchmaking(id);


        const player = players[id];


        if (player && player.lobbyId) {

            const lobbyId = player.lobbyId;

            const lobby = lobbies[lobbyId];


            if (lobby) {

                delete lobby.players[id];


                broadcastToLobby(
                    lobbyId,
                    {
                        type: "player left",

                        player: id,

                        players: getPublicPlayers(lobby)
                    }
                );


                // Delete empty lobby

                if (
                    Object.keys(lobby.players).length === 0
                ) {

                    delete lobbies[lobbyId];

                    console.log(
                        `Lobby ${lobbyId} deleted`
                    );

                }

            }

        }


        delete players[id];

    });

});


// ============================================================
// MATCHMAKING
// ============================================================

function addToMatchmaking(id) {

    const player = players[id];

    if (!player) return;


    if (player.lobbyId) {

        sendToPlayer(id, {
            type: "error",
            message: "You are already in a lobby."
        });

        return;

    }


    if (matchmaking.includes(id)) {

        return;

    }


    matchmaking.push(id);


    sendToPlayer(id, {
        type: "matchmaking",
        status: "searching"
    });


    console.log(
        `Player ${id} entered matchmaking`
    );


    checkMatchmaking();

}


// ============================================================
// CHECK MATCHMAKING
// ============================================================

function checkMatchmaking() {

    while (matchmaking.length >= 4) {

        const matchPlayers =
            matchmaking.splice(0, 4);


        createMatch(matchPlayers);

    }

}


// ============================================================
// CREATE MATCH
// ============================================================

function createMatch(playerIds) {

    const lobbyId = nextLobbyId++;


    lobbies[lobbyId] = {

        id: lobbyId,

        state: "starting",

        players: {},
        
        red: 0,
        blue: 0,
        end: false,
        winner: null

    };


    const lobby = lobbies[lobbyId];


    // --------------------------------------------------------
    // First 4 = RED
    // Last 4 = BLUE
    // --------------------------------------------------------

    playerIds.forEach((id, index) => {

        const team =
            index < 2
                ? "red"
                : "blue";


        const player = players[id];

        if (!player) return;


        player.lobbyId = lobbyId;

        player.team = team;

        player.x = 0;
        player.y = 0;


        lobby.players[id] = {

            id: id,

            x: 0,
            y: 0,

            team: team,

            walls: 0,

            skill: null,
            health: 100,
            radius: 10

        };


        sendToPlayer(id, {

            type: "match found",

            lobbyId: lobbyId,

            team: team

        });

    });


    console.log(
        `Lobby ${lobbyId} created: 2v2`
    );


    // --------------------------------------------------------
    // Tell everyone about the lobby
    // --------------------------------------------------------

    broadcastToLobby(
        lobbyId,
        {
            type: "lobby",

            lobbyId: lobbyId,

            state: lobby.state,

            players: getPublicPlayers(lobby)
        }
    );


    // --------------------------------------------------------
    // Start match
    // --------------------------------------------------------

    setTimeout(() => {

        if (!lobbies[lobbyId]) return;


        lobby.state = "playing";


        broadcastToLobby(
            lobbyId,
            {
                type: "match started",

                lobbyId: lobbyId,

                players: getPublicPlayers(lobby)
            }
        );


        console.log(
            `Lobby ${lobbyId} started`
        );


    }, 5000);

}


// ============================================================
// CREATE PRIVATE LOBBY
// ============================================================

function createLobbyForPlayer(id) {

    const player = players[id];

    if (!player) return;


    if (player.lobbyId) {

        sendToPlayer(id, {
            type: "error",
            message: "Already in a lobby."
        });

        return;

    }


    const lobbyId = nextLobbyId++;


    lobbies[lobbyId] = {

        id: lobbyId,

        state: "waiting",

        players: {}, 
        red: 0,
        blue: 0,
        end: false,
        winner: null

    };


    joinLobby(id, lobbyId);

}


// ============================================================
// JOIN LOBBY
// ============================================================

function joinLobby(id, lobbyId) {

    const player = players[id];

    const lobby = lobbies[lobbyId];


    if (!player) return;


    if (!lobby) {

        sendToPlayer(id, {
            type: "error",
            message: "Lobby does not exist."
        });

        return;

    }


    if (player.lobbyId) {

        sendToPlayer(id, {
            type: "error",
            message: "Already in a lobby."
        });

        return;

    }


    const count =
        Object.keys(lobby.players).length;


    if (count >= 4) {

        sendToPlayer(id, {
            type: "error",
            message: "Lobby is full."
        });

        return;

    }


    // Balance teams

    let red = 0;
    let blue = 0;


    for (const p of Object.values(lobby.players)) {

        if (p.team === "red") red++;
        if (p.team === "blue") blue++;

    }


    const team =
        red <= blue
            ? "red"
            : "blue";


    player.lobbyId = lobbyId;

    player.team = team;


    lobby.players[id] = {

        id: id,

        x: 0,
        y: 0,

        team: team,

        walls: 0,

        skill: null,
        health: 100,
        radius: 10

    };


    sendToPlayer(id, {

        type: "joined lobby",

        lobbyId: lobbyId,

        team: team

    });


    broadcastToLobby(
        lobbyId,
        {
            type: "players",

            players: getPublicPlayers(lobby)
        }
    );


    console.log(
        `Player ${id} joined lobby ${lobbyId}`
    );


    // Automatically start when 8 players join

    if (
        Object.keys(lobby.players).length === 4
    ) {

        startLobby(lobbyId);

    }

}


// ============================================================
// START LOBBY
// ============================================================

function startLobby(lobbyId) {

    const lobby = lobbies[lobbyId];

    if (!lobby) return;


    if (lobby.state === "playing") return;


    lobby.state = "starting";


    broadcastToLobby(
        lobbyId,
        {
            type: "match starting",

            lobbyId: lobbyId,

            players: getPublicPlayers(lobby)
        }
    );


    setTimeout(() => {

        if (!lobbies[lobbyId]) return;


        lobby.state = "playing";


        broadcastToLobby(
            lobbyId,
            {
                type: "match started",

                lobbyId: lobbyId
            }
        );


        console.log(
            `Lobby ${lobbyId} started`
        );


    }, 5000);

}


// ============================================================
// REMOVE FROM MATCHMAKING
// ============================================================

function removeFromMatchmaking(id) {

    const index =
        matchmaking.indexOf(id);


    if (index !== -1) {

        matchmaking.splice(index, 1);


        sendToPlayer(id, {

            type: "matchmaking",

            status: "cancelled"

        });

    }

}


// ============================================================
// GET PUBLIC PLAYERS
// ============================================================

function getPublicPlayers(lobby) {

    const result = {};


    for (
        const [id, player]
        of Object.entries(lobby.players)
    ) {

        result[id] = {

            id: player.id,

            x: player.x,

            y: player.y,

            team: player.team,

            walls: player.walls,

            skill: player.skill,
            health: player.health,
            radius: player.radius

        };

    }


    return result;

}


// ============================================================
// SEND TO ONE PLAYER
// ============================================================

function sendToPlayer(id, message) {

    const player = players[id];

    if (!player) return;


    if (
        player.socket.readyState ===
        WebSocket.OPEN
    ) {

        player.socket.send(
            JSON.stringify(message)
        );

    }

}


// ============================================================
// BROADCAST TO LOBBY
// ============================================================

function broadcastToLobby(lobbyId, message) {

    const lobby = lobbies[lobbyId];

    if (!lobby) return;


    const data =
        JSON.stringify(message);


    for (
        const id of Object.keys(lobby.players)
    ) {

        const player = players[id];

        if (!player) continue;


        if (
            player.socket.readyState ===
            WebSocket.OPEN
        ) {

            player.socket.send(data);

        }

    }

}


// ============================================================
// RANDOM NUMBER
// ============================================================

function getRandomFloat(min, max) {

    return Math.random() *
        (max - min) +
        min;

}
function bulletHitPlayer(bullet, player) {
    const dx = bullet.x - (player.x+8);
    const dy = bullet.y - (player.y+10);
    const distanceSquared = dx * dx + dy * dy;
    const radiusSum = bullet.radius + player.radius;
    return distanceSquared < radiusSum * radiusSum;
}
const io = require('socket.io-client');

const SERVER_URL = 'http://localhost:3001';
const clientA = io(SERVER_URL);
let clientB = null;

let steps = {
    connected: false,
    joined: false,
    countdown: false,
    gameStarted: false,
    chatReceived: false,
    spectatorJoined: false,
    spectatorUpdate: false
};

console.log('🚀 Starting Verification: Loading Screen, Chat, Spectator Mode');

// --- Client A (Player) ---
clientA.on('connect', () => {
    console.log('✅ Client A Connected');
    steps.connected = true;

    // 1. Join Game
    clientA.emit('join_game', { name: 'PlayerA' });
});

clientA.on('lobby_update', (data) => {
    if (!steps.joined) {
        console.log('✅ Client A Joined Lobby');
        steps.joined = true;

        // 2. Ready (trigger countdown)
        clientA.emit('player_ready');
    }
});

clientA.on('countdown_start', (data) => {
    console.log(`⏱️ Countdown Started: ${data.seconds}s`);
    steps.countdown = true;
});

clientA.on('game_start', () => {
    console.log('🎮 Game Started!');
    steps.gameStarted = true;

    // 3. Send Chat
    setTimeout(() => {
        clientA.emit('chat_message', 'Hello Spectator!');
    }, 1000);
});

clientA.on('chat_broadcast', (data) => {
    console.log(`💬 Chat Received: [${data.sender}] ${data.message}`);
    if (data.message === 'Hello Spectator!') {
        steps.chatReceived = true;

        // 4. Start Spectator (Client B)
        startSpectator();
    }
});

// --- Client B (Spectator) ---
function startSpectator() {
    console.log('👁️ Starting Client B (Spectator)...');
    clientB = io(SERVER_URL);

    clientB.on('connect', () => {
        console.log('✅ Client B Connected');
        clientB.emit('join_spectate', { roomId: 'default' });
    });

    clientB.on('spectate_init', (data) => {
        console.log('✅ Spectator Joined Successfully');
        steps.spectatorJoined = true;
    });

    clientB.on('spectator_update', (data) => {
        if (!steps.spectatorUpdate) {
            console.log('✅ Received First Spectator Update');
            steps.spectatorUpdate = true;
            finish();
        }
    });

    clientB.on('chat_broadcast', (data) => {
        console.log(`💬 Chat Received by Spectator: [${data.sender}] ${data.message}`);
    });
}

function finish() {
    console.log('\n--- Verification Summary ---');
    console.log(`Countdown: ${steps.countdown ? 'PASS' : 'FAIL'}`);
    console.log(`Game Start: ${steps.gameStarted ? 'PASS' : 'FAIL'}`);
    console.log(`Chat System: ${steps.chatReceived ? 'PASS' : 'FAIL'}`);
    console.log(`Spectator Mode: ${steps.spectatorJoined && steps.spectatorUpdate ? 'PASS' : 'FAIL'}`);

    const allPassed = steps.countdown && steps.gameStarted && steps.chatReceived && steps.spectatorJoined && steps.spectatorUpdate;
    if (allPassed) {
        console.log('\n✅ ALL TESTS PASSED');
        process.exit(0);
    } else {
        console.error('\n❌ SOME TESTS FAILED');
        process.exit(1);
    }
}

// Timeout
setTimeout(() => {
    console.error('\n❌ Timeout: Verification took too long');
    finish();
}, 15000);

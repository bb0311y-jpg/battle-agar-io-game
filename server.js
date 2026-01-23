const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: ["http://localhost:3000", "https://battle-agar-io-game.vercel.app"],
        methods: ["GET", "POST"]
    }
});

// Game Constants
const WORLD_WIDTH = 4500;
const WORLD_HEIGHT = 4500;
const TICK_RATE = 60;
const MS_PER_TICK = 1000 / TICK_RATE;

// Utility: RNG
const rnd = (max) => Math.random() * max;

class GameRoom {
    constructor(roomId) {
        this.roomId = roomId;
        this.players = new Map(); // socketId -> Player
        this.bots = [];
        this.food = [];
        this.viruses = [];
        this.timer = 180; // 3 minutes
        this.state = 'waiting'; // waiting, playing, gameover
        this.interval = null;
        this.leaderboard = [];
        this.jackpot = null; // { x, y } or null

        this.initializeWorld();
    }

    initializeWorld() {
        this.food = Array.from({ length: 300 }, (_, i) => ({
            id: `f_${i}`, x: rnd(WORLD_WIDTH), y: rnd(WORLD_HEIGHT),
            color: `hsl(${rnd(360)}, 100%, 70%)`, radius: 5 + rnd(5)
        }));

        // Init Bots
        this.bots = Array.from({ length: 20 }, (_, i) => {
            const mass = 15 + rnd(20);
            return {
                id: `bot_${i}`, x: rnd(WORLD_WIDTH), y: rnd(WORLD_HEIGHT),
                mass: mass,
                radius: 10 + Math.sqrt(mass) * 5,
                color: '#888',
                targetX: rnd(WORLD_WIDTH), targetY: rnd(WORLD_HEIGHT)
            };
        });

        // Init Viruses (with mass property and minimum distance)
        this.viruses = [];
        for (let i = 0; i < 15; i++) {
            let x, y, tooClose;
            let attempts = 0;
            do {
                x = rnd(WORLD_WIDTH);
                y = rnd(WORLD_HEIGHT);
                tooClose = this.viruses.some(v => {
                    const dx = v.x - x;
                    const dy = v.y - y;
                    return Math.sqrt(dx * dx + dy * dy) < 300; // Min 300px apart
                });
                attempts++;
            } while (tooClose && attempts < 50);

            const mass = 100 + rnd(35);
            this.viruses.push({
                id: `v_init_${i}`, x, y,
                mass: mass,
                radius: 10 + Math.sqrt(mass) * 5,
                color: '#33ff33', isVirus: true
            });
        }

        // Init Jackpot (guaranteed at start)
        this.jackpot = {
            id: 'jackpot_init', x: rnd(WORLD_WIDTH), y: rnd(WORLD_HEIGHT),
            color: '#FFD700', radius: 25, isJackpot: true
        };
        this.food.push(this.jackpot);

        // Betting System (Phase 5)
        this.pot = 0;
        this.minBet = 100;
    }

    addPlayer(socket, name) {
        const player = {
            id: socket.id,
            name: name || `Player ${socket.id.substr(0, 4)}`,
            // x, y, radius are now DERIVED for high-level logic (e.g. camera),
            // actual physics tracks 'cells'.
            x: rnd(WORLD_WIDTH),
            y: rnd(WORLD_HEIGHT),
            viewX: 0,
            viewY: 0,
            cells: [], // Array of { id, x, y, radius, mass, vx, vy, mergeTime }
            color: `hsl(${rnd(360)}, 100%, 50%)`,
            score: 0,
            isReady: false,
            dead: false,
            deathTime: 0,
            lastScore: 0,

            // Phase 5: Wallet & Betting
            walletAddress: null,
            betAmount: 0
        };

        // Init First Cell
        player.cells.push({
            id: `${socket.id}_0`,
            x: player.x,
            y: player.y,
            mass: 20,
            radius: 10 + Math.sqrt(20) * 5,
            vx: 0,
            vy: 0,
            impulseX: 0,
            impulseY: 0,
            mergeTime: 0
        });
        player.viewX = player.x;
        player.viewY = player.y;

        this.players.set(socket.id, player);
        socket.join(this.roomId);

        // Notify everyone of player count update
        this.broadcastLobbyState();
    }

    broadcastLobbyState() {
        if (this.state === 'waiting') {
            const playersList = Array.from(this.players.values()).map(p => ({
                id: p.id, name: p.name, isReady: p.isReady,
                betAmount: p.betAmount
            }));
            io.to(this.roomId).emit('lobby_update', {
                players: playersList,
                pot: this.pot,
                minBet: this.minBet
            });
        }
    }

    setPlayerReady(socketId, betData) {
        const p = this.players.get(socketId);
        if (p) {
            // Phase 5: Optional Bet (Backward Compatibility)
            if (betData && betData.amount) {
                p.betAmount = betData.amount;
                p.walletAddress = betData.walletAddress;
                this.pot += p.betAmount;
            }

            // Always allow Ready
            p.isReady = true;
            this.broadcastLobbyState();
            this.checkStart();
        }
    }

    checkStart() {
        // Start if > 1 player and ALL are ready
        // Only start if we are currently waiting!
        if (this.state === 'waiting' && this.players.size > 0 && Array.from(this.players.values()).every(p => p.isReady)) {
            this.startGame();
        }
    }

    removePlayer(socketId) {
        this.players.delete(socketId);
        if (this.players.size === 0) {
            this.stopGame();
        }
    }

    startGame() {
        if (this.state === 'playing') return; // Prevent double start
        console.log(`[${this.roomId}] Game Starting...`);
        this.state = 'playing';
        this.timer = 180;

        // Broadcast Start
        io.to(this.roomId).emit('game_start', { time: this.timer });

        if (this.interval) clearInterval(this.interval);
        this.interval = setInterval(() => this.tick(), MS_PER_TICK);
    }

    stopGame() {
        console.log(`[${this.roomId}] Game Stopping(No Players)`);
        this.state = 'waiting';
        if (this.interval) clearInterval(this.interval);
    }

    handleInput(socketId, input) {
        const p = this.players.get(socketId);
        if (!p) return;

        // Input: { targetX, targetY }
        // DEBUG: Trace Input
        if (Math.random() < 0.05) console.log(`[Input] ID:${socketId.substr(0, 4)} T:(${Math.floor(input.targetX)},${Math.floor(input.targetY)})`);

        // Anti-NaN: Reject invalid coordinates
        if (!Number.isFinite(input.targetX) || !Number.isFinite(input.targetY)) {
            console.warn(`[Input Error] Received NaN from ${socketId}`);
            return;
        }

        // Store Target for Tick Logic
        p.targetX = input.targetX;
        p.targetY = input.targetY;
    }

    // Helper: Circle Collision (touching)
    checkCollision(c1, c2) {
        const dx = c1.x - c2.x;
        const dy = c1.y - c2.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        return dist < c1.radius + c2.radius;
    }

    // Helper: Eat Collision (10% overlap of smaller circle)
    checkEatCollision(predator, prey) {
        const dx = predator.x - prey.x;
        const dy = predator.y - prey.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const smallerRadius = Math.min(predator.radius, prey.radius);
        const overlapRequired = smallerRadius * 0.2; // 10% area ≈ 20% radius overlap
        return dist < predator.radius + prey.radius - overlapRequired;
    }

    // Helper: Can Eat? (Simple: mass > opponent + 10% overlap)
    canEat(predator, prey) {
        return predator.mass > prey.mass && this.checkEatCollision(predator, prey);
    }

    tick() {
        if (this.state !== 'playing') return;

        const now = Date.now();

        // 0. Respawn Logic
        this.players.forEach(p => {
            if (p.dead && now > p.deathTime + 5000) {
                // Respawn
                const safeR = this.getSafeZoneRadius();
                // Random pos
                const angle = rnd(Math.PI * 2);
                const r = rnd(safeR * 0.8);
                const spawnX = WORLD_WIDTH / 2 + Math.cos(angle) * r;
                const spawnY = WORLD_HEIGHT / 2 + Math.sin(angle) * r;

                p.dead = false;
                p.x = spawnX; p.y = spawnY;
                p.score = Math.floor(p.lastScore * 0.8);
                const startMass = Math.max(20, p.score);

                p.cells = [{
                    id: `${p.id}_${now}`,
                    x: spawnX, y: spawnY,
                    mass: startMass,
                    radius: 10 + Math.sqrt(startMass) * 5,
                    vx: 0, vy: 0, impulseX: 0, impulseY: 0, mergeTime: 0
                }];
                io.to(p.id).emit('respawn_info', { x: p.x, y: p.y }); // Optional: Notify client logic
            }
        });

        // 1. Move Players (Multi-Cell Logic)
        this.players.forEach(p => {
            if (p.dead) return;

            // Calculate Centroid
            let totalX = 0, totalY = 0, totalMass = 0;

            p.cells.forEach(cell => {
                // Target Movement
                if (p.targetX !== undefined) {
                    const dx = p.targetX - cell.x;
                    const dy = p.targetY - cell.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist > 0) {
                        // Speed based on Mass (Standard Agar.io Formula: Speed = Base * Mass^-0.44?)
                        // Simplified: Base 5, slows down as mass grows.
                        const speed = Math.max(2, 8 * Math.pow(cell.mass, -0.1)); // Adjusted curve

                        // 1. Controlled Movement (Mouse)
                        // This is the "Intention" to move
                        const moveVX = (dx / dist) * speed;
                        const moveVY = (dy / dist) * speed;

                        cell.vx = moveVX;
                        cell.vy = moveVY;
                    }
                }

                // 2. Impulse & Inertia Application
                // Apply Impulse
                cell.x += cell.impulseX || 0;
                cell.y += cell.impulseY || 0;

                // Decay Impulse (Friction)
                // If impulse is small, kill it to save processing
                if (cell.impulseX) cell.impulseX *= 0.9;
                if (cell.impulseY) cell.impulseY *= 0.9;
                if (Math.abs(cell.impulseX) < 0.1) cell.impulseX = 0;
                if (Math.abs(cell.impulseY) < 0.1) cell.impulseY = 0;

                // DEBUG: Log first player's movement
                if (p.id === Array.from(this.players.keys())[0] && (Math.abs(cell.impulseX) > 1 || Math.abs(cell.impulseY) > 1)) {
                    // console.log(`[Impulse] ${cell.impulseX.toFixed(2)}, ${cell.impulseY.toFixed(2)}`);
                }

                // Elastic Collision (Cell Separation)
                p.cells.forEach(other => {
                    if (cell === other) return;
                    if (now < cell.mergeTime || now < other.mergeTime) {
                        // Push away
                        const ddx = cell.x - other.x;
                        const ddy = cell.y - other.y;
                        const d = Math.sqrt(ddx * ddx + ddy * ddy);
                        const minDist = cell.radius + other.radius;
                        if (d < minDist && d > 0) {
                            const push = (minDist - d) / d; // Normalize
                            // Apply force
                            cell.x += ddx * push * 0.5;
                            cell.y += ddy * push * 0.5;
                        }
                    } else {
                        // Merge Logic (Recombine)
                        // If center distance < radius sum * 0.5 (significant overlap)
                        // And cell is larger or same (to prevent double merge, prioritize strict order)
                        const dist = Math.sqrt(Math.pow(cell.x - other.x, 2) + Math.pow(cell.y - other.y, 2)); // Recalc dist just in case

                        if (dist < (cell.radius + other.radius) * 0.5) {
                            // Correct Merge Condition
                            if (cell.mass >= other.mass) {
                                cell.mass += other.mass;
                                cell.radius = 10 + Math.sqrt(cell.mass) * 5;

                                other.mass = 0; // Mark for removal (cleanup loop handles mass < 10)
                                other.dead = true;
                            }
                        }
                    }
                });

                // Apply Velocity
                cell.x += cell.vx;
                cell.y += cell.vy;

                // Clamp
                cell.x = Math.max(0, Math.min(WORLD_WIDTH, cell.x));
                cell.y = Math.max(0, Math.min(WORLD_HEIGHT, cell.y));

                totalX += cell.x * cell.mass;
                totalY += cell.y * cell.mass;
                totalMass += cell.mass;
            });

            if (totalMass > 0) {
                p.x = totalX / totalMass;
                p.y = totalY / totalMass;
                p.score = totalMass; // Update Score
                // Fix: Assign Radius for Client Zoom (Prevent NaN)
                p.radius = 10 + Math.sqrt(p.score) * 5;
            }
        });

        // 5. Natural Decay & Safe Zone Logic
        let safeZoneRadius = this.getSafeZoneRadius();
        this.players.forEach(p => {
            if (p.dead) return;

            // Calculate total score for decay tier
            const totalScore = p.cells.reduce((sum, c) => sum + c.mass, 0);

            // Get decay rate based on score tier (per second)
            let decayPerSec = 0;
            if (totalScore <= 50) decayPerSec = 0;
            else if (totalScore <= 100) decayPerSec = 0.2;
            else if (totalScore <= 150) decayPerSec = 0.3;
            else if (totalScore <= 200) decayPerSec = 0.5;
            else if (totalScore <= 300) decayPerSec = 0.8;
            else decayPerSec = 1.0;

            // Convert to per-tick decay
            const decayPerTick = decayPerSec / TICK_RATE;

            p.cells.forEach(cell => {
                const dx = cell.x - WORLD_WIDTH / 2;
                const dy = cell.y - WORLD_HEIGHT / 2;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const outsideZone = dist > safeZoneRadius;

                // Apply decay (10x if outside safe zone)
                const multiplier = outsideZone ? 10 : 1;
                const actualDecay = decayPerTick * multiplier;

                if (actualDecay > 0) {
                    cell.mass -= actualDecay;
                    cell.radius = 10 + Math.sqrt(Math.max(0, cell.mass)) * 5;
                }
            });

            // Cleanup tiny cells
            p.cells = p.cells.filter(c => c.mass > 10);
            if (p.cells.length === 0) {
                p.dead = true; p.deathTime = now; p.lastScore = p.score;
            }
        });

        // 2. Bot Logic (Placeholder: Treat as single cell players for now)
        // 2. Bot Logic (Fixed Speed)
        this.bots.forEach(b => {
            const dx = b.targetX - b.x;
            const dy = b.targetY - b.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // Move towards target with fixed max speed
            const speed = 3; // Slow bot speed

            if (dist > speed) {
                b.x += (dx / dist) * speed;
                b.y += (dy / dist) * speed;
            } else {
                // Close enough, pick new target
                b.targetX = rnd(WORLD_WIDTH);
                b.targetY = rnd(WORLD_HEIGHT);
            }

            // Randomly change target
            if (Math.random() < 0.005) {
                b.targetX = rnd(WORLD_WIDTH);
                b.targetY = rnd(WORLD_HEIGHT);
            }
        });

        // 3. Food & Jackpot & Bullets
        // Iterate backwards to allow removal
        for (let i = this.food.length - 1; i >= 0; i--) {
            const f = this.food[i];

            // Bullet Logic
            if (f.isBullet) {
                if (f.vx !== 0 || f.vy !== 0) {
                    f.x += f.vx;
                    f.y += f.vy;
                    f.vx *= 0.95; // Friction
                    f.vy *= 0.95;

                    // Stop if slow encough
                    if (Math.abs(f.vx) < 0.1 && Math.abs(f.vy) < 0.1) {
                        f.vx = 0; f.vy = 0;
                    }
                }
            }

            // Virus Eating Bullets (Phase 4.7)
            for (let vIdx = this.viruses.length - 1; vIdx >= 0; vIdx--) {
                const v = this.viruses[vIdx];
                if (this.checkCollision(v, f)) {
                    // Virus eats bullet (+5 mass per bullet)
                    v.mass += 5;
                    v.radius = 10 + Math.sqrt(v.mass) * 5;
                    this.food.splice(i, 1);

                    // Virus Evolution (Explode at 135 mass)
                    if (v.mass >= 135) {
                        const baseAngle = Math.atan2(f.vy, f.vx);
                        const speed = 40;

                        // Reset Original Virus to base
                        v.mass = 100;
                        v.radius = 10 + Math.sqrt(v.mass) * 5;

                        // Spawn 3 Viruses at -15°, 0°, +15° angles
                        const angleOffsets = [-15, 0, 15]; // degrees
                        angleOffsets.forEach((offsetDeg, idx) => {
                            const offsetRad = offsetDeg * (Math.PI / 180);
                            const shotAngle = baseAngle + offsetRad;
                            const newMass = 100 + rnd(15); // Random Level 1-4

                            this.viruses.push({
                                id: `v_${Date.now()}_${vIdx}_${idx}`,
                                x: v.x + Math.cos(shotAngle) * (v.radius + 50),
                                y: v.y + Math.sin(shotAngle) * (v.radius + 50),
                                mass: newMass,
                                radius: 10 + Math.sqrt(newMass) * 5,
                                color: '#33ff33',
                                isVirus: true,
                                vx: Math.cos(shotAngle) * speed,
                                vy: Math.sin(shotAngle) * speed,
                                decay: 0.95
                            });
                        });
                    }
                    return;
                }
            }

            // Sync Jackpot
        }

        // Sync Jackpot (Existing) 
        if (!this.jackpot && this.food.find(f => f.isJackpot)) {
            this.jackpot = this.food.find(f => f.isJackpot);
        } else if (this.jackpot && !this.food.find(f => f.id === this.jackpot.id)) {
            this.jackpot = null;
        }

        // Player Collision (Multi-Cell)
        this.players.forEach(p => {
            if (p.dead) return;
            p.cells.forEach(cell => {
                for (let i = this.food.length - 1; i >= 0; i--) {
                    const f = this.food[i];
                    if (this.checkCollision(cell, f)) {
                        // Eat
                        const gain = f.isJackpot ? 50 : (f.isBullet ? 5 : 1);
                        cell.mass += gain;
                        cell.radius = 10 + Math.sqrt(cell.mass) * 5; // Update Radius

                        this.food.splice(i, 1);
                        if (f.isJackpot) this.jackpot = null;

                        if (!f.isBullet) {
                            const shouldSpawnJackpot = !this.jackpot && Math.random() < 0.005;
                            this.food.push({
                                id: `f_${Date.now()}_${i}`, x: rnd(WORLD_WIDTH), y: rnd(WORLD_HEIGHT),
                                color: shouldSpawnJackpot ? '#FFD700' : `hsl(${rnd(360)}, 100%, 70%)`,
                                radius: shouldSpawnJackpot ? 25 : 5 + rnd(5),
                                isJackpot: shouldSpawnJackpot
                            });
                            if (shouldSpawnJackpot) this.jackpot = this.food[this.food.length - 1];
                        }
                    }
                }
            });
        });

        // Virus Physics & Collision
        for (let vIdx = this.viruses.length - 1; vIdx >= 0; vIdx--) {
            const v = this.viruses[vIdx];

            // 1. Virus Physics (Movement)
            if (v.vx || v.vy) {
                v.x += v.vx;
                v.y += v.vy;
                v.vx *= v.decay || 0.9;
                v.vy *= v.decay || 0.9;
                if (Math.abs(v.vx) < 0.1 && Math.abs(v.vy) < 0.1) {
                    v.vx = 0; v.vy = 0;
                }
                // Boundary Check
                v.x = Math.max(0, Math.min(WORLD_WIDTH, v.x));
                v.y = Math.max(0, Math.min(WORLD_HEIGHT, v.y));
            }

            this.players.forEach(p => {
                if (p.dead) return;
                // Create a copy of cells to iterate safely while modifying the original array
                const currentCells = [...p.cells];
                currentCells.forEach(cell => {
                    // Rule: mass > virus.mass + 10% overlap
                    if (cell.mass > v.mass && this.checkEatCollision(cell, v)) {
                        // Explode Cell
                        this.viruses.splice(vIdx, 1); // Remove Virus

                        // Split Logic (Max 16 cells)
                        const maxSplits = 16 - p.cells.length;
                        if (maxSplits > 0) {
                            const splits = Math.min(maxSplits, 6); // Split into up to 6 pieces
                            const massPerPiece = cell.mass / (splits + 1);

                            // Original Cell shrinks
                            cell.mass = massPerPiece;
                            cell.radius = 10 + Math.sqrt(cell.mass) * 5;

                            // Create Split Cells
                            for (let k = 0; k < splits; k++) {
                                const angle = Math.random() * Math.PI * 2;
                                const speed = 15 + Math.random() * 15;
                                p.cells.push({
                                    id: `${p.id}_split_${Date.now()}_${k}`,
                                    x: cell.x, y: cell.y,
                                    mass: massPerPiece,
                                    radius: 10 + Math.sqrt(massPerPiece) * 5,
                                    vx: 0, vy: 0,
                                    impulseX: Math.cos(angle) * speed,
                                    impulseY: Math.sin(angle) * speed,
                                    mergeTime: Date.now() + 10000,
                                    color: p.color
                                });
                            }
                        }
                    }
                });
            });
        }



        // 4. Combat (PvP & Bot interaction Refactored for Cells)
        // Helper to get all eatable entities
        const allCells = [];
        this.players.forEach(p => {
            if (!p.dead) p.cells.forEach(c => allCells.push({ ...c, owner: p, isBot: false }));
        });
        this.bots.forEach(b => allCells.push({ ...b, owner: null, isBot: true }));

        // Interaction Loop (N^2)
        for (let i = 0; i < allCells.length; i++) {
            for (let j = 0; j < allCells.length; j++) {
                if (i === j) continue;
                const c1 = allCells[i];
                const c2 = allCells[j];

                if (c1.owner === c2.owner && c1.owner !== null) continue; // Same owner

                // Eat Logic: mass > opponent + 10% overlap
                if (c1.mass > c2.mass && this.checkEatCollision(c1, c2)) {
                    // c1 eats c2
                    if (c2.isBot) {
                        // Respawn Bot
                        const bot = this.bots.find(b => b.id === c2.id);
                        if (bot) {
                            const botMass = c2.mass;
                            bot.x = rnd(WORLD_WIDTH); bot.y = rnd(WORLD_HEIGHT);
                            bot.mass = 15 + rnd(20);
                            bot.radius = 10 + Math.sqrt(bot.mass) * 5;

                            if (c1.owner) {
                                const predator = c1.owner.cells.find(c => c.id === c1.id);
                                if (predator) {
                                    predator.mass += botMass * 0.4; // Gain 40% of Bot Mass
                                    predator.radius = 10 + Math.sqrt(predator.mass) * 5;
                                }
                            }
                        }
                    } else {
                        // Player Cell
                        const p2 = c2.owner;
                        const idx = p2.cells.findIndex(c => c.id === c2.id);
                        if (idx !== -1) {
                            // Add mass to c1
                            let gain = 0;
                            if (c2.isBot) gain = c2.mass * 0.4; // Can reach here? No, caught above.
                            else gain = c2.mass * 0.6; // Gain 60% of Player Mass

                            if (c1.isBot) {
                                // Bot eating player?
                                const bot1 = this.bots.find(b => b.id === c1.id);
                                if (bot1) bot1.radius += gain;
                            } else {
                                const p1Cell = c1.owner.cells.find(c => c.id === c1.id);
                                if (p1Cell) {
                                    p1Cell.mass += gain;
                                    p1Cell.radius = 10 + Math.sqrt(p1Cell.mass) * 5;
                                }
                            }
                            // Remove c2
                            p2.cells.splice(idx, 1);
                        }
                    }
                }
            }
        }

        // 6. Timer
        this.timer -= 1 / TICK_RATE;
        if (this.timer <= 0) {
            const sortedPlayers = Array.from(this.players.values()).sort((a, b) => b.score - a.score);
            const winner = sortedPlayers[0] || { name: 'No One', score: 0 };

            // Phase 5: Winnings
            const winnings = this.pot;
            this.pot = 0; // Reset Pot

            io.to(this.roomId).emit('game_over', {
                winner: { ...winner, winnings },
                leaderboard: sortedPlayers.slice(0, 5)
            });
            this.stopGame();
            this.timer = 0;
            return;
        }

        // 6.5. Safety: Enforce Radius = Mass consistency
        this.players.forEach(p => {
            if (p.dead) return;
            p.cells.forEach(c => {
                c.radius = 10 + Math.sqrt(c.mass) * 5;
            });
            // Update main player radius (for camera) based on biggest cell or score?
            // Score = total mass
            // Let's keep p.radius for total size approx or biggest cell
            if (p.cells.length > 0) {
                const maxR = Math.max(...p.cells.map(c => c.radius));
                p.radius = maxR;
            }
        });

        // 7. Broadcast
        const payload = {
            time: this.timer,
            pot: this.pot, // Phase 5: Send Pot
            players: Array.from(this.players.values()),
            bots: this.bots,
            food: this.food,
            viruses: this.viruses,
            safeZone: { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2, radius: this.getSafeZoneRadius() },
            leaderboard: this.generateLeaderboard(),
            jackpot: this.jackpot
        };

        io.to(this.roomId).emit('game_update', payload);
    }

    getSafeZoneRadius() {
        if (this.timer >= 120) return 5000;
        const progress = (120 - this.timer) / 120;
        const startR = 2500;
        const endR = 300;
        return startR + (endR - startR) * progress;
    }

    generateLeaderboard() {
        return Array.from(this.players.values())
            .filter(p => !p.dead) // Live players only
            .sort((a, b) => b.score - a.score)
            .slice(0, 10)
            .map(e => ({ name: e.name, score: Math.floor(e.score) }));
    }

    handleAction(socketId, action) {
        const p = this.players.get(socketId);
        if (!p || p.dead) return;

        if (action.type === 'eject') { // W Key
            // Eject from ALL eligible cells
            p.cells.forEach(cell => {
                if (cell.mass < 40) return; // Min mass to eject (prevents self-kill)

                const loss = 5;
                cell.mass -= loss;
                cell.radius = 10 + Math.sqrt(cell.mass) * 5;

                // Direction: Towards Mouse (Target) or Forward?
                // Using TargetX/Y stored in p
                let vx = 0, vy = 1;
                if (p.targetX !== undefined) {
                    const dx = p.targetX - cell.x;
                    const dy = p.targetY - cell.y;
                    const d = Math.sqrt(dx * dx + dy * dy);
                    if (d > 0) { vx = dx / d; vy = dy / d; }
                }

                const speed = 15;
                this.food.push({
                    id: `b_${Date.now()}_${Math.random()}`,
                    x: cell.x + vx * (cell.radius + 15),
                    y: cell.y + vy * (cell.radius + 15),
                    color: p.color,
                    radius: 10,
                    isBullet: true,
                    vx: vx * speed,
                    vy: vy * speed,
                    decay: 50
                });
            });
        }
        else if (action.type === 'split') { // Space Key
            // Limit max cells (e.g. 16)
            if (p.cells.length >= 16) return;

            // Filter cells that can split
            // Use persistent buffer so we don't split newly created cells immediately in loop?
            // Simple filter is fine for now.
            const eligible = p.cells.filter(c => c.mass >= 35);

            eligible.forEach(cell => {
                if (p.cells.length >= 16) return;

                const splitMass = cell.mass / 2;
                cell.mass = splitMass;
                cell.radius = 10 + Math.sqrt(cell.mass) * 5;

                // Shoot new cell forward
                let vx = 0, vy = 1;
                if (p.targetX !== undefined) {
                    const dx = p.targetX - cell.x;
                    const dy = p.targetY - cell.y;
                    const d = Math.sqrt(dx * dx + dy * dy);
                    if (d > 0) { vx = dx / d; vy = dy / d; }
                }

                const speed = 20; // Split Impulse

                // Add new cell
                p.cells.push({
                    id: `${p.id}_${Date.now()}_${Math.random()}`,
                    x: cell.x + vx * cell.radius,
                    y: cell.y + vy * cell.radius,
                    mass: splitMass,
                    radius: 10 + Math.sqrt(splitMass) * 5,
                    vx: 0, vy: 0,
                    impulseX: vx * speed,
                    impulseY: vy * speed,
                    mergeTime: Date.now() + 10000 // 10s Merge Cooldown
                });
                cell.mergeTime = Date.now() + 10000;
            });
        }
    }
}

// Room Manager
const rooms = new Map();
const getRoom = (id = 'default') => {
    if (!rooms.has(id)) {
        rooms.set(id, new GameRoom(id));
    }
    return rooms.get(id);
};



io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join_game', ({ name, roomId }) => {
        const room = getRoom(roomId || 'default');
        room.addPlayer(socket, name);

        // Send Initial World State (Static stuff like Food, Map Size)
        socket.emit('game_init', {
            worldWidth: WORLD_WIDTH,
            worldHeight: WORLD_HEIGHT,
            food: room.food
        });
    });

    socket.on('player_ready', () => {
        const room = getRoom('default');
        room.setPlayerReady(socket.id);
    });

    socket.on('input_update', (input) => {
        const room = getRoom('default'); // TODO: Track player's room
        room.handleInput(socket.id, input);
    });

    socket.on('input_action', (action) => {
        const room = getRoom('default');
        room.handleAction(socket.id, action);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        const room = getRoom('default');
        room.removePlayer(socket.id);
    });
});

const PORT = 3001;
server.listen(PORT, () => {
    console.log(`👾 Game Server running on port ${PORT} `);
});

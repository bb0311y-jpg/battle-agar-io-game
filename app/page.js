'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

// Game Constants
const WORLD_WIDTH = 4500;
const WORLD_HEIGHT = 4500;
const INITIAL_RADIUS = 20;
const FOOD_COUNT = 300;
const VIRUS_COUNT = 25;
const VIRUS_RADIUS = 35;
const GAME_DURATION_SEC = 120;

export default function GamePage() {
  const canvasRef = useRef(null);
  const requestRef = useRef();

  // UI State
  const [debugInfo, setDebugInfo] = useState({ fps: 0, players: 0 });
  const [gameState, setGameState] = useState('menu'); // 'menu', 'lobby', 'countdown', 'playing', 'gameover'
  const [gameMode, setGameMode] = useState('single'); // 'single', 'multi'
  const [myId, setMyId] = useState(null);
  const [nickname, setNickname] = useState('');
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION_SEC);
  const [notification, setNotification] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);

  // Multiplayer Lobby State
  const [isReady, setIsReady] = useState(false);
  // lobbyPlayers state removed (using otherPlayersRef)

  // World State
  const myPlayerCellsRef = useRef([]);
  const cameraRef = useRef({ x: 0, y: 0, zoom: 1 });

  // Entities
  const otherPlayersRef = useRef(new Map());
  const botsRef = useRef([]);
  const foodRef = useRef([]);
  const virusesRef = useRef([]);
  const ejectedMassRef = useRef([]);

  // Supabase
  const channelRef = useRef(null);

  // Effects
  const [effects, setEffects] = useState([]); // {x, y, text/color, life}
  const addEffect = (x, y, text, color) => {
    setEffects(prev => [...prev, { id: Math.random(), x, y, text, color, life: 1.0 }]);
  };

  // --- Initialization ---

  const createInitialCell = (name) => ({
    id: 'c_' + Math.random().toString(36).substr(2, 9),
    x: Math.random() * WORLD_WIDTH,
    y: Math.random() * WORLD_HEIGHT,
    radius: INITIAL_RADIUS,
    color: `hsl(${Math.random() * 360}, 70%, 50%)`,
    targetX: 0, targetY: 0,
    name: name,
    canMerge: true, mergeTimer: 0
  });

  useEffect(() => {
    const id = Math.random().toString(36).substr(2, 9);
    setMyId(id);

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    let mouseX = 0;
    let mouseY = 0;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    const handleMouseMove = (e) => {
      if (gameState !== 'playing') return;
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      mouseX = e.clientX - centerX;
      mouseY = e.clientY - centerY;
      myPlayerCellsRef.current.forEach(cell => {
        cell.targetX = mouseX;
        cell.targetY = mouseY;
      });
    };

    const handleKeyDown = (e) => {
      if (gameState !== 'playing') return;
      if (e.code === 'Space') splitCells(mouseX, mouseY);
      if (e.code === 'KeyW') ejectMass(mouseX, mouseY);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('keydown', handleKeyDown);

    // Network Setup
    const channel = supabase.channel('room_1', {
      config: { broadcast: { self: false, ack: false } },
    });

    channel
      .on('broadcast', { event: 'player_update' }, (payload) => {
        const { id, cells, score, name } = payload.payload;
        if (id !== myId) {
          otherPlayersRef.current.set(id, { cells, score, name, lastUpdate: Date.now() });
        }
      })
      .on('broadcast', { event: 'lobby_update' }, (payload) => {
        // Handle lobby state sync
        const { id, name, ready, status } = payload.payload;
        if (status === 'start_game') {
          setGameState('playing');
          setTimeLeft(GAME_DURATION_SEC);
          spawnPlayer();
        } else {
          // Update lobby list in the common ref (unified storage)
          // We use the same ref so cleanup logic works automatically
          otherPlayersRef.current.set(id, {
            id, name, ready, lastUpdate: Date.now(),
            cells: [] // No cells in lobby
          });
          // Force re-render for UI update (since ref doesn't trigger render)
          // We can use a tick state or just rely on the requestAnimationFrame loop to pick it up?
          // The 'draw' loop runs via animate, but React UI (DOM) needs state.
          // We'll update a dummy state to force React render for the DOM Overlay
          setDebugInfo(prev => ({ ...prev, _tick: (prev._tick || 0) + 1 }));
        }
      })
      .on('broadcast', { event: 'player_death' }, (payload) => {
        otherPlayersRef.current.delete(payload.payload.id);
      })
      .subscribe();

    channelRef.current = channel;

    // Game Loop
    let lastTime = performance.now();
    let frameCount = 0;
    let lastFpsTime = lastTime;
    let lastBroadcastTime = 0;
    let jackpotTimer = 0;

    const animate = (time) => {
      const deltaTime = time - lastTime;
      lastTime = time;

      if (gameState === 'playing') {
        updateMyCells(deltaTime);
        updateEjectedMass(deltaTime);
        updateBots(deltaTime);
        checkCollisions(id, channel);
        recalcScore();
        updateCamera();

        // Update Effects
        setEffects(prev => prev.filter(e => e.life > 0).map(e => ({ ...e, life: e.life - 0.02 })));

        // Jackpot
        jackpotTimer += deltaTime;
        if (jackpotTimer > 15000) {
          if (Math.random() < 0.8) {
            spawnJackpot();
            showNotification("🎰 JACKPOT ORB SPAWNED! 🎰");
          }
          jackpotTimer = 0;
        }
      } else if (gameState === 'lobby') {
        // Keep broadcasting presence in lobby
        if (time - lastBroadcastTime > 1000) {
          const myName = nickname.trim() || `Player ${myId.substr(0, 4)}`;
          channel.send({
            type: 'broadcast', event: 'lobby_update',
            payload: { id: myId, name: myName, ready: isReady }
          });
          lastBroadcastTime = time;
        }
        checkLobbyStart(channel);
        // Force UI update for lobby list if needed (though debugInfo update below handles 1s intervals)
      }

      // Broadcasting Game State
      if (gameState === 'playing' && time - lastBroadcastTime > 50) {
        channel.send({
          type: 'broadcast', event: 'player_update',
          payload: {
            id: id,
            score: score,
            name: nickname || `Player ${id.substr(0, 4)}`,
            cells: myPlayerCellsRef.current.map(c => ({
              id: c.id, x: Math.round(c.x), y: Math.round(c.y),
              radius: c.radius, color: c.color, name: c.name
            }))
          },
        });
        lastBroadcastTime = time;
      }

      // Cleanup Stale Players (Works for Lobby AND Game now)
      const now = Date.now();
      let changed = false;
      for (const [pid, p] of otherPlayersRef.current.entries()) {
        if (now - p.lastUpdate > 3000) {
          otherPlayersRef.current.delete(pid);
          changed = true;
        }
      }
      if (changed && gameState === 'lobby') {
        setDebugInfo(prev => ({ ...prev, _tick: (prev._tick || 0) + 1 }));
      }

      if (gameState === 'playing' || gameState === 'gameover' || gameState === 'lobby') {
        draw(ctx, canvas);
      }

      // Stats & Leaderboard
      frameCount++;
      if (time - lastFpsTime >= 1000) {
        setDebugInfo({ fps: frameCount, players: otherPlayersRef.current.size + 1 });
        updateLeaderboard();

        if (gameState === 'playing') {
          setTimeLeft(prev => {
            if (prev <= 1) { handleTimeUp(); return 0; }
            return prev - 1;
          });
        }
        frameCount = 0;
        lastFpsTime = time;
      }

      requestRef.current = requestAnimationFrame(animate);
    };

    requestRef.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('keydown', handleKeyDown);
      cancelAnimationFrame(requestRef.current);
      supabase.removeChannel(channel);
    };
  }, [gameState, isReady, score, nickname]); // Deps for lobby logic


  // --- Logic ---

  const initWorld = () => {
    const newFood = [];
    for (let i = 0; i < FOOD_COUNT; i++) newFood.push(createFood());
    foodRef.current = newFood;

    const newViruses = [];
    for (let i = 0; i < VIRUS_COUNT; i++) newViruses.push(createVirus());
    virusesRef.current = newViruses;

    botsRef.current = []; // Filled if single player
  };

  const updateLeaderboard = () => {
    const all = [];
    // Me
    all.push({ name: nickname || "Me", score: score, isMe: true });
    // Others
    otherPlayersRef.current.forEach(p => {
      let s = p.score || 0;
      if (!s && p.cells) s = Math.floor(p.cells.reduce((a, c) => a + c.radius, 0));
      all.push({ name: p.name || "Enemy", score: s, isMe: false });
    });
    // Bots
    // Bots usually don't have score tracked specifically, but we can approx by radius
    // Let's exclude bots from leaderboard to keep it 'Player' focused, or add huge ones.

    all.sort((a, b) => b.score - a.score);
    setLeaderboard(all.slice(0, 5));
  };

  const checkLobbyStart = (channel) => {
    // Must have > 1 player (myself + at least 1 other)
    if (otherPlayersRef.current.size >= 1 && isReady) {
      // Check if ALL others are ready
      let allOthersReady = true;
      for (const p of otherPlayersRef.current.values()) {
        if (!p.ready) { allOthersReady = false; break; }
      }

      if (allOthersReady) {
        if (gameState !== 'playing') {
          setGameState('playing');
          spawnPlayer();
          if (gameMode === 'multi') {
            botsRef.current = [];
            initWorld(); // Reset food
          }
        }
      }
    }
  };

  const createFood = (isJackpot = false) => ({
    x: Math.random() * WORLD_WIDTH,
    y: Math.random() * WORLD_HEIGHT,
    color: isJackpot ? '#ffd700' : `hsl(${Math.random() * 360}, 100%, 70%)`,
    radius: isJackpot ? 15 : 5 + Math.random() * 5,
    isJackpot: isJackpot,
    glow: isJackpot
  });

  const createVirus = () => ({
    x: Math.random() * WORLD_WIDTH,
    y: Math.random() * WORLD_HEIGHT,
    radius: VIRUS_RADIUS,
    massBuf: 0
  });

  const spawnBot = () => {
    botsRef.current.push({
      id: 'bot_' + Math.random(),
      x: Math.random() * WORLD_WIDTH,
      y: Math.random() * WORLD_HEIGHT,
      radius: 15 + Math.random() * 20,
      color: '#888888',
      targetX: Math.random() * WORLD_WIDTH,
      targetY: Math.random() * WORLD_HEIGHT,
      name: 'Bot',
      changeDirTimer: 0
    });
  };

  const spawnJackpot = () => {
    foodRef.current.push(createFood(true));
  };

  const showNotification = (msg) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  // UI Actions
  const handleSinglePlayer = () => {
    setGameMode('single');
    setGameState('playing');
    initWorld();
    for (let i = 0; i < 15; i++) spawnBot(); // More bots for single
    spawnPlayer();
  };

  const handleMultiPlayer = () => {
    setGameMode('multi');
    setGameState('lobby');
    setLobbyPlayers([]);
    setIsReady(false);
    initWorld(); // clear bots
  };

  const spawnPlayer = () => {
    const startName = nickname.trim() || `Player ${myId.substr(0, 4)}`;
    myPlayerCellsRef.current = [createInitialCell(startName)];
    setScore(0);
    setTimeLeft(GAME_DURATION_SEC);
  };

  // Controls
  const toggleReady = () => {
    setIsReady(!isReady);
  };

  const splitCells = (dirX, dirY) => {
    if (myPlayerCellsRef.current.length >= 16) return;

    const newCells = [];
    const now = Date.now();

    myPlayerCellsRef.current.forEach(cell => {
      if (cell.radius > 35) {
        const newRadius = cell.radius / 1.414;
        cell.radius = newRadius;

        const splitCell = { ...cell };
        splitCell.id = 'c_' + Math.random().toString(36).substr(2, 9);
        splitCell.radius = newRadius;
        splitCell.canMerge = false;
        splitCell.mergeTimer = now + 10000;

        const angle = Math.atan2(dirY, dirX);
        splitCell.x = cell.x + Math.cos(angle) * (cell.radius * 2);
        splitCell.y = cell.y + Math.sin(angle) * (cell.radius * 2);

        splitCell.impulseX = Math.cos(angle) * 20;
        splitCell.impulseY = Math.sin(angle) * 20;

        newCells.push(splitCell);
      }
    });
    myPlayerCellsRef.current = [...myPlayerCellsRef.current, ...newCells];
  };

  const ejectMass = (dirX, dirY) => {
    const angle = Math.atan2(dirY, dirX);
    const now = Date.now();

    myPlayerCellsRef.current.forEach(cell => {
      if (cell.radius > 35) {
        const massLoss = 20;
        cell.radius -= 2;

        // Scaling range calculation
        // Base speed 15. Bonus speed based on radius. 
        // Example: Radius 100 -> +10 speed
        const speedBonus = cell.radius * 0.15;
        const totalSpeed = 15 + speedBonus;

        const eject = {
          id: 'ej_' + Math.random(),
          x: cell.x + Math.cos(angle) * cell.radius,
          y: cell.y + Math.sin(angle) * cell.radius,
          vx: Math.cos(angle) * totalSpeed,
          vy: Math.sin(angle) * totalSpeed,
          radius: 8,
          color: cell.color,
          ownerId: myId,
          createdAt: now
        };
        ejectedMassRef.current.push(eject);
      }
    });
  };

  // Updates
  const updateMyCells = (deltaTime) => {
    const now = Date.now();
    myPlayerCellsRef.current.forEach(cell => {
      const dx = cell.targetX || 0;
      const dy = cell.targetY || 0;
      const dist = Math.sqrt(dx * dx + dy * dy);
      let speed = 4 * Math.pow(cell.radius, -0.4) * 10;
      speed = Math.max(speed, 2);

      if (dist > 0) {
        const angle = Math.atan2(dy, dx);
        cell.x += Math.cos(angle) * speed * (deltaTime / 16);
        cell.y += Math.sin(angle) * speed * (deltaTime / 16);
      }

      if (cell.impulseX || cell.impulseY) {
        cell.x += cell.impulseX * (deltaTime / 16);
        cell.y += cell.impulseY * (deltaTime / 16);
        cell.impulseX *= 0.9;
        cell.impulseY *= 0.9;
      }

      cell.x = Math.max(cell.radius, Math.min(WORLD_WIDTH - cell.radius, cell.x));
      cell.y = Math.max(cell.radius, Math.min(WORLD_HEIGHT - cell.radius, cell.y));

      // Merging
      myPlayerCellsRef.current.forEach((other, otherIdx) => {
        if (cell.id === other.id) return;
        const d = Math.hypot(cell.x - other.x, cell.y - other.y);
        const rSum = cell.radius + other.radius;

        if (d < rSum) {
          if (now > cell.mergeTimer && now > other.mergeTimer) {
            const angle = Math.atan2(cell.y - other.y, cell.x - other.x);
            const push = (rSum - d) / 2;
            cell.x += Math.cos(angle) * push * 0.1;
            cell.y += Math.sin(angle) * push * 0.1;

            if (d < Math.max(cell.radius, other.radius) * 0.5) {
              if (cell.radius >= other.radius && !other.merged) {
                const newArea = Math.PI * cell.radius * cell.radius + Math.PI * other.radius * other.radius;
                cell.radius = Math.sqrt(newArea / Math.PI);
                other.merged = true; // Flag for deletion
                addEffect(cell.x, cell.y, "MERGE!", "gold");
              }
            }
          } else {
            const angle = Math.atan2(cell.y - other.y, cell.x - other.x);
            const push = (rSum - d) / 2;
            cell.x += Math.cos(angle) * push * 0.5;
            cell.y += Math.sin(angle) * push * 0.5;
          }
        }
      });
    });

    myPlayerCellsRef.current = myPlayerCellsRef.current.filter(c => !c.merged);
  };

  const updateEjectedMass = (deltaTime) => {
    for (let i = ejectedMassRef.current.length - 1; i >= 0; i--) {
      const e = ejectedMassRef.current[i];
      e.x += e.vx * (deltaTime / 16);
      e.y += e.vy * (deltaTime / 16);
      e.vx *= 0.95;
      e.vy *= 0.95;

      if (Math.abs(e.vx) < 0.1 && Math.abs(e.vy) < 0.1) { e.vx = 0; e.vy = 0; }
      if (e.x < 0 || e.x > WORLD_WIDTH || e.y < 0 || e.y > WORLD_HEIGHT) {
        ejectedMassRef.current.splice(i, 1);
      }
    }
  };

  const updateBots = (deltaTime) => {
    botsRef.current.forEach(bot => {
      bot.changeDirTimer--;
      if (bot.changeDirTimer <= 0) {
        bot.targetX = Math.random() * WORLD_WIDTH;
        bot.targetY = Math.random() * WORLD_HEIGHT;
        bot.changeDirTimer = 100 + Math.random() * 200;
      }
      const angle = Math.atan2(bot.targetY - bot.y, bot.targetX - bot.x);
      bot.x += Math.cos(angle) * 2;
      bot.y += Math.sin(angle) * 2;
      if (bot.x < 0) bot.x += 5;
    });
  };

  const updateCamera = () => {
    let sumX = 0, sumY = 0, count = 0;
    myPlayerCellsRef.current.forEach(c => { sumX += c.x; sumY += c.y; count++; });
    if (count > 0) {
      cameraRef.current.x += ((sumX / count) - cameraRef.current.x) * 0.1;
      cameraRef.current.y += ((sumY / count) - cameraRef.current.y) * 0.1;
    }
  };

  const checkCollisions = (localId, channel) => {
    myPlayerCellsRef.current.forEach((cell) => {
      // 1. Food
      for (let i = foodRef.current.length - 1; i >= 0; i--) {
        const f = foodRef.current[i];
        if (Math.hypot(cell.x - f.x, cell.y - f.y) < cell.radius) {
          const isJackpot = f.isJackpot;
          foodRef.current.splice(i, 1);
          const multiplier = (timeLeft < 30) ? 2 : 1;
          if (isJackpot) {
            cell.radius += 20 * multiplier;
            showNotification("💰 YOU GOT THE JACKPOT! 💰");
            addEffect(cell.x, cell.y, "+JACKPOT", "gold");
          } else {
            cell.radius += 0.5 * multiplier;
          }
          if (!isJackpot) foodRef.current.push(createFood());
        }
      }

      // 2. Ejected Mass
      for (let i = ejectedMassRef.current.length - 1; i >= 0; i--) {
        const e = ejectedMassRef.current[i];
        if (Math.hypot(cell.x - e.x, cell.y - e.y) < cell.radius) {
          ejectedMassRef.current.splice(i, 1);
          cell.radius += 1.5;
        }
      }

      // 3. Bots
      for (let i = botsRef.current.length - 1; i >= 0; i--) {
        const b = botsRef.current[i];
        if (Math.hypot(cell.x - b.x, cell.y - b.y) < cell.radius && cell.radius > b.radius * 1.2) {
          botsRef.current.splice(i, 1);
          cell.radius += b.radius * 0.5;
          spawnBot();
          addEffect(cell.x, cell.y, "CRUNCH!", "red");
        }
      }

      // 4. Viruses
      for (let i = virusesRef.current.length - 1; i >= 0; i--) {
        const v = virusesRef.current[i];
        const dist = Math.hypot(cell.x - v.x, cell.y - v.y);
        if (dist < cell.radius) {
          if (cell.radius > v.radius * 1.1) {
            cell.radius = Math.max(INITIAL_RADIUS, cell.radius * 0.6);
            virusesRef.current.splice(i, 1);
            virusesRef.current.push(createVirus());
            addEffect(cell.x, cell.y, "EXPLODED!", "orange");
          }
        }
        for (let j = ejectedMassRef.current.length - 1; j >= 0; j--) {
          const e = ejectedMassRef.current[j];
          if (Math.hypot(e.x - v.x, e.y - v.y) < v.radius) {
            ejectedMassRef.current.splice(j, 1);
            v.massBuf += 1;
            v.radius += 2;
            if (v.massBuf > 5) {
              const angle = Math.atan2(e.vy, e.vx);
              const newV = createVirus();
              newV.x = v.x + Math.cos(angle) * (v.radius + 50);
              newV.y = v.y + Math.sin(angle) * (v.radius + 50);
              virusesRef.current.push(newV);
              v.massBuf = 0;
              v.radius = VIRUS_RADIUS;
              addEffect(v.x, v.y, "SHOOT!", "green");
            }
          }
        }
      }

      // 5. PvP
      otherPlayersRef.current.forEach((other) => {
        if (!other.cells) return;
        other.cells.forEach(otherCell => {
          if (Math.hypot(cell.x - otherCell.x, cell.y - otherCell.y) < cell.radius) {
            if (cell.radius > otherCell.radius * 1.1) {
              cell.radius += Math.min(20, otherCell.radius * 0.8);
              channel.send({
                type: 'broadcast',
                event: 'player_eat_cell',
                payload: { predatorId: localId, preyId: 'someone', preyCellId: otherCell.id }
              });
              addEffect(cell.x, cell.y, "DESTROYED!", "red");
            }
          }
        });
      });
    });
  };

  const handleTimeUp = () => setGameState('gameover');
  const handleDeath = () => setGameState('gameover');

  // --- Rendering ---
  const draw = (ctx, canvas) => {
    ctx.fillStyle = '#050510'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const cam = cameraRef.current;

    // Draw Lobby Background (Space)
    if (gameState === 'lobby') {
      ctx.fillStyle = 'white';
      ctx.font = '30px Arial';
      ctx.textAlign = 'center';
      ctx.fillText("WAITING FOR PLAYERS...", canvas.width / 2, 100);

      // Draw Players List (From Ref + Self)
      const players = Array.from(otherPlayersRef.current.values());
      players.push({ id: myId, name: nickname || "Me", ready: isReady });

      players.forEach((p, i) => {
        ctx.fillStyle = p.ready ? '#00ff00' : '#ffff00';
        ctx.fillText(`${p.name} - ${p.ready ? 'READY' : 'WAITING'}`, canvas.width / 2, 200 + i * 40);
      });
      return;
    }

    ctx.save();
    ctx.translate((canvas.width / 2) - cam.x, (canvas.height / 2) - cam.y);

    ctx.strokeStyle = '#333'; ctx.lineWidth = 10; ctx.strokeRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    ctx.strokeStyle = '#222'; ctx.lineWidth = 2;
    for (let x = 0; x <= WORLD_WIDTH; x += 100) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD_HEIGHT); ctx.stroke(); }
    for (let y = 0; y <= WORLD_HEIGHT; y += 100) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD_WIDTH, y); ctx.stroke(); }

    foodRef.current.forEach(f => {
      ctx.fillStyle = f.color;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2); ctx.fill();
      if (f.isJackpot) { ctx.shadowColor = 'gold'; ctx.shadowBlur = 20; ctx.stroke(); ctx.shadowBlur = 0; }
    });

    ejectedMassRef.current.forEach(e => {
      ctx.fillStyle = e.color;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2); ctx.fill();
    });

    virusesRef.current.forEach(v => {
      ctx.lineWidth = 4; ctx.fillStyle = '#33ff33'; ctx.strokeStyle = '#22cc22';
      ctx.beginPath();
      const spikes = 20;
      for (let i = 0; i < spikes * 2; i++) {
        const rot = (Math.PI / spikes) * i;
        const r = (i % 2 === 0) ? v.radius : v.radius * 0.9;
        ctx.lineTo(v.x + Math.cos(rot) * r, v.y + Math.sin(rot) * r);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
    });

    [...botsRef.current, ...Array.from(otherPlayersRef.current.values()).flatMap(p => p.cells || []), ...myPlayerCellsRef.current].forEach(ent => {
      if (!ent) return;
      ctx.beginPath(); ctx.arc(ent.x, ent.y, ent.radius, 0, Math.PI * 2);
      ctx.fillStyle = ent.color; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke();
      if (ent.radius > 15) {
        ctx.fillStyle = 'white'; ctx.strokeStyle = 'black'; ctx.lineWidth = 0.5;
        ctx.font = `bold ${Math.max(10, ent.radius / 2)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(ent.name || '?', ent.x, ent.y);
      }
    });

    effects.forEach(ef => {
      ctx.fillStyle = ef.color || 'white';
      ctx.font = 'bold 20px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(ef.text, ef.x, ef.y - (1.0 - ef.life) * 50);
      ef.life -= 0.02;
    });

    ctx.restore();
  };

  const formatTime = (s) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', userSelect: 'none', fontFamily: 'sans-serif' }}>
      <canvas ref={canvasRef} style={{ display: 'block' }} />

      {notification && (
        <div style={{
          position: 'absolute', top: '15%', left: '50%', transform: 'translateX(-50%)',
          color: '#ffd700', fontSize: '3rem', fontWeight: 'bold', textShadow: '0 0 20px black'
        }}>
          {notification}
        </div>
      )}

      {/* Leaderboard - Top Left */}
      {(gameState === 'playing' || gameState === 'gameover') && (
        <div style={{
          position: 'absolute', top: 10, left: 10,
          background: 'rgba(0,0,0,0.5)', padding: '10px', borderRadius: '5px',
          color: 'white', fontSize: '14px', width: '200px'
        }}>
          <div style={{ borderBottom: '1px solid #eba', marginBottom: '5px', fontWeight: 'bold', color: '#eba' }}>LEADERBOARD</div>
          {leaderboard.map((p, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', color: p.isMe ? '#ff0' : '#fff' }}>
              <span>{i + 1}. {p.name.substring(0, 10)}</span>
              <span>{Math.round(p.score)}</span>
            </div>
          ))}
        </div>
      )}

      {gameState === 'playing' && (
        <>
          <div style={{
            position: 'absolute', top: 20, left: '50%', transform: 'translateX(-50%)',
            color: timeLeft < 30 ? 'red' : 'white', fontSize: '3rem', fontWeight: 'bold', textShadow: '0 0 10px black'
          }}>
            {formatTime(timeLeft)}
          </div>
          <div style={{ position: 'absolute', bottom: 20, left: 20, color: 'rgba(255,255,255,0.5)', fontSize: '1rem' }}>
            [Space] Split &nbsp; [W] Shoot Mass
          </div>
        </>
      )}

      {gameState === 'lobby' && (
        <div style={{
          position: 'absolute', bottom: '10%', left: '50%', transform: 'translateX(-50%)',
          textAlign: 'center'
        }}>
          <h2 style={{ color: 'white', marginBottom: '20px' }}>Waiting for players... ({otherPlayersRef.current.size + 1} connected)</h2>
          <button
            onClick={toggleReady}
            style={{ ...btnStyle, background: isReady ? '#888' : '#0f0' }}
          >
            {isReady ? 'CANCEL READY' : 'READY UP!'}
          </button>
          <div style={{ color: '#aaa', marginTop: '10px' }}>Needs at least 2 players to start</div>
        </div>
      )}

      {gameState === 'menu' && (
        <div style={overlayStyle}>
          <h1 style={{ fontSize: '4rem', color: '#00ff00', textShadow: '0 0 20px #00ff00' }}>GLOW BATTLE.IO</h1>
          <input type="text" placeholder="Enter Nickname" value={nickname} onChange={e => setNickname(e.target.value)}
            style={{ padding: '15px', fontSize: '1.5rem', borderRadius: '5px', border: 'none', textAlign: 'center', marginBottom: '20px' }} maxLength={10} />

          <div style={{ display: 'flex', gap: '20px' }}>
            <button onClick={handleSinglePlayer} style={btnStyle}>SINGLE PLAYER</button>
            <button onClick={handleMultiPlayer} style={{ ...btnStyle, background: 'linear-gradient(45deg, #00bdff, #0077ff)' }}>MULTIPLAYER</button>
          </div>
        </div>
      )}

      {gameState === 'gameover' && (
        <div style={overlayStyle}>
          <h1 style={{ color: 'red', fontSize: '3rem' }}>GAME OVER</h1>
          <h2>Final Score: {Math.round(score)}</h2>
          <button onClick={() => setGameState('menu')} style={btnStyle}>MAIN MENU</button>
        </div>
      )}
    </div>
  );
}

const overlayStyle = { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(10,10,20, 0.9)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'white', zIndex: 10 };
const btnStyle = { padding: '15px 30px', fontSize: '1.5rem', background: 'linear-gradient(45deg, #00ff00, #00cc00)', color: 'white', border: 'none', borderRadius: '50px', cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 0 20px rgba(0,255,0,0.5)', minWidth: '200px' };

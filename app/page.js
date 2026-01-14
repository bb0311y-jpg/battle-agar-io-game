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
const GAME_DURATION_SEC = 180;
const INITIAL_SAFE_ZONE_RADIUS = Math.max(WORLD_WIDTH, WORLD_HEIGHT) / 1.5; // Starts covering everything (roughly)
// Map is square 4500x4500. Center 2250,2250.
// Circle radius that covers corners of 4500x4500 is sqrt(2250^2 + 2250^2) = 3181.
// Let's settle on a Safe Zone Radius start = 3500 (Full map safe)
// End radius = WORLD_WIDTH * 0.25 / 2? No, map size to 25%. Area? or Width?
// "Only 25% map size". If Area is 25%, width is 50%. If Width is 25%, Area is 6.25%.
// Let's assume Width/Radius becomes 25% of original (More dramatic).
// Original Radius equivalent ~2250. Final Radius ~560.

export default function GamePage() {
  const canvasRef = useRef(null);
  const requestRef = useRef();

  // UI State
  const [debugInfo, setDebugInfo] = useState({ fps: 0, players: 0 });
  const [gameState, setGameState] = useState('menu'); // 'menu', 'lobby', 'countdown', 'playing', 'gameover'
  const [gameMode, setGameMode] = useState('single'); // 'single', 'multi'
  const [myId] = useState(() => Math.random().toString(36).substr(2, 9)); // Stable ID
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
  const safeZoneRef = useRef({ x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2, radius: 4000 }); // Start bigger than map

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

  // Refs for State (Single Source of Truth for Game Loop)
  const gameStateRef = useRef('menu');
  const timeLeftRef = useRef(GAME_DURATION_SEC);
  const isReadyRef = useRef(false);
  const nicknameRef = useRef('');
  const scoreRef = useRef(0);
  const mouseRef = useRef({ x: 0, y: 0 }); // Global mouse ref
  // const cameraRef = useRef({ x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 }); // Removed duplicate
  const gameModeRef = useRef('single');
  const isGameStartingRef = useRef(false);
  const isGameStartingRef = useRef(false);
  const lobbyTimerRef = useRef(0);
  const respawnTimerRef = useRef(0); // For 10s cooldown

  // Helper to switch state cleanly
  const switchGameState = (newState) => {
    setGameState(newState);
    gameStateRef.current = newState;
  };

  // Wrapped Setters for Refs
  const setNicknameWrapper = (val) => {
    setNickname(val);
    nicknameRef.current = val;
  };

  const setIsReadyWrapper = (val) => {
    setIsReady(val);
    isReadyRef.current = val;
  };

  const setGameModeWrapper = (mode) => {
    setGameMode(mode);
    gameModeRef.current = mode;
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
    canMerge: true, mergeTimer: 0,
    boostX: 0, boostY: 0
  });

  // Function to Start a FRESH Game (Reset Timer, Score, Bots)
  const startNewGame = () => {
    const startName = (nicknameRef.current || '').trim() || `Player ${myId.substr(0, 4)}`;
    myPlayerCellsRef.current = [createInitialCell(startName)];
    setScore(0);
    scoreRef.current = 0;

    setTimeLeft(GAME_DURATION_SEC);
    timeLeftRef.current = GAME_DURATION_SEC;

    if (gameModeRef.current === 'single') {
      botsRef.current = [];
      for (let i = 0; i < 20; i++) spawnBot();
    }
  };

  // Function to Respawn AFTER DEATH (Keep Timer, Score?, Bots)
  const respawnPlayer = () => {
    // If we respawn, do we keep score? 
    // "最終以分數最高者獲勝" - usually implies you keep your high score or accumulate?
    // Agar.io resets mass (score) on death.
    // But strictly "Wait 10s -> Respawn". 
    // Let's reset Score (current mass) but maybe Leaderboard tracks "Max Score"?
    // For now, reset current score/mass as you are a small cell again.
    const startName = (nicknameRef.current || '').trim() || `Player ${myId.substr(0, 4)}`;
    myPlayerCellsRef.current = [createInitialCell(startName)];
    setScore(0);
    scoreRef.current = 0;
    // DO NOT RESET TIMER
    // DO NOT RESET BOTS
  };

  // Moved useEffect to bottom to ensure all helper functions are defined before use in closures.


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

  const recalcScore = () => {
    let s = 0;
    myPlayerCellsRef.current.forEach(c => s += c.radius);
    s = Math.floor(s);
    setScore(s);
    scoreRef.current = s;
  };

  const updateLeaderboard = () => {
    const all = [];
    // Me
    all.push({ name: nicknameRef.current || "Me", score: scoreRef.current, isMe: true });
    // Others
    otherPlayersRef.current.forEach(p => {
      let s = p.score || 0;
      if (!s && p.cells) s = Math.floor(p.cells.reduce((a, c) => a + c.radius, 0));
      all.push({ name: String(p.name || "Enemy"), score: s, isMe: false });
    });

    all.sort((a, b) => b.score - a.score);
    setLeaderboard(all.slice(0, 5));
  };

  // --- Rendering ---
  const draw = (ctx, canvas, currentGS) => {
    ctx.fillStyle = '#050510'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const cam = cameraRef.current;

    // Draw Lobby Background (Space)
    if (currentGS === 'lobby') {
      ctx.fillStyle = 'white';
      ctx.font = '30px Arial';
      ctx.textAlign = 'center';

      if (isGameStartingRef.current) {
        ctx.fillStyle = '#00ff00';
        ctx.font = '60px Arial';
        ctx.fillText(`STARTING IN ${Math.ceil(lobbyTimerRef.current)}...`, canvas.width / 2, 100);
      } else {
        ctx.fillText("WAITING FOR PLAYERS...", canvas.width / 2, 100);
        ctx.font = '20px Arial';
        ctx.fillStyle = '#aaa';
        ctx.fillText("Game Duration: 3 Minutes", canvas.width / 2, 140);
        ctx.fillText("Poison Circle Starts at 1:00", canvas.width / 2, 165);
      }

      // Draw Players List (From Ref + Self)
      const players = Array.from(otherPlayersRef.current.values());
      players.push({ id: myId, name: nicknameRef.current || "Me", ready: isReadyRef.current });

      players.forEach((p, i) => {
        ctx.fillStyle = p.ready ? '#00ff00' : '#ffff00';
        ctx.fillText(`${p.name} - ${p.ready ? 'READY' : 'WAITING'}`, canvas.width / 2, 200 + i * 40);
      });
      return;
    }

    // (Rest of the draw function...)
    ctx.save();
    ctx.translate((canvas.width / 2) - cam.x, (canvas.height / 2) - cam.y);

    ctx.strokeStyle = '#333'; ctx.lineWidth = 10; ctx.strokeRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    // ... grids ...
    ctx.strokeStyle = '#222'; ctx.lineWidth = 2;
    for (let x = 0; x <= WORLD_WIDTH; x += 100) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD_HEIGHT); ctx.stroke(); }
    for (let x = 0; x <= WORLD_WIDTH; x += 100) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD_HEIGHT); ctx.stroke(); }
    for (let y = 0; y <= WORLD_HEIGHT; y += 100) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD_WIDTH, y); ctx.stroke(); }

    // Draw Safe Zone
    const sz = safeZoneRef.current;
    if (sz) {
      ctx.beginPath();
      ctx.arc(sz.x, sz.y, sz.radius, 0, Math.PI * 2);
      ctx.strokeStyle = sz.radius < 4000 ? 'rgba(255, 0, 0, 0.5)' : 'rgba(0, 255, 0, 0.1)'; // Red if shrinking, Green hint if full
      ctx.lineWidth = sz.radius < 4000 ? 20 : 5;
      ctx.stroke();
    }

    // ... Entities ...
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
      // ... virus shape ...
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

  });

  // Draw Jackpot Arrow
  const camX = canvas.width / 2;
  const camY = canvas.height / 2;
  // Find nearest jackpot
  let nearestJP = null;
  let minJPDist = Infinity;

  // Check food for jackpot
  foodRef.current.forEach(f => {
    if (f.isJackpot) {
      // Distance from camera center (player view)
      // World coords
      const dx = f.x - cam.x;
      const dy = f.y - cam.y;
      const d = dx * dx + dy * dy;
      if (d < minJPDist) {
        minJPDist = d;
        nearestJP = { x: dx, y: dy, dist: Math.sqrt(d) }; // Relative to cam
      }
    }
  });

  // If found and off-screen (heuristic)
  if (nearestJP && nearestJP.dist > Math.min(canvas.width, canvas.height) / 2) {
    const angle = Math.atan2(nearestJP.y, nearestJP.x);
    const arrowDist = Math.min(canvas.width, canvas.height) / 2 - 50;
    const ax = camX + Math.cos(angle) * arrowDist;
    const ay = camY + Math.sin(angle) * arrowDist;

    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(angle);
    ctx.fillStyle = '#eba';
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-10, 10);
    ctx.lineTo(-10, -10);
    ctx.fill();
    ctx.fillStyle = 'gold';
    ctx.font = 'bold 12px Arial';
    ctx.fillText("JACKPOT", 15, 5);
    ctx.restore();
  }

  ctx.restore();
};

const checkLobbyStart = (channel, deltaTime) => {
  // Must have > 1 player
  if (otherPlayersRef.current.size >= 1 && isReadyRef.current) {
    // Check if ALL others are ready
    let allOthersReady = true;
    for (const p of otherPlayersRef.current.values()) {
      if (!p.ready) { allOthersReady = false; break; }
    }

    if (allOthersReady) {
      if (!isGameStartingRef.current) {
        isGameStartingRef.current = true;
        lobbyTimerRef.current = 3;
      } else {
        lobbyTimerRef.current -= (deltaTime / 1000);
        if (lobbyTimerRef.current <= 0) {
          if (gameStateRef.current !== 'playing') {
            switchGameState('playing');
            startNewGame();
            isGameStartingRef.current = false; // Reset
            if (gameModeRef.current === 'multi') {
              botsRef.current = [];
              initWorld();
            }
          }
        }
      }
    } else {
      // If someone cancelled ready, abort countdown
      if (isGameStartingRef.current) {
        isGameStartingRef.current = false;
        lobbyTimerRef.current = 3;
      }
    }
  } else {
    if (isGameStartingRef.current) {
      isGameStartingRef.current = false;
    }
  }
};

const createFood = (isJackpot = false) => ({
  x: Math.random() * WORLD_WIDTH,
  y: Math.random() * WORLD_HEIGHT,
  color: isJackpot ? '#ffd700' : `hsl(${Math.random() * 360}, 100%, 70%)`,
  radius: isJackpot ? 25 : 5 + Math.random() * 5, // Jackpot bigger
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
  // Spawn only in Safe Zone
  const f = createFood(true);
  const sz = safeZoneRef.current;
  // Random angle and distance within safe zone
  const angle = Math.random() * Math.PI * 2;
  const dist = Math.random() * (sz.radius * 0.8); // 80% of current safe zone
  f.x = sz.x + Math.cos(angle) * dist;
  f.y = sz.y + Math.sin(angle) * dist;
  foodRef.current.push(f);
};

const showNotification = (msg) => {
  setNotification(msg);
  setTimeout(() => setNotification(null), 3000);
};

const formatTime = (seconds) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};


const updateMyCells = (deltaTime) => {
  const dt = deltaTime / 1000;
  const cam = cameraRef.current;

  // Safety check if mouseRef is available (it should be)
  if (!mouseRef.current) return;

  // Calculate World Mouse Position
  const screenX = mouseRef.current.x;
  const screenY = mouseRef.current.y;
  const halfW = window.innerWidth / 2;
  const halfH = window.innerHeight / 2;
  const mouseWorldX = screenX - halfW + cam.x;
  const mouseWorldY = screenY - halfH + cam.y;

  const myCells = myPlayerCellsRef.current;

  // 1. Move cells towards mouse (Base Movement)
  // 2. Apply Boost (Physics Impulse)
  // 3. Collision with Walls
  // 4. Merge Logic (Optional basic implementation)

  myCells.forEach(cell => {
    // --- Base Movement ---
    const dx = mouseWorldX - cell.x;
    const dy = mouseWorldY - cell.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const speed = 200 * Math.pow(cell.radius, -0.4) * 8;

    if (dist > 5) {
      cell.x += (dx / dist) * speed * dt;
      cell.y += (dy / dist) * speed * dt;
    }

    // --- Apply Boost/Impulse ---
    if (Math.abs(cell.boostX) > 0.1 || Math.abs(cell.boostY) > 0.1) {
      cell.x += cell.boostX * dt;
      cell.y += cell.boostY * dt;
      // Friction
      const friction = 0.92;
      cell.boostX *= friction;
      cell.boostY *= friction;
    }

    // --- Wall Collisions ---
    cell.x = Math.max(cell.radius, Math.min(WORLD_WIDTH - cell.radius, cell.x));
    cell.y = Math.max(cell.radius, Math.min(WORLD_HEIGHT - cell.radius, cell.y));

    // --- Merge CD ---
    if (!cell.canMerge) {
      cell.mergeTimer += dt;
      if (cell.mergeTimer > 15 + (cell.radius * 0.2)) { // Cooldown based on size
        cell.canMerge = true;
      }
    }
  });

  // --- Simple Cell-Cell Collision & Merging ---
  for (let i = 0; i < myCells.length; i++) {
    for (let j = i + 1; j < myCells.length; j++) {
      const c1 = myCells[i];
      const c2 = myCells[j];
      if (!c1 || !c2) continue; // Safety

      const dx = c1.x - c2.x;
      const dy = c1.y - c2.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const minDist = c1.radius + c2.radius;

      if (dist < minDist) {
        // Overlap
        // Check Merge
        if (c1.canMerge && c2.canMerge) {
          // Merge into c1
          const totalArea = c1.radius * c1.radius + c2.radius * c2.radius;
          c1.radius = Math.sqrt(totalArea);
          c1.x = (c1.x + c2.x) / 2;
          c1.y = (c1.y + c2.y) / 2;

          // Remove c2
          myCells.splice(j, 1);
          j--; // Adjust index
          addEffect(c1.x, c1.y, "MERGE!", "#fff");
          continue;
        }

        // Push apart
        if (dist > 0) { // Avoid div 0
          const overlap = minDist - dist;
          const pushX = (dx / dist) * overlap * 0.1;
          const pushY = (dy / dist) * overlap * 0.1;
          c1.x += pushX; c1.y += pushY;
          c2.x -= pushX; c2.y -= pushY;
        }
      }
    }
  }
};

const updateEjectedMass = (deltaTime) => {
  const dt = deltaTime / 1000;
  // Move ejected mass
  for (let i = ejectedMassRef.current.length - 1; i >= 0; i--) {
    const mass = ejectedMassRef.current[i];
    if (Math.abs(mass.vx) > 0.1 || Math.abs(mass.vy) > 0.1) {
      mass.x += mass.vx * dt;
      mass.y += mass.vy * dt;
      mass.vx *= 0.9;
      mass.vy *= 0.9;
    }
  }
};

const updateBots = (deltaTime) => {
  const dt = deltaTime / 1000;
  botsRef.current.forEach(bot => {
    // Simple AI: Move to target, change target if reached
    const dx = bot.targetX - bot.x;
    const dy = bot.targetY - bot.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 10 || bot.changeDirTimer > 5) {
      bot.targetX = Math.random() * WORLD_WIDTH;
      bot.targetY = Math.random() * WORLD_HEIGHT;
      bot.changeDirTimer = 0;
    }

    const speed = 200 * Math.pow(bot.radius, -0.4) * 5; // Bot speed
    bot.x += (dx / dist) * speed * dt;
    bot.y += (dy / dist) * speed * dt;

    bot.x = Math.max(0, Math.min(WORLD_WIDTH, bot.x));
    bot.y = Math.max(0, Math.min(WORLD_HEIGHT, bot.y));

    bot.changeDirTimer += dt;

    // Very basic flee behavior
  });
};

const updateCamera = () => {
  if (myPlayerCellsRef.current.length > 0) {
    let avgX = 0, avgY = 0;
    myPlayerCellsRef.current.forEach(c => { avgX += c.x; avgY += c.y; });
    cameraRef.current = {
      x: avgX / myPlayerCellsRef.current.length,
      y: avgY / myPlayerCellsRef.current.length
    };
  } else {
    // Spectate Mode: Follow top player
    if (leaderboard.length > 0 && otherPlayersRef.current.size > 0) {
      // Find leader (who is not me)
      const leaderName = leaderboard[0].name;
      // Find player obj from ref
      for (const p of otherPlayersRef.current.values()) {
        if (p.name === leaderName && p.cells && p.cells.length > 0) {
          // Calculate center
          let lx = 0, ly = 0;
          p.cells.forEach(c => { lx += c.x; ly += c.y; });
          cameraRef.current = {
            x: lx / p.cells.length,
            y: ly / p.cells.length
          };
          return;
        }
      }
    }
    // Fallback or Free Roam center?
    // Keep current camera if no target found
  }
};

const checkCollisions = (myId, channel) => {
  const myCells = myPlayerCellsRef.current;

  // 1. Food Collision
  for (let i = foodRef.current.length - 1; i >= 0; i--) {
    const f = foodRef.current[i];
    for (const cell of myCells) {
      const dx = cell.x - f.x;
      const dy = cell.y - f.y;
      // Simple circle collision
      if (dx * dx + dy * dy < (cell.radius + f.radius) * (cell.radius + f.radius)) { // Relaxed hit (radius + radius) vs center logic? No, center inside? 
        // Standard agar: if distance < myRadius (center covers food) - or distance < myR - foodR?
        // Let's use: distance < myRadius (eats if center touches edge? No, usually center to center < myR)
        // To be easier: distance < myRadius + f.radius (Touch eats? No, usually overlap significant)
        // Let's stick to strict: dist < cell.radius - f.radius * 0.5 (must cover mostly)

        if (dx * dx + dy * dy < cell.radius * cell.radius) { // Center of food inside player
          const gain = f.isJackpot ? 1000 : f.radius * f.radius; // Area gain
          const newArea = cell.radius * cell.radius + gain;
          cell.radius = Math.sqrt(newArea);

          if (f.isJackpot) {
            showNotification("🎰 JACKPOT! +MASS 🎰");
            addEffect(cell.x, cell.y, "+JACKPOT", "gold");
          }

          foodRef.current.splice(i, 1);
          // Respawn normal food immediately, Jackpot managed by timer
          if (!f.isJackpot) foodRef.current.push(createFood(false));
          break;
        }
      }
    }
  }

  // 2. Ejected Mass
  for (let i = ejectedMassRef.current.length - 1; i >= 0; i--) {
    const m = ejectedMassRef.current[i];
    for (const cell of myCells) {
      const dx = cell.x - m.x;
      const dy = cell.y - m.y;
      if (dx * dx + dy * dy < cell.radius * cell.radius) {
        if (Math.abs(m.vx) < 100 && Math.abs(m.vy) < 100) {
          const newArea = cell.radius * cell.radius + m.radius * m.radius;
          cell.radius = Math.sqrt(newArea);
          ejectedMassRef.current.splice(i, 1);
          break;
        }
      }
    }
  }

  // 3. Virus Collision (Split)
  for (let i = virusesRef.current.length - 1; i >= 0; i--) {
    const v = virusesRef.current[i];
    // Check collision with my cells
    for (let j = 0; j < myCells.length; j++) {
      const cell = myCells[j];
      const dx = cell.x - v.x;
      const dy = cell.y - v.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < cell.radius) { // Overlap
        if (cell.radius > v.radius * 1.1) { // Must be bigger to eat/pop
          // Pop!
          virusesRef.current.splice(i, 1);
          // Split cell into many pieces
          const parts = 16 - myCells.length; // Max remaining slots
          const splits = Math.min(parts, 4); // Split into ~4 unless capped

          if (splits > 0) {
            const areaPerSplit = (cell.radius * cell.radius) / (splits + 1);
            cell.radius = Math.sqrt(areaPerSplit);
            for (let k = 0; k < splits; k++) {
              const angle = Math.random() * Math.PI * 2;
              myCells.push({
                ...createInitialCell(cell.name),
                x: cell.x + Math.cos(angle) * cell.radius * 2,
                y: cell.y + Math.sin(angle) * cell.radius * 2,
                radius: Math.sqrt(areaPerSplit),
                color: cell.color,
                canMerge: false, mergeTimer: 0,
                boostX: Math.cos(angle) * 800,
                boostY: Math.sin(angle) * 800
              });
            }
          }
          // Respawn virus elsewhere
          virusesRef.current.push(createVirus());
          break;
        }
      }
    }
  }

  // 4. Other Players & Bots (Eat logic)
  // Bots
  for (let i = botsRef.current.length - 1; i >= 0; i--) {
    const bot = botsRef.current[i];
    for (const cell of myCells) {
      const dx = cell.x - bot.x;
      const dy = cell.y - bot.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < cell.radius - bot.radius * 0.2 && cell.radius > bot.radius * 1.2) {
        // Eat Bot (Gain 50% Mass)
        const gain = (bot.radius * bot.radius) * 0.5;
        const newArea = cell.radius * cell.radius + gain;
        cell.radius = Math.sqrt(newArea);
        botsRef.current.splice(i, 1);
        addEffect(cell.x, cell.y, "CRUNCH", "red");
        // Respawn bot
        setTimeout(() => spawnBot(), 3000);
        break;
      }
    }
  }

  // PvP
  // We only check if WE eat THEM. They run their own check if they eat US.
  // However, for correct sync, usually the "Eater" claims the kill.
  // If I eat you, I send "I ate Player X cell Y".
  // For simplicity here: Local check -> if I cover enough of enemy cell -> I eat it.
  // Broadcast 'player_death' if I eat all their cells? Or just 'cell_eaten'?
  // Simplified: Just grow local, remove from local 'otherPlayersRef'.
  // Real MP needs authoritative server or strict events.
  // Here we rely on "Honesty" / Laggy consensus.

  otherPlayersRef.current.forEach((p, pid) => {
    if (!p.cells) return;
    let eatenIndices = [];
    p.cells.forEach((enemyCell, idx) => {
      for (const cell of myCells) {
        const dx = cell.x - enemyCell.x;
        const dy = cell.y - enemyCell.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Relaxed Collision Rule for PvP:
        // Must be 10% bigger (1.1x)
        // Dist < radius (touching center? No, overlap).
        // Center of enemy inside My Radius?
        // dist < cell.radius - enemyCell.radius * 0.2

        if (cell.radius > enemyCell.radius * 1.1 && dist < cell.radius - enemyCell.radius * 0.2) {
          // EAT
          const gain = (enemyCell.radius * enemyCell.radius) * 0.5;
          const newArea = cell.radius * cell.radius + gain;
          cell.radius = Math.sqrt(newArea);
          eatenIndices.push(idx);
          addEffect(cell.x, cell.y, "KILL!", "red");
          break;
        }
      }
    });

    if (eatenIndices.length > 0) {
      // Remove eaten cells from local view of enemy
      // We can't easily force them to die unless we send an event
      // Send "kill_request"? 
      // For strict casual game: Send event "I ate cell X of player Y"
      // But simplest valid approach now: Just broadcast my huge size next update :)
      // And maybe send a 'eat_event'
      // Actually, if we don't tell them, they won't disappear on their screen.
      // We MUST send an event.
      const targetId = p.id;
      channel.send({
        type: 'broadcast', event: 'cells_eaten',
        payload: { targetId, indices: eatenIndices, eaterId: myId }
      });

      // Client-side prediction delete
      // p.cells = p.cells.filter((_, i) => !eatenIndices.includes(i));
      // If p.cells empty -> they dead.
    }
  });

};

// UI Actions
const handleSinglePlayer = () => {
  setGameMode('single');
  switchGameState('playing');
  initWorld();
  otherPlayersRef.current.clear();
  startNewGame(); // Start fresh
};

const handleMultiPlayer = () => {
  const name = (nicknameRef.current || `Player ${myId.substr(0, 4)}`).trim();

  // Check for duplicate names
  let isDuplicate = false;
  for (const p of otherPlayersRef.current.values()) {
    if ((p.name || '').trim().toLowerCase() === name.toLowerCase()) {
      isDuplicate = true;
      break;
    }
  }

  if (isDuplicate) {
    showNotification("Name taken! Please choose another.");
    return;
  }

  setGameMode('multi');
  switchGameState('lobby');
  // lobbyPlayers cleared via effect logic usually, but here we just ensure refs clean if needed
  setIsReadyWrapper(false);

  // DISABLE BOTS in Multi
  botsRef.current = [];
  initWorld();
  botsRef.current = []; // Ensure empty after initWorld
};

// Controls
const toggleReady = () => {
  // Determine new state from REF to be safe
  const newState = !isReadyRef.current;
  setIsReadyWrapper(newState);
};

const splitCells = (dirX, dirY) => {
  const myCells = myPlayerCellsRef.current;
  if (myCells.length >= 16) return; // Max 16 cells

  const newCells = [];
  const cam = cameraRef.current;
  const halfW = window.innerWidth / 2;
  const halfH = window.innerHeight / 2;
  // Current world mouse
  const mX = mouseRef.current.x - halfW + cam.x;
  const mY = mouseRef.current.y - halfH + cam.y;

  myCells.forEach(cell => {
    if (cell.radius < 35) {
      newCells.push(cell); // Too small to split
      return;
    }

    // Split!
    const newRadius = cell.radius / 1.414; // Area/2
    cell.radius = newRadius;

    // Direction towards mouse
    let dx = mX - cell.x;
    let dy = mY - cell.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) { dx = 1; dy = 0; }
    else { dx /= dist; dy /= dist; }

    // Create Split Cell
    const splitDist = newRadius * 2; // Spawn slight ahead
    const splitCell = {
      ...createInitialCell(cell.name),
      id: 'c_' + Math.random().toString(36).substr(2, 9),
      x: cell.x + dx * splitDist,
      y: cell.y + dy * splitDist,
      radius: newRadius,
      color: cell.color,
      boostX: dx * 800, // Impulse speed
      boostY: dy * 800,
      canMerge: false,
      mergeTimer: 0
    };

    newCells.push(cell);
    newCells.push(splitCell);
  });

  myPlayerCellsRef.current = newCells;
};

const ejectMass = () => {
  const myCells = myPlayerCellsRef.current;
  const cam = cameraRef.current;
  const halfW = window.innerWidth / 2;
  const halfH = window.innerHeight / 2;
  const mX = mouseRef.current.x - halfW + cam.x;
  const mY = mouseRef.current.y - halfH + cam.y;

  myCells.forEach(cell => {
    if (cell.radius < 30) return; // Too small

    const loss = 10; // Mass loss
    // New radius from area
    // AreaOld = PI*r^2. AreaNew = AreaOld - LossArea.
    // Simplified: just radius reduction approximation for gameplay feel
    // mass ~ r^2. 
    const oldMass = cell.radius * cell.radius;
    const newMass = oldMass - 100; // Deduct 100 mass units (approx r=10)
    if (newMass <= 0) return;

    cell.radius = Math.sqrt(newMass);

    let dx = mX - cell.x;
    let dy = mY - cell.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) { dx = 1; dy = 0; } else { dx /= dist; dy /= dist; }

    // Spawn Mass
    const massObj = {
      x: cell.x + dx * cell.radius,
      y: cell.y + dy * cell.radius,
      vx: dx * 800,
      vy: dy * 800,
      radius: 8,
      color: cell.color
    };
    ejectedMassRef.current.push(massObj);

    if (gameModeRef.current === 'multi') {
      channelRef.current?.send({
        type: 'broadcast', event: 'mass_ejected',
        payload: massObj
      });
    }
  });
};

useEffect(() => {
  // Mount only ONCE
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
    if (gameStateRef.current !== 'playing') return;
    // Store SCREEN coordinates
    mouseRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleKeyDown = (e) => {
    if (gameStateRef.current !== 'playing') return;
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
      // Isolation: If Single Player, IGNORE network
      if (gameModeRef.current === 'single') return;

      const { id, cells, score, name } = payload.payload;
      if (id !== myId) {
        const prev = otherPlayersRef.current.get(id) || {};
        // If we see a player sending updates with cells, they are playing.
        // Improve Lobby Sync: If we are in lobby and ready, and we see someone playing, 
        // we should probably ensure our game starts too (failsafe).
        if (gameStateRef.current === 'lobby' && isReadyRef.current && cells && cells.length > 0) {
          // Optional: trigger start if stuck?
          // Actually, let's just ensure we don't lose the 'ready' flag.
          if (!prev.ready) prev.ready = true; // Infer ready if playing
        }

        otherPlayersRef.current.set(id, {
          ...prev,
          id, cells, score, name: name || 'Unknown', lastUpdate: Date.now()
        });
      }
    })
    .on('broadcast', { event: 'lobby_update' }, (payload) => {
      if (gameModeRef.current === 'single') return; // Ignore in single player

      const { id, name, ready, status } = payload.payload;
      if (status === 'start_game') {
        otherPlayersRef.current.forEach(p => p.cells = []);
        switchGameState('playing');
        setTimeLeft(GAME_DURATION_SEC);
        timeLeftRef.current = GAME_DURATION_SEC;

        startNewGame(); // Was spawnPlayer
      } else {
        otherPlayersRef.current.set(id, {
          id, name: name || 'Unknown', ready, lastUpdate: Date.now(),
          cells: []
        });
      }
    })
    .on('broadcast', { event: 'player_death' }, (payload) => {
      if (gameModeRef.current === 'single') return; // Ignore in single player
      otherPlayersRef.current.delete(payload.payload.id);
    })
    .on('broadcast', { event: 'mass_ejected' }, (payload) => {
      if (gameModeRef.current === 'single') return; // Ignore in single player
      const { x, y, vx, vy, color, radius } = payload.payload;
      ejectedMassRef.current.push({ x, y, vx, vy, color, radius, life: 1.0 });
    })
    .on('broadcast', { event: 'cells_eaten' }, (payload) => {
      if (gameModeRef.current === 'single') return; // Ignore in single player
      // If I am the target, I lost cells!
      if (payload.payload.targetId === myId) {
        const indices = payload.payload.indices;
        // Remove my cells
        // Note: indices might be stale if array shifted? 
        // Safer to match by ID if we had cell IDs. We do! c.id
        // But 'indices' sent from attacker is based on their snapshot.
        // Quick fix: attacker sends cell IDs or we just pop simplisticly?
        // BETTER: just remove N cells.

        // Actually, if I lose all cells, I die.
        if (myPlayerCellsRef.current.length <= indices.length) {
          myPlayerCellsRef.current = [];
          showNotification("OM NOM NOM! YOU WERE EATEN!");
        } else {
          // Remove smallest cells as fallback or try to remove specific
          myPlayerCellsRef.current.splice(0, indices.length);
          showNotification("OUCH! PART OF YOU WAS EATEN!");
        }
      }
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
    try {
      const deltaTime = time - lastTime;
      lastTime = time;

      const currentGS = gameStateRef.current;
      const mode = gameModeRef.current;

      if (currentGS === 'playing') {
        updateMyCells(deltaTime);
        updateEjectedMass(deltaTime);
        if (mode === 'single') updateBots(deltaTime); // ONLY UPDATE BOTS IN SINGLE

        checkCollisions(myId, channel);
        recalcScore();
        updateCamera();

        setEffects(prev => prev.filter(e => e.life > 0).map(e => ({ ...e, life: e.life - 0.02 })));

        // New Logic
        // updateSafeZone(timeLeftRef.current); // This function is not defined in the provided code
        // applyDecay(deltaTime); // This function is not defined in the provided code

        // Zone Warning
        // if (Math.abs(timeLeftRef.current - 130) < 0.1) { // At 130s left (50s elapsed)
        //   showNotification("⚠️ ZONE SHRINKING IN 10S ⚠️");
        // }

        jackpotTimer += deltaTime;
        if (jackpotTimer > 15000) {
          if (Math.random() < 0.8) {
            spawnJackpot();
            showNotification("🎰 JACKPOT ORB SPAWNED! 🎰");
          }
          jackpotTimer = 0;
        }
      } else if (currentGS === 'lobby') {
        if (time - lastBroadcastTime > 1000) {
          const myName = `Player ${myId.substr(0, 4)}`;
          channel.send({
            type: 'broadcast', event: 'lobby_update',
            payload: { id: myId, name: nicknameRef.current || myName, ready: isReadyRef.current }
          });
          lastBroadcastTime = time;
        }
        checkLobbyStart(channel, deltaTime);
        setDebugInfo(prev => ({ ...prev, tick: (prev.tick || 0) + 1 }));
      }


      // Broadcast ONLY in Multi
      if (mode === 'multi' && currentGS === 'playing' && time - lastBroadcastTime > 50) {
        channel.send({
          type: 'broadcast', event: 'player_update',
          payload: {
            id: myId,
            score: scoreRef.current,
            name: nicknameRef.current || `Player ${myId.substr(0, 4)}`,
            cells: myPlayerCellsRef.current.map(c => ({
              id: c.id, x: Math.round(c.x), y: Math.round(c.y),
              radius: c.radius, color: c.color, name: c.name
            }))
          },
        });
        lastBroadcastTime = time;
      }

      // Cleanup
      const now = Date.now();
      for (const [pid, p] of otherPlayersRef.current.entries()) {
        if (now - p.lastUpdate > 3000) otherPlayersRef.current.delete(pid);
      }

      if (currentGS === 'playing' || currentGS === 'gameover' || currentGS === 'lobby') {
        draw(ctx, canvas, currentGS);
      }

      // Timer & Stats
      frameCount++;
      if (time - lastFpsTime >= 1000) {
        setDebugInfo({ fps: frameCount, players: otherPlayersRef.current.size + 1 });
        updateLeaderboard();

        if (currentGS === 'playing') {
          timeLeftRef.current -= 1;
          setTimeLeft(timeLeftRef.current);
          if (timeLeftRef.current <= 0) {
            if (gameModeRef.current === 'single') {
              // Single Player Game Over
              switchGameState('gameover');
            } else {
              // Multi: only show if we are playing?
              // Actually multi relies on server/lobby sync, but client timer dictates UI
              switchGameState('gameover');
            }
          }
        }

        // Update Respawn Timer if dead
        if (gameStateRef.current === 'playing' && myPlayerCellsRef.current.length === 0) {
          // We are dead / spectating
          // But 'playing' state is kept for spectating?
          // Logic check: "gameover" is valid state for end of match. 
          // Valid Death state: we are in "playing" but have 0 cells.
          // We need a timer for respawn button.
        }
      }
      frameCount = 0;
      lastFpsTime = time;
    }
      } catch (err) {
    console.error("Game Loop Error:", err);
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
}, []); // Mount ONCE. Game loop relies on Refs for state updates.

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
        <input type="text" placeholder="Enter Nickname" value={nickname} onChange={e => setNicknameWrapper(e.target.value)}
          style={{ padding: '15px', fontSize: '1.5rem', borderRadius: '5px', border: 'none', textAlign: 'center', marginBottom: '20px' }} maxLength={10} />

        <div style={{ display: 'flex', gap: '20px' }}>
          <button onClick={handleSinglePlayer} style={btnStyle}>SINGLE PLAYER</button>
          <button onClick={handleMultiPlayer} style={{ ...btnStyle, background: 'linear-gradient(45deg, #00bdff, #0077ff)' }}>MULTIPLAYER</button>
        </div>
      </div>
    )}

    {gameState === 'playing' && myPlayerCellsRef.current.length === 0 && (
      <div style={{
        position: 'absolute', top: '40%', left: '50%', transform: 'translate(-50%, -50%)',
        textAlign: 'center', pointerEvents: 'none' // Let clicks pass? No, buttons need clicks
      }}>
        <h1 style={{ color: 'red', textShadow: '0 0 5px black' }}>YOU DIED</h1>
        <div style={{ pointerEvents: 'auto' }}>
          <button
            onClick={() => {
              respawnPlayer(); // Use Respawn Logic (Keep Timer)
            }}
            style={{ ...btnStyle, background: respawnTimerRef.current > 0 ? '#555' : '#ff4444' }}
            disabled={respawnTimerRef.current > 0}
          >
            {respawnTimerRef.current > 0 ? `RESPAWN IN ${Math.ceil(respawnTimerRef.current)}...` : 'RESPAWN NOW'}
          </button>
        </div>
      </div>
    )}

    {gameState === 'gameover' && (
      <div style={overlayStyle}>
        <h1 style={{ color: 'red', fontSize: '3rem' }}>GAME OVER</h1>
        <h2>Final Score: {Math.round(score)}</h2>
        <button onClick={() => switchGameState('menu')} style={btnStyle}>MAIN MENU</button>

        <div style={{ marginTop: '20px', display: 'flex', gap: '20px' }}>
          <button onClick={() => {
            startNewGame(); // Game Over -> Respawn means NEW GAME usually?
            // Or "infinite respawn" context is within the 3 mins.
            // If Game Over state is reached, it means 3 mins is UP.
            // So "Respawn" here means "Play Again".
            switchGameState('playing');
          }} style={{ ...btnStyle, background: '#444' }}>PLAY AGAIN</button>

          <button onClick={() => {
            setScore(0);
            myPlayerCellsRef.current = []; // Ensure dead
            switchGameState('playing');
            showNotification("Spectating Mode");
          }} style={{ ...btnStyle, background: '#666' }}>SPECTATE</button>
        </div>
      </div>
    )}
  </div>
);
}

const overlayStyle = { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(10,10,20, 0.9)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'white', zIndex: 10 };
const btnStyle = { padding: '15px 30px', fontSize: '1.5rem', background: 'linear-gradient(45deg, #00ff00, #00cc00)', color: 'white', border: 'none', borderRadius: '50px', cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 0 20px rgba(0,255,0,0.5)', minWidth: '200px' };

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
  const [myId] = useState(() => (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).substr(2, 9)); // Stable ID

  const [nickname, setNickname] = useState('');
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION_SEC);
  const [notification, setNotification] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);

  // Multiplayer Lobby State
  const [isReady, setIsReady] = useState(false);
  // lobbyPlayers state removed (using otherPlayersRef) <-- OLD COMMENT
  const [lobbyPlayers, setLobbyPlayers] = useState([]); // New State for UI

  const [isLoading, setIsLoading] = useState(true); // Mask initial lag
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState('DISCONNECTED'); // 'SUBSCRIBED', 'TIMED_OUT', 'CLOSED', 'CHANNEL_ERROR'

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
  const lobbyTimerRef = useRef(0);
  const respawnTimerRef = useRef(0); // For 10s cooldown
  const hasDiedRef = useRef(false); // Track death state
  const savedScoreRef = useRef(0); // Store score before death

  // New Ref for Heartbeat Lobby
  const lobbyPlayersRef = useRef(new Map());
  const lastHeartbeatRef = useRef(0);

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

  // Supabase Auth State
  const [user, setUser] = useState(null);

  // Moved useEffect to bottom to ensure all helper functions are defined before use in closures.

  // --- Auth & Profile Logic ---
  useEffect(() => {
    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      const currentUser = session?.user;
      setUser(currentUser);
      if (currentUser) {
        // Here we would fetch the profile/balance
        console.log("User Authenticated:", currentUser.id);
      }
    });

    // Auto Sign-in Anonymously if not logged in
    const signIn = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        const { error } = await supabase.auth.signInAnonymously();
        if (error) console.error("Auth Error:", error);
      }
    };
    signIn();

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  // Function to Start a FRESH Game (Reset Timer, Score, Bots)
  const startNewGame = (shouldSpawnBots = true) => {
    const finalMyId = user ? user.id : myId; // Use Auth ID if available
    const startName = (nicknameRef.current || '').trim() || `Player ${finalMyId.substr(0, 4)}`;

    // Update IDs
    myPlayerCellsRef.current = [createInitialCell(startName)];
    setScore(0);
    scoreRef.current = 0;

    setTimeLeft(GAME_DURATION_SEC);
    timeLeftRef.current = GAME_DURATION_SEC;

    // In Multi, HOST spawns bots passed via Data, logic elsewhere.
    // In Single, we spawn here.
    if ((gameModeRef.current === 'single' && shouldSpawnBots)) {
      botsRef.current = [];
      for (let i = 0; i < 20; i++) spawnBot();
    }

    if (gameModeRef.current === 'single') {
      // Trigger Loading Screen for Single Player Start
      setIsLoading(true);
      setLoadingProgress(0);
      const loadInterval = setInterval(() => {
        setLoadingProgress(prev => {
          if (prev >= 100) {
            clearInterval(loadInterval);
            setIsLoading(false);
            return 100;
          }
          return prev + 10;
        });
      }, 100);
    }
    hasDiedRef.current = false;
  };

  // Function to Respawn AFTER DEATH (Keep Timer, Score?, Bots)
  const respawnPlayer = () => {
    // If we respawn, do we keep score? 
    // "最終以分數最高者獲勝" - usually implies you keep your high score or accumulate?
    // Agar.io resets mass (score) on death.
    // But strictly "Wait 10s -> Respawn". 
    // Let's reset Score (current mass) but maybe Leaderboard tracks "Max Score"?
    // For now, reset current score/mass as you are a small cell again.
    const finalMyId = user ? user.id : myId;
    const startName = (nicknameRef.current || '').trim() || `Player ${finalMyId.substr(0, 4)}`;
    myPlayerCellsRef.current = [createInitialCell(startName)];
    setScore(0);
    scoreRef.current = 0;
    // DO NOT RESET TIMER
    // DO NOT RESET BOTS
    hasDiedRef.current = false;
  };


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

    // Others (Real Players)
    otherPlayersRef.current.forEach(p => {
      let s = p.score || 0;
      if (!s && p.cells) s = Math.floor(p.cells.reduce((a, c) => a + c.radius, 0));
      all.push({ name: String(p.name || "Enemy"), score: s, isMe: false });
    });

    // Bots (Add them to leaderboard so Single Player has competition)
    botsRef.current.forEach(b => {
      // Bot score is roughly its radius (or area, but we use radius sum for score usually)
      // Simple approximation: Score = Radius.
      all.push({ name: b.name || "Bot", score: Math.floor(b.radius), isMe: false });
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
      // Use lobbyPlayersRef for consistency
      const players = Array.from(lobbyPlayersRef.current.values());
      // Self is not in lobbyPlayersRef usually, or handled? 
      // Current implementation logic: we will add self to lobbyPlayersRef or just concat for display.
      // Let's just concat self for display like before.
      const displayList = [...players];
      // Ensure I am in the list visually
      if (!displayList.find(p => p.id === myId)) {
        displayList.push({ id: myId, name: nicknameRef.current || "Me", ready: isReadyRef.current });
      }

      displayList.forEach((p, i) => {
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
      ctx.strokeStyle = sz.radius < 4000 ? 'rgba(255, 0, 0, 0.5)' : 'rgba(0, 255, 0, 0.15)'; // Red if shrinking, Green hint if full
      ctx.lineWidth = sz.radius < 4000 ? 20 : 10; // Thicker green hint
      ctx.stroke();

      // Debug Text for Safe Zone
      if (sz.radius >= 4000 && mouseRef.current) {
        // Show hint only near mouse or center? 
        // ctx.fillStyle = 'rgba(0, 255, 0, 0.3)';
        // ctx.font = '20px Arial';
        // ctx.fillText("SAFE ZONE ACTIVE", sz.x, sz.y - sz.radius + 50);
      }
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

      let drawX = ent.x;
      let drawY = ent.y;

      // Poison Effect: Shake and Red Glow
      if (ent.isPoisoned) {
        drawX += (Math.random() - 0.5) * 4;
        drawY += (Math.random() - 0.5) * 4;

        ctx.beginPath();
        ctx.arc(drawX, drawY, ent.radius + 5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 0, 0, ${0.3 + Math.random() * 0.2})`; // Pulse red
        ctx.fill();
      }

      ctx.beginPath(); ctx.arc(drawX, drawY, ent.radius, 0, Math.PI * 2);
      ctx.fillStyle = ent.color; ctx.fill();

      // Poison stroke
      ctx.strokeStyle = ent.isPoisoned ? '#ff0000' : '#fff';
      ctx.lineWidth = ent.isPoisoned ? 4 : 3;
      ctx.stroke();

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

  // Helper: Am I the Host? (Lowest ID)
  // Helper: Am I the Host? (Lowest ID)
  const isHost = () => {
    // In Lobby, use lobbyPlayersRef to decide host for starting game
    if (gameStateRef.current === 'lobby') {
      const allIds = [myId, ...Array.from(lobbyPlayersRef.current.keys())];
      allIds.sort();
      return allIds[0] === myId;
    }
    // In Game, use otherPlayersRef (active players)
    // RISK: If a player drops, host might shift. 
    // Ideally host should be sticky, but Lowest ID is robust enough for now.
    const allIds = [myId, ...Array.from(otherPlayersRef.current.keys())];
    allIds.sort();
    return allIds[0] === myId;
  };

  const checkLobbyStart = (channel, deltaTime) => {
    // Only Host checks for start conditions
    // But we need to update Timer visually for everyone? 
    // Actually, let Host drive the timer via broadcasts? 
    // Or keep independent timers but Host triggers the "GO".

    // Simplest: Host checks "All Ready", then broadcasts "Starting in 3..."
    // Then after 3s, broadcasts "Start with Data".

    if (!isHost()) return; // Slaves do nothing, just wait for events

    // Must have > 1 player
    // Updated to use lobbyPlayersRef
    const players = Array.from(lobbyPlayersRef.current.values());
    // host is 1, plus clients. 
    // lobbyPlayersRef contains clients (heartbeats from others).
    // Total = clients + me.
    const totalPlayers = players.length + 1;

    if (totalPlayers >= 2 && isReadyRef.current) {
      // Check if ALL others are ready
      const allOthersReady = players.every(p => p.ready);

      if (allOthersReady) {
        if (!isGameStartingRef.current) {
          isGameStartingRef.current = true;
          lobbyTimerRef.current = 3;
          // Notify everyone we are counting down (Tripple Send for reliability)
          const countdownPayload = { type: 'broadcast', event: 'lobby_countdown', payload: { seconds: 3 } };
          channel.send(countdownPayload);
          setTimeout(() => channel.send(countdownPayload), 300);
          setTimeout(() => channel.send(countdownPayload), 600);
        } else {
          lobbyTimerRef.current -= (deltaTime / 1000);

          // Send sync ticks occasionally? Or just trust clients?
          // Let's trust clients for countdown, but Host triggers the FINAL start.

          if (lobbyTimerRef.current <= 0) {
            // START GAME!
            // 1. Generate World Data
            const initialFood = [];
            for (let i = 0; i < FOOD_COUNT; i++) initialFood.push(createFood());

            const initialViruses = [];
            for (let i = 0; i < VIRUS_COUNT; i++) initialViruses.push(createVirus());

            const initialBots = [];
            for (let i = 0; i < 20; i++) { // Always 20 bots in multi
              initialBots.push({
                id: 'bot_' + Math.random().toString(36).substr(2, 9),
                x: Math.random() * WORLD_WIDTH,
                y: Math.random() * WORLD_HEIGHT,
                radius: 15 + Math.random() * 20,
                color: '#888888',
                targetX: Math.random() * WORLD_WIDTH,
                targetY: Math.random() * WORLD_HEIGHT,
                name: 'Bot',
                changeDirTimer: 0
              });
            }

            // 2. Broadcast Data
            // 2. Broadcast Data (Send multiple times for reliability)
            const startPayload = {
              type: 'broadcast', event: 'match_start',
              payload: {
                food: initialFood,
                viruses: initialViruses,
                bots: initialBots
              }
            };
            channel.send(startPayload);
            setTimeout(() => channel.send(startPayload), 500); // Redundancy 1
            setTimeout(() => channel.send(startPayload), 1000); // Redundancy 2

            // 3. Start Local
            startHostGame(initialFood, initialViruses, initialBots);
            isGameStartingRef.current = false;
          }
        }
      } else {
        if (isGameStartingRef.current) {
          isGameStartingRef.current = false;
          channel.send({ type: 'broadcast', event: 'lobby_abort', payload: {} });
        }
      }
    } else {
      if (isGameStartingRef.current) {
        isGameStartingRef.current = false;
        channel.send({ type: 'broadcast', event: 'lobby_abort', payload: {} });
      }
    }
  };

  const startHostGame = (food, viruses, bots) => {
    switchGameState('playing');
    startNewGame(false); // don't spawn local bots
    // Set Refs
    foodRef.current = food;
    virusesRef.current = viruses;
    botsRef.current = bots;
  };

  const createFood = (isJackpot = false) => ({
    id: Math.random().toString(36).substr(2, 9),
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

    // Rule 6: Jackpot Score +20 to +40 random
    // Radius ~ Score. 
    const jpScore = 20 + Math.random() * 20;
    f.radius = jpScore; // Visual size = Score? Or area? Usually radius corresponds to score.
    // Let's set radius = jpScore for simplicity so it ADDS that much roughly.
    // Actually, createFood sets a default radius. We override.

    // Random angle and distance within safe zone
    const angle = Math.random() * Math.PI * 2;
    // Rule 5: Only within CURRENT poison circle
    // Ensure it spawns strictly inside
    const dist = Math.random() * (sz.radius * 0.9); // 90% of Safe Zone to be safe
    f.x = sz.x + Math.cos(angle) * dist;
    f.y = sz.y + Math.sin(angle) * dist;

    // Clamp to world just in case SafeZone is bigger than world (start of game)
    f.x = Math.max(50, Math.min(WORLD_WIDTH - 50, f.x));
    f.y = Math.max(50, Math.min(WORLD_HEIGHT - 50, f.y));

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

  const updateBots = (deltaTime, channel) => {
    // Only Host runs AI
    const amHost = isHost(); // Requires current closure access or passed arg? isHost uses refs, so it's fine.
    // Wait, in Single player we are always host-like.
    if (gameModeRef.current === 'multi' && !amHost) return;

    // AI Logic ...
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

      // --- Bot Eating Logic ---

      // 1. Eat Food
      for (let i = foodRef.current.length - 1; i >= 0; i--) {
        const f = foodRef.current[i];
        const dx = bot.x - f.x;
        const dy = bot.y - f.y;
        if (dx * dx + dy * dy < bot.radius * bot.radius) { // Eat if center inside
          // Rule: Score = Radius. 
          // Gain = Food Radius (or area? Food is small). 
          // Let's assume Food Radius adds explicitly to score? No, usually area.
          // But User wants "Score presents Volume/Size".
          // If Food R=5. Bot R=20. Bot Area=400. New Area=425. New R=20.6.
          // If additive radius: 20+5=25. Area=625. Huge growth.
          // Normal food should use AREA. Players/Bots use RADIUS logic requested?
          // "Unified scoring": "Score directly affects volume size".
          // Let's stick to Area for small food (otherwise 1 pellet = +1 score is huge).
          // But for Players/Bots, use the requested Percentage Logic.

          // UNLESS: "Unified scoring... don't use other ways for Bot".
          // Let's use Area addition for Food to be safe/standard.
          // Bot eats food:
          const gain = f.isJackpot ? (f.radius * f.radius) : (f.radius * f.radius);
          bot.radius = Math.sqrt(bot.radius * bot.radius + gain);

          // Remove Food
          foodRef.current.splice(i, 1);
          // Broadcast if Multi
          if (gameModeRef.current === 'multi') {
            channel?.send({ type: 'broadcast', event: 'food_eaten', payload: { id: f.id } });
            if (!f.isJackpot) {
              const newFood = createFood(false);
              foodRef.current.push(newFood);
              channel?.send({ type: 'broadcast', event: 'food_spawned', payload: newFood });
            }
          } else {
            if (!f.isJackpot) foodRef.current.push(createFood(false));
          }
        }
      }

      // 2. Eat Players (Host & Clients)
      // Helper: Check eat
      const checkEatPlayer = (pId, pCells, isLocal) => {
        if (!pCells) return;
        const eatenIds = [];
        pCells.forEach((pc, idx) => {
          const dx = bot.x - pc.x;
          const dy = bot.y - pc.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          // Rule 7: Bot needs +5 radius to eat Player
          if (bot.radius > pc.radius + 5 && dist < bot.radius - pc.radius * 0.4) {
            // Eat!
            // Rule 1: Gain 50% of Player Score (Radius)
            bot.radius += pc.radius * 0.5;

            eatenIds.push(pc.id);
          }
        });

        if (eatenIds.length > 0) {
          if (isLocal) {
            // Host was eaten
            // Remove cells locally
            myPlayerCellsRef.current = myPlayerCellsRef.current.filter(c => !eatenIds.includes(c.id));
            if (myPlayerCellsRef.current.length === 0) showNotification("You were eaten by a Bot!");
          } else {
            // Client was eaten
            // Broadcast death/eat event
            channel?.send({ type: 'broadcast', event: 'cells_eaten', payload: { targetId: pId, cellIds: eatenIds } });

            // Also update local ref to remove ghost immediately
            const p = otherPlayersRef.current.get(pId);
            if (p && p.cells) {
              p.cells = p.cells.filter(c => !eatenIds.includes(c.id));
              otherPlayersRef.current.set(pId, p);
            }
          }
        }
      };

      // Check Host
      checkEatPlayer(myId, myPlayerCellsRef.current, true);
      // Check Clients
      // Check Clients
      otherPlayersRef.current.forEach((p, pid) => checkEatPlayer(pid, p.cells, false));
    }); // Close Bot Loop (forEach)

    // Broadcast Updates (Frequency Throttling should be in loop, but we do naive here)
    if (gameModeRef.current === 'multi' && amHost && Math.random() < 0.2) { // ~12fps broadcast
      channel?.send({
        type: 'broadcast', event: 'bot_update',
        payload: botsRef.current.map(b => ({
          id: b.id, x: Math.round(b.x), y: Math.round(b.y), radius: Math.round(b.radius), color: b.color
        }))
      });
    }
  }; // Close updateBots function



  const updateSafeZone = (timeLeft) => {
    // Shrink from 1:00 (60s remaining) to 0:00.
    // Total Duration 180s. Starts shrinking at 60s left? 
    // User said: "Poison Circle Starts at 1:00" (which implies 60s timestamp or 1 min in?).
    // Usually "Starts at 1:00" means 1 minute into game? Or 1 minute remaining?
    // User said: "Warning... at 0:50 (130s remaining)".
    // Let's assume shrinking starts at T-120s (1 min in) or T-60s (2 min in)?
    // Re-reading: "Starts shrinking at 1:00 (120 seconds remaining)". 
    // NOTE: User said 1:00 (120s remaining). This means 60s elapsed.

    // Hardcoded logic used 120, but GAME_DURATION_SEC is 180.
    const startShrinkTime = GAME_DURATION_SEC - 60; // 180 - 60 = 120s remaining.

    if (timeLeft > startShrinkTime) return; // Haven't started shrinking yet

    const maxRadius = INITIAL_SAFE_ZONE_RADIUS; // 3500
    const minRadius = WORLD_WIDTH * 0.25 / 2; // ~560

    // Time progress from 120 -> 0
    const progress = (startShrinkTime - timeLeft) / startShrinkTime; // 0 to 1
    // Linear shrink

    const currentRadius = maxRadius - (maxRadius - minRadius) * progress;
    safeZoneRef.current = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2, radius: currentRadius };
  };

  const applyDecay = (deltaTime) => {
    const dt = deltaTime / 1000;
    const sz = safeZoneRef.current;

    const totalMass = myPlayerCellsRef.current.reduce((acc, c) => acc + c.radius, 0); // Approx score

    myPlayerCellsRef.current.forEach(cell => {
      // Natural Decay
      let decayAmount = 0;
      if (totalMass > 100) decayAmount = 0.8;
      else if (totalMass > 50) decayAmount = 0.2;

      // Poison Zone Penalty (5x)
      const dist = Math.sqrt(Math.pow(cell.x - sz.x, 2) + Math.pow(cell.y - sz.y, 2));
      let isPoisoned = false;

      if (dist > sz.radius) {
        isPoisoned = true;
        // New Rule: If score < 50, special forced decay until 10.
        // Normal Decay Logic (for > 50) calculated above.
        // If < 50, decayAmount from natural logic is 0. 

        if (totalMass < 50) {
          // Force 0.5 per sec if poisoned
          decayAmount = 0.5;
        } else {
          // Standard Multiplier Logic
          if (decayAmount === 0) decayAmount = 1.0;
          else decayAmount *= 5; // 5x penalty
        }

        // Visual cue?
        // if (Math.random() < 0.1) addEffect(cell.x, cell.y, "POISON!", "purple");
      }

      // Store poison state for visual shake
      cell.isPoisoned = isPoisoned;

      if (decayAmount > 0) {
        cell.radius -= decayAmount * dt;
        if (cell.radius < 10) cell.radius = 10; // Floor at 10 (or 5? User said 'until 10')
      }
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
            // Rule 6: Jackpot score is its radius (20-40)
            // Food gain = Area of food.
            const foodArea = f.radius * f.radius;
            // If Jackpot, valid gain is its area? 
            // User said: "+20~+40分區間". If Score = Radius, then gain should increase radius by X?
            // "RecalcScore" sums radius. So if we want +20 Score, we need radius += 20 ? 
            // Area addition: R_new = sqrt(R^2 + r^2). This yields much less than r linear addition.
            // If we want +20 LINEAR score: cell.radius += 20.
            // Let's assume +Score means +Radius for Jackpot.

            if (f.isJackpot) {
              cell.radius += f.radius; // Direct Score Add
            } else {
              // Normal food
              const gain = f.radius * f.radius;
              const newArea = cell.radius * cell.radius + gain;
              cell.radius = Math.sqrt(newArea);
            }

            if (f.isJackpot) {
              showNotification("🎰 JACKPOT! +MASS 🎰");
              addEffect(cell.x, cell.y, "+JACKPOT", "gold");
            }

            // Remove Locally
            foodRef.current.splice(i, 1);

            // Broadcast Eat
            if (gameModeRef.current === 'multi') {
              channel.send({ type: 'broadcast', event: 'food_eaten', payload: { id: f.id } });
            }

            // Respawn Logic
            if (!f.isJackpot) {
              // In Multi, only Host respawns
              if (gameModeRef.current === 'multi') {
                if (isHost()) {
                  const newFood = createFood(false);
                  foodRef.current.push(newFood);
                  channel.send({ type: 'broadcast', event: 'food_spawned', payload: newFood });
                }
              } else {
                // Single
                foodRef.current.push(createFood(false));
              }
            }
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

        // Rule 7: Need +5 radius, not 1.1x
        // cell.radius > bot.radius + 5
        if (cell.radius > bot.radius + 5 && dist < cell.radius - bot.radius * 0.4) {
          // Rule 2: Gain 25% of BOT Score (Radius) - Additive
          // User request: Score 30 -> eat gives ~7-8. 
          // Previous logic was Area based which is huge or tiny depending on R.
          // New Logic: myRadius += botRadius * 0.25.

          cell.radius += bot.radius * 0.25;

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
      let eatenCellIds = []; // Track IDs instead of indices
      p.cells.forEach((enemyCell) => {
        for (const cell of myCells) {
          const dx = cell.x - enemyCell.x;
          const dy = cell.y - enemyCell.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          // Relaxed Collision Rule for PvP:
          // Must be 10% bigger (1.1x)
          // Dist < radius (touching center? No, overlap).
          // Center of enemy inside My Radius?
          // dist < cell.radius - enemyCell.radius * 0.2

          // Rule 7: Need +5 radius, not 1.1x
          if (cell.radius > enemyCell.radius + 5 && dist < cell.radius - enemyCell.radius * 0.2) {
            // EAT
            const gain = (enemyCell.radius * enemyCell.radius) * 0.5;
            const newArea = cell.radius * cell.radius + gain;
            cell.radius = Math.sqrt(newArea);

            // Push ID if available, otherwise fallback might fail (but we generated IDs in createInitialCell)
            if (enemyCell.id) eatenCellIds.push(enemyCell.id);

            addEffect(cell.x, cell.y, "KILL!", "red");
            break;
          }
        }
      });

      if (eatenCellIds.length > 0) {
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
          payload: { targetId, cellIds: eatenCellIds, eaterId: myId }
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

    // DISABLE BOTS in Multi? NO, User wants collision. Enable local bots for everyone.
    // botsRef.current = [];
    initWorld();
    // Spawn Bots for local flavor in Multi too
    botsRef.current = [];
    for (let i = 0; i < 20; i++) spawnBot();

    // Track Presence -> REMOVED
    // Initial Heartbeat
    channelRef.current?.send({
      type: 'broadcast', event: 'lobby_heartbeat',
      payload: {
        id: myId,
        name: name,
        ready: false,
        timestamp: Date.now()
      }
    });
  };

  // Controls
  const toggleReady = () => {
    const newState = !isReadyRef.current;
    setIsReadyWrapper(newState);

    if (gameModeRef.current === 'multi') {
      channelRef.current?.send({
        type: 'broadcast',
        event: 'lobby_heartbeat',
        payload: {
          id: myId,
          name: nicknameRef.current || `Player ${myId.substr(0, 4)}`,
          ready: newState,
          timestamp: Date.now()
        }
      });
    }
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

    // Page Load one-time
    const initialLoad = setInterval(() => {
      setLoadingProgress(prev => {
        if (prev >= 100) {
          clearInterval(initialLoad);
          setIsLoading(false);
          return 100;
        }
        return prev + 20; // Faster initial load
      });
    }, 50);

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
    // JOIN CHANNEL - DEBUG MODE V2
    const channel = supabase.channel('global_room_v2', {
      config: {
        broadcast: { self: true, ack: false }, // Enable loopback for debugging!
        presence: {
          key: myId,
        },
      },
    });

    channel
      .on('broadcast', { event: 'player_update' }, (payload) => {
        // RELAXED SYNC: Commenting out strict mode check
        // if (gameModeRef.current === 'single') return;

        const { id, cells, score, name } = payload.payload;
        if (id !== myId) {
          // Debug First Packet from new ID
          if (!otherPlayersRef.current.has(id)) console.log("🎮 New In-Game Player Detected:", name, id);
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
      .on('broadcast', { event: 'lobby_heartbeat' }, (payload) => {
        const { id, name, ready, timestamp } = payload.payload;

        // DEBUG: Verify loopback works
        console.log(`💓 RAW RX from ${name} (${id.substr(0, 4)})`);

        if (id === myId) return; // Ignore self

        // RELAXED CHECKS: Always update list if we have a valid ID from network
        // if (gameModeRef.current !== 'multi') return;
        // if (gameStateRef.current !== 'lobby') return;     

        console.log("💓 ACCEPTED Heartbeat from:", name, id);

        lobbyPlayersRef.current.set(id, {
          id,
          name: name || 'Unknown',
          ready,
          lastSeen: Date.now()
        });

        // Update UI State
        setLobbyPlayers(Array.from(lobbyPlayersRef.current.values()));
        setDebugInfo(prev => ({ ...prev, players: lobbyPlayersRef.current.size + 1 }));
      })
      .on('broadcast', { event: '*' }, (payload) => {
        // CATCH-ALL debug
        // console.log("🌍 Broadcast Event:", payload.event);
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
          const { cellIds } = payload.payload;

          if (cellIds && cellIds.length > 0) {
            // Robust removal by ID
            myPlayerCellsRef.current = myPlayerCellsRef.current.filter(c => !cellIds.includes(c.id));

            if (myPlayerCellsRef.current.length === 0) {
              showNotification("OM NOM NOM! YOU WERE EATEN!");
            } else {
              showNotification("OUCH! PART OF YOU WAS EATEN!");
            }
          }
        }
      })
      .on('broadcast', { event: 'match_start' }, (payload) => {
        if (gameModeRef.current === 'single') return;

        // Client receives World Data
        const { food, viruses, bots } = payload.payload;
        foodRef.current = food || [];
        virusesRef.current = viruses || [];
        botsRef.current = bots || [];

        switchGameState('playing');
        startNewGame(false); // Do not spawn bots locally
      })
      .on('broadcast', { event: 'lobby_countdown' }, (payload) => {
        if (gameModeRef.current === 'single') return;
        if (isGameStartingRef.current) return; // Already started

        isGameStartingRef.current = true;
        lobbyTimerRef.current = payload.payload.seconds;
      })
      .on('broadcast', { event: 'lobby_abort' }, (payload) => {
        isGameStartingRef.current = false;
      })
      .on('broadcast', { event: 'bot_update' }, (payload) => {
        // Clients just update bot info
        if (gameModeRef.current === 'single') return;

        // payload: { id, x, y, radius, color... }
        // We might receive full list or partial updates. 
        // For simple sync: Host sends array of essential bot data?
        // Or individual? Individual is spammy. Array is better.

        const botDataList = payload.payload;
        if (Array.isArray(botDataList)) {
          // Update local refs
          // Naive replace or merge? Replace is easiest for position sync
          botsRef.current = botDataList;
        }
      })
      .on('broadcast', { event: 'food_spawned' }, (payload) => {
        if (gameModeRef.current === 'single') return;
        foodRef.current.push(payload.payload);
      })
      .on('broadcast', { event: 'food_eaten' }, (payload) => {
        if (gameModeRef.current === 'single') return;
        const { id } = payload.payload;
        // Safe removal:
        foodRef.current = foodRef.current.filter(f => f.id !== id);
      })
      .on('broadcast', { event: 'match_time_update' }, (payload) => {
        if (gameModeRef.current === 'single') return;
        const { time } = payload.payload;
        // Sync Time
        timeLeftRef.current = time;
        setTimeLeft(time);
      })
    channel
      .on('broadcast', { event: 'player_update' }, (payload) => {
        // ... (handlers)
      })
      // ... (other handlers)
      .subscribe((status, err) => {
        console.log("Supabase Channel Status:", status, err);
        setConnectionStatus(status);
        if (status === 'CHANNEL_ERROR') {
          showNotification("Connection Error: " + (err?.message || 'Unknown'));
        }
      });

    channelRef.current = channel;
    window.gameChannel = channel; // EXPOSE FOR DEBUGGING

    // Game Loop
    let lastTime = performance.now();
    let frameCount = 0;
    let lastFpsTime = lastTime;
    let lastGameBroadcastTime = 0;
    let lastLobbyBroadcastTime = 0;
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
          updateBots(deltaTime, channel); // Pass channel for Host Broadcasting

          checkCollisions(myId, channel);
          recalcScore();
          updateCamera();

          setEffects(prev => prev.filter(e => e.life > 0).map(e => ({ ...e, life: e.life - 0.02 })));

          // New Logic
          updateSafeZone(timeLeftRef.current);
          applyDecay(deltaTime);

          jackpotTimer += deltaTime;
          if (jackpotTimer > 15000) {
            if (Math.random() < 0.8) {
              spawnJackpot();
              showNotification("🎰 JACKPOT ORB SPAWNED! 🎰");
            }
            jackpotTimer = 0;
          }
        } else if (currentGS === 'lobby') {
          // Lobby Updates - Presence handles list now.
          // Host still manages "Start Game" via broadcast checkLobbyStart.
          /* 
          // REMOVED manual broadcast loop in favor of Presence
          if (time - lastLobbyBroadcastTime > 1000) { ... } 
          */
          checkLobbyStart(channel, deltaTime);

          // Force UI update for lobby count
          setDebugInfo(prev => ({ ...prev, tick: (prev.tick || 0) + 1, players: otherPlayersRef.current.size + 1 }));

          // HEARTBEAT LOGIC
          if (time - lastHeartbeatRef.current > 1000) {
            console.log("💓 Sending Heartbeat...", { id: myId, ready: isReadyRef.current });
            channelRef.current?.send({
              type: 'broadcast',
              event: 'lobby_heartbeat',
              payload: {
                id: myId,
                name: nicknameRef.current || `Player ${myId.substr(0, 4)}`,
                ready: isReadyRef.current,
                timestamp: Date.now()
              }
            })
              .then(resp => {
                if (resp === 'ok') console.log("💓 Heartbeat SENT OK");
                else console.warn("💓 Heartbeat Send Status:", resp);
              })
              .catch(err => console.error("💓 Heartbeat Send Error:", err));

            lastHeartbeatRef.current = time;

            // Clean up timeouts
            const now = Date.now();
            let changed = false;
            for (const [id, player] of lobbyPlayersRef.current.entries()) {
              if (now - player.lastSeen > 3500) { // 3.5s timeout
                console.log("💀 Player Timed out:", id);
                lobbyPlayersRef.current.delete(id);
                changed = true;
              }
            }
            if (changed) {
              setLobbyPlayers(Array.from(lobbyPlayersRef.current.values()));
            }
          }
        }


        // FORCE BROADCAST in Multi (Relaxed State Check)
        // We broadcast if we are playing OR if we are in Lobby but have cells (Post-Game/Pre-Game transition)
        // Actually, just broadcast if we have cells and are in Multi mode.
        if (mode === 'multi' && myPlayerCellsRef.current.length > 0 && time - lastGameBroadcastTime > 50) {
          // Debug outgoing
          // if (frameCount % 60 === 0) console.log("📤 Sending Game Update", { cells: myPlayerCellsRef.current.length });

          channel.send({
            type: 'broadcast', event: 'player_update',
            payload: {
              id: myId,
              score: scoreRef.current,
              name: nicknameRef.current || `Player ${myId.substr(0, 4)}`,
              cells: myPlayerCellsRef.current.map(c => ({
                id: c.id, x: Math.round(c.x), y: Math.round(c.y),
                radius: c.radius, color: c.color, name: c.name,
                isPoisoned: c.isPoisoned // Sync poison state
              }))
            },
          });
          lastGameBroadcastTime = time;
        }

        // Cleanup
        const now = Date.now();
        // Only cleanup timed-out players in PLAYING mode (where we expect constant broadcasts).
        // In LOBBY, we rely on Supabase Presence (which doesn't heartbeat constantly), so we should NOT timeout players.


        if (currentGS === 'playing' || currentGS === 'gameover' || currentGS === 'lobby') {
          draw(ctx, canvas, currentGS);
        }

        // Timer & Stats
        frameCount++;
        if (time - lastFpsTime >= 1000) {
          setDebugInfo({ fps: frameCount, players: otherPlayersRef.current.size + 1 });
          updateLeaderboard();

          if (currentGS === 'playing') {
            // Host decreases time and broadcasts it
            // Clients just listen (listener handles timeLeftRef update), 
            // BUT for smoothness, clients can theoretically decrease locally too.
            // Problem: Double decrement if we do both?
            // Solution: Host is authority. Clients rely on sync OR local decrement if sync logic handles drift.
            // Simplest: Host decrements and sends. Clients ONLY set from sync?
            // "3 minutes didn't count down" -> implies sync missing.

            // Logic Change for Multi:
            if (gameModeRef.current === 'single') {
              timeLeftRef.current -= 1;
              setTimeLeft(timeLeftRef.current);
            } else {
              // Multi:
              if (isHost()) {
                timeLeftRef.current -= 1;
                setTimeLeft(timeLeftRef.current);
                // Broadcast
                channel.send({ type: 'broadcast', event: 'match_time_update', payload: { time: timeLeftRef.current } });
              } else {
                // Client: Interpolate locally to prevent stutter
                // We rely on 'match_time_update' to correct drift, but we MUST decrement locally
                // otherwise if a packet is dropped, we freeze.

                // Only decrement if we haven't received an update recently?
                // Actually, standard prediction: always decrement, server overwrites.
                timeLeftRef.current -= 1;
                setTimeLeft(timeLeftRef.current);
              }
            }

            if (timeLeftRef.current <= 0) {
              if (gameModeRef.current === 'single') {
                // Single Player Game Over
                switchGameState('gameover');
              } else {
                // Multi: HOST triggers Game Over for everyone?
                // Or everyone sees 0 and ends self.
                switchGameState('gameover');
              }
            }
          }

          // Update Respawn Timer if dead
          if (gameStateRef.current === 'playing') {
            if (myPlayerCellsRef.current.length === 0) {
              if (!hasDiedRef.current) {
                hasDiedRef.current = true;
                respawnTimerRef.current = 10; // 10s Cooldown
                // Save score for penalty
                // If Score = Radius Sum.
                // We revive with 1 cell ?
                // Logic: Revive with 70% of previous total radius?
                savedScoreRef.current = scoreRef.current;
              }
            }
          }

          if (respawnTimerRef.current > 0) {
            respawnTimerRef.current -= 1;
            if (respawnTimerRef.current <= 0) {
              // Trigger Respawn
              hasDiedRef.current = false;
              const penaltyRadius = Math.max(INITIAL_RADIUS, savedScoreRef.current * 0.7);

              let spawnX, spawnY;
              // If Poison Circle logic active (Time < 1 min? Or 130s? User check: "毒圈階段")
              // Poison starts at 1:00 remaining? Code says `updateSafeZone`.
              // Let's check `timeLeftRef`. Using 60s as shrinking phase start?
              // Or if SafeZone < World?
              // Let's safely assume if timeLeft < GAME_DURATION - 60 (i.e. late game) 
              // or just check SafeZone radius < 4000.
              const sz = safeZoneRef.current;
              if (sz.radius < 4000) {
                // Spawn inside Safe Zone
                const angle = Math.random() * Math.PI * 2;
                const dist = Math.random() * (sz.radius * 0.8);
                spawnX = sz.x + Math.cos(angle) * dist;
                spawnY = sz.y + Math.sin(angle) * dist;
              } else {
                // Random
                spawnX = Math.random() * WORLD_WIDTH;
                spawnY = Math.random() * WORLD_HEIGHT;
              }

              // Create Cell
              myPlayerCellsRef.current.push({
                id: myId, // Single cell ID or unique sub-ID? `myId` is player ID. Cells need unique IDs?
                // createInitialCell logic handles it usually.
                // Let's inline logic or use helper if available. 
                // Helper `createInitialCell` doesn't exist? It was used in virus split.
                // Ah, I need to check if I have `createInitialCell`.
                // I'll inline standard init.
                id: myId + '_respawn',
                x: spawnX, y: spawnY,
                radius: penaltyRadius,
                color: `hsl(${Math.random() * 360}, 100%, 50%)`,
                name: nicknameRef.current || 'Player',
                canMerge: true, mergeTimer: 0,
                boostX: 0, boostY: 0
              });
              // Notification
              showNotification("RESPAWNED!");
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
          <h2 style={{ color: 'white', marginBottom: '20px' }}>Waiting for players... ({lobbyPlayers.length + 1} connected)</h2>
          <button
            onClick={toggleReady}
            style={{ ...btnStyle, background: isReady ? '#888' : '#0f0' }}
          >
            {isReady ? 'CANCEL READY' : 'READY UP!'}
          </button>
          <div style={{ color: '#aaa', marginTop: '10px' }}>Needs at least 2 players to start</div>

          <div style={{ marginTop: '20px', color: '#aaa' }}>
            Players ({lobbyPlayers.length + 1}):
            <div style={{ color: isReady ? '#0f0' : '#ff0' }}> You ({isReady ? 'READY' : 'WAITING'}) </div>
            {lobbyPlayers.map(p => (
              <div key={p.id} style={{ color: p.ready ? '#0f0' : '#ff0' }}>
                {p.name} ({p.ready ? 'READY' : 'WAITING'})
              </div>
            ))}
          </div>

          <div style={{ marginTop: '20px', padding: '10px', borderRadius: '5px', background: 'rgba(0,0,0,0.5)' }}>
            <span style={{ color: '#aaa', fontSize: '12px' }}>Network Status: </span>
            <span style={{
              color: connectionStatus === 'SUBSCRIBED' ? '#0f0' : 'red',
              fontWeight: 'bold'
            }}>
              {connectionStatus}
            </span>
          </div>
        </div>
      )}

      {gameState === 'menu' && (
        <div style={overlayStyle}>
          <h1 style={{ fontSize: '4rem', color: '#00ff00', textShadow: '0 0 20px #00ff00' }}>GLOW BATTLE v1.5.9</h1>
          <div style={{ color: '#aaa', marginBottom: '20px' }}>Current Version: COUNTDOWN RELIABILITY FIX</div>
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

      {
        isLoading && (
          <div style={{
            position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
            background: '#050510', zIndex: 9999, display: 'flex', flexDirection: 'column',
            justifyContent: 'center', alignItems: 'center', color: 'white'
          }}>
            <h1 style={{ fontSize: '3rem', marginBottom: '20px', color: '#00ff00' }}>LOADING...</h1>
            <div style={{ width: '300px', height: '10px', background: '#333', borderRadius: '5px' }}>
              <div style={{ width: `${loadingProgress}%`, height: '100%', background: '#00ff00', borderRadius: '5px', transition: 'width 0.1s' }} />
            </div>
            <p style={{ marginTop: '10px', color: '#aaa' }}>Initializing World Entities...</p>
          </div>
        )
      }

    </div >
  );
}

const overlayStyle = { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(10,10,20, 0.9)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'white', zIndex: 10 };
const btnStyle = { padding: '15px 30px', fontSize: '1.5rem', background: 'linear-gradient(45deg, #00ff00, #00cc00)', color: 'white', border: 'none', borderRadius: '50px', cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 0 20px rgba(0,255,0,0.5)', minWidth: '200px' };

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
  const gameModeRef = useRef('single');
  const isGameStartingRef = useRef(false);
  const lobbyTimerRef = useRef(0);

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
    canMerge: true, mergeTimer: 0
  });

  const spawnPlayer = () => {
    const startName = (nicknameRef.current || '').trim() || `Player ${myId.substr(0, 4)}`;
    myPlayerCellsRef.current = [createInitialCell(startName)];
    setScore(0);
    scoreRef.current = 0;
    setTimeLeft(GAME_DURATION_SEC);
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
        const { id, cells, score, name } = payload.payload;
        if (id !== myId) {
          otherPlayersRef.current.set(id, { id, cells, score, name: name || 'Unknown', lastUpdate: Date.now() });
        }
      })
      .on('broadcast', { event: 'lobby_update' }, (payload) => {
        const { id, name, ready, status } = payload.payload;
        if (status === 'start_game') {
          otherPlayersRef.current.forEach(p => p.cells = []);
          switchGameState('playing');
          setTimeLeft(GAME_DURATION_SEC);
          timeLeftRef.current = GAME_DURATION_SEC;

          spawnPlayer();
        } else {
          otherPlayersRef.current.set(id, {
            id, name: name || 'Unknown', ready, lastUpdate: Date.now(),
            cells: []
          });
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
      try {
        const deltaTime = time - lastTime;
        lastTime = time;

        const currentGS = gameStateRef.current;

        if (currentGS === 'playing') {
          updateMyCells(deltaTime);
          updateEjectedMass(deltaTime);
          updateBots(deltaTime);
          checkCollisions(myId, channel);
          recalcScore();
          updateCamera();

          setEffects(prev => prev.filter(e => e.life > 0).map(e => ({ ...e, life: e.life - 0.02 })));

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

        if (currentGS === 'playing' && time - lastBroadcastTime > 50) {
          channel.send({
            type: 'broadcast', event: 'player_update',
            payload: {
              id: myId,
              score: scoreRef.current, // Use Score Ref!
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
              switchGameState('gameover');
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
    for (let y = 0; y <= WORLD_HEIGHT; y += 100) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD_WIDTH, y); ctx.stroke(); }

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
              spawnPlayer();
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
    switchGameState('playing');
    initWorld();
    for (let i = 0; i < 15; i++) spawnBot();
    spawnPlayer();
  };

  const handleMultiPlayer = () => {
    setGameMode('multi');
    switchGameState('lobby');
    // lobbyPlayers cleared via effect logic usually, but here we just ensure refs clean if needed
    setIsReadyWrapper(false);
    initWorld();
  };

  // Controls
  const toggleReady = () => {
    // Determine new state from REF to be safe
    const newState = !isReadyRef.current;
    setIsReadyWrapper(newState);
  };

  const splitCells = (dirX, dirY) => {

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

        {gameState === 'gameover' && (
          <div style={overlayStyle}>
            <h1 style={{ color: 'red', fontSize: '3rem' }}>GAME OVER</h1>
            <h2>Final Score: {Math.round(score)}</h2>
            <button onClick={() => switchGameState('menu')} style={btnStyle}>MAIN MENU</button>
          </div>
        )}
      </div>
    );
  }

  const overlayStyle = { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(10,10,20, 0.9)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'white', zIndex: 10 };
  const btnStyle = { padding: '15px 30px', fontSize: '1.5rem', background: 'linear-gradient(45deg, #00ff00, #00cc00)', color: 'white', border: 'none', borderRadius: '50px', cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 0 20px rgba(0,255,0,0.5)', minWidth: '200px' };

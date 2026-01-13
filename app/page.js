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
  const [gameState, setGameState] = useState('menu');
  const [myId, setMyId] = useState(null);
  const [nickname, setNickname] = useState('');
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION_SEC);
  const [notification, setNotification] = useState(null); // For "Jackpot Spawned!" text

  // World State
  const myPlayerCellsRef = useRef([]);
  const cameraRef = useRef({ x: 0, y: 0, zoom: 1 });

  // Entities
  const otherPlayersRef = useRef(new Map());
  const botsRef = useRef([]);
  const foodRef = useRef([]); // Normal + Jackpot food
  const virusesRef = useRef([]);
  const ejectedMassRef = useRef([]); // Blobs ejected by 'W'

  // Supabase
  const channelRef = useRef(null);

  // Initial Helper
  const createInitialCell = (name) => ({
    id: 'c_' + Math.random().toString(36).substr(2, 9),
    x: Math.random() * WORLD_WIDTH,
    y: Math.random() * WORLD_HEIGHT,
    radius: INITIAL_RADIUS,
    color: `hsl(${Math.random() * 360}, 70%, 50%)`,
    targetX: 0, targetY: 0,
    name: name,
    canMerge: true, mergeTimer: 0 // Initially can merge if split logic handled correctly, or false if just born
  });

  // Effect Visuals
  const [effects, setEffects] = useState([]); // {x, y, text/color, life}
  const addEffect = (x, y, text, color) => {
    setEffects(prev => [...prev, { id: Math.random(), x, y, text, color, life: 1.0 }]);
  };

  useEffect(() => {
    const id = Math.random().toString(36).substr(2, 9);
    setMyId(id);
    initWorld();

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
      // Space: Split
      if (e.code === 'Space') {
        splitCells(mouseX, mouseY);
      }
      // W: Eject Mass
      if (e.code === 'KeyW') {
        ejectMass(mouseX, mouseY);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('keydown', handleKeyDown);

    // Network Setup
    const channel = supabase.channel('room_1', {
      config: { broadcast: { self: false, ack: false } },
    });

    channel
      .on('broadcast', { event: 'player_update' }, (payload) => {
        const { id, cells } = payload.payload;
        if (id !== myId) {
          otherPlayersRef.current.set(id, { cells, lastUpdate: Date.now() });
        }
      })
      .on('broadcast', { event: 'player_death' }, (payload) => {
        otherPlayersRef.current.delete(payload.payload.id);
      })
      .on('broadcast', { event: 'game_event' }, (payload) => {
        // Handle global events like "Jackpot Spawned"
        if (payload.payload.type === 'jackpot') {
          showNotification("🎰 JACKPOT ORB SPAWNED! 🎰");
          // Spawn locally for visual consistency (though ideally server auth)
          // We'll trust the randomness here for prototype
          spawnJackpot();
        }
      })
      .subscribe();

    channelRef.current = channel;

    // Loop
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

        // Random Jackpot Spawner (Client-side simulation for prototype)
        // In real app, only one client/server should decide this.
        jackpotTimer += deltaTime;
        if (jackpotTimer > 15000) { // Check every 15s instead of 30s
          if (Math.random() < 0.8) { // 80% chance
            spawnJackpot();
            showNotification("🎰 JACKPOT ORB SPAWNED! 🎰");
          }
          jackpotTimer = 0;
        }
      }

      // Network
      if (gameState === 'playing' && time - lastBroadcastTime > 50) {
        channel.send({
          type: 'broadcast',
          event: 'player_update',
          payload: {
            id: id,
            cells: myPlayerCellsRef.current.map(c => ({
              id: c.id,
              x: Math.round(c.x),
              y: Math.round(c.y),
              radius: c.radius,
              color: c.color,
              name: c.name
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

      draw(ctx, canvas);

      // UI/Timer
      frameCount++;
      if (time - lastFpsTime >= 1000) {
        setDebugInfo({ fps: frameCount, players: otherPlayersRef.current.size + 1 });
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
  }, [gameState]);


  // --- Logic ---

  const initWorld = () => {
    const newFood = [];
    for (let i = 0; i < FOOD_COUNT; i++) newFood.push(createFood());
    foodRef.current = newFood;

    const newViruses = [];
    for (let i = 0; i < VIRUS_COUNT; i++) newViruses.push(createVirus());
    virusesRef.current = newViruses;

    // Reset Bots
    botsRef.current = [];
    for (let i = 0; i < 10; i++) spawnBot();
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
    massBuf: 0 // Accumulated mass from W feeding
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

  const startGame = () => {
    const startName = nickname.trim() || `Player ${myId.substr(0, 4)}`;
    myPlayerCellsRef.current = [createInitialCell(startName)];
    setScore(0);
    setTimeLeft(GAME_DURATION_SEC);
    setGameState('playing');
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
        // Loss mass
        const massLoss = 20; // Radius units relativeish
        // Exact area calc: r_new = sqrt(r_old^2 - loss^2) roughly
        // Simple: just reduce radius linear for prototype feels better
        cell.radius -= 2;

        const eject = {
          id: 'ej_' + Math.random(),
          x: cell.x + Math.cos(angle) * cell.radius,
          y: cell.y + Math.sin(angle) * cell.radius,
          vx: Math.cos(angle) * 15,
          vy: Math.sin(angle) * 15,
          radius: 8,
          color: cell.color,
          ownerId: myId,
          createdAt: now
        };
        ejectedMassRef.current.push(eject);
      }
    });
  };

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

      // 4. Collision with own cells (Merging)
      myPlayerCellsRef.current.forEach((other, otherIdx) => {
        if (cell.id === other.id) return; // Self check by ID
        const d = Math.hypot(cell.x - other.x, cell.y - other.y);
        const rSum = cell.radius + other.radius;

        if (d < rSum) {
          // Check Merge
          if (now > cell.mergeTimer && now > other.mergeTimer) {
            // MERGE!
            const angle = Math.atan2(cell.y - other.y, cell.x - other.x);
            const push = (rSum - d) / 2;
            cell.x += Math.cos(angle) * push * 0.1;
            cell.y += Math.sin(angle) * push * 0.1;

            // Real Merge Prototype:
            // If they overlap significantly (center to center < r_large)
            if (d < Math.max(cell.radius, other.radius) * 0.5) {
              // We can flag 'other' as mergedTo 'cell'.
              if (cell.radius >= other.radius && !other.merged) {
                const newArea = Math.PI * cell.radius * cell.radius + Math.PI * other.radius * other.radius;
                cell.radius = Math.sqrt(newArea / Math.PI);
                other.merged = true; // Flag for deletion
                addEffect(cell.x, cell.y, "MERGE!", "gold");
              }
            }
          } else {
            // Push apart (They cannot merge yet)
            const angle = Math.atan2(cell.y - other.y, cell.x - other.x);
            const push = (rSum - d) / 2;
            cell.x += Math.cos(angle) * push * 0.5; // Stronger push
            cell.y += Math.sin(angle) * push * 0.5;
          }
        }
      });
    });

    // Remove merged cells
    myPlayerCellsRef.current = myPlayerCellsRef.current.filter(c => !c.merged);
  };
}
      });
    });
  };

const updateEjectedMass = (deltaTime) => {
  for (let i = ejectedMassRef.current.length - 1; i >= 0; i--) {
    const e = ejectedMassRef.current[i];
    e.x += e.vx * (deltaTime / 16);
    e.y += e.vy * (deltaTime / 16);

    // Friction
    e.vx *= 0.95;
    e.vy *= 0.95;

    // Stop logic
    if (Math.abs(e.vx) < 0.1 && Math.abs(e.vy) < 0.1) {
      e.vx = 0; e.vy = 0;
    }

    // World Bounds
    if (e.x < 0 || e.x > WORLD_WIDTH || e.y < 0 || e.y > WORLD_HEIGHT) {
      ejectedMassRef.current.splice(i, 1);
      continue;
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
    // Wall bounce/clamp
    if (bot.x < 0) bot.x += 5;
    // ... simplified
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

        // Rewards
        const multiplier = (timeLeft < 30) ? 2 : 1; // Sudden Death: 2x Food
        if (isJackpot) {
          cell.radius += 20 * multiplier;
          showNotification("💰 YOU GOT THE JACKPOT! 💰");
          addEffect(cell.x, cell.y, "+JACKPOT", "gold");
        } else {
          cell.radius += 0.5 * multiplier;
        }

        // Respawn normal food
        if (!isJackpot) foodRef.current.push(createFood());
      }
    }

    // 2. Ejected Mass (Eating it)
    for (let i = ejectedMassRef.current.length - 1; i >= 0; i--) {
      const e = ejectedMassRef.current[i];
      // Can't eat own ejected mass immediately (cooldown?) - for simple prototype, just eat it
      // Basic logic: if touching, eat
      if (Math.hypot(cell.x - e.x, cell.y - e.y) < cell.radius) {
        // e.createdAt check to avoid instant self-eating if we want
        ejectedMassRef.current.splice(i, 1);
        cell.radius += 1.5; // Gain back some mass (inefficient conversion)
      }
    }

    // 3. Bots
    for (let i = botsRef.current.length - 1; i >= 0; i--) {
      const b = botsRef.current[i];
      if (Math.hypot(cell.x - b.x, cell.y - b.y) < cell.radius && cell.radius > b.radius * 1.2) {
        botsRef.current.splice(i, 1);
        cell.radius += b.radius * 0.5;
        spawnBot();
      }
    }

    // 4. Viruses (Explode vs Feed)
    // Check collision first
    for (let i = virusesRef.current.length - 1; i >= 0; i--) {
      const v = virusesRef.current[i];
      const dist = Math.hypot(cell.x - v.x, cell.y - v.y);

      // Player touches virus
      if (dist < cell.radius) {
        if (cell.radius > v.radius * 1.1) {
          // EXPLODE
          cell.radius = Math.max(INITIAL_RADIUS, cell.radius * 0.6); // Lose 40%
          // Spawn little bits around? (Visual only for now)
          virusesRef.current.splice(i, 1);
          virusesRef.current.push(createVirus());
        }
      }

      // Check if Ejected Mass hits Virus (Shooting Mechanic)
      for (let j = ejectedMassRef.current.length - 1; j >= 0; j--) {
        const e = ejectedMassRef.current[j];
        const d2 = Math.hypot(e.x - v.x, e.y - v.y);
        if (d2 < v.radius) {
          // Feed Virus
          ejectedMassRef.current.splice(j, 1);
          v.massBuf += 1;
          v.radius += 2; // Visually grow

          // Trigger Shoot?
          if (v.massBuf > 5) {
            // Shoot a new virus in direction of impact (approx by velocity of eject)
            // Or just same direction e was moving
            const angle = Math.atan2(e.vy, e.vx);
            const newV = createVirus();
            newV.x = v.x + Math.cos(angle) * (v.radius + 50);
            newV.y = v.y + Math.sin(angle) * (v.radius + 50);
            // Push existing back? No, just spawn new one moving forward
            // To make it a projectile, we need a 'moving virus' entity.
            // For prototype: Just spawn a static one further ahead (Instant blockade)
            // Or better: Spawn a new virus at v location, and push the old v forward?
            // Let's spawn a new virus at distance
            virusesRef.current.push(newV);

            // Reset original
            v.massBuf = 0;
            v.radius = VIRUS_RADIUS;
          }
        }
      }
    }

    // 5. PvP (Eat)
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
          }
        }
      });
    });
  });
};

const recalcScore = () => {
  let totalR = 0;
  myPlayerCellsRef.current.forEach(c => totalR += c.radius);
  setScore(Math.floor(totalR));
};

const handleTimeUp = () => setGameState('gameover');
const handleDeath = () => setGameState('gameover');

// --- Rendering ---
const draw = (ctx, canvas) => {
  ctx.fillStyle = '#050510'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const cam = cameraRef.current;

  ctx.save();
  ctx.translate((canvas.width / 2) - cam.x, (canvas.height / 2) - cam.y);

  // Bounds
  ctx.strokeStyle = '#333'; ctx.lineWidth = 10; ctx.strokeRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  // Grid
  ctx.strokeStyle = '#222'; ctx.lineWidth = 2;
  for (let x = 0; x <= WORLD_WIDTH; x += 100) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD_HEIGHT); ctx.stroke(); }
  for (let y = 0; y <= WORLD_HEIGHT; y += 100) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD_WIDTH, y); ctx.stroke(); }

  // Food
  foodRef.current.forEach(f => {
    ctx.fillStyle = f.color;
    ctx.beginPath(); ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2); ctx.fill();
    if (f.isJackpot) {
      ctx.shadowColor = 'gold'; ctx.shadowBlur = 20; ctx.stroke(); ctx.shadowBlur = 0;
    }
  });

  // Ejected Mass
  ejectedMassRef.current.forEach(e => {
    ctx.fillStyle = e.color;
    ctx.beginPath(); ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2); ctx.fill();
  });

  // Viruses
  ctx.fillStyle = '#33ff33';
  ctx.strokeStyle = '#22cc22';
  virusesRef.current.forEach(v => {
    ctx.lineWidth = 4;
    ctx.beginPath();
    const spikes = 20;
    for (let i = 0; i < spikes * 2; i++) {
      const rot = (Math.PI / spikes) * i;
      const r = (i % 2 === 0) ? v.radius : v.radius * 0.9;
      ctx.lineTo(v.x + Math.cos(rot) * r, v.y + Math.sin(rot) * r);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
  });

  // Bots & Players
  [...botsRef.current, ...Array.from(otherPlayersRef.current.values()).flatMap(p => p.cells || []), ...myPlayerCellsRef.current].forEach(ent => {
    if (!ent) return;
    ctx.beginPath(); ctx.arc(ent.x, ent.y, ent.radius, 0, Math.PI * 2);
    ctx.fillStyle = ent.color; ctx.fill();
    ctx.strokeStyle = ent === myPlayerCellsRef.current[0] || myPlayerCellsRef.current.includes(ent) ? '#ffff00' : '#fff';
    ctx.lineWidth = 3; ctx.stroke();
    // Text
    if (ent.radius > 15) {
      ctx.fillStyle = 'white'; ctx.strokeStyle = 'black'; ctx.lineWidth = 0.5;
      ctx.font = `bold ${Math.max(10, ent.radius / 2)}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(ent.name || '?', ent.x, ent.y);
    }
  });

  // Effects
  effects.forEach(ef => {
    ctx.fillStyle = ef.color || 'white';
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(ef.text, ef.x, ef.y - (1.0 - ef.life) * 50); // Float up
    ef.life -= 0.02;
  });
  // Cleanup effects - wait, we can't clean state in render.
  // Ideally use a Ref for effects or a cleanup effect. 
  // To keep it simple in this architecture, we'll let them linger or hack clean:
  // (This is bad practice for React render but works for prototype canvas loop if state is managed outside)
  // Actually, we should update effects in 'animate' loop. Let's do that next tool call.

  ctx.restore();
};

const formatTime = (s) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

return (
  <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', userSelect: 'none', fontFamily: 'sans-serif' }}>
    <canvas ref={canvasRef} style={{ display: 'block' }} />

    {/* Notifications */}
    {notification && (
      <div style={{
        position: 'absolute', top: '15%', left: '50%', transform: 'translateX(-50%)',
        color: '#ffd700', fontSize: '3rem', fontWeight: 'bold', textShadow: '0 0 20px black',
        animation: 'popIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
      }}>
        {notification}
      </div>
    )}

    {/* HUD & Overlays */}
    {gameState === 'playing' && (
      <>
        <div style={{ position: 'absolute', top: 20, left: 20, pointerEvents: 'none' }}>
          <div style={{ color: 'white', fontSize: '1.5rem', fontWeight: 'bold', textShadow: '2px 2px black' }}>Score: {Math.round(score)}</div>
          <div style={{ color: '#aaa' }}>Online: {debugInfo.players}</div>
        </div>
        <div style={{
          position: 'absolute', top: 20, left: '50%', transform: 'translateX(-50%)',
          color: timeLeft < 30 ? 'red' : 'white', fontSize: '3rem', fontWeight: 'bold', textShadow: '0 0 10px black'
        }}>
          {formatTime(timeLeft)}
        </div>
        {/* Controls Hint */}
        <div style={{
          position: 'absolute', bottom: 20, left: 20, color: 'rgba(255,255,255,0.5)', fontSize: '1rem'
        }}>
          [Space] Split &nbsp; [W] Shoot Mass
        </div>
      </>
    )}

    {gameState === 'menu' && (
      <div style={overlayStyle}>
        <h1 style={{ fontSize: '4rem', color: '#00ff00', textShadow: '0 0 20px #00ff00' }}>GLOW BATTLE.IO</h1>
        <input type="text" placeholder="Enter Nickname" value={nickname} onChange={e => setNickname(e.target.value)}
          style={{ padding: '15px', fontSize: '1.5rem', borderRadius: '5px', border: 'none', textAlign: 'center', marginBottom: '20px' }} maxLength={10} />
        <button onClick={startGame} style={btnStyle}>PLAY NOW</button>
        <div style={{ marginTop: '20px', color: '#888' }}>New: Press 'W' to shoot viruses! Watch out for JACKPOTS!</div>
      </div>
    )}

    {gameState === 'gameover' && (
      <div style={overlayStyle}>
        <h1 style={{ color: 'red', fontSize: '3rem' }}>GAME OVER</h1>
        <h2>Final Score: {Math.round(score)}</h2>
        <button onClick={startGame} style={btnStyle}>PLAY AGAIN</button>
      </div>
    )}
  </div>
);
}

const overlayStyle = { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(10,10,20, 0.9)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'white', zIndex: 10 };
const btnStyle = { padding: '15px 50px', fontSize: '2rem', background: 'linear-gradient(45deg, #00ff00, #00cc00)', color: 'white', border: 'none', borderRadius: '50px', cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 0 20px rgba(0,255,0,0.5)' };

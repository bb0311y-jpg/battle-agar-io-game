'use client';

import { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';

// Constants
const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001';
// Note: In production, this would be an env var or the same host

export default function GamePage() {
  const canvasRef = useRef(null);
  const socketRef = useRef(null);

  // UI State
  const [gameState, setGameState] = useState('menu'); // 'menu', 'playing'
  const [nickname, setNickname] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('DISCONNECTED');
  const [leaderboard, setLeaderboard] = useState([]);
  const [timeLeft, setTimeLeft] = useState(180);
  const [lobbyPlayers, setLobbyPlayers] = useState([]);
  const [winner, setWinner] = useState(null);
  const [finalLeaderboard, setFinalLeaderboard] = useState([]);

  // Phase 5: Betting State
  const [pot, setPot] = useState(0);
  const [minBet, setMinBet] = useState(100);
  const [walletAddress, setWalletAddress] = useState(null);
  const [betAmount, setBetAmount] = useState(100);
  const [tokenBalance, setTokenBalance] = useState(1000); // Mock Balance

  // Game State Refs (Mutable for 60FPS rendering)
  const playersRef = useRef([]); // Visual State
  const serverPlayersRef = useRef([]); // Server Target State
  const foodRef = useRef([]);
  const botsRef = useRef([]);
  const virusesRef = useRef([]); // v2.03 Phase 4.6
  const safeZoneRef = useRef({ x: 2250, y: 2250, radius: 2250 }); // Default
  const jackpotRef = useRef(null);
  const myIdRef = useRef(null);
  const cameraRef = useRef({ x: 2250, y: 2250, zoom: 1 }); // FIX: Start at Center

  // Visual Effects System (v2.18)
  const effectsRef = useRef([]); // Array of { type, x, y, text, color, startTime, duration }
  const lastScoreRef = useRef(0); // Track last score for score popup

  // Camera Shake & Death Effects (v2.19)
  const cameraShakeRef = useRef({ intensity: 0, startTime: 0, duration: 0 });
  const deathParticlesRef = useRef([]); // Array of { x, y, vx, vy, color, radius, startTime, duration }

  // Continuous Input Fix (v2.20) - Store last target to send even when mouse doesn't move
  const lastTargetRef = useRef({ x: 2250, y: 2250 });

  // Trail Effect (v2.20) - Store previous positions
  const trailRef = useRef([]); // Array of { x, y, color, timestamp }

  useEffect(() => {
    // 1. Connect to Server
    const socket = io(SERVER_URL);
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('✅ Connected to Game Server:', socket.id);
      setConnectionStatus('CONNECTED');
      myIdRef.current = socket.id;
    });

    socket.on('disconnect', () => {
      console.log('❌ Disconnected');
      setConnectionStatus('DISCONNECTED');
    });

    socket.on('game_init', (data) => {
      console.log('🌍 World Init:', data);
      // data.worldWidth, data.worldHeight, initial food?
      if (data.food) foodRef.current = data.food;
    });

    socket.on('game_update', (payload) => {
      // payload: { players, bots, food, time }
      // This is the High-Frequency Update (20-60Hz)
      if (payload.players) serverPlayersRef.current = payload.players; // Store as Target, don't overwrite visual immediately
      if (payload.bots) botsRef.current = payload.bots; // Sync bots
      if (payload.viruses) virusesRef.current = payload.viruses; // Sync viruses
      if (payload.food) foodRef.current = payload.food; // Optional if dynamic
      if (payload.safeZone) safeZoneRef.current = payload.safeZone; // Sync Safe Zone
      // Jackpot payload might be null or object
      jackpotRef.current = payload.jackpot || null;

      // Phase 5: Sync Pot in Game
      if (payload.pot !== undefined) setPot(payload.pot);

      // Visual Effects: Score Popup (v2.18)
      const myPlayer = payload.players?.find(p => p.id === myIdRef.current);
      if (myPlayer && myPlayer.score > lastScoreRef.current + 0.5) {
        const gain = Math.floor(myPlayer.score - lastScoreRef.current);
        if (gain > 0 && myPlayer.cells && myPlayer.cells.length > 0) {
          const cell = myPlayer.cells[0];
          effectsRef.current.push({
            type: 'score_popup',
            x: cell.x,
            y: cell.y - cell.radius - 20,
            text: `+${gain}`,
            color: gain >= 10 ? '#FFD700' : '#00ff00',
            startTime: Date.now(),
            duration: 1000
          });

          // Camera Shake for big gains (v2.19)
          if (gain >= 10) {
            cameraShakeRef.current = {
              intensity: Math.min(gain / 5, 10), // Max 10px shake
              startTime: Date.now(),
              duration: 200
            };
          }
        }
      }
      if (myPlayer) lastScoreRef.current = myPlayer.score;

      if (payload.time !== undefined) setTimeLeft(Math.floor(payload.time));
      if (payload.leaderboard) {
        setLeaderboard(payload.leaderboard);
      }
    });

    socket.on('lobby_update', (data) => {
      console.log('👥 Lobby Update:', data);
      setLobbyPlayers(data.players);
      if (data.pot !== undefined) setPot(data.pot);
      if (data.minBet !== undefined) setMinBet(data.minBet);
    });

    socket.on('game_over', (data) => {
      console.log('🏁 Game Over:', data);
      setWinner(data.winner);
      setFinalLeaderboard(data.leaderboard);
      setGameState('gameover');
    });

    socket.on('game_start', () => {
      setGameState('playing');
      setLobbyPlayers([]);
    });

    // Cleanup
    return () => {
      socket.disconnect();
    };
  }, []);

  // Format Helper
  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const handleJoinGame = () => {
    if (!nickname.trim()) return;
    socketRef.current.emit('join_game', { name: nickname });
    setGameState('lobby'); // Changed from 'playing' to 'lobby'
  };

  // --- RENDERING LOOP ---
  useEffect(() => {
    if (gameState !== 'playing') return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let animationFrameId;

    // Responsive Canvas
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', resize);
    resize();

    const render = () => {
      animationFrameId = requestAnimationFrame(render);

      // --- INTERPOLATION (Smooth Movement) ---
      const lerpFactor = 0.2; // Adjust for smoothness (0.1 = slow/smooth, 0.5 = fast/accurate)

      const serverPlayers = serverPlayersRef.current;
      const visualPlayers = playersRef.current;

      // 1. Update Existing & Add New
      serverPlayers.forEach(sp => {
        let vp = visualPlayers.find(p => p.id === sp.id);
        if (!vp) {
          // New Player: Snap immediate
          vp = JSON.parse(JSON.stringify(sp));
          visualPlayers.push(vp);
        } else {
          // Existing: LERP properties
          // If single cell, simple x/y lerp.
          // If multi-cell, lerp each cell? 
          // Simplified: Lerp the 'centroid' x/y for camera and labels
          vp.x += (sp.x - vp.x) * lerpFactor;
          vp.y += (sp.y - vp.y) * lerpFactor;
          vp.score = sp.score; // Instant score update
          vp.dead = sp.dead;
          vp.color = sp.color;
          vp.name = sp.name;
          vp.name = sp.name;

          // Fix: Immediate Radius Update if difference is large (e.g. eating bot)
          // Otherwise smooth for small growth
          const rDiff = sp.radius - vp.radius;
          if (Math.abs(rDiff) > 5) {
            vp.radius = sp.radius; // Snap for big changes
          } else {
            vp.radius += rDiff * lerpFactor; // Smooth for small
          }

          // Multi-Cell Lerp
          if (sp.cells && sp.cells.length > 0) {
            if (!vp.cells) vp.cells = JSON.parse(JSON.stringify(sp.cells));

            // Sync Cells
            sp.cells.forEach((sc, i) => {
              let vc = vp.cells.find(c => c.id === sc.id);
              if (!vc) {
                vp.cells.push({ ...sc }); // New cell
              } else {
                vc.x += (sc.x - vc.x) * lerpFactor;
                vc.y += (sc.y - vc.y) * lerpFactor;
                vc.y += (sc.y - vc.y) * lerpFactor;

                // Fix: Cell Radius Snap
                const crDiff = sc.radius - vc.radius;
                if (Math.abs(crDiff) > 5) {
                  vc.radius = sc.radius;
                } else {
                  vc.radius += crDiff * lerpFactor;
                }
                vc.mass = sc.mass;
              }
            });
            // Remove dead cells
            vp.cells = vp.cells.filter(vc => sp.cells.find(sc => sc.id === vc.id));
          }
        }
      });

      // 2. Remove Disconnected Players
      playersRef.current = visualPlayers.filter(vp => serverPlayers.find(sp => sp.id === vp.id));


      // 1. Camera Logic (Follow Me)
      const myPlayer = playersRef.current.find(p => p.id === myIdRef.current);
      if (myPlayer) {
        // Smooth Lerp Camera
        cameraRef.current.x += (myPlayer.x - cameraRef.current.x) * 0.1;
        cameraRef.current.y += (myPlayer.y - cameraRef.current.y) * 0.1;

        // Zoom based on size (Simple)
        const safeRadius = myPlayer.radius || 20; // Fallback to prevent NaN
        const targetZoom = 1 / (1 + safeRadius / 1000);
        cameraRef.current.zoom += (targetZoom - cameraRef.current.zoom) * 0.1;
      }

      // Safety: Prevent Camera getting stuck at 0 or NaN (Defensive Fix)
      if (!Number.isFinite(cameraRef.current.x) || !Number.isFinite(cameraRef.current.y) ||
        (cameraRef.current.x === 0 && cameraRef.current.y === 0)) {
        console.warn("⚠️ Camera corrupted (NaN or 0). Force-Reset to 2250.");
        cameraRef.current.x = 2250;
        cameraRef.current.y = 2250;
      }
      // DEBUG: Why no player?
      if (Math.random() < 0.01) console.log("Waiting for player...", myIdRef.current, playersRef.current.length);


      // Canvas Clear
      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const camX = cameraRef.current.x;
      const camY = cameraRef.current.y;
      const zoom = cameraRef.current.zoom;

      // Camera Shake Effect (v2.19)
      let shakeX = 0, shakeY = 0;
      const shake = cameraShakeRef.current;
      if (shake.intensity > 0 && Date.now() - shake.startTime < shake.duration) {
        const progress = (Date.now() - shake.startTime) / shake.duration;
        const decay = 1 - progress; // Fade out
        shakeX = (Math.random() - 0.5) * shake.intensity * decay;
        shakeY = (Math.random() - 0.5) * shake.intensity * decay;
      }

      // Transform View (with shake)
      ctx.translate(canvas.width / 2 + shakeX, canvas.height / 2 + shakeY);
      ctx.scale(zoom, zoom);
      ctx.translate(-camX, -camY);

      // --- Draw Grid ---
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 1;
      const gridSize = 100;
      // Optimize grid drawing? For now simple loops
      // Simple bound: -500 to 5000 
      ctx.beginPath();
      for (let x = 0; x <= 4500; x += gridSize) {
        ctx.moveTo(x, 0); ctx.lineTo(x, 4500);
      }
      for (let y = 0; y <= 4500; y += gridSize) {
        ctx.moveTo(0, y); ctx.lineTo(4500, y);
      }
      ctx.stroke();

      // --- Draw Safe Zone ---
      if (safeZoneRef.current) {
        const { x, y, radius } = safeZoneRef.current;

        // 1. Draw Warning Border
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.lineWidth = 5;
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
        ctx.stroke();
        ctx.lineWidth = 1;

        // 2. Draw "Poison" Area (Outside the circle) - Optimization: Massive Border?
        // Canvas trick: Draw huge rectangle, cut out circle with clip? Or just huge border.
        // Let's stick to a clear red border for performance first, or semi-transparent red ring.

        // Simple visual: Red Border + "SAFE ZONE" Text
        ctx.fillStyle = 'rgba(255, 0, 0, 0.2)';
        ctx.font = 'bold 200px Arial';
        ctx.textAlign = 'center';
        // ctx.fillText("SAFE ZONE", x, y); // Might cover game
      }

      // --- Draw Food ---
      foodRef.current.forEach(f => {
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
        ctx.fillStyle = f.color;
        ctx.shadowBlur = 10;
        ctx.shadowColor = f.color;
        ctx.fill();
        ctx.shadowBlur = 0; // Reset
      });

      // --- Draw Jackpot Arrow ---
      if (jackpotRef.current && myIdRef.current) {
        const me = playersRef.current.find(p => p.id === myIdRef.current);
        if (me && !me.dead) {
          const jp = jackpotRef.current;
          // Check if on screen? Simplified: Always draw arrow if valid
          const dx = jp.x - me.x;
          const dy = jp.y - me.y;
          const angle = Math.atan2(dy, dx);

          const arrowDist = 100; // Radius from player center
          const ax = me.x + Math.cos(angle) * arrowDist;
          const ay = me.y + Math.sin(angle) * arrowDist;

          ctx.save();
          ctx.translate(ax, ay);
          ctx.rotate(angle);
          ctx.fillStyle = '#FFD700';
          ctx.beginPath(); // Simple Triangle
          ctx.moveTo(10, 0); ctx.lineTo(-10, 10); ctx.lineTo(-10, -10);
          ctx.fill();
          ctx.restore();
        }
      }

      // --- Trail Effect (v2.20) ---
      const trailPlayer = playersRef.current.find(p => p.id === myIdRef.current);
      if (trailPlayer && trailPlayer.cells && trailPlayer.cells.length > 0) {
        const cell = trailPlayer.cells[0];
        const now = Date.now();

        // Add current position to trail
        trailRef.current.push({ x: cell.x, y: cell.y, color: trailPlayer.color, timestamp: now });

        // Remove old trail points (older than 300ms)
        trailRef.current = trailRef.current.filter(t => now - t.timestamp < 300);

        // Draw trail (fading circles)
        trailRef.current.forEach((t, i) => {
          const age = now - t.timestamp;
          const alpha = Math.max(0, 1 - age / 300) * 0.3;
          const radius = (cell.radius || 20) * (1 - age / 600);

          ctx.beginPath();
          ctx.arc(t.x, t.y, Math.max(3, radius), 0, Math.PI * 2);
          ctx.fillStyle = t.color || '#00ff00';
          ctx.globalAlpha = alpha;
          ctx.fill();
          ctx.globalAlpha = 1;
        });
      }

      // --- Draw Players (Multi-Cell) ---
      playersRef.current.forEach(p => {
        if (p.dead) return; // Don't draw dead players

        // Draw Cells
        if (p.cells && p.cells.length > 0) {
          p.cells.forEach(cell => {
            ctx.beginPath();
            ctx.arc(cell.x, cell.y, cell.radius, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.shadowBlur = 20;
            ctx.shadowColor = p.color;
            ctx.fill();
            ctx.shadowBlur = 0;

            // Optional: Draw cell mass?
          });
        } else {
          // Fallback for non-multi-cell/bots if any
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.shadowBlur = 20;
          ctx.shadowColor = p.color;
          ctx.fill();
        }

        // Draw Name at Centroid (p.x, p.y)
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#fff';
        const fontSize = Math.max(12, 20); // Fixed size label or scale?
        ctx.font = `bold ${fontSize}px Arial`;
        ctx.textAlign = 'center';
        ctx.fillText(p.name, p.x, p.y);
        ctx.font = `10px Arial`;
        ctx.fillText(Math.floor(p.score), p.x, p.y + 12);
      });

      // --- Draw Bots (with Score Display) ---
      botsRef.current.forEach(b => {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
        ctx.fillStyle = b.color;
        ctx.shadowColor = b.color;
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.shadowBlur = 0;

        // Bot Score Display (v2.19)
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(Math.floor(b.mass || b.radius), b.x, b.y + 4);
      });

      // --- Draw Viruses (with Pulsating Glow) ---
      const glowTime = Date.now() / 500; // Slow pulse
      virusesRef.current.forEach(v => {
        // Pulsating glow effect (v2.19)
        const glowIntensity = 15 + Math.sin(glowTime + v.x * 0.01) * 10;
        ctx.shadowColor = '#33ff33';
        ctx.shadowBlur = glowIntensity;

        ctx.beginPath();
        // Spiky Circle Logic
        const spikes = 20;
        const outerRadius = v.radius;
        const innerRadius = v.radius * 0.9;

        for (let i = 0; i < spikes; i++) {
          const angle = (Math.PI * 2 / spikes) * i;
          // Outer point
          ctx.lineTo(v.x + Math.cos(angle) * outerRadius, v.y + Math.sin(angle) * outerRadius);
          // Inner point
          const innerAngle = angle + (Math.PI / spikes);
          ctx.lineTo(v.x + Math.cos(innerAngle) * innerRadius, v.y + Math.sin(innerAngle) * innerRadius);
        }
        ctx.closePath();
        ctx.fillStyle = v.color; // Green
        ctx.fill();
        ctx.strokeStyle = '#22aa22';
        ctx.lineWidth = 5;
        ctx.stroke();
        ctx.shadowBlur = 0; // Reset glow
      });

      ctx.restore();

      // --- Render Visual Effects (Score Popups) ---
      const now = Date.now();
      effectsRef.current = effectsRef.current.filter(effect => {
        const elapsed = now - effect.startTime;
        if (elapsed > effect.duration) return false; // Remove expired effects

        const progress = elapsed / effect.duration;
        const alpha = 1 - progress; // Fade out
        const yOffset = progress * 30; // Float up

        // Transform to screen coordinates
        const screenX = (effect.x - camX) * zoom + canvas.width / 2;
        const screenY = (effect.y - yOffset - camY) * zoom + canvas.height / 2;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = effect.color;
        ctx.font = 'bold 20px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(effect.text, screenX, screenY);
        ctx.restore();

        return true; // Keep effect
      });

      // --- Render Death Particles (v2.19) ---
      deathParticlesRef.current = deathParticlesRef.current.filter(p => {
        const elapsed = now - p.startTime;
        if (elapsed > p.duration) return false;

        const progress = elapsed / p.duration;
        const alpha = 1 - progress;

        // Update position
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.95; // Friction
        p.vy *= 0.95;

        // Transform to screen
        const screenX = (p.x - camX) * zoom + canvas.width / 2;
        const screenY = (p.y - camY) * zoom + canvas.height / 2;
        const screenRadius = p.radius * zoom * (1 - progress * 0.5);

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(screenX, screenY, Math.max(1, screenRadius), 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 5;
        ctx.fill();
        ctx.restore();

        return true;
      });

      // --- UI Overlay (Timer, Leaderboard) ---
      // Timer
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 30px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(formatTime(timeLeft), canvas.width / 2, 50);

      // Phase 5: Pot Display
      ctx.fillStyle = '#FFD700';
      ctx.font = 'bold 24px Arial';
      ctx.fillText(`💰 POT: ${pot}`, canvas.width / 2, 80);

      // Leaderboard (Top Right)
      // DEBUG FORCE:
      // const activeLeaderboard = leaderboard.length > 0 ? leaderboard : [{name: 'TestBot', score: 100}, {name: 'Player', score: 50}];
      const activeLeaderboard = leaderboard;

      if (activeLeaderboard.length > 0) {
        const lbWidth = 200;
        const lbX = canvas.width - lbWidth - 10; // 10px padding from right
        const lbY = 10;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(lbX, lbY, lbWidth, leaderboard.length * 25 + 40);

        ctx.fillStyle = '#fff';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'left';
        ctx.fillText("🏆 LEADERBOARD", lbX + 10, lbY + 25);

        ctx.font = '14px Arial';
        leaderboard.forEach((entry, i) => {
          ctx.fillText(`#${i + 1} ${entry.name.slice(0, 10)} (${entry.score})`, lbX + 10, lbY + 50 + i * 25);
        });
      }

      // Debug
      ctx.font = '12px Arial';
      ctx.textAlign = 'left';
      ctx.fillText(`Ping: ? ms | ID: ${myIdRef.current?.substr(0, 4)}`, 10, 20);
      ctx.fillText(`Players: ${playersRef.current.length} | Bots: ${botsRef.current.length}`, 10, 40);
      ctx.fillText(`Food: ${foodRef.current.length}`, 10, 60);
    };

    render();
    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, [gameState, timeLeft]);

  // Input Handling
  const handleMouseMove = (e) => {
    if (gameState !== 'playing' || !socketRef.current) return;

    // We need to send "Mouse Position in World"
    // Convert Screen -> World
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Aggressive Camera Fix: If Camera is at 0 (Bug), snap it to center
    if (cameraRef.current.x < 100 && cameraRef.current.y < 100) {
      cameraRef.current.x = 2250;
      cameraRef.current.y = 2250;
      console.warn("⚠️ Camera drifted to 0. Force-Snapped to 2250.");
    }

    const camX = cameraRef.current.x;
    const camY = cameraRef.current.y;
    const zoom = cameraRef.current.zoom;

    // Screen Center relative
    const dx = e.clientX - canvas.width / 2;
    const dy = e.clientY - canvas.height / 2;

    // Convert to World Delta
    const worldDx = dx / zoom;
    const worldDy = dy / zoom;

    const targetX = camX + worldDx;
    const targetY = camY + worldDy;

    // Safety: Prevent NaN or Infinite coordinates
    if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) {
      console.warn('⚠️ Invalid Input (NaN/Inf) detected. Blocking emit.');
      return;
    }

    socketRef.current.emit('input_update', { targetX, targetY });

    // Store for continuous sending (v2.20 bug fix)
    lastTargetRef.current = { x: targetX, y: targetY };
  };

  // Continuous Input Sending (v2.20) - Fix for player stuck when mouse doesn't move
  useEffect(() => {
    if (gameState !== 'playing' || !socketRef.current) return;

    const inputInterval = setInterval(() => {
      if (socketRef.current && lastTargetRef.current) {
        const { x, y } = lastTargetRef.current;
        if (Number.isFinite(x) && Number.isFinite(y)) {
          socketRef.current.emit('input_update', { targetX: x, targetY: y });
        }
      }
    }, 50); // Send every 50ms (20Hz) even if mouse not moving

    return () => clearInterval(inputInterval);
  }, [gameState]);

  // Key Input
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'w' || e.key === 'W') {
        if (gameState === 'playing' && !amIDead()) {
          socketRef.current.emit('input_action', { type: 'eject' });
        }
      } else if (e.code === 'Space') {
        if (gameState === 'playing' && !amIDead()) {
          socketRef.current.emit('input_action', { type: 'split' });
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gameState]);

  // Check if I am dead
  const amIDead = () => {
    if (!myIdRef.current || playersRef.current.length === 0) return false;
    const me = playersRef.current.find(p => p.id === myIdRef.current);
    return me && me.dead; // Server needs to send 'dead' flag in payload
  };

  // Calculate Toxic Overlay Opacity
  const getToxicOpacity = () => {
    if (!myIdRef.current || !safeZoneRef.current) return 0;
    const me = playersRef.current.find(p => p.id === myIdRef.current);
    if (!me) return 0;

    const dx = me.x - safeZoneRef.current.x;
    const dy = me.y - safeZoneRef.current.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > safeZoneRef.current.radius) {
      // Fade in based on how far deep? Or just constant?
      // Let's make it pulse or consistent.
      return 0.3; // 30% Red
    }
    return 0;
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
      overflow: 'hidden', background: '#000', margin: 0, padding: 0
    }} onMouseMove={handleMouseMove}>

      {/* Toxic Overlay */}
      {gameState === 'playing' && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          pointerEvents: 'none',
          zIndex: 5,
          boxShadow: getToxicOpacity() > 0 ? 'inset 0 0 100px 50px rgba(255, 0, 0, 0.5)' : 'none',
          background: `rgba(255, 0, 0, ${getToxicOpacity()})`,
          transition: 'background 0.5s, box-shadow 0.5s'
        }} />
      )}

      {gameState === 'playing' && amIDead() && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.7)', zIndex: 15, color: '#ff0000', pointerEvents: 'none'
        }}>
          <h1 style={{ fontSize: '4rem', textShadow: '0 0 10px #f00' }}>YOU DIED</h1>
          <h2>Respawning in 5 seconds...</h2>
          <p>Score Retained: 80%</p>
        </div>
      )}

      {gameState === 'menu' && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.8)', zIndex: 10
        }}>
          <h1 style={{ fontSize: '4rem', color: '#00ff00', textShadow: '0 0 20px #00ff00', fontFamily: 'Arial' }}>
            GLOW BATTLE v2.20 (Bug Fix + Trail)
          </h1>
          <div style={{ color: connectionStatus === 'CONNECTED' ? '#0f0' : '#f00', marginBottom: 20 }}>
            Status: {connectionStatus}
          </div>

          <input
            value={nickname}
            onChange={e => setNickname(e.target.value)}
            placeholder="Enter Name"
            style={{
              padding: '15px 30px', fontSize: '20px', borderRadius: '30px',
              border: '2px solid #00ff00', background: '#000', color: '#fff',
              textAlign: 'center', outline: 'none', marginBottom: 20
            }}
          />

          <button
            onClick={handleJoinGame}
            disabled={connectionStatus !== 'CONNECTED' || !nickname}
            style={{
              padding: '15px 40px', fontSize: '24px', borderRadius: '30px',
              border: 'none', background: '#00ff00', color: '#000', fontWeight: 'bold',
              cursor: 'pointer', opacity: (connectionStatus === 'CONNECTED' && nickname) ? 1 : 0.5
            }}
          >
            JOIN SERVER
          </button>
          <div style={{ marginTop: 20, color: '#666' }}>v2.19</div>
        </div>
      )
      }

      {
        gameState === 'lobby' && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.9)', zIndex: 10, color: 'white', fontFamily: 'Arial'
          }}>
            <h1>🎮 LOBBY</h1>
            <p>Waiting for players...</p>

            <div style={{ margin: '20px', padding: '20px', border: '1px solid #444', borderRadius: '10px', minWidth: '300px' }}>
              {lobbyPlayers.length === 0 && <p style={{ color: '#888' }}>Checking server...</p>}
              {lobbyPlayers.map(p => (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', borderBottom: '1px solid #333' }}>
                  <span>{p.name} {p.id === myIdRef.current ? '(ME)' : ''}</span>
                  <span style={{ color: p.isReady ? '#0f0' : '#888' }}>
                    {p.isReady ? `✅ BET: ${p.betAmount || '?'}` : '⏳ WAITING'}
                  </span>
                </div>
              ))}
            </div>

            {/* Phase 5: Hidden for Phase 4 Debug
          <div style={{ marginBottom: 20, textAlign: 'center' }}>
            <h2 style={{ color: '#FFD700' }}>💰 POT: {pot}</h2>
             ...
          </div>
          */}

            <button
              onClick={() => {
                socketRef.current.emit('player_ready');
              }}
              style={{
                padding: '15px 40px', fontSize: '20px', background: '#00ff00',
                border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold'
              }}
            >
              Ready / Start Game (Phase 4 Debug)
            </button>
            <div style={{ marginTop: 20, color: '#666' }}>v2.20 (Bug Fix + Trail)</div>
          </div>
        )
      }

      {
        gameState === 'gameover' && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.9)', zIndex: 20, color: 'white', fontFamily: 'Arial'
          }}>
            <h1 style={{ fontSize: '4rem', color: '#FFD700', textShadow: '0 0 20px #FFD700' }}>GAME OVER</h1>

            {winner ? (
              <div style={{ textAlign: 'center', marginBottom: '40px' }}>
                <h2>🏆 WINNER 🏆</h2>
                <h3 style={{ fontSize: '3rem', margin: '10px' }}>{winner.name}</h3>
                <p>Score: {Math.floor(winner.score)}</p>
                {winner.winnings && (
                  <p style={{ color: '#FFD700', fontSize: '24px', fontWeight: 'bold' }}>
                    EARNINGS: +${winner.winnings}
                  </p>
                )}
              </div>
            ) : (
              <h2>Game Ended</h2>
            )}

            <button
              onClick={() => window.location.reload()}
              style={{
                marginTop: '30px', padding: '15px 40px', fontSize: '20px',
                background: '#fff', border: 'none', borderRadius: '30px', cursor: 'pointer'
              }}
            >
              Back to Menu
            </button>
            <div style={{ marginTop: 20, color: '#666' }}>v2.20</div>
          </div>
        )
      }

      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div >
  );
}

import React, { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX, Crosshair, Sparkles } from "lucide-react";

interface GameCanvasProps {
  socket: WebSocket;
  playerId: string;
  roomId: string;
  playersData: any[];
  bulletsData: any[];
  gameStatus: string;
  winnerId: string | null;
  onRestart: () => void;
}

interface Particle {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  color: string;
  type: "dust" | "dash" | "sonar" | "hit_spark";
  maxAge: number;
  age: number;
}

export default function GameCanvas({
  socket,
  playerId,
  roomId,
  playersData,
  bulletsData,
  gameStatus,
  winnerId,
  onRestart,
}: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Sound Synth setup
  const playSound = (type: "shoot" | "hit" | "dash" | "win" | "lose") => {
    if (!soundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();

      switch (type) {
        case "shoot": {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sawtooth";
          osc.frequency.setValueAtTime(1200, ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.15);
          
          gain.gain.setValueAtTime(0.15, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
          
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 0.15);
          break;
        }
        case "hit": {
          // Exploding noise
          const bufferSize = ctx.sampleRate * 0.2;
          const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
          const data = buffer.getChannelData(0);
          for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
          }
          const noise = ctx.createBufferSource();
          noise.buffer = buffer;

          const filter = ctx.createBiquadFilter();
          filter.type = "lowpass";
          filter.frequency.setValueAtTime(400, ctx.currentTime);
          filter.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.2);

          const gain = ctx.createGain();
          gain.gain.setValueAtTime(0.2, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);

          noise.connect(filter);
          filter.connect(gain);
          gain.connect(ctx.destination);
          noise.start();
          break;
        }
        case "dash": {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "triangle";
          osc.frequency.setValueAtTime(200, ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.12);

          gain.gain.setValueAtTime(0.2, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);

          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 0.12);
          break;
        }
        case "win": {
          // Success melody
          const now = ctx.currentTime;
          const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
          notes.forEach((freq, index) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.frequency.value = freq;
            osc.connect(gain);
            gain.connect(ctx.destination);
            gain.gain.setValueAtTime(0.1, now + index * 0.1);
            gain.gain.exponentialRampToValueAtTime(0.01, now + index * 0.1 + 0.25);
            osc.start(now + index * 0.1);
            osc.stop(now + index * 0.1 + 0.25);
          });
          break;
        }
        case "lose": {
          // Defeat melody
          const now = ctx.currentTime;
          const notes = [392.00, 349.23, 311.13, 261.63]; // G4, F4, Eb4, C4
          notes.forEach((freq, index) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.frequency.value = freq;
            osc.connect(gain);
            gain.connect(ctx.destination);
            gain.gain.setValueAtTime(0.1, now + index * 0.12);
            gain.gain.exponentialRampToValueAtTime(0.01, now + index * 0.12 + 0.3);
            osc.start(now + index * 0.12);
            osc.stop(now + index * 0.12 + 0.3);
          });
          break;
        }
      }
    } catch (e) {
      console.warn("Web Audio API failed or blocked:", e);
    }
  };

  // Local particles & effect states
  const particlesRef = useRef<Particle[]>([]);
  const lastPositionsRef = useRef<{ [id: string]: { x: number; y: number } }>({});
  const walkFramesRef = useRef<{ [id: string]: number }>({});
  const shakeIntensityRef = useRef<number>(0);

  // Resize handler for scaling canvas
  useEffect(() => {
    const handleResize = () => {
      if (!containerRef.current) return;
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      const scaleX = width / 800;
      const scaleY = height / 600;
      setScale(Math.min(scaleX, scaleY));
    };

    window.addEventListener("resize", handleResize);
    handleResize();

    // Setup initial delay to recalculate scale once layout finishes
    const timer = setTimeout(handleResize, 100);

    return () => {
      window.removeEventListener("resize", handleResize);
      clearTimeout(timer);
    };
  }, []);

  // Listen for socket messages for effects triggers
  useEffect(() => {
    if (!socket) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case "shoot_effect": {
            playSound("shoot");
            // Add sonar ripple particle
            particlesRef.current.push({
              id: Math.random().toString(),
              x: msg.x,
              y: msg.y,
              vx: 0,
              vy: 0,
              radius: 10,
              alpha: 1,
              color: msg.ownerId === playerId ? "rgba(0, 191, 255, 0.7)" : "rgba(255, 69, 0, 0.7)",
              type: "sonar",
              maxAge: 24, // ~0.4s at 60 FPS
              age: 0,
            });
            break;
          }
          case "dash_effect": {
            playSound("dash");
            // Add sonar ripple
            particlesRef.current.push({
              id: Math.random().toString(),
              x: msg.x,
              y: msg.y,
              vx: 0,
              vy: 0,
              radius: 10,
              alpha: 0.9,
              color: "rgba(255, 0, 0, 0.8)",
              type: "sonar",
              maxAge: 24,
              age: 0,
            });
            break;
          }
          case "hit": {
            playSound("hit");
            shakeIntensityRef.current = 12; // Camera shake!

            // Spawn hit sparks
            for (let i = 0; i < 20; i++) {
              const angle = Math.random() * Math.PI * 2;
              const speed = Math.random() * 4 + 2;
              particlesRef.current.push({
                id: Math.random().toString(),
                x: msg.x,
                y: msg.y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                radius: Math.random() * 3 + 1.5,
                alpha: 1,
                color: msg.targetId === playerId ? "#ef4444" : "#ffffff",
                type: "hit_spark",
                maxAge: 35,
                age: 0,
              });
            }
            break;
          }
          case "round_over": {
            if (msg.winnerId === playerId) {
              playSound("win");
            } else {
              playSound("lose");
            }
            break;
          }
        }
      } catch (err) {
        console.error("Error processing effect event:", err);
      }
    };

    socket.addEventListener("message", handleMessage);
    return () => socket.removeEventListener("message", handleMessage);
  }, [socket, playerId, soundEnabled]);

  // Handle local WASD + Space + L Keyboard Inputs
  useEffect(() => {
    const keys: { [key: string]: boolean } = {};
    let lastDx = 0;
    let lastDy = 0;

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      
      // Prevent browser scroll for arrow keys & spacebar inside game viewport
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(e.key)) {
        e.preventDefault();
      }

      keys[key] = true;

      // Spacebar triggers Dash
      if (e.key === " ") {
        socket.send(JSON.stringify({ type: "dash" }));
      }

      // 'L' key fires sniper bullet
      if (key === "l") {
        socket.send(JSON.stringify({ type: "shoot" }));
      }

      sendMovement();
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      keys[key] = false;
      sendMovement();
    };

    const sendMovement = () => {
      let dx = 0;
      let dy = 0;

      if (keys["w"] || keys["arrowup"]) dy -= 1;
      if (keys["s"] || keys["arrowdown"]) dy += 1;
      if (keys["a"] || keys["arrowleft"]) dx -= 1;
      if (keys["d"] || keys["arrowright"]) dx += 1;

      if (dx !== lastDx || dy !== lastDy) {
        lastDx = dx;
        lastDy = dy;
        socket.send(JSON.stringify({ type: "move", dx, dy }));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [socket]);

  // Main Canvas Rendering & Animation Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animFrameId: number;

    const renderLoop = () => {
      // 1. Camera Shake calculation
      let shakeX = 0;
      let shakeY = 0;
      if (shakeIntensityRef.current > 0.1) {
        shakeX = (Math.random() - 0.5) * shakeIntensityRef.current;
        shakeY = (Math.random() - 0.5) * shakeIntensityRef.current;
        shakeIntensityRef.current *= 0.9; // decay
      }

      ctx.save();
      ctx.translate(shakeX, shakeY);

      // 2. Clear canvas with dark slate background
      ctx.fillStyle = "#0b0f19";
      ctx.fillRect(0, 0, 800, 600);

      // Draw subtle tactical grid lines
      ctx.strokeStyle = "rgba(255, 255, 255, 0.02)";
      ctx.lineWidth = 1;
      const gridSize = 40;
      for (let x = 0; x < 800; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 600);
        ctx.stroke();
      }
      for (let y = 0; y < 600; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(800, y);
        ctx.stroke();
      }

      // Draw tactical bounding box borders
      ctx.strokeStyle = "rgba(99, 102, 241, 0.25)"; // Indigo border
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, 796, 596);

      // 3. Process Particle generation based on player position updates
      playersData.forEach((player) => {
        const lastPos = lastPositionsRef.current[player.id];
        const isMoving = player.isMoving;

        // Ensure we initialize walk frames tracking
        if (walkFramesRef.current[player.id] === undefined) {
          walkFramesRef.current[player.id] = 0;
        }

        if (isMoving) {
          walkFramesRef.current[player.id]++;

          if (player.isDashing) {
            // Dash Trail red particles every frame
            particlesRef.current.push({
              id: Math.random().toString(),
              x: player.x,
              y: player.y,
              vx: (Math.random() - 0.5) * 1.5,
              vy: (Math.random() - 0.5) * 1.5,
              radius: Math.random() * 5 + 3,
              alpha: 0.8,
              color: "rgba(239, 68, 68, 0.8)", // Bright neon red
              type: "dash",
              maxAge: 48, // ~0.8 seconds
              age: 0,
            });
          } else {
            // Normal foot dust every 5 frames
            if (walkFramesRef.current[player.id] % 5 === 0) {
              particlesRef.current.push({
                id: Math.random().toString(),
                x: player.x,
                y: player.y + 12, // spawn at feet
                vx: (Math.random() - 0.5) * 0.4,
                vy: (Math.random() - 0.5) * 0.4 - 0.2, // light upward drift
                radius: Math.random() * 3 + 1,
                alpha: 0.4,
                color: "rgba(156, 163, 175, 0.5)", // Faint gray dust
                type: "dust",
                maxAge: 36, // ~0.6 seconds
                age: 0,
              });
            }
          }
        }

        // Cache last positions for next comparison
        lastPositionsRef.current[player.id] = { x: player.x, y: player.y };
      });

      // 4. Update and Render Local Particles
      particlesRef.current.forEach((p, idx) => {
        p.age++;
        p.x += p.vx;
        p.y += p.vy;

        // Fading calculations
        const progress = p.age / p.maxAge;
        p.alpha = Math.max(0, 1 - progress);

        if (p.type === "dust") {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(148, 163, 184, ${p.alpha * 0.4})`; // Slate gray
          ctx.fill();
        } else if (p.type === "dash") {
          // Glow effect for red dash trails
          ctx.save();
          ctx.shadowBlur = 10;
          ctx.shadowColor = "#ef4444";
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius * (1 - progress * 0.4), 0, Math.PI * 2);
          ctx.fillStyle = `rgba(239, 68, 68, ${p.alpha})`; // Glowing red
          ctx.fill();
          ctx.restore();
        } else if (p.type === "sonar") {
          // Sonar wave expands and fades
          p.radius = 10 + progress * 160;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
          ctx.strokeStyle = p.color.replace("0.7", p.alpha.toString()).replace("0.8", p.alpha.toString());
          ctx.lineWidth = 2.5;
          ctx.stroke();
        } else if (p.type === "hit_spark") {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius * (1 - progress * 0.5), 0, Math.PI * 2);
          ctx.fillStyle = p.color === "#ef4444" ? `rgba(239, 68, 68, ${p.alpha})` : `rgba(255, 255, 255, ${p.alpha})`;
          ctx.fill();
        }
      });

      // Remove expired particles
      particlesRef.current = particlesRef.current.filter((p) => p.age < p.maxAge);

      // 5. Render Players
      playersData.forEach((player) => {
        const isSelf = player.id === playerId;
        const isRevealed = player.revealed || isSelf;

        if (isRevealed) {
          ctx.save();

          // Smooth lighting circles under active player avatars
          const gradient = ctx.createRadialGradient(player.x, player.y, 5, player.x, player.y, 35);
          if (isSelf) {
            gradient.addColorStop(0, "rgba(59, 130, 246, 0.2)"); // Own is Blue
            gradient.addColorStop(1, "rgba(59, 130, 246, 0)");
          } else {
            gradient.addColorStop(0, "rgba(244, 63, 94, 0.35)"); // Enemy alert/red
            gradient.addColorStop(1, "rgba(244, 63, 94, 0)");
          }
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.arc(player.x, player.y, 35, 0, Math.PI * 2);
          ctx.fill();

          // Outer glowing boundaries
          ctx.shadowBlur = 12;
          ctx.shadowColor = isSelf ? "#3b82f6" : "#f43f5e";

          ctx.beginPath();
          ctx.arc(player.x, player.y, 18, 0, Math.PI * 2);
          ctx.fillStyle = isSelf ? "#1d4ed8" : "#be123c"; // Dark filled core
          ctx.strokeStyle = isSelf ? "#60a5fa" : "#fb7185"; // Glowing rim
          ctx.lineWidth = 3.5;
          ctx.fill();
          ctx.stroke();

          // Draw face direction pointer
          const faceLen = 22;
          ctx.beginPath();
          ctx.moveTo(player.x, player.y);
          ctx.lineTo(player.x + player.facingX * faceLen, player.y + player.facingY * faceLen);
          ctx.strokeStyle = isSelf ? "#ffffff" : "#fb7185";
          ctx.lineWidth = 3;
          ctx.stroke();

          ctx.restore();

          // Draw reload circular indicator next to player's feet
          if (player.shootCooldownLeft > 0) {
            const cooldownProgress = player.shootCooldownLeft / 3000;
            ctx.beginPath();
            ctx.arc(player.x, player.y + 28, 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * cooldownProgress);
            ctx.strokeStyle = "#eab308"; // Gold indicator
            ctx.lineWidth = 2.5;
            ctx.stroke();

            // Label text "재장전..."
            ctx.fillStyle = "#eab308";
            ctx.font = "bold 9px sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("재장전 중", player.x, player.y + 44);
          }

          // Draw HP nodes above their heads
          const nodeW = 10;
          const spacing = 4;
          const startX = player.x - ((nodeW * 3 + spacing * 2) / 2);
          for (let h = 0; h < 3; h++) {
            ctx.fillStyle = h < player.hp ? (isSelf ? "#3b82f6" : "#ef4444") : "#374151";
            ctx.fillRect(startX + h * (nodeW + spacing), player.y - 32, nodeW, 4);
          }

          // Draw nickname above head
          ctx.fillStyle = isSelf ? "#93c5fd" : "#fca5a5";
          ctx.font = "11px monospace";
          ctx.textAlign = "center";
          ctx.fillText(player.name, player.x, player.y - 42);
        } else {
          // If the opponent is invisible but currently dashing, we render a faint glitch silhouette
          if (player.isDashing) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(player.x, player.y, 16, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(239, 68, 68, 0.25)";
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.restore();
          }
        }
      });

      // 6. Render Sniper Bullets
      bulletsData.forEach((bullet) => {
        ctx.save();
        ctx.shadowBlur = 8;
        ctx.shadowColor = "#fca5a5";
        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();

        // High-velocity trajectory streak line behind bullet
        ctx.beginPath();
        // Travel velocity vector is around 24, so streak goes backwards
        const bulletOwner = playersData.find(p => p.id === bullet.ownerId);
        if (bulletOwner) {
          const fx = bulletOwner.facingX || 1;
          const fy = bulletOwner.facingY || 0;
          const len = Math.hypot(fx, fy);
          const dx = len > 0 ? (fx / len) * 35 : 35;
          const dy = len > 0 ? (fy / len) * 35 : 0;
          
          ctx.moveTo(bullet.x, bullet.y);
          ctx.lineTo(bullet.x - dx, bullet.y - dy);
          ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        ctx.restore();
      });

      ctx.restore(); // restore from camera shake translation

      animFrameId = requestAnimationFrame(renderLoop);
    };

    animFrameId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(animFrameId);
  }, [playersData, bulletsData, playerId]);

  // Self Player Data helper
  const selfPlayer = playersData.find((p) => p.id === playerId);
  const opponentPlayer = playersData.find((p) => p.id !== playerId);

  return (
    <div className="flex flex-col items-center justify-center w-full bg-[#0b0f19] p-4 md:p-6 border border-[#1e293b] rounded-2xl shadow-2xl">
      {/* HUD Top Stats Header */}
      <div className="flex flex-wrap items-center justify-between w-full max-w-4xl bg-[#0f172a] border border-[#1e293b] px-6 py-4 rounded-xl mb-5 gap-4 shadow-xl">
        {/* Play Status & Room Info */}
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2 bg-[#0b0f19] border border-[#334155] px-3 py-1.5 rounded-lg">
            <span className="flex h-2.5 w-2.5 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-indigo-500"></span>
            </span>
            <span className="text-[10px] font-mono text-indigo-400 font-bold tracking-widest uppercase">LIVE OPERATION</span>
          </div>
          <div className="h-4 w-[1px] bg-[#1e293b]" />
          <span className="text-xs text-[#94a3b8] font-bold">
            ROOM: <span className="text-white font-mono text-sm tracking-widest bg-[#0b0f19] px-2 py-0.5 rounded border border-[#334155]">{roomId}</span>
          </span>
        </div>

        {/* Tactical Game Scoreboard */}
        <div className="flex items-center justify-center space-x-12 text-center">
          {/* Player 1 (Self or Left) */}
          <div className="flex flex-col items-center">
            <span className="text-[9px] text-[#64748b] font-mono font-black tracking-widest mb-1">SNIPER (YOU)</span>
            <span className="text-sm font-extrabold text-white truncate max-w-[140px] tracking-tight">
              {selfPlayer?.name || "나"}
            </span>
            {/* Glowing HP Nodes (Sophisticated Dark) */}
            <div className="flex items-center justify-center mt-2.5 gap-1.5">
              {[...Array(3)].map((_, i) => (
                <div
                  key={i}
                  className={`w-4 h-6 rounded-sm transition-all duration-300 ${
                    selfPlayer && i < selfPlayer.hp
                      ? "bg-indigo-500 shadow-[0_0_12px_rgba(99,102,241,0.65)]"
                      : "bg-[#1e293b] border border-[#334155]"
                  }`}
                />
              ))}
            </div>
            <span className="text-xs font-mono text-indigo-400 mt-2 font-bold tracking-widest bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded">
              {selfPlayer?.score ?? 0} SECURED
            </span>
          </div>

          <div className="flex flex-col justify-center px-4">
            <span className="text-lg font-black text-[#334155] font-mono tracking-wider">VS</span>
            <div className="w-8 h-[2px] bg-[#1e293b] mx-auto mt-1" />
          </div>

          {/* Player 2 (Opponent or Right) */}
          <div className="flex flex-col items-center">
            <span className="text-[9px] text-rose-400 font-mono font-black tracking-widest mb-1">TARGET (ENEMY)</span>
            <span className="text-sm font-extrabold text-slate-300 truncate max-w-[140px] tracking-tight">
              {opponentPlayer?.name || "상대방 대기 중..."}
            </span>
            {/* Glowing HP Nodes */}
            <div className="flex items-center justify-center mt-2.5 gap-1.5">
              {[...Array(3)].map((_, i) => (
                <div
                  key={i}
                  className={`w-4 h-6 rounded-sm transition-all duration-300 ${
                    opponentPlayer && i < opponentPlayer.hp
                      ? "bg-rose-500 shadow-[0_0_12px_rgba(239,68,68,0.65)]"
                      : "bg-[#1e293b] border border-[#334155]"
                  }`}
                />
              ))}
            </div>
            <span className="text-xs font-mono text-rose-400 mt-2 font-bold tracking-widest bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded">
              {opponentPlayer?.score ?? 0} SECURED
            </span>
          </div>
        </div>

        {/* Audio / Control Toggles */}
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="flex items-center justify-center h-10 w-10 bg-[#1e293b] hover:bg-[#334155] active:scale-95 text-slate-300 rounded-lg border border-[#334155] transition-all cursor-pointer"
            title={soundEnabled ? "음소거" : "소리 켜기"}
          >
            {soundEnabled ? <Volume2 className="h-4.5 w-4.5" /> : <VolumeX className="h-4.5 w-4.5 text-rose-400" />}
          </button>
        </div>
      </div>

      {/* Main Sandbox Canvas Wrapper */}
      <div
        ref={containerRef}
        className="relative flex items-center justify-center w-full max-w-4xl bg-[#030712] rounded-2xl overflow-hidden aspect-[4/3] select-none shadow-2xl border border-[#1e293b]"
      >
        <canvas
          ref={canvasRef}
          width={800}
          height={600}
          style={{
            transform: `scale(${scale})`,
            transformOrigin: "center center",
            width: "800px",
            height: "600px",
          }}
          className="bg-[#0b0f19] block max-w-none transition-transform duration-75"
        />

        {/* Round End Modal / Overlay */}
        {gameStatus === "ended" && (
          <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center animate-fade-in z-20">
            <div className="bg-[#0f172a] border border-[#1e293b] rounded-2xl p-8 max-w-sm w-full shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-indigo-500 via-pink-500 to-indigo-500 animate-pulse" />
              
              <div className="flex justify-center mb-4">
                <div className="p-3 bg-indigo-500/10 rounded-full text-indigo-400 border border-[#334155]">
                  <Crosshair className="h-8 w-8" />
                </div>
              </div>

              <h3 className="text-2xl font-black tracking-tight text-white mb-2">
                {winnerId === playerId ? (
                  <span className="text-indigo-400">전술적 승리! 🎯</span>
                ) : (
                  <span className="text-rose-500">작전 실패 (사망) 💀</span>
                )}
              </h3>

              <p className="text-[#94a3b8] text-xs mb-6 leading-relaxed">
                {winnerId === playerId
                  ? "상대 스나이퍼를 먼저 격추하는 데 성공했습니다. 뛰어난 추적 능력을 보여주셨습니다."
                  : "상대 스나이퍼의 기습 조준 사격에 격추당했습니다. 그림자에 숨어 더 안전하게 조준하십시오."}
              </p>

              <button
                onClick={onRestart}
                className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-bold text-xs tracking-wider rounded-xl transition-all shadow-lg shadow-indigo-600/30 cursor-pointer uppercase font-mono"
              >
                다음 라운드 시작 🔄 NEXT ROUND
              </button>
            </div>
          </div>
        )}

        {/* Handheld/Mobile inputs or Quick Controls reminder */}
        <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between text-[11px] font-mono text-[#64748b] pointer-events-none bg-[#0f172a]/70 backdrop-blur-md px-4 py-2 rounded-xl border border-[#334155]/50">
          <div className="flex items-center space-x-4">
            <span>이동: <b className="text-slate-300">W, A, S, D</b> / <b className="text-slate-300">방향키</b></span>
            <span>대시: <b className="text-slate-300">Spacebar</b></span>
            <span>저격 사격: <b className="text-slate-300">L 키</b></span>
          </div>
          <div>
            <span>작전 프로토콜: <span className="text-indigo-400/80">SHADOW_SNIPER_V2</span></span>
          </div>
        </div>
      </div>

      {/* Quick Tactical Cooldown HUD Bottom Bar */}
      <div className="grid grid-cols-2 gap-4 w-full max-w-4xl mt-4">
        {/* Shooting cooldown bar */}
        <div className="bg-[#0f172a] border border-[#1e293b] rounded-xl p-4 flex flex-col justify-between shadow-lg">
          <div className="flex justify-between items-center mb-1.5">
            <span className="text-[11px] text-[#94a3b8] font-bold">L 키 - 저격 사격 (엄청난 사속)</span>
            <span className="text-xs font-mono text-amber-500 font-bold">
              {selfPlayer?.shootCooldownLeft > 0 ? `${(selfPlayer.shootCooldownLeft / 1000).toFixed(1)}s` : "대기 완료"}
            </span>
          </div>
          <div className="h-2.5 w-full bg-[#0b0f19] rounded-full overflow-hidden border border-[#1e293b]">
            <div
              className={`h-full rounded-full transition-all duration-75 ${
                selfPlayer?.shootCooldownLeft > 0 ? "bg-amber-500" : "bg-indigo-500"
              }`}
              style={{
                width: `${selfPlayer ? (1 - selfPlayer.shootCooldownLeft / 3000) * 100 : 100}%`,
              }}
            />
          </div>
        </div>

        {/* Dash cooldown bar */}
        <div className="bg-[#0f172a] border border-[#1e293b] rounded-xl p-4 flex flex-col justify-between shadow-lg">
          <div className="flex justify-between items-center mb-1.5">
            <span className="text-[11px] text-[#94a3b8] font-bold">Space - 회피 기동 대시 (위험 유발)</span>
            <span className="text-xs font-mono text-cyan-400 font-bold">
              {selfPlayer?.dashCooldownLeft > 0 ? `${(selfPlayer.dashCooldownLeft / 1000).toFixed(1)}s` : "대기 완료"}
            </span>
          </div>
          <div className="h-2.5 w-full bg-[#0b0f19] rounded-full overflow-hidden border border-[#1e293b]">
            <div
              className={`h-full rounded-full transition-all duration-75 ${
                selfPlayer?.dashCooldownLeft > 0 ? "bg-cyan-500" : "bg-indigo-500"
              }`}
              style={{
                width: `${selfPlayer ? (1 - selfPlayer.dashCooldownLeft / 1500) * 100 : 100}%`,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

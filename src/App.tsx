import React, { useEffect, useState, useRef } from "react";
import { 
  Crosshair, 
  User, 
  Users, 
  Compass, 
  Sparkles, 
  Copy, 
  Check, 
  ArrowRight, 
  Volume2, 
  VolumeX, 
  AlertTriangle,
  Info
} from "lucide-react";
import GameCanvas from "./components/GameCanvas";

export default function App() {
  const [gameState, setGameState] = useState<"lobby" | "connecting" | "waiting" | "playing" | "ended">("lobby");
  const [nickname, setNickname] = useState(() => {
    return localStorage.getItem("blind_sniper_nickname") || "";
  });
  const [roomIdInput, setRoomIdInput] = useState("");
  const [currentRoomId, setCurrentRoomId] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [players, setPlayers] = useState<any[]>([]);
  const [bullets, setBullets] = useState<any[]>([]);
  const [winnerId, setWinnerId] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [disconnectMessage, setDisconnectMessage] = useState("");
  
  const socketRef = useRef<WebSocket | null>(null);

  // Check URL query parameters for an invitation room code
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const inviteRoom = params.get("room");
    if (inviteRoom) {
      setRoomIdInput(inviteRoom.toUpperCase());
    }
  }, []);

  // Save nickname to localStorage
  const handleNicknameChange = (val: string) => {
    setNickname(val);
    localStorage.setItem("blind_sniper_nickname", val);
  };

  // Connect and join a room
  const handleJoinGame = (customRoomId?: string) => {
    if (!nickname.trim()) {
      alert("전술 스나이퍼 닉네임을 입력해 주십시오!");
      return;
    }

    setGameState("connecting");
    setDisconnectMessage("");

    // Determine secure or standard websocket protocol based on host
    const wsProto = window.location.protocol === "https:" ? "wss://" : "ws://";
    const wsUrl = `${wsProto}${window.location.host}`;
    
    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;

    ws.onopen = () => {
      console.log("[WS] Connected to tactical server");
      ws.send(JSON.stringify({
        type: "join",
        name: nickname.trim(),
        roomId: customRoomId ? customRoomId.toUpperCase() : undefined
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        console.log("[WS] Received message:", msg.type);

        switch (msg.type) {
          case "init":
            setPlayerId(msg.playerId);
            setCurrentRoomId(msg.roomId);
            // Replace browser URL path to match Room ID for easy copy/paste invites
            window.history.replaceState(null, "", `?room=${msg.roomId}`);
            break;

          case "waiting_for_opponent":
            setGameState("waiting");
            setPlayers(msg.players);
            break;

          case "start":
            setGameState("playing");
            setPlayers(msg.players);
            setBullets([]);
            break;

          case "state":
            setPlayers(msg.players);
            setBullets(msg.bullets);
            break;

          case "hit":
            // Managed inside GameCanvas for particles, here we can update local player stats
            if (msg.hp !== undefined) {
              setPlayers(prev => prev.map(p => p.id === msg.targetId ? { ...p, hp: msg.hp } : p));
            }
            break;

          case "round_over":
            setGameState("ended");
            setWinnerId(msg.winnerId);
            setPlayers(msg.players);
            break;

          case "round_started":
            setGameState("playing");
            setWinnerId(null);
            setBullets([]);
            // Sync initial states
            setPlayers(msg.players);
            break;

          case "opponent_disconnected":
            setGameState("waiting");
            setDisconnectMessage(msg.message);
            // Remove the second player
            setPlayers(prev => prev.filter(p => p.id === playerId));
            break;

          case "error":
            alert(msg.message);
            ws.close();
            setGameState("lobby");
            break;
        }
      } catch (err) {
        console.error("Error handling incoming WebSocket message:", err);
      }
    };

    ws.onclose = () => {
      console.log("[WS] Connection closed");
      setGameState("lobby");
      socketRef.current = null;
    };

    ws.onerror = (err) => {
      console.error("[WS] Connection error:", err);
      setGameState("lobby");
    };
  };

  const handleRestartRound = () => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "restart" }));
    }
  };

  const handleLeaveGame = () => {
    if (socketRef.current) {
      socketRef.current.close();
    }
    // Clear room query from URL
    window.history.replaceState(null, "", window.location.pathname);
    setGameState("lobby");
    setCurrentRoomId("");
  };

  const copyInviteLink = () => {
    const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${currentRoomId}`;
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    });
  };

  return (
    <div className="min-h-screen bg-[#0b0f19] text-[#e2e8f0] flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* Top Navigation Bar */}
      <header className="border-b border-[#1e293b] bg-[#0f172a] px-6 py-4 sticky top-0 z-50 shadow-2xl">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="h-10 w-10 rounded-xl bg-indigo-600/10 border border-[#334155] flex items-center justify-center text-indigo-400">
              <Crosshair className="h-6 w-6 animate-pulse" />
            </div>
            <div>
              <h1 className="text-lg font-black tracking-wider text-white flex items-center gap-2">
                그림자 저격수 <span className="text-[10px] bg-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded-full border border-indigo-500/30 font-mono">SHADOW SNIPER</span>
              </h1>
              <p className="text-[11px] text-[#64748b] font-mono tracking-widest uppercase">Blind Sniper — Psychological Tactical Shooter</p>
            </div>
          </div>

          {gameState !== "lobby" && (
            <button
              onClick={handleLeaveGame}
              className="px-4 py-1.5 bg-[#1e293b] hover:bg-rose-950/50 hover:text-rose-400 border border-[#334155] hover:border-rose-900 text-xs font-bold text-slate-300 rounded-lg transition-all active:scale-95 cursor-pointer"
            >
              대기실로 나가기 🚪
            </button>
          )}
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 flex flex-col items-center justify-center p-4 md:p-8 max-w-7xl w-full mx-auto">
        {gameState === "lobby" && (
          <div className="w-full max-w-4xl grid md:grid-cols-12 gap-8 my-auto items-center">
            {/* Left side: Game Info & Instructions */}
            <div className="md:col-span-7 space-y-6">
              <div className="space-y-2">
                <div className="inline-flex items-center space-x-2 bg-indigo-500/10 border border-[#334155] px-3 py-1 rounded-full">
                  <Sparkles className="h-3 w-3 text-indigo-400" />
                  <span className="text-[11px] font-bold text-indigo-400 tracking-wider">신개념 전술 잠입 심리 게임</span>
                </div>
                <h2 className="text-4xl font-extrabold text-white tracking-tight leading-tight">
                  상대방은 완전히 <span className="text-indigo-400 underline decoration-indigo-500/40">보이지 않습니다</span>.
                </h2>
                <p className="text-[#94a3b8] text-sm leading-relaxed">
                  보이지 않는 전장 속에서 상대 스나이퍼의 미세한 거동 흔적, 흙먼지 궤적, 소나 소리 파동을 분석하여 예측 헤드샷을 저격하십시오. 움직이는 순간 당신의 흔적도 상대에게 노출됩니다.
                </p>
              </div>

              {/* Game Rules Cards */}
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="bg-[#0f172a]/80 backdrop-blur-md border border-[#334155] p-4 rounded-xl space-y-2">
                  <div className="flex items-center space-x-2 text-indigo-400">
                    <Info className="h-4 w-4" />
                    <h3 className="text-xs font-bold uppercase tracking-wider">완전 스텔스 상태</h3>
                  </div>
                  <p className="text-xs text-[#94a3b8] leading-relaxed">
                    상대의 아바타는 기본적으로 <b>완전 투명</b>합니다. 오직 사격을 하거나, 탄환을 맞았을 때만 <b>0.5초</b> 동안 실체가 드러납니다.
                  </p>
                </div>

                <div className="bg-[#0f172a]/80 backdrop-blur-md border border-[#334155] p-4 rounded-xl space-y-2">
                  <div className="flex items-center space-x-2 text-cyan-400">
                    <Compass className="h-4 w-4" />
                    <h3 className="text-xs font-bold uppercase tracking-wider">궤적과 흔적 추적</h3>
                  </div>
                  <p className="text-xs text-[#94a3b8] leading-relaxed">
                    이동할 때 발밑에 <b>faint gray 흙먼지</b>가 흩날립니다. 대시(Space) 시 선명하고 강렬한 <b>붉은 네온 잔상</b>을 0.8초간 남깁니다.
                  </p>
                </div>

                <div className="bg-[#0f172a]/80 backdrop-blur-md border border-[#334155] p-4 rounded-xl space-y-2">
                  <div className="flex items-center space-x-2 text-rose-400">
                    <Crosshair className="h-4 w-4" />
                    <h3 className="text-xs font-bold uppercase tracking-wider">소나 소리 파동</h3>
                  </div>
                  <p className="text-xs text-[#94a3b8] leading-relaxed">
                    사격이나 대시 작동 시 발원지를 중심으로 <b>소나 사운드 링(Sonar Sound Ripples)</b>이 확장되어 사방으로 퍼집니다.
                  </p>
                </div>

                <div className="bg-[#0f172a]/80 backdrop-blur-md border border-[#334155] p-4 rounded-xl space-y-2">
                  <div className="flex items-center space-x-2 text-yellow-400">
                    <AlertTriangle className="h-4 w-4" />
                    <h3 className="text-xs font-bold uppercase tracking-wider">3 HP 저격전</h3>
                  </div>
                  <p className="text-xs text-[#94a3b8] leading-relaxed">
                    각 플레이어는 3 HP를 가집니다. L 키를 누르면 고속의 저격 탄환이 즉시 사격 방향으로 나아갑니다. 쿨타임은 <b>3초</b>입니다.
                  </p>
                </div>
              </div>
            </div>

            {/* Right side: Nickname Form & Room Controls */}
            <div className="md:col-span-5 bg-[#0f172a] border border-[#1e293b] p-6 rounded-2xl shadow-2xl space-y-6">
              <div className="space-y-1.5">
                <h3 className="text-lg font-bold text-white">작전 사령부 로그인</h3>
                <p className="text-xs text-[#94a3b8]">전장에 나설 정예 스나이퍼의 닉네임을 식별하십시오.</p>
              </div>

              {/* Nickname Input */}
              <div className="space-y-2">
                <label className="text-[11px] font-mono font-bold text-[#64748b] uppercase tracking-wider block">
                  스나이퍼 코드네임 (닉네임)
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-500">
                    <User className="h-4 w-4" />
                  </span>
                  <input
                    type="text"
                    maxLength={15}
                    value={nickname}
                    onChange={(e) => handleNicknameChange(e.target.value)}
                    placeholder="예: ShadowHawk"
                    className="w-full bg-[#0b0f19] border border-[#334155] focus:border-indigo-500 rounded-xl py-3 pl-10 pr-4 text-sm text-white placeholder-slate-600 focus:outline-none transition-all"
                  />
                </div>
              </div>

              <div className="h-[1px] bg-[#1e293b] my-2" />

              {/* Matchmaking controls */}
              <div className="space-y-4">
                <button
                  onClick={() => handleJoinGame()}
                  disabled={!nickname.trim()}
                  className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 text-white font-bold text-sm tracking-wide rounded-xl transition-all shadow-lg shadow-indigo-600/20 flex items-center justify-center space-x-2 active:scale-95 cursor-pointer"
                >
                  <Users className="h-4 w-4" />
                  <span>실시간 빠른 매치 입장 (자동 매칭)</span>
                  <ArrowRight className="h-4 w-4" />
                </button>

                <div className="flex items-center justify-center space-x-3 text-xs text-[#64748b]">
                  <span className="h-[1px] flex-1 bg-[#1e293b]" />
                  <span>또는 친구와 함께 대결하기</span>
                  <span className="h-[1px] flex-1 bg-[#1e293b]" />
                </div>

                <div className="flex space-x-2">
                  <input
                    type="text"
                    maxLength={4}
                    value={roomIdInput}
                    onChange={(e) => setRoomIdInput(e.target.value.toUpperCase())}
                    placeholder="방 코드 (예: ABCD)"
                    className="flex-1 bg-[#0b0f19] border border-[#334155] focus:border-indigo-500 rounded-xl py-3 px-4 text-sm text-white font-mono text-center placeholder-slate-600 focus:outline-none transition-all uppercase tracking-widest"
                  />
                  <button
                    onClick={() => handleJoinGame(roomIdInput)}
                    disabled={!nickname.trim() || !roomIdInput.trim()}
                    className="px-5 bg-[#1e293b] hover:bg-[#334155] disabled:opacity-50 disabled:hover:bg-[#1e293b] text-slate-200 font-bold text-xs rounded-xl transition-all border border-[#334155] hover:border-[#475569] active:scale-95 cursor-pointer"
                  >
                    방 참가
                  </button>
                </div>
              </div>

              {/* Share invite tip if room is set from URL */}
              {roomIdInput && (
                <div className="bg-indigo-500/5 border border-indigo-500/10 p-3.5 rounded-xl flex items-start space-x-2.5">
                  <Info className="h-4 w-4 text-indigo-400 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-[#94a3b8] leading-relaxed">
                    초대된 게임 방 코드 <b className="text-indigo-400 font-mono text-xs">{roomIdInput}</b>가 감지되었습니다. 닉네임을 적고 입장하시면 해당 세션으로 바로 참가합니다.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Connecting Screen */}
        {gameState === "connecting" && (
          <div className="text-center space-y-4 max-w-sm">
            <div className="relative h-16 w-16 mx-auto flex items-center justify-center">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-20"></span>
              <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500"></div>
            </div>
            <h3 className="text-lg font-bold text-white">안전한 전술 주파수 연결 중...</h3>
            <p className="text-xs text-[#94a3b8] leading-relaxed">
              사령부 서버의 암호화된 채널에 로그인 중입니다. 잠시만 기다려 주십시오.
            </p>
          </div>
        )}

        {/* Waiting for Opponent Screen */}
        {gameState === "waiting" && (
          <div className="w-full max-w-2xl bg-[#0f172a] border border-[#1e293b] rounded-2xl p-8 shadow-2xl text-center space-y-6">
            {/* Warning header */}
            {disconnectMessage && (
              <div className="bg-amber-500/10 border border-amber-500/20 p-3 rounded-xl text-xs text-amber-400 mb-2 max-w-lg mx-auto">
                ⚠️ {disconnectMessage}
              </div>
            )}

            <div className="space-y-2">
              <div className="h-14 w-14 bg-indigo-500/10 border border-[#334155] rounded-full flex items-center justify-center text-indigo-400 mx-auto">
                <Users className="h-7 w-7 animate-pulse" />
              </div>
              <h3 className="text-xl font-black text-white">상대 저격수 매칭 및 대기 중...</h3>
              <p className="text-xs text-[#94a3b8] max-w-md mx-auto">
                보이지 않는 가상 현실 시뮬레이션 매치가 완료되기 위해서는 두 명의 저격수가 필요합니다.
              </p>
            </div>

            {/* Room Code Showcase */}
            <div className="bg-[#0b0f19] border border-[#334155] rounded-xl p-4 max-w-md mx-auto space-y-2.5">
              <span className="text-[10px] text-[#64748b] font-mono font-bold tracking-widest uppercase block">
                전술 룸코드 공유 링크
              </span>
              <div className="flex items-center space-x-2 bg-[#0f172a] border border-[#334155] rounded-lg p-2.5">
                <span className="text-xs text-[#94a3b8] font-mono truncate flex-1 select-all text-left">
                  {window.location.origin}?room={currentRoomId}
                </span>
                <button
                  onClick={copyInviteLink}
                  className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[11px] rounded-md transition-all flex items-center space-x-1.5 active:scale-95 cursor-pointer"
                >
                  {isCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{isCopied ? "복사됨!" : "링크 복사"}</span>
                </button>
              </div>
              <p className="text-[10px] text-[#64748b] leading-relaxed text-left">
                💡 친구에게 이 링크를 보내거나 다른 브라우저 탭에서 링크를 열어 혼자서 두 플레이어로 바로 전투 테스트를 해보실 수 있습니다!
              </p>
            </div>

            {/* Connected players list */}
            <div className="space-y-2.5 max-w-sm mx-auto">
              <h4 className="text-[11px] font-mono text-[#64748b] font-bold uppercase tracking-wider text-left">
                현재 전술실에 접속한 스나이퍼 ({players.length}/2)
              </h4>
              <div className="space-y-1.5">
                {players.map((p, idx) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between bg-[#0b0f19] border border-[#334155] rounded-lg px-4 py-2 text-xs"
                  >
                    <span className="flex items-center space-x-2">
                      <span className="h-2 w-2 rounded-full bg-indigo-500" />
                      <span className="font-bold text-slate-200">{p.name}</span>
                      {p.id === playerId && <span className="text-[9px] text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded-full border border-indigo-500/20 font-bold">나</span>}
                    </span>
                    <span className="text-[#64748b] font-mono">참가 승인됨</span>
                  </div>
                ))}
                {players.length < 2 && (
                  <div className="bg-[#0b0f19] border border-dashed border-[#334155] rounded-lg px-4 py-2 text-xs text-slate-600 text-left animate-pulse">
                    상대 저격수 참여 대기 중...
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Live game board section */}
        {(gameState === "playing" || gameState === "ended") && (
          <div className="w-full flex justify-center">
            <GameCanvas
              socket={socketRef.current!}
              playerId={playerId}
              roomId={currentRoomId}
              playersData={players}
              bulletsData={bullets}
              gameStatus={gameState}
              winnerId={winnerId}
              onRestart={handleRestartRound}
            />
          </div>
        )}
      </main>

      {/* Footer copyright */}
      <footer className="border-t border-[#1e293b] py-6 px-6 text-center text-xs text-[#475569] bg-[#020617]">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 font-mono">
          <p>SHADOW SNIPER V.2.0.4-TACTICAL © 2026 그림자 저격수. All operations authorized.</p>
          <div className="flex gap-4">
            <span className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div> SERVER CONNECTED
            </span>
            <span>PING: 14MS</span>
            <span>PORT: 3000</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

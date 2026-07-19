import { useState } from "react";
import { useGame } from "./net/useGame";

export function App() {
  const game = useGame();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const inRoom = game.status === "connected" || game.status === "connecting";
  const me = game.snapshot.players.find((p) => p.id === game.mySessionId);
  const isHost = game.snapshot.hostId === game.mySessionId;

  if (!inRoom) {
    return (
      <div className="wrap">
        <h1>🎲 Монополия</h1>
        <input placeholder="Твоё имя" value={name} onChange={(e) => setName(e.target.value)} />
        <button disabled={!name.trim()} onClick={() => game.createGame(name.trim(), `Игра ${name.trim()}`, false)}>
          ➕ Создать лобби
        </button>
        <div className="row">
          <input placeholder="Код лобби" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
          <button disabled={!name.trim() || !code.trim()} onClick={() => game.joinByCode(code.trim(), name.trim())}>
            🔍 Войти
          </button>
        </div>
        {game.error ? <p className="err">{game.error}</p> : null}
      </div>
    );
  }

  return (
    <div className="wrap">
      <h1>{game.snapshot.lobbyName || "Лобби"}</h1>
      <p>код: {game.snapshot.code}</p>
      <p>{game.snapshot.players.length} из {game.snapshot.maxPlayers}</p>
      <button onClick={game.leave}>Выйти</button>
      <ul>
        {game.snapshot.players.map((p) => (
          <li key={p.id}>
            {p.id === game.snapshot.hostId ? "👑 " : ""}
            {p.name} {p.id === game.mySessionId ? "(ты)" : ""} — {p.ready ? "✓ готов" : "не готов"}
          </li>
        ))}
      </ul>
      {game.snapshot.phase === "lobby" && (
        <>
          <button onClick={() => game.setReady(!me?.ready)}>{me?.ready ? "Я не готов" : "Я готов"}</button>
          {isHost && <button onClick={game.startGame}>НАЧАТЬ</button>}
        </>
      )}
      {game.snapshot.phase === "countdown" && <p>Старт через мгновение…</p>}
      {game.snapshot.phase === "playing" && <p>🎲 Игра скоро тут будет (Фаза 1)</p>}
    </div>
  );
}

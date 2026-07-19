import { useState } from "react";
import { useGame } from "./net/useGame";
import { Board } from "./Board";

export function App() {
  const game = useGame();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const inRoom = game.status === "connected" || game.status === "connecting";
  const me = game.snapshot.players.find((p) => p.id === game.mySessionId);
  const isHost = game.snapshot.hostId === game.mySessionId;
  const inGame = game.snapshot.phase === "playing" || game.snapshot.phase === "game_over";

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

  if (inGame) {
    return (
      <div className="gameWrap">
        <button className="leaveBtn" onClick={game.leave}>Выйти</button>
        <Board
          players={game.snapshot.players}
          properties={game.snapshot.properties}
          currentPlayerId={game.snapshot.currentPlayerId}
          mySessionId={game.mySessionId}
          dice1={game.snapshot.dice1}
          dice2={game.snapshot.dice2}
          awaitingBuyTileId={game.snapshot.awaitingBuyTileId}
          phase={game.snapshot.phase}
          winnerId={game.snapshot.winnerId}
          onRoll={game.rollDice}
          onBuy={game.buyProperty}
          onDecline={game.declineBuy}
          onEndTurn={game.endTurn}
        />
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
    </div>
  );
}

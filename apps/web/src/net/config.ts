// В деве бьём в локальный сервер, в проде — сервер раздаёт и веб, значит свой origin.
const isDev = import.meta.env.DEV;

export const SERVER_ENDPOINT = isDev
  ? "ws://localhost:2567"
  : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;

export const TOKEN_BASE = isDev ? "http://localhost:2567" : location.origin;

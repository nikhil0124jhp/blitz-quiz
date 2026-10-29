"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const HOST = process.env.HOST || "0.0.0.0";
const QUESTION_DURATION_MS = 8_000;
const OPENING_COUNTDOWN_MS = 3_000;
const BETWEEN_ROUND_MS = 2_200;
const REVEAL_DURATION_MS = 3_500;
const NORMAL_ROUNDS = 10;
const MAX_PLAYERS = 8;
const ROOM_TTL_MS = 2 * 60 * 60 * 1_000;

const STATIC_FILES = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
  "/styles.css": { file: "styles.css", type: "text/css; charset=utf-8" },
  "/app.js": { file: "app.js", type: "application/javascript; charset=utf-8" },
};

const QUESTIONS = [
  { id: "red-planet", text: "Which planet is known as the Red Planet?", choices: ["Venus", "Mars", "Jupiter", "Mercury"], correctIndex: 1 },
  { id: "gold-symbol", text: "What is the chemical symbol for gold?", choices: ["Ag", "Au", "Gd", "Go"], correctIndex: 1 },
  { id: "largest-ocean", text: "What is the largest ocean on Earth?", choices: ["Atlantic Ocean", "Indian Ocean", "Pacific Ocean", "Arctic Ocean"], correctIndex: 2 },
  { id: "piano-keys", text: "Which instrument traditionally has 88 keys?", choices: ["Violin", "Piano", "Flute", "Trumpet"], correctIndex: 1 },
  { id: "hexagon-sides", text: "How many sides does a hexagon have?", choices: ["5", "6", "7", "8"], correctIndex: 1 },
  { id: "japan-capital", text: "What is the capital of Japan?", choices: ["Kyoto", "Seoul", "Tokyo", "Osaka"], correctIndex: 2 },
  { id: "largest-mammal", text: "What is the largest mammal in the world?", choices: ["African elephant", "Blue whale", "Giraffe", "Orca"], correctIndex: 1 },
  { id: "pride-prejudice", text: "Who wrote Pride and Prejudice?", choices: ["Jane Austen", "Charlotte Brontë", "Virginia Woolf", "Mary Shelley"], correctIndex: 0 },
  { id: "plants-gas", text: "Which gas do plants absorb from the air?", choices: ["Oxygen", "Nitrogen", "Carbon dioxide", "Helium"], correctIndex: 2 },
  { id: "brazil-language", text: "What is the official language of Brazil?", choices: ["Spanish", "Portuguese", "French", "Italian"], correctIndex: 1 },
  { id: "nine-times-seven", text: "What is 9 × 7?", choices: ["56", "63", "72", "81"], correctIndex: 1 },
  { id: "shuttlecock", text: "Which sport uses a shuttlecock?", choices: ["Tennis", "Squash", "Badminton", "Table tennis"], correctIndex: 2 },
  { id: "binary-digits", text: "Which two digits are used in binary?", choices: ["0 and 1", "1 and 2", "0 and 9", "2 and 8"], correctIndex: 0 },
  { id: "saturn-rings", text: "Which planet is famous for its rings?", choices: ["Mars", "Saturn", "Neptune", "Earth"], correctIndex: 1 },
  { id: "freezing-water", text: "At what temperature does water freeze in Celsius?", choices: ["0°C", "10°C", "32°C", "100°C"], correctIndex: 0 },
  { id: "india-continent", text: "On which continent is India located?", choices: ["Europe", "Africa", "Asia", "Australia"], correctIndex: 2 },
  { id: "human-heart", text: "How many chambers does a human heart have?", choices: ["2", "3", "4", "5"], correctIndex: 2 },
  { id: "rainbow-colours", text: "How many colours are traditionally in a rainbow?", choices: ["5", "6", "7", "8"], correctIndex: 2 },
  { id: "author-hamlet", text: "Who wrote Hamlet?", choices: ["Charles Dickens", "William Shakespeare", "Mark Twain", "Oscar Wilde"], correctIndex: 1 },
  { id: "fastest-land-animal", text: "What is the fastest land animal?", choices: ["Cheetah", "Horse", "Greyhound", "Lion"], correctIndex: 0 },
  { id: "primary-colour", text: "Which of these is a primary colour in light?", choices: ["Green", "Purple", "Orange", "Brown"], correctIndex: 0 },
  { id: "eiffel-location", text: "The Eiffel Tower is in which city?", choices: ["Rome", "Paris", "Barcelona", "Vienna"], correctIndex: 1 },
  { id: "longest-river", text: "Which river flows through Egypt?", choices: ["Amazon", "Nile", "Danube", "Yangtze"], correctIndex: 1 },
  { id: "solar-system-star", text: "What is the star at the centre of our solar system?", choices: ["Polaris", "Sirius", "The Sun", "Betelgeuse"], correctIndex: 2 },
  { id: "triangles", text: "How many sides does a triangle have?", choices: ["2", "3", "4", "5"], correctIndex: 1 },
  { id: "tallest-mountain", text: "What is the tallest mountain above sea level?", choices: ["K2", "Kangchenjunga", "Mount Everest", "Denali"], correctIndex: 2 },
  { id: "currency-japan", text: "What currency is used in Japan?", choices: ["Won", "Yen", "Yuan", "Baht"], correctIndex: 1 },
  { id: "paint-mona-lisa", text: "Who painted the Mona Lisa?", choices: ["Vincent van Gogh", "Pablo Picasso", "Leonardo da Vinci", "Claude Monet"], correctIndex: 2 },
];

const rooms = new Map();

function shuffled(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function createRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function sanitizeName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ").slice(0, 18);
  if (!name) throw new HttpError(400, "Please enter a nickname.");
  return name;
}

function sanitizePlayerId(value) {
  const playerId = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(playerId)) {
    throw new HttpError(400, "Your player session is invalid. Refresh and try again.");
  }
  return playerId;
}

function makeRoom(hostId, hostName) {
  const code = createRoomCode();
  const room = {
    code,
    hostId,
    players: new Map([[hostId, { id: hostId, name: hostName, ready: false, score: 0 }]]),
    connections: new Set(),
    phase: "lobby",
    phaseEndsAt: null,
    timer: null,
    timerToken: 0,
    questions: [],
    usedQuestionIds: new Set(),
    questionIndex: -1,
    currentQuestion: null,
    currentRoundId: null,
    isTiebreak: false,
    tiebreakPlayerIds: [],
    answers: new Map(),
    lastRoundResults: [],
    winnerId: null,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

function clearRoomTimer(room) {
  if (room.timer) clearTimeout(room.timer);
  room.timer = null;
  room.timerToken += 1;
}

function schedule(room, delay, action) {
  clearRoomTimer(room);
  const token = room.timerToken;
  room.timer = setTimeout(() => {
    if (room.timerToken !== token) return;
    room.timer = null;
    action();
  }, Math.max(0, delay));
}

function getEligiblePlayerIds(room) {
  return room.isTiebreak ? room.tiebreakPlayerIds : [...room.players.keys()];
}

function publicPlayer(room, player) {
  return {
    id: player.id,
    name: player.name,
    ready: player.ready,
    score: player.score,
    answerSubmitted: room.answers.has(player.id),
  };
}

function serializeRoom(room, viewerId) {
  const now = Date.now();
  const showReveal = room.phase === "reveal" || room.phase === "final";
  const currentQuestion = room.currentQuestion
    ? {
        text: room.currentQuestion.text,
        choices: room.currentQuestion.choices,
        ...(showReveal ? { correctIndex: room.currentQuestion.correctIndex } : {}),
      }
    : null;

  return {
    code: room.code,
    phase: room.phase,
    phaseEndsAt: room.phaseEndsAt,
    countdownKind: room.countdownKind || null,
    serverNow: now,
    hostId: room.hostId,
    playerCount: room.players.size,
    totalRounds: NORMAL_ROUNDS,
    roundNumber: room.isTiebreak ? null : Math.max(0, room.questionIndex + 1),
    isTiebreak: room.isTiebreak,
    tiebreakPlayerIds: room.tiebreakPlayerIds,
    currentRoundId: room.currentRoundId,
    currentQuestion,
    answerCount: room.answers.size,
    eligiblePlayerIds: getEligiblePlayerIds(room),
    yourAnswerIndex: room.answers.get(viewerId)?.choiceIndex ?? null,
    players: [...room.players.values()].map((player) => publicPlayer(room, player)),
    lastRoundResults: showReveal ? room.lastRoundResults : [],
    winnerId: room.winnerId,
    allReady: room.players.size >= 2 && [...room.players.values()].every((player) => player.ready),
  };
}

function writeState(connection, room) {
  if (connection.res.writableEnded) return;
  const payload = JSON.stringify(serializeRoom(room, connection.playerId));
  connection.res.write(`event: state\ndata: ${payload}\n\n`);
}

function broadcast(room) {
  room.lastActivityAt = Date.now();
  for (const connection of room.connections) writeState(connection, room);
}

function beginCountdown(room, kind) {
  const duration = kind === "opening" ? OPENING_COUNTDOWN_MS : BETWEEN_ROUND_MS;
  room.phase = "countdown";
  room.phaseEndsAt = Date.now() + duration;
  room.currentQuestion = null;
  room.currentRoundId = null;
  room.answers = new Map();
  room.lastRoundResults = [];
  room.countdownKind = kind;
  broadcast(room);
  schedule(room, duration, () => {
    if (kind === "tiebreak") startTiebreakQuestion(room);
    else startNormalQuestion(room);
  });
}

function startGame(room) {
  room.questions = shuffled(QUESTIONS).slice(0, NORMAL_ROUNDS);
  room.usedQuestionIds = new Set(room.questions.map((question) => question.id));
  room.questionIndex = -1;
  room.isTiebreak = false;
  room.tiebreakPlayerIds = [];
  room.winnerId = null;
  room.currentQuestion = null;
  room.lastRoundResults = [];
  for (const player of room.players.values()) player.score = 0;
  beginCountdown(room, "opening");
}

function startNormalQuestion(room) {
  room.isTiebreak = false;
  room.questionIndex += 1;
  room.currentQuestion = room.questions[room.questionIndex];
  openQuestion(room);
}

function chooseTiebreakQuestion(room) {
  const unused = QUESTIONS.filter((question) => !room.usedQuestionIds.has(question.id));
  const candidates = unused.length ? unused : QUESTIONS;
  const question = candidates[Math.floor(Math.random() * candidates.length)];
  room.usedQuestionIds.add(question.id);
  return question;
}

function startTiebreakQuestion(room) {
  room.isTiebreak = true;
  room.currentQuestion = chooseTiebreakQuestion(room);
  openQuestion(room);
}

function openQuestion(room) {
  room.phase = "question";
  room.answers = new Map();
  room.lastRoundResults = [];
  room.currentRoundId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  room.questionStartedAt = Date.now();
  room.phaseEndsAt = room.questionStartedAt + QUESTION_DURATION_MS;
  broadcast(room);
  schedule(room, QUESTION_DURATION_MS, () => closeQuestion(room));
}

function normalRoundResults(room) {
  return [...room.players.values()].map((player) => {
    const answer = room.answers.get(player.id);
    const isCorrect = Boolean(answer && answer.choiceIndex === room.currentQuestion.correctIndex);
    let points = 0;
    if (isCorrect) {
      const elapsed = Math.max(0, Math.min(QUESTION_DURATION_MS, answer.submittedAt - room.questionStartedAt));
      const speedPoints = Math.round(500 * (1 - elapsed / QUESTION_DURATION_MS));
      points = 500 + speedPoints;
      player.score += points;
    }
    return {
      playerId: player.id,
      choiceIndex: answer?.choiceIndex ?? null,
      isCorrect,
      points,
    };
  });
}

function finishWithWinner(room, winnerId) {
  clearRoomTimer(room);
  room.phase = "final";
  room.phaseEndsAt = null;
  room.winnerId = winnerId;
  broadcast(room);
}

function startTiebreak(room) {
  const highestScore = Math.max(...[...room.players.values()].map((player) => player.score));
  room.tiebreakPlayerIds = [...room.players.values()]
    .filter((player) => player.score === highestScore)
    .map((player) => player.id);
  room.isTiebreak = true;
  beginCountdown(room, "tiebreak");
}

function afterReveal(room) {
  if (room.isTiebreak) {
    const firstCorrect = room.lastRoundResults
      .filter((result) => result.isCorrect)
      .sort((a, b) => a.submittedAt - b.submittedAt)[0];
    if (firstCorrect) finishWithWinner(room, firstCorrect.playerId);
    else beginCountdown(room, "tiebreak");
    return;
  }

  if (room.questionIndex + 1 < NORMAL_ROUNDS) {
    beginCountdown(room, "next");
    return;
  }

  const players = [...room.players.values()];
  const highestScore = Math.max(...players.map((player) => player.score));
  const leaders = players.filter((player) => player.score === highestScore);
  if (leaders.length === 1) finishWithWinner(room, leaders[0].id);
  else startTiebreak(room);
}

function closeQuestion(room) {
  if (room.phase !== "question" || !room.currentQuestion) return;
  clearRoomTimer(room);
  const eligibleIds = getEligiblePlayerIds(room);
  let results;

  if (room.isTiebreak) {
    results = eligibleIds.map((playerId) => {
      const answer = room.answers.get(playerId);
      return {
        playerId,
        choiceIndex: answer?.choiceIndex ?? null,
        isCorrect: Boolean(answer && answer.choiceIndex === room.currentQuestion.correctIndex),
        points: 0,
        submittedAt: answer?.submittedAt ?? Number.MAX_SAFE_INTEGER,
      };
    });
  } else {
    results = normalRoundResults(room).map((result) => ({ ...result, submittedAt: room.answers.get(result.playerId)?.submittedAt ?? Number.MAX_SAFE_INTEGER }));
  }

  room.lastRoundResults = results;
  room.phase = "reveal";
  room.phaseEndsAt = Date.now() + REVEAL_DURATION_MS;
  broadcast(room);
  schedule(room, REVEAL_DURATION_MS, () => afterReveal(room));
}

function recordAnswer(room, playerId, choiceIndex, roundId) {
  if (room.phase !== "question") throw new HttpError(409, "Wait for the next question.");
  if (roundId !== room.currentRoundId) throw new HttpError(409, "That question has already moved on.");
  if (!getEligiblePlayerIds(room).includes(playerId)) throw new HttpError(403, "You are spectating this sudden-death question.");
  if (!Number.isInteger(choiceIndex) || choiceIndex < 0 || choiceIndex > 3) throw new HttpError(400, "Choose one of the four answers.");
  if (room.answers.has(playerId)) throw new HttpError(409, "Your answer is already locked in.");

  room.answers.set(playerId, { choiceIndex, submittedAt: Date.now() });
  broadcast(room);
  if (room.answers.size >= getEligiblePlayerIds(room).length) closeQuestion(room);
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function sendError(res, error) {
  const status = error instanceof HttpError ? error.status : 500;
  const message = error instanceof HttpError ? error.message : "Something went wrong on the game server.";
  if (status === 500) console.error(error);
  sendJson(res, status, { error: message });
}

function findRoom(code) {
  const room = rooms.get(String(code || "").toUpperCase());
  if (!room) throw new HttpError(404, "That room code does not exist.");
  room.lastActivityAt = Date.now();
  return room;
}

function requirePlayer(room, rawPlayerId) {
  const playerId = sanitizePlayerId(rawPlayerId);
  const player = room.players.get(playerId);
  if (!player) throw new HttpError(403, "You are not in this room. Join it first.");
  return { playerId, player };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 20_000) reject(new HttpError(413, "That request is too large."));
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new HttpError(400, "Please try that again."));
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(res, pathname) {
  const item = STATIC_FILES[pathname];
  if (!item) throw new HttpError(404, "Not found.");
  const filePath = path.join(__dirname, "public", item.file);
  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendError(res, error);
      return;
    }
    res.writeHead(200, { "Content-Type": item.type, "Cache-Control": "no-store" });
    res.end(data);
  });
}

function attachEventStream(req, res, room, playerId) {
  requirePlayer(room, playerId);
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 1500\n\n");
  const connection = { res, playerId };
  room.connections.add(connection);
  writeState(connection, room);
  const keepAlive = setInterval(() => {
    if (!res.writableEnded) res.write(": keepalive\n\n");
  }, 20_000);
  req.on("close", () => {
    clearInterval(keepAlive);
    room.connections.delete(connection);
  });
}

function routeMatch(pathname, pattern) {
  const match = pathname.match(pattern);
  return match ? decodeURIComponent(match[1]) : null;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    if (req.method === "GET" && (pathname === "/healthz" || pathname === "/health")) {
      sendJson(res, 200, { status: "ok" });
      return;
    }

    if (req.method === "GET" && STATIC_FILES[pathname]) {
      serveStatic(res, pathname);
      return;
    }

    if (req.method === "POST" && pathname === "/api/rooms") {
      const body = await readJson(req);
      const playerId = sanitizePlayerId(body.playerId);
      const name = sanitizeName(body.name);
      const room = makeRoom(playerId, name);
      sendJson(res, 201, { code: room.code, state: serializeRoom(room, playerId) });
      return;
    }

    const roomCode = routeMatch(pathname, /^\/api\/rooms\/([^/]+)\/(?:join|ready|start|answer|events|state)$/);
    if (roomCode) {
      const room = findRoom(roomCode);

      if (req.method === "POST" && pathname.endsWith("/join")) {
        const body = await readJson(req);
        const playerId = sanitizePlayerId(body.playerId);
        const name = sanitizeName(body.name);
        const existing = room.players.get(playerId);
        if (existing) {
          if (room.phase === "lobby") existing.name = name;
        } else {
          if (room.phase !== "lobby") throw new HttpError(409, "This match has already started.");
          if (room.players.size >= MAX_PLAYERS) throw new HttpError(409, "This room is full.");
          room.players.set(playerId, { id: playerId, name, ready: false, score: 0 });
        }
        broadcast(room);
        sendJson(res, 200, { code: room.code, state: serializeRoom(room, playerId) });
        return;
      }

      if (req.method === "GET" && pathname.endsWith("/events")) {
        attachEventStream(req, res, room, url.searchParams.get("playerId"));
        return;
      }

      if (req.method === "GET" && pathname.endsWith("/state")) {
        const { playerId } = requirePlayer(room, url.searchParams.get("playerId"));
        sendJson(res, 200, { state: serializeRoom(room, playerId) });
        return;
      }

      if (req.method === "POST" && pathname.endsWith("/ready")) {
        const body = await readJson(req);
        const { player } = requirePlayer(room, body.playerId);
        if (room.phase !== "lobby") throw new HttpError(409, "The game has already started.");
        player.ready = Boolean(body.ready);
        broadcast(room);
        sendJson(res, 200, { state: serializeRoom(room, player.id) });
        return;
      }

      if (req.method === "POST" && pathname.endsWith("/start")) {
        const body = await readJson(req);
        const { playerId } = requirePlayer(room, body.playerId);
        if (room.hostId !== playerId) throw new HttpError(403, "Only the room host can start the match.");
        if (room.phase !== "lobby") throw new HttpError(409, "This match is already underway.");
        if (room.players.size < 2) throw new HttpError(409, "You need at least two players.");
        if (![...room.players.values()].every((player) => player.ready)) {
          throw new HttpError(409, "Everyone needs to be ready before the match starts.");
        }
        startGame(room);
        sendJson(res, 200, { state: serializeRoom(room, playerId) });
        return;
      }

      if (req.method === "POST" && pathname.endsWith("/answer")) {
        const body = await readJson(req);
        const { playerId } = requirePlayer(room, body.playerId);
        recordAnswer(room, playerId, body.choiceIndex, body.roundId);
        sendJson(res, 200, { state: serializeRoom(room, playerId) });
        return;
      }
    }

    throw new HttpError(404, "Not found.");
  } catch (error) {
    sendError(res, error);
  }
});

setInterval(() => {
  const cutoff = Date.now() - ROOM_TTL_MS;
  for (const [code, room] of rooms) {
    if (room.connections.size === 0 && room.lastActivityAt < cutoff) {
      clearRoomTimer(room);
      rooms.delete(code);
    }
  }
}, 5 * 60 * 1_000).unref();

server.listen(PORT, HOST, () => {
  console.log(`Blitz Quiz is running on http://${HOST}:${PORT}`);
});

function gracefulShutdown(signal) {
  console.log(`Received ${signal}. Gracefully shutting down Blitz Quiz server...`);
  server.close(() => {
    console.log("HTTP server closed.");
    process.exit(0);
  });
  setTimeout(() => {
    console.error("Forced shutdown after timeout.");
    process.exit(1);
  }, 5_000).unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

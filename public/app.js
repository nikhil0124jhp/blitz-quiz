const welcomeScreen = document.querySelector("#welcome-screen");
const gameScreen = document.querySelector("#game-screen");
const createForm = document.querySelector("#create-form");
const joinForm = document.querySelector("#join-form");
const createNameInput = document.querySelector("#create-name");
const joinNameInput = document.querySelector("#join-name");
const roomCodeInput = document.querySelector("#room-code");
const roomCodeDisplay = document.querySelector("#room-code-display");
const lobbyCodeDisplay = document.querySelector("#lobby-code-display");
const copyCodeButton = document.querySelector("#copy-code-button");
const leaveRoomButton = document.querySelector("#leave-room-button");
const connectionStatus = document.querySelector("#connection-status");
const lobbyStage = document.querySelector("#lobby-stage");
const countdownStage = document.querySelector("#countdown-stage");
const questionStage = document.querySelector("#question-stage");
const revealStage = document.querySelector("#reveal-stage");
const finalStage = document.querySelector("#final-stage");
const readyButton = document.querySelector("#ready-button");
const startButton = document.querySelector("#start-button");
const lobbyHelp = document.querySelector("#lobby-help");
const countdownEyebrow = document.querySelector("#countdown-eyebrow");
const countdownNumber = document.querySelector("#countdown-number");
const countdownTitle = document.querySelector("#countdown-title");
const roundLabel = document.querySelector("#round-label");
const answerCount = document.querySelector("#answer-count");
const timerNumber = document.querySelector("#timer-number");
const timerFill = document.querySelector("#timer-fill");
const questionText = document.querySelector("#question-text");
const answers = document.querySelector("#answers");
const answerStatus = document.querySelector("#answer-status");
const revealEyebrow = document.querySelector("#reveal-eyebrow");
const revealTitle = document.querySelector("#reveal-title");
const correctAnswer = document.querySelector("#correct-answer");
const roundOutcome = document.querySelector("#round-outcome");
const nextUp = document.querySelector("#next-up");
const winnerName = document.querySelector("#winner-name");
const winnerCopy = document.querySelector("#winner-copy");
const newRoomButton = document.querySelector("#new-room-button");
const playerCount = document.querySelector("#player-count");
const leaderboard = document.querySelector("#leaderboard");
const toast = document.querySelector("#toast");

const SESSION_KEY = "blitz-quiz-session-v1";
const playerId = getOrCreatePlayerId();
let session = readSession();
let gameState = null;
let serverOffset = 0;
let eventSource = null;
let submittingAnswer = false;
let toastTimeout = null;

function getOrCreatePlayerId() {
  const key = "blitz-quiz-player-id-v1";
  let id = localStorage.getItem(key);
  if (!id) {
    id = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replaceAll("-", "")
      : `${Date.now()}${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(key, id);
  }
  return id;
}

function readSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

function saveSession(nextSession) {
  session = nextSession;
  localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
}

function clearSession() {
  session = null;
  localStorage.removeItem(SESSION_KEY);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Something went wrong. Please try again.");
  return payload;
}

function showToast(message) {
  clearTimeout(toastTimeout);
  toast.textContent = message;
  toast.classList.remove("is-hidden");
  toastTimeout = setTimeout(() => toast.classList.add("is-hidden"), 3_800);
}

function setConnection(message, live = false) {
  connectionStatus.textContent = message;
  connectionStatus.classList.toggle("is-live", live);
}

function setState(nextState) {
  gameState = nextState;
  serverOffset = Number(nextState.serverNow || Date.now()) - Date.now();
  submittingAnswer = false;
  render();
}

function showGame() {
  welcomeScreen.classList.add("is-hidden");
  gameScreen.classList.remove("is-hidden");
}

function showWelcome() {
  gameScreen.classList.add("is-hidden");
  welcomeScreen.classList.remove("is-hidden");
}

function openEventStream() {
  if (!session) return;
  eventSource?.close();
  setConnection("Connecting to room…");
  eventSource = new EventSource(`/api/rooms/${encodeURIComponent(session.code)}/events?playerId=${encodeURIComponent(playerId)}`);
  eventSource.addEventListener("state", (event) => {
    setConnection("Live and synchronized", true);
    setState(JSON.parse(event.data));
  });
  eventSource.onopen = () => setConnection("Live and synchronized", true);
  eventSource.onerror = () => setConnection("Trying to reconnect…");
}

async function enterRoom(code, name, initialState) {
  saveSession({ code, name });
  showGame();
  if (initialState) setState(initialState);
  openEventStream();
}

async function restoreRoom() {
  if (!session?.code) return;
  showGame();
  setConnection("Restoring your room…");
  try {
    const payload = await api(`/api/rooms/${encodeURIComponent(session.code)}/state?playerId=${encodeURIComponent(playerId)}`);
    setState(payload.state);
    openEventStream();
  } catch {
    clearSession();
    showWelcome();
  }
}

createForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = createNameInput.value.trim();
  if (!name) return;
  const button = createForm.querySelector("button");
  button.disabled = true;
  try {
    const payload = await api("/api/rooms", { method: "POST", body: { playerId, name } });
    await enterRoom(payload.code, name, payload.state);
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
});

joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = joinNameInput.value.trim();
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!name || !code) return;
  const button = joinForm.querySelector("button");
  button.disabled = true;
  try {
    const payload = await api(`/api/rooms/${encodeURIComponent(code)}/join`, { method: "POST", body: { playerId, name } });
    await enterRoom(payload.code, name, payload.state);
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
});

readyButton.addEventListener("click", async () => {
  if (!session || !gameState) return;
  const me = getMe();
  try {
    await api(`/api/rooms/${encodeURIComponent(session.code)}/ready`, { method: "POST", body: { playerId, ready: !me.ready } });
  } catch (error) {
    showToast(error.message);
  }
});

startButton.addEventListener("click", async () => {
  if (!session) return;
  startButton.disabled = true;
  try {
    await api(`/api/rooms/${encodeURIComponent(session.code)}/start`, { method: "POST", body: { playerId } });
  } catch (error) {
    showToast(error.message);
    startButton.disabled = false;
  }
});

copyCodeButton.addEventListener("click", async () => {
  if (!gameState?.code) return;
  try {
    await navigator.clipboard.writeText(gameState.code);
    showToast("Room code copied.");
  } catch {
    showToast(`Room code: ${gameState.code}`);
  }
});

leaveRoomButton.addEventListener("click", leaveRoom);
newRoomButton.addEventListener("click", leaveRoom);

function leaveRoom() {
  eventSource?.close();
  eventSource = null;
  clearSession();
  gameState = null;
  showWelcome();
  setConnection("Connecting to room…");
}

function getMe() {
  return gameState?.players.find((player) => player.id === playerId);
}

function getPlayer(playerIdToFind) {
  return gameState?.players.find((player) => player.id === playerIdToFind);
}

function isEligible() {
  return Boolean(gameState?.eligiblePlayerIds?.includes(playerId));
}

function switchStage(activeStage) {
  [lobbyStage, countdownStage, questionStage, revealStage, finalStage].forEach((stage) => {
    stage.classList.toggle("is-hidden", stage !== activeStage);
  });
}

function renderLeaderboard() {
  if (!gameState) return;
  playerCount.textContent = `${gameState.playerCount} player${gameState.playerCount === 1 ? "" : "s"}`;
  const orderedPlayers = [...gameState.players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  leaderboard.replaceChildren(...orderedPlayers.map((player, index) => {
    const item = document.createElement("li");
    if (player.id === playerId) item.classList.add("is-me");
    const meta = gameState.phase === "lobby"
      ? `<span class="ready-dot ${player.ready ? "is-ready" : ""}"></span>${player.ready ? "Ready" : "Waiting"}`
      : player.answerSubmitted && gameState.phase === "question" ? "Answer locked" : "";
    item.innerHTML = `<span class="rank">${index + 1}</span><span class="leader-name"></span><strong class="leader-score">${player.score.toLocaleString()}</strong>`;
    const name = item.querySelector(".leader-name");
    name.textContent = player.name + (player.id === gameState.hostId ? " · host" : "");
    if (meta) {
      const sub = document.createElement("span");
      sub.className = "leader-sub";
      if (gameState.phase === "lobby") sub.innerHTML = meta;
      else sub.textContent = meta;
      name.append(sub);
    }
    return item;
  }));
}

function renderLobby() {
  const me = getMe();
  const isHost = gameState.hostId === playerId;
  switchStage(lobbyStage);
  lobbyCodeDisplay.textContent = gameState.code;
  readyButton.textContent = me?.ready ? "Not ready yet" : "I’m ready";
  readyButton.classList.toggle("secondary-button", Boolean(me?.ready));
  readyButton.classList.toggle("primary-button", !me?.ready);
  startButton.classList.toggle("is-hidden", !isHost);
  startButton.disabled = !gameState.allReady;
  if (isHost) {
    lobbyHelp.textContent = gameState.allReady
      ? "Everyone is ready — start when you are."
      : "You can start when at least two players are here and everyone is ready.";
  } else {
    lobbyHelp.textContent = me?.ready ? "You’re ready. Waiting for the host to start." : "Tap ready when you’re set.";
  }
}

function renderCountdown() {
  switchStage(countdownStage);
  const remaining = getRemainingMs();
  const seconds = Math.max(1, Math.ceil(remaining / 1000));
  const isTie = gameState.countdownKind === "tiebreak";
  countdownEyebrow.textContent = isTie ? "SUDDEN DEATH" : gameState.countdownKind === "opening" ? "GET READY" : "NEXT UP";
  countdownNumber.textContent = seconds;
  countdownTitle.textContent = isTie
    ? "Tied leaders: first correct answer wins"
    : gameState.countdownKind === "opening"
      ? "The trivia sprint is about to begin"
      : "Get ready for the next question";
}

function renderQuestion() {
  switchStage(questionStage);
  const question = gameState.currentQuestion;
  const meHasAnswered = gameState.yourAnswerIndex !== null;
  const eligible = isEligible();
  roundLabel.textContent = gameState.isTiebreak ? "SUDDEN DEATH" : `QUESTION ${gameState.roundNumber} OF ${gameState.totalRounds}`;
  answerCount.textContent = `${gameState.answerCount} / ${gameState.eligiblePlayerIds.length} locked in`;
  questionText.textContent = question.text;
  answers.replaceChildren(...question.choices.map((choice, index) => {
    const choiceButton = document.createElement("button");
    choiceButton.type = "button";
    choiceButton.className = `answer-button choice-${index}${gameState.yourAnswerIndex === index ? " selected" : ""}`;
    choiceButton.disabled = !eligible || meHasAnswered || submittingAnswer;
    choiceButton.innerHTML = `<span class="answer-letter">${String.fromCharCode(65 + index)}</span><span class="answer-copy"></span>`;
    choiceButton.querySelector(".answer-copy").textContent = choice;
    choiceButton.addEventListener("click", () => submitAnswer(index));
    return choiceButton;
  }));
  answerStatus.textContent = !eligible
    ? "Sudden death is for the tied leaders — you’re watching this one."
    : meHasAnswered
      ? "Answer locked. Hold tight for the reveal!"
      : "Pick one answer before time runs out.";
}

function renderReveal() {
  switchStage(revealStage);
  const question = gameState.currentQuestion;
  const result = gameState.lastRoundResults.find((roundResult) => roundResult.playerId === playerId);
  revealEyebrow.textContent = gameState.isTiebreak ? "SUDDEN-DEATH REVEAL" : `QUESTION ${gameState.roundNumber} RESULTS`;
  revealTitle.textContent = "The correct answer was";
  correctAnswer.textContent = question.choices[question.correctIndex];
  if (gameState.isTiebreak) {
    roundOutcome.textContent = result?.isCorrect ? "You got it — checking who was quickest…" : "No winner yet — another sudden-death question is coming.";
    nextUp.textContent = "First correct answer wins the game.";
  } else if (result?.isCorrect) {
    roundOutcome.textContent = `Correct! +${result.points.toLocaleString()} points`;
    nextUp.textContent = gameState.roundNumber === gameState.totalRounds ? "Calculating the winner…" : "Leaderboard updated. Next question is coming…";
  } else if (result?.choiceIndex === null) {
    roundOutcome.textContent = "Time’s up — no points this round.";
    nextUp.textContent = "Keep moving. The next question is coming…";
  } else {
    roundOutcome.textContent = "Not this one — no points this round.";
    nextUp.textContent = "Fast reset: the next question is coming…";
  }
}

function renderFinal() {
  switchStage(finalStage);
  const winner = getPlayer(gameState.winnerId);
  winnerName.textContent = winner?.name || "A winner";
  winnerCopy.textContent = winner ? `wins with ${winner.score.toLocaleString()} points and takes the Blitz Quiz crown.` : "takes the Blitz Quiz crown.";
}

function render() {
  if (!gameState) return;
  roomCodeDisplay.textContent = gameState.code;
  renderLeaderboard();
  if (gameState.phase === "lobby") renderLobby();
  else if (gameState.phase === "countdown") renderCountdown();
  else if (gameState.phase === "question") renderQuestion();
  else if (gameState.phase === "reveal") renderReveal();
  else if (gameState.phase === "final") renderFinal();
}

function getRemainingMs() {
  return Math.max(0, Number(gameState?.phaseEndsAt || 0) - (Date.now() + serverOffset));
}

function updateTimer() {
  if (!gameState) return;
  const remaining = getRemainingMs();
  if (gameState.phase === "question") {
    timerNumber.textContent = (remaining / 1000).toFixed(1);
    timerFill.style.width = `${Math.max(0, Math.min(100, (remaining / 8_000) * 100))}%`;
  } else if (gameState.phase === "countdown") {
    renderCountdown();
  }
}

async function submitAnswer(choiceIndex) {
  if (!session || !gameState || submittingAnswer || gameState.yourAnswerIndex !== null) return;
  submittingAnswer = true;
  renderQuestion();
  try {
    await api(`/api/rooms/${encodeURIComponent(session.code)}/answer`, {
      method: "POST",
      body: { playerId, choiceIndex, roundId: gameState.currentRoundId },
    });
  } catch (error) {
    submittingAnswer = false;
    showToast(error.message);
    renderQuestion();
  }
}

setInterval(updateTimer, 80);
roomCodeInput.addEventListener("input", () => {
  roomCodeInput.value = roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});

restoreRoom();

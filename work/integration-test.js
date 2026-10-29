const baseUrl = process.env.TEST_URL || `http://localhost:${process.env.PORT || 3000}`;

const correctIndexByQuestion = new Map([
  ["Which planet is known as the Red Planet?", 1],
  ["What is the chemical symbol for gold?", 1],
  ["What is the largest ocean on Earth?", 2],
  ["Which instrument traditionally has 88 keys?", 1],
  ["How many sides does a hexagon have?", 1],
  ["What is the capital of Japan?", 2],
  ["What is the largest mammal in the world?", 1],
  ["Who wrote Pride and Prejudice?", 0],
  ["Which gas do plants absorb from the air?", 2],
  ["What is the official language of Brazil?", 1],
  ["What is 9 × 7?", 1],
  ["Which sport uses a shuttlecock?", 2],
  ["Which two digits are used in binary?", 0],
  ["Which planet is famous for its rings?", 1],
  ["At what temperature does water freeze in Celsius?", 0],
  ["On which continent is India located?", 2],
  ["How many chambers does a human heart have?", 2],
  ["How many colours are traditionally in a rainbow?", 2],
  ["Who wrote Hamlet?", 1],
  ["What is the fastest land animal?", 0],
  ["Which of these is a primary colour in light?", 0],
  ["The Eiffel Tower is in which city?", 1],
  ["Which river flows through Egypt?", 1],
  ["What is the star at the centre of our solar system?", 2],
  ["How many sides does a triangle have?", 1],
  ["What is the tallest mountain above sea level?", 2],
  ["What currency is used in Japan?", 1],
  ["Who painted the Mona Lisa?", 2],
]);

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function request(path, method = "GET", body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  return { response, payload };
}

async function main() {
  const suffix = Date.now().toString(36);
  const alpha = `testalpha${suffix}`;
  const bravo = `testbravo${suffix}`;

  const created = await request("/api/rooms", "POST", { playerId: alpha, name: "Alpha" });
  if (created.response.status !== 201) throw new Error(`Create room failed: ${JSON.stringify(created.payload)}`);
  const code = created.payload.code;

  const joined = await request(`/api/rooms/${code}/join`, "POST", { playerId: bravo, name: "Bravo" });
  if (!joined.response.ok || joined.payload.state.playerCount !== 2) throw new Error("Second player did not join the same room.");

  await request(`/api/rooms/${code}/ready`, "POST", { playerId: alpha, ready: true });
  const bothReady = await request(`/api/rooms/${code}/ready`, "POST", { playerId: bravo, ready: true });
  if (!bothReady.payload.state.allReady) throw new Error("Ready state did not synchronize.");

  const started = await request(`/api/rooms/${code}/start`, "POST", { playerId: alpha });
  if (started.payload.state.phase !== "countdown") throw new Error("Match did not start in countdown.");
  await wait(3_250);

  const inQuestion = await request(`/api/rooms/${code}/state?playerId=${alpha}`);
  const state = inQuestion.payload.state;
  if (state.phase !== "question" || !state.currentRoundId) throw new Error("Shared question did not open.");
  const correctChoice = correctIndexByQuestion.get(state.currentQuestion.text);
  if (correctChoice === undefined) throw new Error("Test does not know the current question answer.");

  const alphaAnswer = await request(`/api/rooms/${code}/answer`, "POST", { playerId: alpha, choiceIndex: correctChoice, roundId: state.currentRoundId });
  if (!alphaAnswer.response.ok || alphaAnswer.payload.state.yourAnswerIndex !== correctChoice) throw new Error("First answer was not locked.");
  const duplicate = await request(`/api/rooms/${code}/answer`, "POST", { playerId: alpha, choiceIndex: correctChoice, roundId: state.currentRoundId });
  if (duplicate.response.status !== 409) throw new Error("Duplicate answer was accepted.");

  await wait(1_000);
  const bravoAnswer = await request(`/api/rooms/${code}/answer`, "POST", { playerId: bravo, choiceIndex: correctChoice, roundId: state.currentRoundId });
  if (!bravoAnswer.response.ok) throw new Error("Second answer failed.");

  const revealed = await request(`/api/rooms/${code}/state?playerId=${alpha}`);
  const revealedState = revealed.payload.state;
  if (revealedState.phase !== "reveal" || revealedState.currentQuestion.correctIndex !== correctChoice) {
    throw new Error("The room did not move together into answer reveal.");
  }
  const alphaScore = revealedState.players.find((player) => player.id === alpha)?.score;
  const bravoScore = revealedState.players.find((player) => player.id === bravo)?.score;
  if (!(alphaScore > bravoScore && bravoScore >= 500)) {
    throw new Error(`Speed scoring is wrong: Alpha=${alphaScore}, Bravo=${bravoScore}`);
  }

  console.log(`PASS: room ${code}; shared lobby, readiness, countdown, answer lock, reveal, and speed scoring all verified.`);
}

main().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});

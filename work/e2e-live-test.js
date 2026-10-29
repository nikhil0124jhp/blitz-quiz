"use strict";

const http = require("node:http");

const baseUrl = process.env.TEST_URL || `http://localhost:${process.env.PORT || 3000}`;
const parsedBase = new URL(baseUrl);

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

function request(path, method = "GET", body) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : "";
    const options = {
      hostname: parsedBase.hostname,
      port: parsedBase.port || 80,
      path,
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(postData) } : {}),
      },
    };
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const payload = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, headers: res.headers, payload });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
    });
    req.on("error", reject);
    if (postData) req.write(postData);
    req.end();
  });
}

function listenToSse(code, playerId, onState) {
  const req = http.request({
    hostname: parsedBase.hostname,
    port: parsedBase.port || 80,
    path: `/api/rooms/${encodeURIComponent(code)}/events?playerId=${encodeURIComponent(playerId)}`,
    method: "GET",
    headers: { Accept: "text/event-stream" },
  }, (res) => {
    if (res.statusCode !== 200) {
      console.error(`SSE failed with status: ${res.statusCode}`);
      return;
    }
    let buffer = "";
    res.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n\n");
      buffer = lines.pop(); // keep last incomplete chunk
      for (const block of lines) {
        for (const line of block.split("\n")) {
          if (line.startsWith("data: ")) {
            try {
              const state = JSON.parse(line.slice(6));
              onState(state);
            } catch (e) {
              // ignore comments like : keepalive
            }
          }
        }
      }
    });
  });
  req.on("error", (err) => console.error("SSE stream error:", err.message));
  req.end();
  return () => req.destroy();
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  console.log("1. Verifying health check and static endpoints...");
  const health = await request("/healthz");
  if (health.status !== 200 || health.payload.status !== "ok") {
    throw new Error(`Health check failed: ${JSON.stringify(health)}`);
  }
  console.log("   ✓ /healthz responded 200 OK");

  const home = await request("/");
  if (home.status !== 200 || !home.headers["content-type"].includes("text/html")) {
    throw new Error("Root route / did not return 200 text/html");
  }
  console.log("   ✓ / returned 200 text/html");

  const indexPage = await request("/index.html");
  if (indexPage.status !== 200 || !indexPage.headers["content-type"].includes("text/html")) {
    throw new Error("/index.html route did not return 200 text/html");
  }
  console.log("   ✓ /index.html returned 200 text/html");

  console.log("2. Creating multiplayer room...");
  const suffix = Date.now().toString(36);
  const hostId = `host_${suffix}`;
  const guestId = `guest_${suffix}`;

  const createRes = await request("/api/rooms", "POST", { playerId: hostId, name: "HostPlayer" });
  if (createRes.status !== 201) throw new Error(`Create room failed: ${JSON.stringify(createRes)}`);
  const roomCode = createRes.payload.code;
  console.log(`   ✓ Room ${roomCode} created by ${hostId}`);

  console.log("3. Connecting both players to live SSE real-time stream...");
  let hostLatestState = null;
  let guestLatestState = null;

  const closeHostSse = listenToSse(roomCode, hostId, (state) => {
    hostLatestState = state;
  });

  const joinRes = await request(`/api/rooms/${roomCode}/join`, "POST", { playerId: guestId, name: "GuestPlayer" });
  if (joinRes.status !== 200) throw new Error(`Guest join failed: ${JSON.stringify(joinRes)}`);
  console.log(`   ✓ Guest ${guestId} joined room ${roomCode}`);

  const closeGuestSse = listenToSse(roomCode, guestId, (state) => {
    guestLatestState = state;
  });

  await wait(500);

  if (!hostLatestState || hostLatestState.playerCount !== 2) {
    throw new Error(`Host did not receive live SSE update for guest join. State: ${JSON.stringify(hostLatestState)}`);
  }
  console.log("   ✓ Host received real-time SSE event with playerCount = 2");

  console.log("4. Toggling readiness...");
  await request(`/api/rooms/${roomCode}/ready`, "POST", { playerId: hostId, ready: true });
  await request(`/api/rooms/${roomCode}/ready`, "POST", { playerId: guestId, ready: true });
  await wait(300);

  if (!hostLatestState.allReady || !guestLatestState.allReady) {
    throw new Error("Readiness did not synchronize over SSE stream.");
  }
  console.log("   ✓ Both players synchronized allReady=true over SSE");

  console.log("5. Starting match...");
  const startRes = await request(`/api/rooms/${roomCode}/start`, "POST", { playerId: hostId });
  if (startRes.status !== 200) throw new Error(`Start game failed: ${JSON.stringify(startRes)}`);

  await wait(300);
  if (hostLatestState.phase !== "countdown" || guestLatestState.phase !== "countdown") {
    throw new Error("Match did not broadcast countdown phase over SSE.");
  }
  console.log("   ✓ Countdown broadcasted simultaneously to both players");

  console.log("6. Waiting for question phase to open (3s countdown)...");
  await wait(3_200);

  if (hostLatestState.phase !== "question") {
    throw new Error(`Expected question phase, got: ${hostLatestState.phase}`);
  }
  console.log(`   ✓ Question active: "${hostLatestState.currentQuestion.text}"`);

  const roundId = hostLatestState.currentRoundId;
  const correctChoice = correctIndexByQuestion.get(hostLatestState.currentQuestion.text);

  console.log("7. Host submitting answer (speed lock)...");
  const hostAns = await request(`/api/rooms/${roomCode}/answer`, "POST", {
    playerId: hostId,
    choiceIndex: correctChoice,
    roundId,
  });
  if (hostAns.status !== 200) throw new Error(`Host answer failed: ${JSON.stringify(hostAns)}`);

  await wait(600);

  console.log("8. Guest submitting answer...");
  const guestAns = await request(`/api/rooms/${roomCode}/answer`, "POST", {
    playerId: guestId,
    choiceIndex: correctChoice,
    roundId,
  });
  if (guestAns.status !== 200) throw new Error(`Guest answer failed: ${JSON.stringify(guestAns)}`);

  await wait(500);

  if (hostLatestState.phase !== "reveal") {
    throw new Error(`Expected reveal phase after both answers, got: ${hostLatestState.phase}`);
  }
  console.log("   ✓ Both answers locked, room moved to reveal phase");

  const hostScore = hostLatestState.players.find((p) => p.id === hostId)?.score;
  const guestScore = hostLatestState.players.find((p) => p.id === guestId)?.score;
  console.log(`   ✓ Scores calculated: Host=${hostScore}, Guest=${guestScore}`);
  if (!(hostScore > guestScore && guestScore >= 500)) {
    throw new Error(`Speed scoring failed: Host (${hostScore}) should be > Guest (${guestScore})`);
  }

  closeHostSse();
  closeGuestSse();

  console.log("\n=======================================================");
  console.log("ALL MULTIPLAYER & SSE STREAMING TESTS PASSED PERFECTLY!");
  console.log("=======================================================\n");
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});


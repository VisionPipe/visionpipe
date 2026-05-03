#!/usr/bin/env node
import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";

const PORT = parseInt(process.env.PORT ?? "8787", 10);
const REAL_DG_KEY = process.env.DEEPGRAM_API_KEY;

const tokens = new Map(); // token -> { issuedAt, minutesUsed }

const httpServer = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/install") {
    const token = randomUUID();
    tokens.set(token, { issuedAt: Date.now(), minutesUsed: 0 });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ token }));
    return;
  }
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200); res.end("ok"); return;
  }
  res.writeHead(404); res.end("not found");
});

const wss = new WebSocketServer({ server: httpServer, path: "/transcribe" });

wss.on("connection", (clientWs, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get("token");
  if (!token || !tokens.has(token)) {
    clientWs.close(1008, "Unauthorized");
    return;
  }

  console.log(`[vp-edge-mock] Client connected with token ${token.slice(0, 8)}…`);

  if (REAL_DG_KEY) {
    // Forward to real Deepgram
    const dgWs = new WebSocket(
      "wss://api.deepgram.com/v1/listen?model=nova-3&language=en-US&interim_results=true&smart_format=true&encoding=opus",
      { headers: { Authorization: `Token ${REAL_DG_KEY}` } }
    );
    dgWs.on("message", (msg) => clientWs.send(msg));
    dgWs.on("close", () => clientWs.close());
    clientWs.on("message", (audio) => dgWs.readyState === WebSocket.OPEN && dgWs.send(audio));
    clientWs.on("close", () => dgWs.close());
  } else {
    // Echo mode: send canned transcripts every 1.5s
    let chunkCount = 0;
    const interval = setInterval(() => {
      chunkCount += 1;
      const isFinal = chunkCount % 3 === 0;
      clientWs.send(JSON.stringify({
        type: "Results",
        is_final: isFinal,
        speech_final: isFinal,
        channel: {
          alternatives: [{
            transcript: `mock transcript chunk ${chunkCount}${isFinal ? "." : "..."}`,
            confidence: 0.95,
          }],
        },
        start: chunkCount * 1.5,
        duration: 1.5,
      }));
    }, 1500);
    clientWs.on("close", () => clearInterval(interval));
  }
});

httpServer.listen(PORT, () => {
  console.log(`[vp-edge-mock] Listening on http://localhost:${PORT}`);
  console.log(`[vp-edge-mock] WebSocket: ws://localhost:${PORT}/transcribe?token=…`);
  console.log(`[vp-edge-mock] Real Deepgram: ${REAL_DG_KEY ? "ENABLED (forwarding)" : "DISABLED (echo mode)"}`);
});

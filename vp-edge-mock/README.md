# vp-edge-mock

Local development mock for the `vp-edge` transcription proxy that production VisionPipe will eventually use.

## Run

```bash
pnpm dev:proxy
# or:
node vp-edge-mock/server.mjs
```

## Endpoints

- `POST /install` — issues an opaque `token` (no auth required for local dev)
- `GET /health` — returns `ok`
- `WSS /transcribe?token=<token>` — streams audio in, transcripts out

## Modes

- **Echo mode** (default): returns canned transcript chunks every 1.5s. No real ASR. Use for UI smoke tests.
- **Forwarding mode**: set `DEEPGRAM_API_KEY=...` in env. Audio is proxied to Deepgram Nova-3 and real transcripts come back. Use for end-to-end testing.

## Spec 1 vs production `vp-edge`

This mock is NOT the production proxy. The real `vp-edge` adds: per-token rate limiting (60 min/day), per-IP throttle on `/install`, monthly spend cap, observability/alerting, deployment to Cloudflare Workers (or similar). Production proxy is a separate plan.

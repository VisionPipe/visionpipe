# VisionPipe Cloud Share + Secret-Link Sharing — Design Spec

**Status:** Draft, pending implementation plan
**Author:** Brainstormed via Claude Code session, 2026-05-02
**Spec scope:** Spec 2 of a 2-spec sequence. Spec 1 (`2026-05-02-multi-screenshot-narrated-bundle-design.md`) defined the local multi-screenshot session. This spec adds optional cloud upload + secret-link sharing on top, gated by the existing Stripe credit billing system in `visionpipe-web`.

---

## 1. Summary

Spec 1 produces a session folder on disk (`~/Pictures/VisionPipe/session-<id>/`) containing screenshots, audio, `transcript.json`, and `transcript.md`. The default flow is "Copy & Send" — markdown to clipboard with absolute local image paths, optimized for Claude Code consumption.

**Spec 2 adds a "Save to cloud" button alongside "Copy & Send"** that:
1. Authenticates the user via Clerk (desktop ↔ web auth flow)
2. Charges credits from the user's existing balance (via the `visionpipe-web` Stripe billing system)
3. Uploads the session folder to Cloudflare R2 storage
4. Rewrites image references in `transcript.md` from local paths to public URLs
5. Generates a secret share link at `https://share.visionpipe.app/<linkId>`
6. Returns the link to the desktop, which copies it to the clipboard and shows a toast

The recipient of a shared link visits the URL in any browser and sees a server-rendered page with all screenshots, audio playback, transcript text, and metadata — no account required.

**Relationship to existing specs and code:**
- Builds on **Spec 1** (multi-screenshot narrated bundle) — reads the session folder shape Spec 1 produces. Does not modify Spec 1's contract; only adds an upload/sharing path on top.
- Builds on **`visionpipe-web` Phase 1** (Stripe credit billing, shipped at `feature/stripe-billing-phase-1` in that repo) — reuses Clerk auth, Drizzle DB, `purchases` + `getBalance`, Resend email. Adds new tables and API routes; no breaking changes to existing schema.
- Implements the cloud-share portion of what `visionpipe-web`'s Stripe spec describes as "Phase 2: Desktop app authentication and credit consumption."

**Explicitly NOT in this spec:**
- Credit-consumption for transcription minutes (Spec 1's vp-edge stays free + rate-limited per its own design; transcription billing is a future Spec 3)
- Multi-member team uploads (Phase 1.5 in `visionpipe-web` — wait until that ships)
- Internationalization / non-US tax (matches Phase 1's US-only constraint)
- Session-folder auto-sync between machines / cloud-as-source-of-truth (this spec is "publish-to-cloud," not "cloud-native sessions")

---

## 2. Goals and non-goals

### Goals

- One-click cloud upload of a complete VisionPipe session
- Secret share link works in any browser without recipient sign-in
- Auth and billing entirely reuse existing `visionpipe-web` infrastructure (no new identity system, no new pricing surface)
- Charge a flat, predictable credit cost per upload (50 credits = $0.50 at base pack rate)
- Server-side preserve the session: screenshots, audio, transcript, metadata
- Secret link is opaque, hard to enumerate, optionally revocable by the uploader
- Web viewer shows preview cards (Open Graph) when the link is pasted into Slack, Twitter, etc.
- Failed uploads cost zero credits (charge happens only on finalize)

### Non-goals (Spec 2)

- **Transcription billing** — defer to Spec 3
- **Team upload / shared org workspaces** — defer until `visionpipe-web` Phase 1.5 ships (multi-member Clerk Orgs)
- **Viewer authentication** — recipients are anonymous; "require sign-in to view" is a future add
- **Custom domain on share links** — everyone uses `share.visionpipe.app`
- **Editing or annotating after upload** — uploads are immutable snapshots; re-upload to update
- **Session-folder bidirectional sync** — desktop pushes to cloud; cloud doesn't sync back
- **Cloud-storage tier selection / cold archive** — single hot tier (R2), uniform pricing
- **In-app "my shared sessions" list / management UI** — defer to v0.3+; uploaders can manage links via the web dashboard
- **International expansion / non-US billing** — inherits Phase 1's US-only constraint

---

## 3. Decisions made during brainstorming

| # | Decision | Rationale |
|---|---|---|
| Q1 | **Auth model:** Clerk via magic-link bootstrap, opaque token stored in Keychain | The web app already ships Clerk + magic-link infrastructure. Anonymous-with-claim-later is unnecessary friction once auth exists. |
| Q2 | **Pricing:** Flat 50 credits per cloud upload ($0.50 at base pack rate), no per-byte tiering | Predictable for users; cloud egress on R2 is essentially free so cost is value-signal not infra cost. Tunable later. |
| Q3 | **Free tier:** Cannot upload to cloud (matches founder's stated requirement) — paywall modal shown | "Personal & Open Source" license stays free for local-only use; cloud is a Commercial-tier feature requiring credit purchase. |
| Q4 | **Billing model:** Credits, NOT subscription | Matches `visionpipe-web` Phase 1's existing pack model ($10/$20/$50/$100; 12-month expiry). No new pricing surface. |
| Q5 | **Storage:** Cloudflare R2 (cheaper egress than S3) | Free egress matters when share-links serve images to recipients. |
| Q6 | **Web viewer:** Server-rendered Next.js route at `/share/[linkId]` | Reuses existing Next.js app; gives proper SEO + Open Graph cards; no separate viewer app to deploy. |
| Q7 | **Charge timing:** On finalize, not on initiate | Failed uploads don't cost credits. Pending uploads cleaned up by R2 lifecycle policy after 24h. |
| Q8 | **Spec 2 vs full "Phase 2" decomposition:** Spec 2 = cloud share only; transcription billing is Spec 3 | Smaller, focused, shippable; transcription billing is a separate concern. |

---

## 4. System architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  VisionPipe Desktop App  (Tauri / macOS)                           │
│                                                                     │
│  Session window (Spec 1):                                           │
│  ─ existing: Take screenshot, narrate, edit captions, Copy & Send   │
│  ─ NEW: "Save to cloud" button (next to Copy & Send)                │
│  ─ NEW: Auth state UI (signed-in user email; "Sign in" if not)      │
│  ─ NEW: Toast with share link + Copy button after upload            │
└──┬────────────────────────────┬─────────────────────────────────────┘
   │ direct PUT (presigned URL) │ HTTPS API
   ▼                             ▼
┌──────────────────────┐   ┌──────────────────────────────────────────┐
│  Cloudflare R2        │   │  visionpipe-web  (Next.js 15, Vercel)    │
│                       │   │                                           │
│  Bucket layout:       │   │  NEW pages:                               │
│  /<orgId>/sessions/   │   │  ─ /auth/desktop      (auth handshake)    │
│    <sessionId>/       │   │  ─ /share/[linkId]    (public viewer)     │
│      VisionPipe-NNN   │   │  ─ /dashboard/sessions (user's uploads)   │
│        .png           │   │                                           │
│      audio-master.    │   │  NEW API routes:                          │
│        webm           │   │  ─ POST /api/desktop/auth/initiate        │
│      transcript.json  │   │  ─ POST /api/desktop/auth/exchange        │
│      transcript.md    │   │  ─ DELETE /api/desktop/tokens/:id         │
│                       │   │  ─ POST /api/uploads/initiate             │
│  Public via           │   │  ─ POST /api/uploads/:id/finalize         │
│  share.visionpipe.app │   │  ─ DELETE /api/uploads/:id                │
│                       │   │  ─ POST /api/share-links                  │
│  Lifecycle: pending/  │   │  ─ DELETE /api/share-links/:id            │
│  prefix → delete      │   │  ─ GET  /api/share/:id (server-component) │
│  after 24h            │   │                                           │
└───────────────────────┘   │  Existing (unchanged) deps:               │
                            │  Clerk · Stripe · Neon · Resend · Drizzle │
                            └──────────────────────────────────────────┘
```

### Boundaries & responsibilities

- **Desktop app:** captures, narrates, manages local session, makes auth + upload requests. Holds opaque desktop token in macOS Keychain.
- **`visionpipe-web` Next.js app:** terminates auth, charges credits transactionally, issues R2 presigned URLs, manages share-link DB rows, renders viewer pages.
- **Cloudflare R2:** stores all session assets (PNGs, WebM audio, JSON, MD). Public read on `share.visionpipe.app` custom domain. Lifecycle policy auto-cleans `pending/` prefix.
- **Neon Postgres (via Drizzle):** source of truth for `capture_sessions`, `shared_links`, `desktop_install_tokens`, `credit_charges`, plus the existing Phase 1 tables.
- **Clerk:** authoritative for user identity; existing magic-link flow is the bootstrap path for desktop auth.

### Why this shape

- **Desktop uploads directly to R2 via presigned URLs**, NOT through Next.js: avoids Vercel's 4.5 MB body size limit, avoids paying for bandwidth-through-Vercel for what could be 100 MB sessions.
- **Web viewer is server-rendered Next.js**, NOT a separate static SPA: reuses existing app, gives Open Graph preview cards out of the box.
- **Credits ledger uses a `credit_charges` table** added alongside existing `purchases`, NOT a `balance` column on `organizations`: matches Phase 1's "compute balance live, no cache invalidation" design philosophy. The existing `getBalance(orgId)` query gets one new term in its sum.
- **Two new R2 prefixes per upload (`pending/`, `sessions/`)**: prevents abandoned uploads from polluting the live data set; lifecycle policy keeps storage costs bounded without app-side cron.

---

## 5. Desktop-to-web auth flow

**Goal:** the desktop app obtains an opaque token tied to a specific `(org_id, clerk_user_id)` pair, stored in macOS Keychain, that authorizes credit-consuming actions.

### Flow steps

```
┌─────────────┐                                     ┌──────────────┐                    ┌─────────┐
│  Desktop    │                                     │   Web App    │                    │  Clerk  │
└──────┬──────┘                                     └──────┬───────┘                    └────┬────┘
       │                                                   │                                 │
   1.  │ user clicks "Sign in"                             │                                 │
       │ desktop generates challenge = random(32 bytes)    │                                 │
       │                                                   │                                 │
   2.  │ POST /api/desktop/auth/initiate                   │                                 │
       │ { challenge_hash: sha256(challenge),              │                                 │
       │   install_label: "MacBook Air (M2)" }             │                                 │
       │ ────────────────────────────────────────────────►│                                 │
       │                                                   │                                 │
   3.  │                                                   │ stores pending row, returns:   │
       │                                                   │ { auth_url: "https://app/      │
       │                                                   │     auth/desktop?              │
       │                                                   │     pending_id=<id>",          │
       │                                                   │   poll_url: "https://app/api/  │
       │                                                   │     desktop/auth/exchange" }   │
       │ ◄────────────────────────────────────────────────│                                 │
       │                                                   │                                 │
   4.  │ open auth_url in default browser                  │                                 │
       │                                                   │                                 │
   5.  │                          user signs in via Clerk magic-link OR existing session ───►│
       │                                                   │ ◄─────────────── session ──────│
       │                                                   │                                 │
   6.  │                                                   │ /auth/desktop page shows:      │
       │                                                   │   "Authorize VisionPipe?       │
       │                                                   │    [Authorize] [Cancel]"       │
       │                                                   │                                 │
   7.  │                          user clicks Authorize                                      │
       │                                                   │ web generates opaque_token      │
       │                                                   │ stores hash(opaque_token) in    │
       │                                                   │   desktop_install_tokens        │
       │                                                   │ marks pending row "completed"   │
       │                                                   │ shows: "Return to VisionPipe"   │
       │                                                   │                                 │
   8.  │ POST /api/desktop/auth/exchange (polling, every 2s)                                  │
       │ { challenge: <raw>, pending_id: <id> }            │                                 │
       │ ────────────────────────────────────────────────►│                                 │
       │                                                   │                                 │
   9.  │                                                   │ verifies sha256(challenge) ==   │
       │                                                   │   pending_row.challenge_hash    │
       │                                                   │ if pending_row.completed,       │
       │                                                   │   returns { token, org_id,      │
       │                                                   │     user_email, user_name }     │
       │                                                   │ else returns 202 Accepted       │
       │ ◄────────────────────────────────────────────────│                                 │
       │                                                   │                                 │
  10.  │ stores token in Keychain                          │                                 │
       │ shows "Signed in as <email>"                      │                                 │
       │                                                   │                                 │
```

### Why this shape (vs. URL scheme alternative)

A `visionpipe://` URL scheme callback is the alternative. Pros: no polling. Cons: clunkier UX (browser shows a "Open in VisionPipe?" prompt that some users distrust); fragile across browsers. **The polling model is more reliable** for a desktop app, with a maximum of ~30 seconds of polling (typical sign-in completes in ~10 sec).

### Token properties

- **Opaque random** (256 bits, base64-encoded), NOT a JWT. Why: simpler, easier to revoke, no key management.
- Stored in `desktop_install_tokens` table as `sha256(token)` — never store plaintext.
- Sent on every authenticated request as `Authorization: Bearer <token>`.
- No expiry by default. User can revoke via dashboard or by clicking "Sign out" in the desktop app (which calls `DELETE /api/desktop/tokens/<id>`).

### Token verification on every request

Server middleware:
1. Extract `Authorization: Bearer <token>` header
2. Compute `sha256(token)`
3. Look up in `desktop_install_tokens` where `token_hash = ? AND revoked_at IS NULL`
4. If found: load `org_id`, `clerk_user_id`, update `last_used_at`. Attach to request context.
5. If not found: return 401.

### Sign-out from desktop

- Desktop sends `DELETE /api/desktop/tokens/me` (uses current token to identify itself)
- Server marks `revoked_at = now()`
- Desktop deletes Keychain entry
- Cloud features become disabled in UI

### Sign-out from web dashboard

- Dashboard at `/dashboard/devices` lists all rows where `org_id = current_org`
- Each row has an "Unlink device" button that does the same DELETE
- Useful for stolen devices or rotating credentials

---

## 6. Data model

### New tables (additions to `visionpipe-web` Drizzle schema)

```typescript
// drizzle schema: src/db/schema.ts (extend)

export const desktopInstallTokens = pgTable("desktop_install_tokens", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organizations.id),
  clerkUserId: text("clerk_user_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),  // sha256 hex of the token
  installLabel: text("install_label"),                // user-supplied or auto from User-Agent
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at"),
  revokedAt: timestamp("revoked_at"),
});

export const captureSessions = pgTable("capture_sessions", {
  id: text("id").primaryKey(),  // "vps_<base62-12>"
  orgId: integer("org_id").notNull().references(() => organizations.id),
  uploadedByClerkUserId: text("uploaded_by_clerk_user_id").notNull(),
  status: text("status", { enum: ["pending", "complete", "failed", "deleted"] }).notNull(),
  desktopSessionId: text("desktop_session_id").notNull(),  // the local "session-<ts>" id from Spec 1
  screenshotCount: integer("screenshot_count").notNull(),
  durationSec: integer("duration_sec").notNull(),
  totalSizeBytes: bigint("total_size_bytes", { mode: "number" }).notNull(),
  creditsCharged: integer("credits_charged").notNull(),    // 0 if status='pending'
  r2Prefix: text("r2_prefix").notNull(),                   // "<orgId>/sessions/<id>"
  createdAt: timestamp("created_at").notNull().defaultNow(),
  uploadedAt: timestamp("uploaded_at"),                    // null until finalize
  expiresAt: timestamp("expires_at"),                      // nullable; lifecycle policy
});

export const sharedLinks = pgTable("shared_links", {
  id: text("id").primaryKey(),  // "vsl_<base62-16>" — opaque, hard to enumerate
  captureSessionId: text("capture_session_id").notNull().references(() => captureSessions.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at"),                      // nullable; future user-configurable
  revokedAt: timestamp("revoked_at"),
  viewCount: integer("view_count").notNull().default(0),
  lastViewedAt: timestamp("last_viewed_at"),
});

export const creditCharges = pgTable("credit_charges", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organizations.id),
  amount: integer("amount").notNull(),                     // positive = deduction
  reason: text("reason", { enum: ["cloud_upload", "cloud_upload_refund"] }).notNull(),
  refId: text("ref_id"),                                    // e.g., capture_session_id
  chargedAt: timestamp("charged_at").notNull().defaultNow(),
  refundedAt: timestamp("refunded_at"),                     // if a deduction was reversed
});
```

### Updated balance computation

The existing `getBalance(orgId)` function in `src/db/queries.ts` needs to subtract the new `credit_charges`:

```typescript
// src/db/queries.ts (updated)

export async function getBalance(orgId: number): Promise<number> {
  const credits = await db.execute(sql`
    SELECT
      COALESCE((
        SELECT SUM(credits_purchased - refunded_credits)
        FROM purchases
        WHERE org_id = ${orgId}
          AND status IN ('complete', 'partially_refunded')
          AND expires_at > NOW()
      ), 0)
      -
      COALESCE((
        SELECT SUM(amount)
        FROM credit_charges
        WHERE org_id = ${orgId}
          AND refunded_at IS NULL
      ), 0)
    AS balance
  `);
  return Number(credits.rows[0].balance);
}
```

### Migration

Single Drizzle migration adds 4 tables; no changes to existing tables. Order:
1. `desktop_install_tokens` (no foreign key dependencies beyond existing `organizations`)
2. `capture_sessions` (same)
3. `shared_links` (depends on `capture_sessions`)
4. `credit_charges` (depends on `organizations`)

---

## 7. Upload flow

Three-step protocol: **initiate → direct PUT to R2 → finalize**. Charge happens at finalize.

### Step A — Initiate upload

```
POST /api/uploads/initiate
Authorization: Bearer <desktop_token>
Body: {
  desktopSessionId: "2026-05-02_14-23-07",
  files: [
    { name: "VisionPipe-001-...-Chrome-github.png", size: 384000 },
    { name: "VisionPipe-002-...-VSCode.png", size: 412000 },
    { name: "audio-master.webm", size: 2400000 },
    { name: "transcript.json", size: 4800 },
    { name: "transcript.md", size: 3600 }
  ],
  screenshotCount: 2,
  durationSec: 198
}

Response 200: {
  captureSessionId: "vps_<id>",
  presignedUrls: {
    "VisionPipe-001-...-Chrome-github.png": "https://r2.../...?X-Amz-Signature=...",
    "VisionPipe-002-...-VSCode.png": "https://r2.../...?...",
    "audio-master.webm": "https://r2.../...?...",
    "transcript.json": "https://r2.../...?...",
    "transcript.md": "https://r2.../...?..."
  },
  publicUrlBase: "https://share.visionpipe.app/<orgId>/sessions/vps_<id>"
}

Response 401: token invalid or revoked
Response 400: malformed request, file too large (>100MB total)
Response 429: rate limited (10 initiate/hour per org)
```

Server-side:
1. Authenticate token → resolve `orgId`, `clerkUserId`
2. Validate: `totalSize <= 100 MB`, `files.length <= 250`, no duplicate names
3. Generate `captureSessionId = "vps_" + base62(random(64))`
4. Insert `capture_sessions` row with `status = "pending"`, `creditsCharged = 0`, `r2Prefix = "<orgId>/sessions/vps_<id>"`
5. Generate one R2 presigned PUT URL per file (1-hour expiry), bucket prefix is `pending/<orgId>/<captureSessionId>/<filename>` (note the `pending/` prefix — moved on finalize)
6. Return `presignedUrls` map + `publicUrlBase` (so the desktop knows what URL to embed in transcript.md before uploading it)

### Step B — Desktop direct uploads to R2

For each file:
```
PUT https://r2.../?X-Amz-Signature=...
Content-Type: <appropriate>
Body: <file bytes>

Response 200: success (R2 returns ETag)
Response 4xx/5xx: failure (desktop retries up to 3x with exponential backoff)
```

If any file fails after retries:
- Desktop calls `DELETE /api/uploads/<captureSessionId>` to mark failed
- Server marks row `status = "failed"`
- R2 lifecycle policy auto-deletes pending files after 24h

### Step C — Finalize upload

```
POST /api/uploads/<captureSessionId>/finalize
Authorization: Bearer <desktop_token>
Body: {
  createShareLink: true,           // optional, default false
  expiresAt: null                  // null = never expires; ISO timestamp = expires
}

Response 200: {
  status: "complete",
  shareLink: {                     // only if createShareLink
    id: "vsl_<id>",
    url: "https://share.visionpipe.app/vsl_<id>",
    expiresAt: null
  },
  creditsCharged: 50,
  remainingBalance: 950
}

Response 402: insufficient credits (balance < 50)
Response 403: token's org doesn't own this captureSessionId
Response 404: captureSessionId not found or already finalized
```

Server-side, in a single DB transaction:
1. Verify token's `orgId` owns the `captureSessionId` and status = "pending"
2. Verify R2 has all expected files at the `pending/` prefix (HEAD requests, parallelized)
3. Compute balance via `getBalance(orgId)`. If `< 50`, return 402.
4. Insert `credit_charges` row: `amount = 50, reason = "cloud_upload", refId = captureSessionId`
5. Move R2 objects from `pending/<orgId>/<id>/` to `<orgId>/sessions/<id>/` (R2 supports server-side copy + delete)
6. Update `capture_sessions`: `status = "complete", uploadedAt = now(), creditsCharged = 50`
7. If `createShareLink`: insert `shared_links` row with `id = "vsl_" + base62(random(96))`
8. Commit transaction
9. Return response

### Step D — Desktop receives final response

- If success with `shareLink`: copy `shareLink.url` to clipboard, show toast: `"Shared at <url> · 50 credits used · 950 remaining"`
- If success without `shareLink`: show toast: `"Uploaded · 50 credits used · 950 remaining"`. User can later create a share link from `/dashboard/sessions`.
- If `402`: show modal: `"Insufficient credits. You have <X>, need 50. Buy more?"` with button to open `https://visionpipe.app/pricing` in browser.

### Cleanup of failed/abandoned uploads

- R2 lifecycle policy: any object under `pending/` older than 24 hours is auto-deleted. No app-side cron needed.
- Daily cron in `visionpipe-web`: mark `capture_sessions` rows `status = "pending"` older than 24 hours as `status = "failed"`. No credit refund (none was charged).

---

## 8. Share link + web viewer

### Share link generation

- ID format: `"vsl_" + base62(random(96))` — 96 bits of entropy, 16 base62 characters. Hard to enumerate (would take ~10²⁰ tries to find one valid link).
- One-to-many: a `capture_session` can have multiple share links (e.g., user revokes one, generates another).
- Optional expiry: `expiresAt` is nullable; if set, viewer route returns 410 (Gone) past that date.
- Revocation: user can `DELETE /api/share-links/<id>` from dashboard; sets `revokedAt`. Viewer returns 410.

### Web viewer route

`GET /share/[linkId]` — server-rendered Next.js page (App Router server component).

Render flow:
1. Look up `shared_links` by `id`. If not found, 404. If `revokedAt` set or `expiresAt < now()`, return 410 (Gone) with friendly "This link is no longer available" page.
2. Look up `capture_sessions` by `id = shared_link.captureSessionId`.
3. Increment `shared_links.viewCount`, set `lastViewedAt = now()`.
4. Fetch `transcript.md` from R2 (server-side, hot — cache for 1 minute via Next.js `unstable_cache`).
5. Parse markdown to React components (use `react-markdown` or similar, or render raw HTML via `marked` since the markdown is trusted-source).
6. Render the page with:
   - Header: "VisionPipe Session" + capture date + "Shared by <user_name or anonymous>" + screenshot count + duration
   - Body: rendered markdown with images served from R2 public URLs
   - Audio player at the top (HTML `<audio controls>` pointing at `audio-master.webm` public URL)
   - Footer: "Captured with VisionPipe — <link to install>"

### Open Graph preview cards

The `<head>` includes:
- `<title>VisionPipe — <screenshotCount> screenshots, <duration></title>`
- `og:title`, `og:description` (first 200 chars of first screenshot's caption or transcript)
- `og:image` (URL of the first screenshot)
- `twitter:card` `summary_large_image`

This makes share links auto-preview when pasted into Slack, Twitter, Discord, iMessage, etc.

### Public read access to R2

Two options considered:
- **Public bucket with custom domain `share.visionpipe.app`**: simple, free egress. ✅ chosen.
- **Signed URLs with short expiry, server-issued per request**: tracking + revocation per asset, but complexity.

For v1, public bucket. The `share/[linkId]` route still gates *discoverability* (you need the secret link to find the bucket prefix); R2 keys are also opaque (`<orgId>/sessions/vps_<id>/...`), so guessing is impractical even if someone learns the bucket domain. View tracking lives on `shared_links.viewCount` (per-link), not per-asset.

### "Bring your own domain" / custom branding

Out of scope for v1. Future v2 add: paid orgs can map a custom domain (`shares.acme.com → share.visionpipe.app/<orgId>/...`).

---

## 9. Billing integration (credit deduction model + paywall UX)

### Cost: 50 credits per upload (flat)

- $10 base pack ($0.01/credit) → 50 credits = $0.50/share
- $100 max pack ($0.0083/credit) → 50 credits ≈ $0.42/share
- $10 pack supports 20 cloud shares; $100 pack supports 240
- Cost is value-based (signal of "this share is worth saving"), not infrastructure-based

The constant lives in `src/lib/pricing.ts` (alongside the existing pack definitions):

```typescript
export const CLOUD_UPLOAD_CREDIT_COST = 50;
```

A future spec can add tiered pricing (cost varies with size/duration) by changing this to a function.

### Paywall UX (desktop)

When user clicks "Save to cloud" but is not authenticated:

```
┌──────────────────────────────────────────────────┐
│  Save to cloud                                    │
│                                                   │
│  Cloud sharing requires a free Vision|Pipe       │
│  account.                                         │
│                                                   │
│  ┌──────────────────┐  ┌─────────────────────┐  │
│  │ Sign in / Sign up │  │ Continue locally    │  │
│  └──────────────────┘  └─────────────────────┘  │
└──────────────────────────────────────────────────┘
```

When user is authenticated but balance < 50 credits:

```
┌──────────────────────────────────────────────────┐
│  Save to cloud                                    │
│                                                   │
│  Cloud sharing costs 50 credits.                  │
│  You currently have 12 credits.                   │
│                                                   │
│  ┌──────────────────────┐  ┌─────────────────┐   │
│  │ Buy more credits →   │  │ Cancel           │   │
│  └──────────────────────┘  └─────────────────┘   │
└──────────────────────────────────────────────────┘
```

"Buy more credits →" opens `https://visionpipe.app/pricing` in the default browser. After the user purchases, the desktop polls `/api/me/balance` on focus-regain (or on next "Save to cloud" click) to detect the new balance.

When user is authenticated with sufficient balance:

```
┌──────────────────────────────────────────────────┐
│  Save to cloud                                    │
│                                                   │
│  This will upload 5 screenshots, 4m 18s of audio │
│  (4.2 MB total) and create a shareable link.     │
│                                                   │
│  Cost: 50 credits  ·  Your balance: 950 credits   │
│                                                   │
│  ☑ Generate share link (uncheck to upload only)  │
│  Link expires:  ○ Never  ○ In 7 days  ○ Custom   │
│                                                   │
│  ┌──────────┐  ┌────────┐                         │
│  │ Upload   │  │ Cancel │                         │
│  └──────────┘  └────────┘                         │
└──────────────────────────────────────────────────┘
```

### Refund policy

Failed uploads cost zero credits (not charged until finalize). If a user's upload completes but they want to delete it:

- **Soft delete (free)**: marks `capture_sessions.status = "deleted"`, keeps in R2 for 30 days, does NOT refund credits. Available from `/dashboard/sessions`.
- **Within 1 hour of upload (free, with refund)**: deletion within 1 hour of `uploadedAt` issues a `credit_charges` refund row (`reason = "cloud_upload_refund"`, `amount = -50`). Useful if user accidentally uploaded the wrong session. Available from desktop "Just shared" toast (10s window) and from dashboard.
- **After 1 hour, no refund**: standard policy.

### Bulk refunds

Stripe-side full refund of a purchase pack triggers the existing `handleChargeRefunded` webhook in Phase 1. That webhook updates `purchases.refundedCredits`. The new `getBalance` formula naturally handles this (refunded purchase credits drop from the sum). Already-spent credits do NOT recover; if the refund exceeds the available unspent balance, the user has a negative balance — block further uploads until topped up. Edge case acceptable for v1 (very rare); flag for review if it happens often.

---

## 10. API surface (full list of new endpoints)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/desktop/auth/initiate` | none | Desktop kicks off auth handshake; returns auth_url + poll_url |
| `POST` | `/api/desktop/auth/exchange` | none (challenge-based) | Desktop polls; returns token after user authorizes |
| `DELETE` | `/api/desktop/tokens/me` | desktop token | Revoke caller's own token (sign-out from desktop) |
| `DELETE` | `/api/desktop/tokens/:id` | Clerk user (web) | Revoke a token (sign-out from dashboard) |
| `GET` | `/api/desktop/tokens` | Clerk user (web) | List all tokens for current org (for dashboard "Devices" page) |
| `POST` | `/api/uploads/initiate` | desktop token | Create pending capture_session, return R2 presigned URLs |
| `POST` | `/api/uploads/:id/finalize` | desktop token | Charge credits, finalize upload, optionally create share link |
| `DELETE` | `/api/uploads/:id` | desktop token OR Clerk user | Soft-delete an upload (refund if within 1h) |
| `GET` | `/api/me/balance` | Clerk user OR desktop token | Returns current credit balance (existing endpoint, extends to accept desktop token) |
| `POST` | `/api/share-links` | desktop token OR Clerk user | Create a share link for an existing capture_session |
| `DELETE` | `/api/share-links/:id` | desktop token OR Clerk user | Revoke a share link |
| `PATCH` | `/api/share-links/:id` | desktop token OR Clerk user | Update expiry |

Plus:
- `GET /share/[linkId]` — server-rendered viewer page (public, no auth)
- `GET /auth/desktop` — interactive auth-handshake page (Clerk-protected)
- `GET /dashboard/sessions` — list user's uploaded sessions (Clerk-protected)
- `GET /dashboard/sessions/[id]` — individual session detail + share-link management (Clerk-protected)
- `GET /dashboard/devices` — list of authorized desktop installs (Clerk-protected)

### Authentication middleware

A new middleware `withDesktopAuth(handler)` sits alongside the existing `auth()` Clerk middleware:

```typescript
// src/lib/desktop-auth.ts (new)

import { sql } from "drizzle-orm";
import { db } from "./db";
import { desktopInstallTokens } from "./db/schema";
import crypto from "node:crypto";

export interface DesktopAuthContext {
  orgId: number;
  clerkUserId: string;
  tokenId: number;
}

export async function authenticateDesktopRequest(req: Request): Promise<DesktopAuthContext | null> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  const hash = crypto.createHash("sha256").update(token).digest("hex");

  const [row] = await db
    .select()
    .from(desktopInstallTokens)
    .where(sql`token_hash = ${hash} AND revoked_at IS NULL`)
    .limit(1);

  if (!row) return null;

  // fire-and-forget update
  db.execute(sql`UPDATE desktop_install_tokens SET last_used_at = NOW() WHERE id = ${row.id}`).catch(() => {});

  return { orgId: row.orgId, clerkUserId: row.clerkUserId, tokenId: row.id };
}
```

API routes that accept either Clerk session OR desktop token (`/api/me/balance`, share-link endpoints) check both:

```typescript
const desktop = await authenticateDesktopRequest(req);
const clerk = await auth();
const orgId = desktop?.orgId ?? clerk.orgId;
if (!orgId) return Response.json({ error: "unauthenticated" }, { status: 401 });
```

---

## 11. Implementation handoff notes (read before writing the plan)

### Spec 2 has a hard prerequisite: `visionpipe-web` Phase 1 must be merged

Phase 1 (`feature/stripe-billing-phase-1` in `visionpipe-web`) ships the existing schema, Clerk integration, Stripe checkout, and `getBalance`. Spec 2 extends that schema and that query. **If Phase 1 is not merged when Spec 2 implementation begins, halt.** Either help finish Phase 1 first or wait.

### Spec 1 (multi-screenshot bundle) does NOT have to be implemented first, but should be

Spec 2 reads the session-folder shape Spec 1 produces. If a Spec 2 implementer starts before Spec 1 is shipped, they have to either (a) hand-build mock session folders to test against, or (b) wait. Recommend Spec 1 → Spec 2 sequencing.

### Two repos, two implementation plans

This spec touches **both** the `visionpipe` (desktop, Tauri+Rust+React) repo and the `visionpipe-web` (Next.js) repo. The eventual implementation plan will likely split into two coordinated plans:

- **Plan 2-web**: Drizzle migration, R2 setup, all new API routes, share viewer page, dashboard pages, paywall + balance plumbing
- **Plan 2-desktop**: Auth flow client, "Save to cloud" button, paywall modals, polling + Keychain token storage

The web plan should ship first (or in parallel with mocked desktop client) so the desktop plan has live endpoints to integrate against.

### Brand / privacy disclosure

Spec 1's §11 already noted that Deepgram softens the "no uploads, no integrations, no accounts" promise. **Spec 2 explicitly breaks all three of those promises for the cloud-share flow**: there are uploads, there's an integration with Stripe/Clerk/R2, and there's an account. That's intentional — it's an opt-in paid feature. The README and onboarding need clear copy:

- "Local sessions never leave your machine" (true — cloud is opt-in)
- "Cloud sharing requires a Vision|Pipe account and credits" (true — paywall)
- "Shared sessions are visible to anyone with the secret link" (true — disclose this in the upload modal)

### `vp-edge` proxy is a separate piece of infrastructure

Spec 1's transcription proxy (`vp-edge`) and Spec 2's web app (`visionpipe-web`) are distinct services. Don't confuse:
- `vp-edge`: WebSocket proxy for Deepgram transcription. Does not touch Clerk/Stripe/Drizzle. Lives wherever (Cloudflare Worker recommended).
- `visionpipe-web`: Next.js app on Vercel. Has Clerk/Stripe/Drizzle. Handles uploads + share + auth + dashboard.

If a future spec wants to merge them (e.g., Spec 3's transcription billing), that's a fresh decision.

### Why each major architectural choice was made

| Choice | Real reason |
|---|---|
| Direct desktop → R2 PUT via presigned URLs (not through Next.js) | Vercel has 4.5 MB body size limit; sessions can be 100 MB; bandwidth-through-Vercel costs money |
| Charge on finalize, not on initiate | Failed uploads must not cost users; abuse window bounded by R2 lifecycle policy + initiate rate limit |
| Opaque tokens, not JWTs | Easier revocation, no key management, simpler auth middleware |
| Polling auth flow, not URL scheme callback | More reliable across browsers; URL-scheme prompts get rejected by paranoid users |
| `credit_charges` ledger table, not `balance` column | Matches Phase 1's "compute live, no cache" philosophy; provides audit trail for free |
| Public R2 bucket, not signed URLs per asset | Free egress; opaque URLs are sufficient defense for v1; per-link view tracking lives on `shared_links` |
| Server-rendered Next.js viewer, not static SPA | Open Graph preview cards out of the box; reuses existing app deploy; no separate viewer to maintain |
| Single hot R2 tier, no cold archive in v1 | At ~$0.015/GB-month, even 10K active sessions = ~$1.50/month — not worth optimizing |
| `pending/` prefix + lifecycle policy, no app-side cleanup cron | Lifecycle policy is reliable, ops-free; app cron adds infra without benefit |

### Things that look weird but are intentional

- **Multiple share links per capture_session is allowed.** A user might revoke a link they accidentally tweeted, then create a new one. Don't constrain.
- **`credit_charges.amount` is positive for deductions, negative for refunds.** Reads weirdly but matches the SQL `SUM(amount)` semantics in `getBalance`.
- **Token has no expiry.** Sessions are explicit revocations only. Adding expiry would force users to re-auth every N days for no security benefit (the token is only as compromised as the device it lives on).
- **The auth handshake polls instead of using a webhook.** Simpler — no inbound URL scheme to register, no firewall punching.
- **The `desktop_session_id` column on `capture_sessions`** is a string copied verbatim from the desktop ("session-2026-05-02_14-23-07"). It's not used as a key — it's a debug breadcrumb so support can trace back to the desktop folder if needed.
- **`viewCount` is incremented on every page render**, including by bots. For v1, accept noise. v2 can add bot filtering.

### Test discipline

- Drizzle migrations: write a roll-forward + roll-back test
- API routes: integration tests against a real Postgres test instance (Phase 1 already has this pattern)
- Share viewer page: snapshot test with a fixture session
- Auth flow: unit tests for token generation, hash, lookup, revocation; integration test against Clerk's testing helpers
- Paywall UX (desktop): React component tests with all four states (no auth, low balance, sufficient balance, insufficient after attempt)
- R2 integration: use Cloudflare's local R2 emulator (Miniflare) in CI; production uses real R2

---

## 12. Testing strategy

### Unit tests

- `getBalance(orgId)` — golden tests: 0 purchases, 1 purchase no charges, multiple purchases with mixed expiry, charges only, refunds, mixed
- `chargeCredits(orgId, amount, reason, refId)` — happy path, insufficient balance throws, transaction atomicity (concurrent charges should serialize)
- Token hash + lookup — collision-free, lookup by hash returns row
- Share-link ID generation — entropy check, no collisions in 1M generations
- Markdown URL rewriting (desktop side) — replaces local paths with public URLs correctly, handles edge cases (Windows backslashes, special chars in filenames)

### Integration tests (web)

- Full upload flow: initiate → mock R2 PUTs → finalize → assert credits deducted, share link created
- Failed upload: initiate → never finalize → 24h cleanup test (use time travel)
- Insufficient credits: balance = 49, attempt finalize → 402 returned, no charge made
- Concurrent finalize on same session: only one succeeds
- Auth handshake: initiate → simulate Clerk auth → exchange → token returned
- Revoked token: subsequent request → 401

### Integration tests (desktop)

- "Save to cloud" with no auth: paywall shown, sign-in flow opens browser
- "Save to cloud" with auth + 0 credits: paywall shown, "Buy credits" opens pricing page
- "Save to cloud" with auth + sufficient credits: full upload → toast with link
- "Save to cloud" mid-upload network failure: partial files in R2, session marked failed, no credit charge
- Polling timeout: auth handshake never completes → desktop times out at 5min, shows "try again"
- Token rotation: user revokes token from web dashboard → next desktop request gets 401, prompts re-sign-in

### Manual smoke tests

- Upload a 5-screenshot session, confirm share link works in: Chrome, Safari, Firefox, an iPhone Safari
- Paste share link into Slack, verify Open Graph preview card appears
- Audio playback in viewer works on all browsers (WebM Opus support)
- Revoke a link from dashboard, verify viewer shows 410 within seconds (no caching delay)
- Stripe refund of a credit pack → balance updates → uploads still work if balance > 0
- Sign out from desktop → Keychain entry deleted → "Save to cloud" reverts to "Sign in"

---

## 13. Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| R2 outage → all share links 5xx | High | Cloudflare's R2 SLA is 99.9%. Status page + alerts. Viewer route returns "temporarily unavailable" with retry. |
| Vercel function timeout on finalize (server-side R2 copy from `pending/` to `sessions/` is sync) | Med | R2 copy is fast (~100ms per object even for large files; metadata-only copy). For 250-file session: ~25s, within Vercel's 60s default. If exceeded, switch to Background Functions. |
| Concurrent finalize causes double-charge | Med | DB transaction with `SELECT … FOR UPDATE` on the `capture_sessions` row. Idempotency: status check fails if already complete. |
| User accidentally shares sensitive content publicly | Med (UX) | Upload modal copy: "Anyone with the link can view this." Explicit checkbox to confirm sharing. Easy revocation from dashboard + desktop "Just shared" toast. |
| Bot enumeration of share-link IDs | Low | 96-bit entropy IDs; ~10²⁰ tries to find one. WAF rate limits viewer route. |
| Stripe refund of a pack, but credits already spent → negative balance | Low | Detected at upload time (`getBalance < 50` blocks). Block further uploads; manual support intervention. |
| Cost spike from heavy users | Low | Credits are pre-paid; storage is paid by us but cost is ~$0.50/year for an active user's sessions; well below revenue per user |
| Desktop user stolen → attacker uses cached token to upload | Low | User can revoke token from web dashboard immediately; tokens have no implicit power beyond uploading + spending the user's own credits |
| Drizzle migration on production Neon deletes data | High | Always test migrations against a copy of prod first; use `drizzle-kit push:pg` only in dev, `drizzle-kit migrate` in prod |
| `getBalance` becomes slow as `credit_charges` grows large | Low (long-term) | Index `credit_charges` on `(org_id, refunded_at)`. Materialized view for very-active orgs (deferred). |

---

## 14. Out of scope (explicit)

These are intentionally not in this spec:

- **Transcription billing** — Spec 1's `vp-edge` stays free + rate-limited. Spec 3 (future) will introduce credit-deducting transcription.
- **Multi-member team uploads** — wait until `visionpipe-web` Phase 1.5 ships multi-member orgs
- **Viewer authentication** ("require Clerk sign-in to view")
- **Custom domain on share links**
- **Editing or annotating sessions after upload** — uploads are immutable
- **Bidirectional cloud sync** — desktop pushes to cloud; cloud doesn't sync back to desktop
- **Cold storage tier / archive policies**
- **In-desktop "my shared sessions" UI** — managed via web dashboard
- **International (non-US) tax / billing** — inherits Phase 1's US-only constraint
- **Webhook/notification on share-link views** — defer
- **Per-asset signed URLs** — using public bucket for v1
- **Cloud-storage size limits beyond per-upload (100 MB)** — no per-org storage quota in v1; revisit if abuse appears
- **Migration of existing local sessions to cloud at sign-up** — future "import all my prior sessions" flow

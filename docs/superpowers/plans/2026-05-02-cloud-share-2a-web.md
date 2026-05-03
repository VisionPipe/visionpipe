# Cloud Share + Secret-Link Sharing — Plan 2a (Web Side) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Read first:** [`docs/superpowers/specs/2026-05-02-cloud-share-secret-link-design.md`](../specs/2026-05-02-cloud-share-secret-link-design.md). Implementation handoff notes are in §11. Two-repo coordination is real; **this plan is the WEB side only** — Plan 2b covers the desktop side.

**Goal:** Build the `visionpipe-web` (Next.js) side of cloud upload + secret-link sharing for VisionPipe sessions: 4 new Drizzle tables, an extended `getBalance`, R2-backed presigned-upload flow, share-link API + server-rendered viewer page, and dashboard pages for session/device management. Charge 50 credits per upload, gate access via Clerk auth, public viewer for anonymous recipients.

**Architecture:** Extends the existing `visionpipe-web` Next.js 15 app on Vercel. Reuses Phase 1's Clerk + Stripe + Neon Postgres + Drizzle + Resend infrastructure. Adds Cloudflare R2 (via `@aws-sdk/client-s3` since R2 is S3-compatible) for asset storage with public read on `share.visionpipe.app`. Adds `withDesktopAuth` middleware that authenticates desktop callers via opaque tokens stored in `desktop_install_tokens` table. Three-step upload protocol (initiate → direct PUT to R2 → finalize) charges credits only on finalize so failed uploads cost nothing. Cron via Vercel Scheduled Functions cleans up abandoned uploads after 24h.

**Tech Stack:**
- Existing: Next.js 15 (App Router), TypeScript, Drizzle ORM 0.36, `@neondatabase/serverless`, `@clerk/nextjs` 6, `stripe` 17, `resend` 4, `vitest` 2
- New: `@aws-sdk/client-s3` (R2 client; S3-compatible API), `@aws-sdk/s3-request-presigner` (presigned URL generation), `nanoid` (opaque ID generation), `react-markdown` + `remark-gfm` (viewer rendering)
- External: Cloudflare R2 (bucket `visionpipe-shares`, public custom domain `share.visionpipe.app`)
- Repo: `/Users/drodio/Projects/visionpipe-web`. **All paths in this plan are relative to that repo.**

---

## Pre-flight checks (do these before Task 1)

- [ ] You are working in `/Users/drodio/Projects/visionpipe-web`. Run `pwd` to confirm. (NOT `/Users/drodio/Projects/visionpipe` — that's the desktop repo.)
- [ ] `feature/stripe-billing-phase-1` is **merged into main** in this repo. Confirm with `git log main --oneline | head -20` — you should see the Phase 1 commits. If not merged, halt and ask the user.
- [ ] Create a fresh branch off main: `git checkout main && git pull && git checkout -b feature/cloud-share-secret-link`. Use the **same branch name** as the desktop repo for ease of cross-repo coordination.
- [ ] Confirm `pnpm install` (or `npm install` — check which one this repo uses) and `pnpm dev` work cleanly before any changes.
- [ ] Confirm Cloudflare R2 access: a bucket named `visionpipe-shares` exists, and you have credentials in `.env.local` as `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`, `R2_BUCKET=visionpipe-shares`, `R2_PUBLIC_BASE=https://share.visionpipe.app`. If R2 isn't set up yet, see Task 7 for setup steps.
- [ ] Confirm DB connection works: `pnpm drizzle-kit studio` (or whatever the existing repo uses) opens without error against the Neon DB pointed at by `DATABASE_URL`.

---

## File structure

This plan creates and modifies the following files. Each task notes which files it touches.

**New TypeScript files:**

| File | Responsibility |
|---|---|
| `src/db/schema.ts` (extended) | Add `desktopInstallTokens`, `captureSessions`, `sharedLinks`, `creditCharges` tables |
| `src/db/queries.ts` (extended) | Update `getBalance(orgId)` to subtract `credit_charges`; add `chargeCredits`, `refundCharge`, helpers |
| `drizzle/<timestamp>_cloud_share_tables.sql` | Drizzle migration for the 4 new tables |
| `src/lib/desktop-auth.ts` | Token issuance, hashing, lookup, revocation; `authenticateDesktopRequest` middleware |
| `src/lib/r2.ts` | R2 client wrapper: presigned PUT URL generation, server-side copy/delete, HEAD for verification |
| `src/lib/pricing.ts` (extended) | Add `CLOUD_UPLOAD_CREDIT_COST = 50` constant |
| `src/lib/share-link.ts` | Share-link ID generation, expiry check, view-count increment |
| `src/lib/markdown-viewer.ts` | Server-side markdown → HTML rendering for `/share/[id]` page |
| `src/app/auth/desktop/page.tsx` | Interactive auth-handshake page (Clerk-protected; "Authorize VisionPipe" button) |
| `src/app/share/[linkId]/page.tsx` | Server-rendered public viewer for shared sessions |
| `src/app/share/[linkId]/opengraph-image.tsx` | Open Graph image generation (Next.js convention) |
| `src/app/dashboard/sessions/page.tsx` | List of user's uploaded sessions (Clerk-protected) |
| `src/app/dashboard/sessions/[id]/page.tsx` | Session detail + share-link management (Clerk-protected) |
| `src/app/dashboard/devices/page.tsx` | Authorized desktop install tokens; revoke buttons |
| `src/app/api/desktop/auth/initiate/route.ts` | POST: create pending auth handshake, return auth_url + poll_url |
| `src/app/api/desktop/auth/exchange/route.ts` | POST: exchange challenge for token after user authorizes |
| `src/app/api/desktop/auth/authorize/route.ts` | POST (web only): the "Authorize" button on /auth/desktop calls this to mint the token |
| `src/app/api/desktop/tokens/me/route.ts` | DELETE: revoke caller's own token |
| `src/app/api/desktop/tokens/[id]/route.ts` | DELETE: web-side token revocation |
| `src/app/api/desktop/tokens/route.ts` | GET: list current org's tokens |
| `src/app/api/uploads/initiate/route.ts` | POST: create pending capture_session, return presigned URLs |
| `src/app/api/uploads/[id]/finalize/route.ts` | POST: charge credits, finalize, optionally create share link |
| `src/app/api/uploads/[id]/route.ts` | DELETE: soft-delete + conditional refund |
| `src/app/api/share-links/route.ts` | POST: create share link for existing session |
| `src/app/api/share-links/[id]/route.ts` | DELETE/PATCH: revoke / update expiry |
| `src/app/api/me/balance/route.ts` (extended) | Accept either Clerk session OR desktop token |
| `src/app/api/cron/cleanup-pending-uploads/route.ts` | Vercel cron: marks 24h+ pending sessions as failed |

**New TypeScript test files (Vitest):**

| File | Tests |
|---|---|
| `src/lib/__tests__/desktop-auth.test.ts` | Token gen/hash/lookup/revoke |
| `src/lib/__tests__/share-link.test.ts` | ID generation entropy, expiry checks |
| `src/db/__tests__/credit-charges.test.ts` | `getBalance` updated formula, `chargeCredits` atomicity |
| `src/lib/__tests__/r2.test.ts` | Presigned URL shape (no actual R2 calls; verify SDK call args) |
| `src/lib/__tests__/markdown-viewer.test.ts` | Markdown → HTML, image URL rewrite, sanitization |
| `src/app/api/uploads/__tests__/initiate.test.ts` | Auth, validation, presigned URL response shape |
| `src/app/api/uploads/__tests__/finalize.test.ts` | Credit charge, status transition, idempotency |

**Modified files (existing):**

| File | Change |
|---|---|
| `src/db/schema.ts` | Add 4 new tables (no changes to existing tables) |
| `src/db/queries.ts` | Update `getBalance` to subtract `credit_charges` |
| `src/lib/pricing.ts` | Add `CLOUD_UPLOAD_CREDIT_COST = 50` |
| `package.json` | Add deps: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `nanoid`, `react-markdown`, `remark-gfm`, `dompurify`, `isomorphic-dompurify` |
| `vercel.json` | Add cron schedule for cleanup-pending-uploads (every 6h) |
| `.env.example` | Add R2 env vars (placeholders, no real values) |
| `next.config.ts` | Add `share.visionpipe.app` to `images.remotePatterns` if needed for `next/image` |

---

## Phase A — Database schema (4 new tables, getBalance update)

### Task 1: Add 4 new tables to Drizzle schema

**Files:**
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Read existing schema to confirm imports + style**

Run: `cat src/db/schema.ts`
Expected: see existing `organizations`, `memberships`, `purchases`, `webhookEvents` table definitions. Note the exact import statements and column-naming conventions.

- [ ] **Step 2: Add 4 new tables to `src/db/schema.ts`**

Append to the existing schema file (after the last existing table definition):

```typescript
// ===== Cloud Share + Secret-Link Sharing (Spec 2) =====

export const desktopInstallTokens = pgTable("desktop_install_tokens", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organizations.id),
  clerkUserId: text("clerk_user_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  installLabel: text("install_label"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at"),
  revokedAt: timestamp("revoked_at"),
});

export const captureSessions = pgTable("capture_sessions", {
  id: text("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organizations.id),
  uploadedByClerkUserId: text("uploaded_by_clerk_user_id").notNull(),
  status: text("status", { enum: ["pending", "complete", "failed", "deleted"] }).notNull(),
  desktopSessionId: text("desktop_session_id").notNull(),
  screenshotCount: integer("screenshot_count").notNull(),
  durationSec: integer("duration_sec").notNull(),
  totalSizeBytes: bigint("total_size_bytes", { mode: "number" }).notNull(),
  creditsCharged: integer("credits_charged").notNull().default(0),
  r2Prefix: text("r2_prefix").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  uploadedAt: timestamp("uploaded_at"),
  expiresAt: timestamp("expires_at"),
});

export const sharedLinks = pgTable("shared_links", {
  id: text("id").primaryKey(),
  captureSessionId: text("capture_session_id").notNull().references(() => captureSessions.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at"),
  revokedAt: timestamp("revoked_at"),
  viewCount: integer("view_count").notNull().default(0),
  lastViewedAt: timestamp("last_viewed_at"),
});

export const creditCharges = pgTable("credit_charges", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organizations.id),
  amount: integer("amount").notNull(),
  reason: text("reason", { enum: ["cloud_upload", "cloud_upload_refund"] }).notNull(),
  refId: text("ref_id"),
  chargedAt: timestamp("charged_at").notNull().defaultNow(),
  refundedAt: timestamp("refunded_at"),
});
```

If `bigint` is not already imported, add it to the existing `import { ... } from "drizzle-orm/pg-core"` line.

- [ ] **Step 3: Generate the migration file**

Run: `pnpm drizzle-kit generate` (or `npm run db:generate` — check `package.json` scripts)
Expected: a new file appears in `drizzle/` named like `0002_<random>.sql`. Inspect it: should contain 4 `CREATE TABLE` statements.

- [ ] **Step 4: Apply migration to local Neon DB**

Run: `pnpm drizzle-kit migrate` (or `npm run db:migrate`)
Expected: migration applied; `pnpm drizzle-kit studio` shows the 4 new tables.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "Add 4 cloud-share tables to Drizzle schema (desktop_install_tokens, capture_sessions, shared_links, credit_charges)"
```

---

### Task 2: Update getBalance to subtract credit_charges + write tests

**Files:**
- Modify: `src/db/queries.ts`
- Create: `src/db/__tests__/credit-charges.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/db/__tests__/credit-charges.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../index";
import { organizations, purchases, creditCharges } from "../schema";
import { getBalance, chargeCredits } from "../queries";
import { eq } from "drizzle-orm";

const fakeOrg = async (label = "test"): Promise<number> => {
  const [row] = await db.insert(organizations).values({
    clerkOrgId: `clerk_org_${Date.now()}_${Math.random()}`,
    type: "personal",
    name: label,
  }).returning();
  return row.id;
};

const cleanup = async (orgId: number) => {
  await db.delete(creditCharges).where(eq(creditCharges.orgId, orgId));
  await db.delete(purchases).where(eq(purchases.orgId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
};

describe("getBalance with credit_charges", () => {
  it("returns 0 for an org with no purchases or charges", async () => {
    const orgId = await fakeOrg("no-activity");
    expect(await getBalance(orgId)).toBe(0);
    await cleanup(orgId);
  });

  it("returns full purchase credits when no charges exist", async () => {
    const orgId = await fakeOrg("only-purchase");
    await db.insert(purchases).values({
      orgId, sku: "pack_10",
      stripeCheckoutSessionId: `cs_${Date.now()}`,
      stripePaymentIntentId: `pi_${Date.now()}`,
      creditsPurchased: 1000, amountCents: 1000, currency: "usd",
      status: "complete", refundedCredits: 0,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      completedAt: new Date(),
    });
    expect(await getBalance(orgId)).toBe(1000);
    await cleanup(orgId);
  });

  it("subtracts unrefunded credit charges", async () => {
    const orgId = await fakeOrg("with-charges");
    await db.insert(purchases).values({
      orgId, sku: "pack_10",
      stripeCheckoutSessionId: `cs_${Date.now()}`,
      stripePaymentIntentId: `pi_${Date.now()}`,
      creditsPurchased: 1000, amountCents: 1000, currency: "usd",
      status: "complete", refundedCredits: 0,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      completedAt: new Date(),
    });
    await db.insert(creditCharges).values({
      orgId, amount: 50, reason: "cloud_upload", refId: "vps_test",
    });
    expect(await getBalance(orgId)).toBe(950);
    await cleanup(orgId);
  });

  it("ignores refunded charges (refundedAt set)", async () => {
    const orgId = await fakeOrg("with-refund");
    await db.insert(purchases).values({
      orgId, sku: "pack_10",
      stripeCheckoutSessionId: `cs_${Date.now()}`,
      stripePaymentIntentId: `pi_${Date.now()}`,
      creditsPurchased: 1000, amountCents: 1000, currency: "usd",
      status: "complete", refundedCredits: 0,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      completedAt: new Date(),
    });
    await db.insert(creditCharges).values({
      orgId, amount: 50, reason: "cloud_upload", refId: "vps_test",
      refundedAt: new Date(),
    });
    expect(await getBalance(orgId)).toBe(1000);
    await cleanup(orgId);
  });
});

describe("chargeCredits", () => {
  it("inserts a credit_charges row and returns new balance", async () => {
    const orgId = await fakeOrg("charge-success");
    await db.insert(purchases).values({
      orgId, sku: "pack_10",
      stripeCheckoutSessionId: `cs_${Date.now()}`,
      stripePaymentIntentId: `pi_${Date.now()}`,
      creditsPurchased: 1000, amountCents: 1000, currency: "usd",
      status: "complete", refundedCredits: 0,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      completedAt: new Date(),
    });
    const result = await chargeCredits({
      orgId, amount: 50, reason: "cloud_upload", refId: "vps_x",
    });
    expect(result.newBalance).toBe(950);
    expect(await getBalance(orgId)).toBe(950);
    await cleanup(orgId);
  });

  it("throws InsufficientCreditsError when balance < amount", async () => {
    const orgId = await fakeOrg("insufficient");
    await expect(chargeCredits({
      orgId, amount: 50, reason: "cloud_upload", refId: "vps_x",
    })).rejects.toThrow(/insufficient/i);
    await cleanup(orgId);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm vitest run src/db/__tests__/credit-charges.test.ts`
Expected: failures referencing `chargeCredits is not exported` and `getBalance` returning the wrong value.

- [ ] **Step 3: Update `getBalance` and add `chargeCredits` in `src/db/queries.ts`**

Replace the existing `getBalance` function and add `chargeCredits`:

```typescript
import { db } from "./index";
import { sql } from "drizzle-orm";
import { creditCharges } from "./schema";

export class InsufficientCreditsError extends Error {
  constructor(public available: number, public requested: number) {
    super(`Insufficient credits: have ${available}, need ${requested}`);
    this.name = "InsufficientCreditsError";
  }
}

export async function getBalance(orgId: number): Promise<number> {
  const result = await db.execute(sql`
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
  return Number(result.rows[0].balance);
}

interface ChargeArgs {
  orgId: number;
  amount: number;
  reason: "cloud_upload" | "cloud_upload_refund";
  refId: string;
}

export async function chargeCredits(args: ChargeArgs): Promise<{ chargeId: number; newBalance: number }> {
  return await db.transaction(async (tx) => {
    const balanceResult = await tx.execute(sql`
      SELECT
        COALESCE((SELECT SUM(credits_purchased - refunded_credits) FROM purchases
          WHERE org_id = ${args.orgId} AND status IN ('complete', 'partially_refunded') AND expires_at > NOW()), 0)
        -
        COALESCE((SELECT SUM(amount) FROM credit_charges
          WHERE org_id = ${args.orgId} AND refunded_at IS NULL), 0)
      AS balance
    `);
    const available = Number(balanceResult.rows[0].balance);
    if (available < args.amount) {
      throw new InsufficientCreditsError(available, args.amount);
    }
    const [row] = await tx.insert(creditCharges).values({
      orgId: args.orgId,
      amount: args.amount,
      reason: args.reason,
      refId: args.refId,
    }).returning({ id: creditCharges.id });
    return { chargeId: row.id, newBalance: available - args.amount };
  });
}

export async function refundCharge(refId: string): Promise<void> {
  await db.execute(sql`
    UPDATE credit_charges
    SET refunded_at = NOW()
    WHERE ref_id = ${refId} AND refunded_at IS NULL
  `);
}
```

- [ ] **Step 4: Run tests to pass**

Run: `pnpm vitest run src/db/__tests__/credit-charges.test.ts`
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/db/queries.ts src/db/__tests__/credit-charges.test.ts
git commit -m "Update getBalance to subtract credit_charges; add chargeCredits + refundCharge"
```

---

## Phase B — Desktop auth flow (3 API routes + 1 web page)

### Task 3: Desktop auth library (token gen, hash, lookup)

**Files:**
- Create: `src/lib/desktop-auth.ts`
- Create: `src/lib/__tests__/desktop-auth.test.ts`

- [ ] **Step 1: Install nanoid**

Run: `pnpm add nanoid`

- [ ] **Step 2: Write failing tests**

Create `src/lib/__tests__/desktop-auth.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  generateToken, hashToken, generateChallenge, hashChallenge, verifyChallengeMatches,
} from "../desktop-auth";

describe("token primitives", () => {
  it("generateToken produces 256-bit base64url string", () => {
    const t = generateToken();
    // Decoded length should be 32 bytes (256 bits)
    const decoded = Buffer.from(t, "base64url");
    expect(decoded.length).toBe(32);
  });

  it("hashToken returns 64-char lowercase hex sha256", () => {
    const h = hashToken("abc");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("two different tokens hash to different values", () => {
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });
});

describe("challenge primitives", () => {
  it("generateChallenge returns 256-bit base64url", () => {
    const c = generateChallenge();
    expect(Buffer.from(c, "base64url").length).toBe(32);
  });

  it("verifyChallengeMatches matches when raw hashes to stored", () => {
    const raw = generateChallenge();
    const stored = hashChallenge(raw);
    expect(verifyChallengeMatches(raw, stored)).toBe(true);
  });

  it("verifyChallengeMatches rejects mismatched", () => {
    const raw = generateChallenge();
    const stored = hashChallenge(generateChallenge());
    expect(verifyChallengeMatches(raw, stored)).toBe(false);
  });
});
```

- [ ] **Step 3: Run, expect failure**

Run: `pnpm vitest run src/lib/__tests__/desktop-auth.test.ts`
Expected: module-not-found.

- [ ] **Step 4: Implement `src/lib/desktop-auth.ts`**

```typescript
import crypto from "node:crypto";
import { db } from "../db";
import { desktopInstallTokens } from "../db/schema";
import { eq, and, isNull, sql } from "drizzle-orm";

export function generateToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function generateChallenge(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashChallenge(challenge: string): string {
  return crypto.createHash("sha256").update(challenge).digest("hex");
}

export function verifyChallengeMatches(raw: string, storedHash: string): boolean {
  return hashChallenge(raw) === storedHash;
}

export interface DesktopAuthContext {
  orgId: number;
  clerkUserId: string;
  tokenId: number;
}

export async function authenticateDesktopRequest(req: Request): Promise<DesktopAuthContext | null> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  const hash = hashToken(token);

  const [row] = await db
    .select()
    .from(desktopInstallTokens)
    .where(and(eq(desktopInstallTokens.tokenHash, hash), isNull(desktopInstallTokens.revokedAt)))
    .limit(1);

  if (!row) return null;

  // Fire-and-forget last_used_at update
  db.execute(sql`UPDATE desktop_install_tokens SET last_used_at = NOW() WHERE id = ${row.id}`).catch(() => {});

  return { orgId: row.orgId, clerkUserId: row.clerkUserId, tokenId: row.id };
}

export async function issueToken(args: {
  orgId: number;
  clerkUserId: string;
  installLabel: string | null;
}): Promise<{ token: string; tokenId: number }> {
  const token = generateToken();
  const hash = hashToken(token);
  const [row] = await db.insert(desktopInstallTokens).values({
    orgId: args.orgId,
    clerkUserId: args.clerkUserId,
    tokenHash: hash,
    installLabel: args.installLabel,
  }).returning({ id: desktopInstallTokens.id });
  return { token, tokenId: row.id };
}

export async function revokeToken(tokenId: number): Promise<void> {
  await db.update(desktopInstallTokens)
    .set({ revokedAt: new Date() })
    .where(eq(desktopInstallTokens.id, tokenId));
}

export async function revokeTokenByHash(hash: string): Promise<void> {
  await db.update(desktopInstallTokens)
    .set({ revokedAt: new Date() })
    .where(eq(desktopInstallTokens.tokenHash, hash));
}
```

- [ ] **Step 5: Run tests, expect green**

Run: `pnpm vitest run src/lib/__tests__/desktop-auth.test.ts`
Expected: all 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/desktop-auth.ts src/lib/__tests__/desktop-auth.test.ts package.json pnpm-lock.yaml
git commit -m "Add desktop-auth library with token gen/hash/verify primitives"
```

---

### Task 4: Pending-handshake DB table + initiate route

The auth handshake needs a transient store of pending handshakes (challenge_hash, completed flag, issued token). Adding a 5th table.

**Files:**
- Modify: `src/db/schema.ts`
- Create: `src/app/api/desktop/auth/initiate/route.ts`

- [ ] **Step 1: Add `desktop_auth_handshakes` table**

In `src/db/schema.ts`, append:

```typescript
export const desktopAuthHandshakes = pgTable("desktop_auth_handshakes", {
  id: text("id").primaryKey(),                          // "dah_<nanoid>"
  challengeHash: text("challenge_hash").notNull(),
  installLabel: text("install_label"),
  status: text("status", { enum: ["pending", "authorized", "expired"] }).notNull().default("pending"),
  authorizedTokenId: integer("authorized_token_id").references(() => desktopInstallTokens.id),
  authorizedTokenPlaintext: text("authorized_token_plaintext"),  // ephemeral; cleared on first exchange
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),         // 10 minutes from creation
  exchangedAt: timestamp("exchanged_at"),
});
```

- [ ] **Step 2: Generate + apply migration**

```bash
pnpm drizzle-kit generate
pnpm drizzle-kit migrate
```

Expected: 5th table appears in studio.

- [ ] **Step 3: Implement initiate route**

Create `src/app/api/desktop/auth/initiate/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { desktopAuthHandshakes } from "@/db/schema";
import { nanoid } from "nanoid";
import { z } from "zod";

const Body = z.object({
  challengeHash: z.string().regex(/^[0-9a-f]{64}$/, "must be sha256 hex"),
  installLabel: z.string().max(120).optional(),
});

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const id = `dah_${nanoid(24)}`;
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await db.insert(desktopAuthHandshakes).values({
    id,
    challengeHash: parsed.data.challengeHash,
    installLabel: parsed.data.installLabel ?? null,
    expiresAt,
  });

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://visionpipe.app";
  return NextResponse.json({
    pendingId: id,
    authUrl: `${baseUrl}/auth/desktop?pending_id=${id}`,
    pollUrl: `${baseUrl}/api/desktop/auth/exchange`,
    expiresAt: expiresAt.toISOString(),
  });
}
```

You may need to install `zod` if not already a dep. Run: `pnpm add zod`.

- [ ] **Step 4: Smoke test the route**

Run: `pnpm dev` (in another terminal), then:

```bash
curl -X POST http://localhost:3000/api/desktop/auth/initiate \
  -H "content-type: application/json" \
  -d '{"challengeHash":"a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3","installLabel":"Test Mac"}'
```

Expected: JSON response with `pendingId`, `authUrl`, `pollUrl`, `expiresAt`.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts drizzle/ src/app/api/desktop/auth/initiate/route.ts package.json pnpm-lock.yaml
git commit -m "Add desktop_auth_handshakes table and POST /api/desktop/auth/initiate"
```

---

### Task 5: Authorize route (web-side button handler)

**Files:**
- Create: `src/app/api/desktop/auth/authorize/route.ts`

- [ ] **Step 1: Implement**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { db } from "@/db";
import { desktopAuthHandshakes, organizations } from "@/db/schema";
import { issueToken } from "@/lib/desktop-auth";
import { findOrCreateOrgForUser } from "@/lib/clerk-backend";  // existing helper from Phase 1
import { eq } from "drizzle-orm";
import { z } from "zod";

const Body = z.object({ pendingId: z.string().startsWith("dah_") });

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const [handshake] = await db.select().from(desktopAuthHandshakes)
    .where(eq(desktopAuthHandshakes.id, parsed.data.pendingId)).limit(1);

  if (!handshake) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (handshake.status !== "pending") return NextResponse.json({ error: "already_used_or_expired" }, { status: 409 });
  if (handshake.expiresAt < new Date()) return NextResponse.json({ error: "expired" }, { status: 410 });

  // Find or create the org for this Clerk user (Phase 1's existing helper)
  const user = await currentUser();
  const org = await findOrCreateOrgForUser({
    clerkUserId: userId,
    email: user?.emailAddresses?.[0]?.emailAddress ?? "",
    firstName: user?.firstName ?? user?.emailAddresses?.[0]?.emailAddress?.split("@")[0] ?? "",
  });

  const { token, tokenId } = await issueToken({
    orgId: org.id,
    clerkUserId: userId,
    installLabel: handshake.installLabel,
  });

  await db.update(desktopAuthHandshakes).set({
    status: "authorized",
    authorizedTokenId: tokenId,
    authorizedTokenPlaintext: token,
  }).where(eq(desktopAuthHandshakes.id, parsed.data.pendingId));

  return NextResponse.json({ success: true });
}
```

> **Note:** This file imports `findOrCreateOrgForUser` from `@/lib/clerk-backend`, which is a Phase 1 helper. Confirm it exists with `grep -r findOrCreateOrgForUser src/`. If it has a different signature than assumed above, adjust the call site.

- [ ] **Step 2: Commit**

```bash
git add src/app/api/desktop/auth/authorize/route.ts
git commit -m "Add POST /api/desktop/auth/authorize for the web-side Authorize button"
```

---

### Task 6: Exchange route (desktop polling endpoint)

**Files:**
- Create: `src/app/api/desktop/auth/exchange/route.ts`

- [ ] **Step 1: Implement**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { desktopAuthHandshakes, desktopInstallTokens } from "@/db/schema";
import { verifyChallengeMatches } from "@/lib/desktop-auth";
import { eq } from "drizzle-orm";
import { z } from "zod";

const Body = z.object({
  pendingId: z.string().startsWith("dah_"),
  challenge: z.string().min(40),
});

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const [handshake] = await db.select().from(desktopAuthHandshakes)
    .where(eq(desktopAuthHandshakes.id, parsed.data.pendingId)).limit(1);

  if (!handshake) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!verifyChallengeMatches(parsed.data.challenge, handshake.challengeHash)) {
    return NextResponse.json({ error: "challenge_mismatch" }, { status: 403 });
  }
  if (handshake.expiresAt < new Date()) {
    return NextResponse.json({ error: "expired" }, { status: 410 });
  }
  if (handshake.status === "pending") {
    return NextResponse.json({ status: "pending" }, { status: 202 });
  }
  if (handshake.status !== "authorized" || !handshake.authorizedTokenPlaintext) {
    return NextResponse.json({ error: "not_authorized" }, { status: 409 });
  }

  // Token retrieval consumes the plaintext (one-shot)
  const token = handshake.authorizedTokenPlaintext;
  await db.update(desktopAuthHandshakes).set({
    authorizedTokenPlaintext: null,
    exchangedAt: new Date(),
  }).where(eq(desktopAuthHandshakes.id, parsed.data.pendingId));

  // Look up org info to return alongside the token
  const [tokenRow] = await db.select().from(desktopInstallTokens)
    .where(eq(desktopInstallTokens.id, handshake.authorizedTokenId!)).limit(1);

  return NextResponse.json({
    status: "authorized",
    token,
    tokenId: handshake.authorizedTokenId,
    orgId: tokenRow?.orgId,
    clerkUserId: tokenRow?.clerkUserId,
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/desktop/auth/exchange/route.ts
git commit -m "Add POST /api/desktop/auth/exchange for desktop polling"
```

---

### Task 7: /auth/desktop page (interactive Authorize button)

**Files:**
- Create: `src/app/auth/desktop/page.tsx`

- [ ] **Step 1: Implement**

```tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { desktopAuthHandshakes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { AuthorizeButton } from "./AuthorizeButton";

interface Props {
  searchParams: Promise<{ pending_id?: string }>;
}

export default async function DesktopAuthPage({ searchParams }: Props) {
  const { pending_id } = await searchParams;
  if (!pending_id) {
    return <div className="p-8">Missing pending_id query parameter.</div>;
  }

  const { userId } = await auth();
  if (!userId) {
    redirect(`/sign-in?redirect_url=${encodeURIComponent(`/auth/desktop?pending_id=${pending_id}`)}`);
  }

  const [handshake] = await db.select().from(desktopAuthHandshakes)
    .where(eq(desktopAuthHandshakes.id, pending_id)).limit(1);

  if (!handshake) return <div className="p-8">Authorization request not found.</div>;
  if (handshake.expiresAt < new Date() || handshake.status === "expired") {
    return <div className="p-8">This authorization request has expired. Try again from the desktop app.</div>;
  }
  if (handshake.status === "authorized") {
    return <div className="p-8">Already authorized. You can close this window and return to VisionPipe.</div>;
  }

  return (
    <div className="max-w-md mx-auto p-8 mt-12">
      <h1 className="text-2xl font-bold mb-4">Authorize Vision|Pipe Desktop</h1>
      <p className="mb-6 text-gray-600">
        Allow this VisionPipe desktop install ({handshake.installLabel ?? "unnamed"}) to access your account?
      </p>
      <AuthorizeButton pendingId={pending_id} />
    </div>
  );
}
```

Create `src/app/auth/desktop/AuthorizeButton.tsx`:

```tsx
"use client";

import { useState } from "react";

export function AuthorizeButton({ pendingId }: { pendingId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const onAuthorize = async () => {
    setState("loading");
    try {
      const res = await fetch("/api/desktop/auth/authorize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pendingId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error?.toString?.() ?? "authorization failed");
        setState("error");
        return;
      }
      setState("done");
    } catch (err) {
      setError(String(err));
      setState("error");
    }
  };

  if (state === "done") {
    return (
      <div>
        <p className="text-green-700 font-semibold mb-2">Authorized!</p>
        <p className="text-gray-600">You can close this window and return to Vision|Pipe.</p>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={onAuthorize}
        disabled={state === "loading"}
        className="bg-teal-700 text-white px-6 py-2 rounded font-semibold hover:bg-teal-800 disabled:opacity-50"
      >
        {state === "loading" ? "Authorizing…" : "Authorize"}
      </button>
      {error && <p className="text-red-600 mt-2">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Smoke test**

In a browser at `http://localhost:3000/auth/desktop?pending_id=<test_id_you_inserted_earlier>`:
- If signed in, see "Authorize Vision|Pipe Desktop" with button
- Click button → "Authorized!"
- Then `curl POST /api/desktop/auth/exchange` with the matching challenge → returns the token

- [ ] **Step 3: Commit**

```bash
git add src/app/auth/desktop/
git commit -m "Add /auth/desktop interactive page with Authorize button"
```

---

### Task 8: Token revocation routes + token list

**Files:**
- Create: `src/app/api/desktop/tokens/me/route.ts`
- Create: `src/app/api/desktop/tokens/[id]/route.ts`
- Create: `src/app/api/desktop/tokens/route.ts`

- [ ] **Step 1: `DELETE /api/desktop/tokens/me`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { authenticateDesktopRequest, revokeToken } from "@/lib/desktop-auth";

export async function DELETE(req: NextRequest) {
  const ctx = await authenticateDesktopRequest(req);
  if (!ctx) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  await revokeToken(ctx.tokenId);
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: `GET /api/desktop/tokens` (web-only, list current org's)**

```typescript
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { desktopInstallTokens, organizations, memberships } from "@/db/schema";
import { eq, isNull, and, inArray } from "drizzle-orm";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const userOrgs = await db.select({ orgId: memberships.orgId }).from(memberships)
    .where(eq(memberships.clerkUserId, userId));
  const orgIds = userOrgs.map(o => o.orgId);
  if (orgIds.length === 0) return NextResponse.json({ tokens: [] });

  const tokens = await db.select({
    id: desktopInstallTokens.id,
    installLabel: desktopInstallTokens.installLabel,
    createdAt: desktopInstallTokens.createdAt,
    lastUsedAt: desktopInstallTokens.lastUsedAt,
  }).from(desktopInstallTokens)
    .where(and(inArray(desktopInstallTokens.orgId, orgIds), isNull(desktopInstallTokens.revokedAt)));

  return NextResponse.json({ tokens });
}
```

- [ ] **Step 3: `DELETE /api/desktop/tokens/[id]` (web-only, revoke specific)**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { desktopInstallTokens, memberships } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { revokeToken } from "@/lib/desktop-auth";

interface Params { params: Promise<{ id: string }>; }

export async function DELETE(_: NextRequest, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  const tokenId = parseInt(id, 10);
  if (isNaN(tokenId)) return NextResponse.json({ error: "bad_id" }, { status: 400 });

  const userOrgs = await db.select({ orgId: memberships.orgId }).from(memberships)
    .where(eq(memberships.clerkUserId, userId));
  const orgIds = userOrgs.map(o => o.orgId);

  const [row] = await db.select().from(desktopInstallTokens)
    .where(and(eq(desktopInstallTokens.id, tokenId), inArray(desktopInstallTokens.orgId, orgIds))).limit(1);
  if (!row) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  await revokeToken(tokenId);
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/desktop/tokens/
git commit -m "Add token revocation routes (desktop self-revoke + web-side revoke + list)"
```

---

## Phase C — R2 setup + presigned URLs

### Task 9: R2 client wrapper

**Files:**
- Create: `src/lib/r2.ts`

- [ ] **Step 1: Install AWS SDK packages**

```bash
pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

- [ ] **Step 2: Implement R2 wrapper**

```typescript
import { S3Client, HeadObjectCommand, CopyObjectCommand, DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const accountId = process.env.R2_ACCOUNT_ID!;
const accessKeyId = process.env.R2_ACCESS_KEY_ID!;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY!;
export const R2_BUCKET = process.env.R2_BUCKET ?? "visionpipe-shares";
export const R2_PUBLIC_BASE = (process.env.R2_PUBLIC_BASE ?? "https://share.visionpipe.app").replace(/\/$/, "");

if (!accountId || !accessKeyId || !secretAccessKey) {
  // Fail fast at module load in production
  if (process.env.NODE_ENV === "production") {
    throw new Error("R2 credentials missing in env");
  }
}

export const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

export async function presignPut(key: string, contentType: string, expiresInSec = 3600): Promise<string> {
  const cmd = new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, ContentType: contentType });
  return getSignedUrl(r2, cmd, { expiresIn: expiresInSec });
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return true;
  } catch (err: unknown) {
    const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    if (status === 404) return false;
    throw err;
  }
}

export async function copyObject(srcKey: string, dstKey: string): Promise<void> {
  await r2.send(new CopyObjectCommand({
    Bucket: R2_BUCKET,
    CopySource: `${R2_BUCKET}/${encodeURIComponent(srcKey)}`,
    Key: dstKey,
  }));
}

export async function deleteObject(key: string): Promise<void> {
  await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
}

export function publicUrl(key: string): string {
  return `${R2_PUBLIC_BASE}/${encodeURIComponent(key).replace(/%2F/g, "/")}`;
}

const SAFE_CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  webm: "audio/webm",
  json: "application/json",
  md: "text/markdown",
};

export function inferContentType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return SAFE_CONTENT_TYPES[ext] ?? "application/octet-stream";
}
```

- [ ] **Step 3: Update `.env.example`**

Append to `.env.example`:

```
# Cloudflare R2 (cloud-share storage)
R2_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-r2-access-key-id
R2_SECRET_ACCESS_KEY=your-r2-secret-access-key
R2_BUCKET=visionpipe-shares
R2_PUBLIC_BASE=https://share.visionpipe.app
```

- [ ] **Step 4: Manual R2 setup checklist (do this once in Cloudflare dashboard before deploying)**

These are operator steps, not code:

1. Cloudflare dashboard → R2 → Create bucket `visionpipe-shares`
2. Bucket Settings → Public access → Custom Domain → add `share.visionpipe.app`. Cloudflare creates a DNS CNAME automatically.
3. Bucket Settings → Lifecycle → Add rule: prefix `pending/`, action "Delete objects", age 1 day
4. R2 → Manage R2 API Tokens → Create API token with Object Read + Write on `visionpipe-shares`. Save key id + secret to `.env.local` and Vercel project env.
5. Test: `curl -I https://share.visionpipe.app/healthcheck-doesnt-exist` should return 404 (not DNS error). Confirm domain is pointed correctly.

> Document this in `prd/branch commit updates/feature-cloud-share-secret-link.md` after completing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/r2.ts package.json pnpm-lock.yaml .env.example
git commit -m "Add R2 client wrapper with presigned-PUT, copy, delete, public URL helpers"
```

---

## Phase D — Upload API (initiate + finalize + delete)

### Task 10: POST /api/uploads/initiate

**Files:**
- Create: `src/app/api/uploads/initiate/route.ts`
- Create: `src/app/api/uploads/__tests__/initiate.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/app/api/uploads/__tests__/initiate.test.ts
import { describe, it, expect } from "vitest";
import { POST } from "../initiate/route";

const fakeReq = (body: unknown, authHeader?: string): Request => {
  const headers = new Headers({ "content-type": "application/json" });
  if (authHeader) headers.set("authorization", authHeader);
  return new Request("http://localhost/api/uploads/initiate", {
    method: "POST", headers, body: JSON.stringify(body),
  });
};

describe("POST /api/uploads/initiate", () => {
  it("returns 401 with no auth header", async () => {
    const res = await POST(fakeReq({ files: [], desktopSessionId: "x", screenshotCount: 0, durationSec: 0 }));
    expect(res.status).toBe(401);
  });
  it("returns 401 with bogus token", async () => {
    const res = await POST(fakeReq(
      { files: [], desktopSessionId: "x", screenshotCount: 0, durationSec: 0 },
      "Bearer not-a-real-token"
    ));
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Implement route**

```typescript
// src/app/api/uploads/initiate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { authenticateDesktopRequest } from "@/lib/desktop-auth";
import { db } from "@/db";
import { captureSessions } from "@/db/schema";
import { presignPut, inferContentType, R2_PUBLIC_BASE } from "@/lib/r2";
import { nanoid } from "nanoid";
import { z } from "zod";

const FileSpec = z.object({
  name: z.string().min(1).max(250),
  size: z.number().int().nonnegative(),
});

const Body = z.object({
  desktopSessionId: z.string().min(1).max(120),
  files: z.array(FileSpec).min(1).max(250),
  screenshotCount: z.number().int().nonnegative(),
  durationSec: z.number().int().nonnegative(),
});

const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const ctx = await authenticateDesktopRequest(req);
  if (!ctx) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const totalBytes = parsed.data.files.reduce((s, f) => s + f.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    return NextResponse.json({ error: "session_too_large", maxBytes: MAX_TOTAL_BYTES }, { status: 413 });
  }
  const names = new Set(parsed.data.files.map(f => f.name));
  if (names.size !== parsed.data.files.length) {
    return NextResponse.json({ error: "duplicate_filenames" }, { status: 400 });
  }

  const captureSessionId = `vps_${nanoid(16)}`;
  const r2Prefix = `${ctx.orgId}/sessions/${captureSessionId}`;
  const pendingPrefix = `pending/${ctx.orgId}/${captureSessionId}`;

  await db.insert(captureSessions).values({
    id: captureSessionId,
    orgId: ctx.orgId,
    uploadedByClerkUserId: ctx.clerkUserId,
    status: "pending",
    desktopSessionId: parsed.data.desktopSessionId,
    screenshotCount: parsed.data.screenshotCount,
    durationSec: parsed.data.durationSec,
    totalSizeBytes: totalBytes,
    r2Prefix,
  });

  const presignedUrls: Record<string, string> = {};
  for (const f of parsed.data.files) {
    const key = `${pendingPrefix}/${f.name}`;
    presignedUrls[f.name] = await presignPut(key, inferContentType(f.name), 3600);
  }

  return NextResponse.json({
    captureSessionId,
    presignedUrls,
    publicUrlBase: `${R2_PUBLIC_BASE}/${r2Prefix}`,
  });
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run src/app/api/uploads/__tests__/initiate.test.ts`
Expected: 2 tests pass.

- [ ] **Step 4: Manual smoke test**

```bash
# First create an authorized handshake + token via the auth flow steps from earlier.
# Then:
TOKEN=<your-issued-token>
curl -X POST http://localhost:3000/api/uploads/initiate \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "desktopSessionId": "session-2026-05-02_14-23-07",
    "files": [
      {"name": "VisionPipe-001-test.png", "size": 100000},
      {"name": "transcript.md", "size": 200}
    ],
    "screenshotCount": 1,
    "durationSec": 60
  }'
```

Expected: JSON with `captureSessionId`, two presigned URLs in `presignedUrls`, public URL base.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/uploads/initiate/ src/app/api/uploads/__tests__/
git commit -m "Add POST /api/uploads/initiate with presigned R2 PUT URLs"
```

---

### Task 11: POST /api/uploads/[id]/finalize

**Files:**
- Create: `src/app/api/uploads/[id]/finalize/route.ts`
- Modify: `src/lib/pricing.ts` (add CLOUD_UPLOAD_CREDIT_COST)
- Create: `src/app/api/uploads/__tests__/finalize.test.ts`

- [ ] **Step 1: Add credit-cost constant**

In `src/lib/pricing.ts`, append:

```typescript
export const CLOUD_UPLOAD_CREDIT_COST = 50;
```

- [ ] **Step 2: Write failing tests**

```typescript
// src/app/api/uploads/__tests__/finalize.test.ts
import { describe, it, expect } from "vitest";
// Note: full integration tests (DB + R2) require fixtures; this is a thin smoke test.
import { POST } from "../[id]/finalize/route";

describe("POST /api/uploads/[id]/finalize (auth checks)", () => {
  it("returns 401 with no auth", async () => {
    const req = new Request("http://localhost/api/uploads/vps_x/finalize", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "vps_x" }) });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 3: Implement route**

```typescript
// src/app/api/uploads/[id]/finalize/route.ts
import { NextRequest, NextResponse } from "next/server";
import { authenticateDesktopRequest } from "@/lib/desktop-auth";
import { db } from "@/db";
import { captureSessions, sharedLinks } from "@/db/schema";
import { chargeCredits, InsufficientCreditsError } from "@/db/queries";
import { CLOUD_UPLOAD_CREDIT_COST } from "@/lib/pricing";
import { copyObject, deleteObject, objectExists } from "@/lib/r2";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

const Body = z.object({
  createShareLink: z.boolean().optional().default(false),
  expiresAt: z.string().datetime().nullable().optional().default(null),
  fileNames: z.array(z.string()).min(1),
});

interface Params { params: Promise<{ id: string }>; }

export async function POST(req: NextRequest, { params }: Params) {
  const ctx = await authenticateDesktopRequest(req);
  if (!ctx) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  // Lock the session row for the duration of the finalize transaction
  const result = await db.transaction(async (tx) => {
    const [session] = await tx.select().from(captureSessions)
      .where(and(eq(captureSessions.id, id), eq(captureSessions.orgId, ctx.orgId))).limit(1);

    if (!session) return { status: 404 as const };
    if (session.status !== "pending") return { status: 409 as const, body: { error: "already_finalized" } };

    // Verify all files exist in R2 pending/ prefix
    const pendingPrefix = `pending/${ctx.orgId}/${id}`;
    const sessionPrefix = session.r2Prefix;
    for (const name of parsed.data.fileNames) {
      const exists = await objectExists(`${pendingPrefix}/${name}`);
      if (!exists) {
        return { status: 422 as const, body: { error: "file_missing", name } };
      }
    }

    // Charge credits (transactional, throws if insufficient)
    const charge = await chargeCredits({
      orgId: ctx.orgId,
      amount: CLOUD_UPLOAD_CREDIT_COST,
      reason: "cloud_upload",
      refId: id,
    });

    // Move objects from pending/ to permanent prefix
    for (const name of parsed.data.fileNames) {
      await copyObject(`${pendingPrefix}/${name}`, `${sessionPrefix}/${name}`);
      await deleteObject(`${pendingPrefix}/${name}`);
    }

    await tx.update(captureSessions).set({
      status: "complete",
      uploadedAt: new Date(),
      creditsCharged: CLOUD_UPLOAD_CREDIT_COST,
    }).where(eq(captureSessions.id, id));

    let shareLink: { id: string; url: string; expiresAt: Date | null } | null = null;
    if (parsed.data.createShareLink) {
      const linkId = `vsl_${nanoid(16)}`;
      const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;
      await tx.insert(sharedLinks).values({
        id: linkId, captureSessionId: id, expiresAt,
      });
      const baseUrl = process.env.NEXT_PUBLIC_SHARE_BASE ?? "https://share.visionpipe.app/s";
      shareLink = { id: linkId, url: `${baseUrl}/${linkId}`, expiresAt };
    }

    return {
      status: 200 as const,
      body: {
        status: "complete",
        creditsCharged: CLOUD_UPLOAD_CREDIT_COST,
        remainingBalance: charge.newBalance,
        shareLink,
      },
    };
  }).catch(err => {
    if (err instanceof InsufficientCreditsError) {
      return { status: 402 as const, body: { error: "insufficient_credits", available: err.available, required: err.requested } };
    }
    throw err;
  });

  if ("body" in result) return NextResponse.json(result.body, { status: result.status });
  return NextResponse.json({}, { status: result.status });
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/app/api/uploads/__tests__/finalize.test.ts`
Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/uploads/[id]/finalize/ src/app/api/uploads/__tests__/finalize.test.ts src/lib/pricing.ts
git commit -m "Add POST /api/uploads/[id]/finalize with credit charge + R2 promotion + share-link creation"
```

---

### Task 12: DELETE /api/uploads/[id] (soft delete + conditional refund)

**Files:**
- Create: `src/app/api/uploads/[id]/route.ts`

- [ ] **Step 1: Implement**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { authenticateDesktopRequest } from "@/lib/desktop-auth";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { captureSessions, memberships } from "@/db/schema";
import { refundCharge } from "@/db/queries";
import { eq, and, inArray } from "drizzle-orm";

interface Params { params: Promise<{ id: string }>; }

const REFUND_WINDOW_MS = 60 * 60 * 1000;  // 1 hour

export async function DELETE(req: NextRequest, { params }: Params) {
  const desktop = await authenticateDesktopRequest(req);
  const clerk = desktop ? null : await auth();
  if (!desktop && !clerk?.userId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { id } = await params;
  const [session] = await db.select().from(captureSessions).where(eq(captureSessions.id, id)).limit(1);
  if (!session) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Authorize: must be in the org
  if (desktop) {
    if (session.orgId !== desktop.orgId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  } else if (clerk?.userId) {
    const userOrgs = await db.select({ orgId: memberships.orgId }).from(memberships)
      .where(eq(memberships.clerkUserId, clerk.userId));
    if (!userOrgs.some(o => o.orgId === session.orgId)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  if (session.status === "deleted") return NextResponse.json({ error: "already_deleted" }, { status: 409 });

  const refundEligible =
    session.status === "complete" &&
    session.uploadedAt &&
    Date.now() - session.uploadedAt.getTime() < REFUND_WINDOW_MS;

  await db.update(captureSessions).set({ status: "deleted" }).where(eq(captureSessions.id, id));

  let refunded = false;
  if (refundEligible) {
    await refundCharge(id);
    refunded = true;
  }

  return NextResponse.json({ status: "deleted", refunded });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/uploads/[id]/route.ts
git commit -m "Add DELETE /api/uploads/[id] with soft-delete and 1-hour refund window"
```

---

### Task 13: Cleanup cron for abandoned pending uploads

**Files:**
- Create: `src/app/api/cron/cleanup-pending-uploads/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Implement cron route**

```typescript
import { NextResponse } from "next/server";
import { db } from "@/db";
import { captureSessions } from "@/db/schema";
import { eq, and, lt, sql } from "drizzle-orm";

export async function GET(req: Request) {
  // Vercel cron sends a User-Agent: vercel-cron/1.0; verify with secret as well
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const updated = await db.update(captureSessions)
    .set({ status: "failed" })
    .where(and(eq(captureSessions.status, "pending"), lt(captureSessions.createdAt, cutoff)))
    .returning({ id: captureSessions.id });

  return NextResponse.json({ markedFailed: updated.length, ids: updated.map(u => u.id) });
}
```

- [ ] **Step 2: Add cron schedule to `vercel.json`**

If `vercel.json` doesn't exist, create it:

```json
{
  "crons": [
    {
      "path": "/api/cron/cleanup-pending-uploads",
      "schedule": "0 */6 * * *"
    }
  ]
}
```

If it exists, add the cron block (don't overwrite other config).

- [ ] **Step 3: Add CRON_SECRET to `.env.example`**

```
# Cron-job authentication
CRON_SECRET=long-random-string-set-this-in-vercel-env
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cron/ vercel.json .env.example
git commit -m "Add 6-hourly cron to mark abandoned pending uploads as failed"
```

---

## Phase E — Share-link API

### Task 14: POST /api/share-links + DELETE/PATCH

**Files:**
- Create: `src/lib/share-link.ts`
- Create: `src/lib/__tests__/share-link.test.ts`
- Create: `src/app/api/share-links/route.ts`
- Create: `src/app/api/share-links/[id]/route.ts`

- [ ] **Step 1: Write share-link primitives + tests**

`src/lib/__tests__/share-link.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { generateShareLinkId, isShareLinkActive } from "../share-link";

describe("generateShareLinkId", () => {
  it("starts with vsl_ and has 16+ chars after prefix", () => {
    const id = generateShareLinkId();
    expect(id).toMatch(/^vsl_[A-Za-z0-9_-]{16,}$/);
  });
  it("100 generations yield no collisions", () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) ids.add(generateShareLinkId());
    expect(ids.size).toBe(100);
  });
});

describe("isShareLinkActive", () => {
  it("returns true for non-revoked, non-expired", () => {
    expect(isShareLinkActive({ revokedAt: null, expiresAt: null })).toBe(true);
    expect(isShareLinkActive({ revokedAt: null, expiresAt: new Date(Date.now() + 60_000) })).toBe(true);
  });
  it("returns false for revoked", () => {
    expect(isShareLinkActive({ revokedAt: new Date(), expiresAt: null })).toBe(false);
  });
  it("returns false for expired", () => {
    expect(isShareLinkActive({ revokedAt: null, expiresAt: new Date(Date.now() - 60_000) })).toBe(false);
  });
});
```

`src/lib/share-link.ts`:

```typescript
import { nanoid } from "nanoid";

export function generateShareLinkId(): string {
  return `vsl_${nanoid(16)}`;
}

export function isShareLinkActive(link: { revokedAt: Date | null; expiresAt: Date | null }): boolean {
  if (link.revokedAt) return false;
  if (link.expiresAt && link.expiresAt < new Date()) return false;
  return true;
}
```

Run: `pnpm vitest run src/lib/__tests__/share-link.test.ts`
Expected: 5 tests pass.

- [ ] **Step 2: Implement POST /api/share-links**

```typescript
// src/app/api/share-links/route.ts
import { NextRequest, NextResponse } from "next/server";
import { authenticateDesktopRequest } from "@/lib/desktop-auth";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { captureSessions, sharedLinks, memberships } from "@/db/schema";
import { generateShareLinkId } from "@/lib/share-link";
import { eq } from "drizzle-orm";
import { z } from "zod";

const Body = z.object({
  captureSessionId: z.string().startsWith("vps_"),
  expiresAt: z.string().datetime().nullable().optional().default(null),
});

export async function POST(req: NextRequest) {
  const desktop = await authenticateDesktopRequest(req);
  const clerk = desktop ? null : await auth();
  if (!desktop && !clerk?.userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const [session] = await db.select().from(captureSessions)
    .where(eq(captureSessions.id, parsed.data.captureSessionId)).limit(1);
  if (!session || session.status !== "complete") {
    return NextResponse.json({ error: "session_not_found_or_incomplete" }, { status: 404 });
  }

  // Authorize org membership
  if (desktop) {
    if (session.orgId !== desktop.orgId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  } else if (clerk?.userId) {
    const userOrgs = await db.select({ orgId: memberships.orgId }).from(memberships)
      .where(eq(memberships.clerkUserId, clerk.userId));
    if (!userOrgs.some(o => o.orgId === session.orgId)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const id = generateShareLinkId();
  const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;
  await db.insert(sharedLinks).values({ id, captureSessionId: session.id, expiresAt });

  const baseUrl = process.env.NEXT_PUBLIC_SHARE_BASE ?? "https://share.visionpipe.app/s";
  return NextResponse.json({ id, url: `${baseUrl}/${id}`, expiresAt });
}
```

- [ ] **Step 3: Implement DELETE + PATCH /api/share-links/[id]**

```typescript
// src/app/api/share-links/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { authenticateDesktopRequest } from "@/lib/desktop-auth";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { sharedLinks, captureSessions, memberships } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

interface Params { params: Promise<{ id: string }>; }

async function authorize(req: NextRequest, linkId: string) {
  const desktop = await authenticateDesktopRequest(req);
  const clerk = desktop ? null : await auth();
  if (!desktop && !clerk?.userId) return { error: "unauthenticated" as const, status: 401 };

  const [row] = await db.select({
    linkId: sharedLinks.id,
    captureSessionId: sharedLinks.captureSessionId,
    sessionOrgId: captureSessions.orgId,
  }).from(sharedLinks).innerJoin(captureSessions, eq(sharedLinks.captureSessionId, captureSessions.id))
    .where(eq(sharedLinks.id, linkId)).limit(1);
  if (!row) return { error: "not_found" as const, status: 404 };

  if (desktop) {
    if (row.sessionOrgId !== desktop.orgId) return { error: "forbidden" as const, status: 403 };
  } else if (clerk?.userId) {
    const userOrgs = await db.select({ orgId: memberships.orgId }).from(memberships)
      .where(eq(memberships.clerkUserId, clerk.userId));
    if (!userOrgs.some(o => o.orgId === row.sessionOrgId)) {
      return { error: "forbidden" as const, status: 403 };
    }
  }
  return { ok: true as const };
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const a = await authorize(req, id);
  if ("error" in a) return NextResponse.json({ error: a.error }, { status: a.status });
  await db.update(sharedLinks).set({ revokedAt: new Date() }).where(eq(sharedLinks.id, id));
  return NextResponse.json({ revoked: true });
}

const PatchBody = z.object({ expiresAt: z.string().datetime().nullable() });

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const a = await authorize(req, id);
  if ("error" in a) return NextResponse.json({ error: a.error }, { status: a.status });
  const parsed = PatchBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  await db.update(sharedLinks).set({
    expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
  }).where(eq(sharedLinks.id, id));
  return NextResponse.json({ updated: true });
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/share-link.ts src/lib/__tests__/share-link.test.ts src/app/api/share-links/
git commit -m "Add share-link primitives + POST/DELETE/PATCH /api/share-links endpoints"
```

---

## Phase F — Web viewer (server-rendered /share/[id])

### Task 15: Markdown viewer helper

**Files:**
- Create: `src/lib/markdown-viewer.ts`
- Create: `src/lib/__tests__/markdown-viewer.test.ts`

- [ ] **Step 1: Install markdown deps**

```bash
pnpm add react-markdown remark-gfm
pnpm add isomorphic-dompurify
```

- [ ] **Step 2: Write tests**

```typescript
// src/lib/__tests__/markdown-viewer.test.ts
import { describe, it, expect } from "vitest";
import { rewriteImagePaths } from "../markdown-viewer";

describe("rewriteImagePaths", () => {
  it("rewrites local absolute paths to public URLs", () => {
    const md = "![alt](/Users/x/Pictures/VisionPipe/session-y/foo.png)";
    const out = rewriteImagePaths(md, {
      sessionFolder: "/Users/x/Pictures/VisionPipe/session-y",
      publicUrlBase: "https://share.visionpipe.app/42/sessions/vps_abc",
    });
    expect(out).toBe("![alt](https://share.visionpipe.app/42/sessions/vps_abc/foo.png)");
  });
  it("leaves remote URLs alone", () => {
    const md = "![alt](https://example.com/img.png)";
    expect(rewriteImagePaths(md, {
      sessionFolder: "/local", publicUrlBase: "https://share.visionpipe.app/x/y",
    })).toBe(md);
  });
});
```

- [ ] **Step 3: Implement**

```typescript
// src/lib/markdown-viewer.ts
export interface RewriteOpts {
  sessionFolder: string;       // local path the desktop wrote (e.g., "/Users/x/Pictures/VisionPipe/session-y")
  publicUrlBase: string;        // R2 public base for this session (e.g., "https://share.visionpipe.app/42/sessions/vps_abc")
}

export function rewriteImagePaths(markdown: string, opts: RewriteOpts): string {
  const folderEsc = opts.sessionFolder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(!\\[[^\\]]*\\]\\()${folderEsc}/([^)]+)\\)`, "g");
  return markdown.replace(re, `$1${opts.publicUrlBase}/$2)`);
}
```

Run: `pnpm vitest run src/lib/__tests__/markdown-viewer.test.ts`
Expected: 2 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/markdown-viewer.ts src/lib/__tests__/markdown-viewer.test.ts package.json pnpm-lock.yaml
git commit -m "Add markdown-viewer helper to rewrite image refs from local to public URLs"
```

---

### Task 16: /share/[linkId] server-rendered page

**Files:**
- Create: `src/app/share/[linkId]/page.tsx`
- Create: `src/app/share/[linkId]/not-found.tsx`

- [ ] **Step 1: Implement page**

```tsx
import { notFound } from "next/navigation";
import { db } from "@/db";
import { sharedLinks, captureSessions } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { isShareLinkActive } from "@/lib/share-link";
import { publicUrl, R2_PUBLIC_BASE, R2_BUCKET } from "@/lib/r2";
import { rewriteImagePaths } from "@/lib/markdown-viewer";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import DOMPurify from "isomorphic-dompurify";

interface Props { params: Promise<{ linkId: string }>; }

async function fetchTranscriptMd(r2Prefix: string): Promise<string | null> {
  const url = `${R2_PUBLIC_BASE}/${r2Prefix}/transcript.md`;
  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) return null;
  return await res.text();
}

export async function generateMetadata({ params }: Props) {
  const { linkId } = await params;
  const [row] = await db.select({
    sessionId: sharedLinks.captureSessionId,
    revokedAt: sharedLinks.revokedAt,
    expiresAt: sharedLinks.expiresAt,
    screenshotCount: captureSessions.screenshotCount,
    durationSec: captureSessions.durationSec,
    r2Prefix: captureSessions.r2Prefix,
  }).from(sharedLinks).innerJoin(captureSessions, eq(sharedLinks.captureSessionId, captureSessions.id))
    .where(eq(sharedLinks.id, linkId)).limit(1);

  if (!row || !isShareLinkActive(row)) return { title: "Vision|Pipe — Share unavailable" };

  return {
    title: `Vision|Pipe — ${row.screenshotCount} screenshots, ${Math.round(row.durationSec / 60)}m ${row.durationSec % 60}s`,
    openGraph: {
      title: `Vision|Pipe session`,
      description: `${row.screenshotCount} screenshots, ${Math.round(row.durationSec / 60)}m of narration`,
      images: [{ url: `${R2_PUBLIC_BASE}/${row.r2Prefix}/og.png` }],
    },
    twitter: { card: "summary_large_image" },
  };
}

export default async function SharePage({ params }: Props) {
  const { linkId } = await params;

  const [row] = await db.select({
    link: sharedLinks,
    session: captureSessions,
  }).from(sharedLinks).innerJoin(captureSessions, eq(sharedLinks.captureSessionId, captureSessions.id))
    .where(eq(sharedLinks.id, linkId)).limit(1);

  if (!row) notFound();
  if (!isShareLinkActive(row.link)) {
    return (
      <main className="max-w-2xl mx-auto p-12 text-center">
        <h1 className="text-2xl font-bold mb-4">This link is no longer available</h1>
        <p className="text-gray-600">The link has been revoked or expired.</p>
      </main>
    );
  }
  if (row.session.status === "deleted") {
    return (
      <main className="max-w-2xl mx-auto p-12 text-center">
        <h1 className="text-2xl font-bold mb-4">Session deleted</h1>
      </main>
    );
  }

  // Increment view count (fire and forget)
  db.update(sharedLinks).set({
    viewCount: sql`${sharedLinks.viewCount} + 1`,
    lastViewedAt: new Date(),
  }).where(eq(sharedLinks.id, linkId)).catch(() => {});

  const transcript = await fetchTranscriptMd(row.session.r2Prefix);
  if (!transcript) {
    return <main className="p-12">Transcript file missing in storage. Please contact the uploader.</main>;
  }

  // Rewrite image paths from desktop-local absolute paths to R2 public URLs.
  // Desktop writes paths like /Users/<x>/Pictures/VisionPipe/session-<ts>/file.png in transcript.md.
  // The shared markdown should reference R2 instead.
  const sessionFolderHint = transcript.match(/\*\*Session folder:\*\*\s*`([^`]+)`/)?.[1] ?? "";
  const publicBase = `${R2_PUBLIC_BASE}/${row.session.r2Prefix}`;
  const rewritten = rewriteImagePaths(transcript, {
    sessionFolder: sessionFolderHint.replace(/\/$/, ""),
    publicUrlBase: publicBase,
  });

  return (
    <main className="max-w-3xl mx-auto p-8">
      <header className="mb-6 pb-4 border-b">
        <h1 className="text-2xl font-bold">Vision|Pipe Session</h1>
        <p className="text-sm text-gray-500 mt-1">
          {row.session.screenshotCount} screenshots · {Math.round(row.session.durationSec / 60)}m {row.session.durationSec % 60}s
        </p>
        <audio controls src={`${publicBase}/audio-master.webm`} className="mt-4 w-full" />
      </header>
      <article className="prose max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {rewritten}
        </ReactMarkdown>
      </article>
      <footer className="mt-12 pt-6 border-t text-sm text-gray-500">
        Captured with <a href="https://visionpipe.app" className="underline">Vision|Pipe</a> · <code>screenshot | llm</code>
      </footer>
    </main>
  );
}
```

- [ ] **Step 2: Add not-found page**

```tsx
// src/app/share/[linkId]/not-found.tsx
export default function NotFound() {
  return (
    <main className="max-w-2xl mx-auto p-12 text-center">
      <h1 className="text-2xl font-bold mb-4">Share link not found</h1>
      <p className="text-gray-600">The link may have been mistyped or the session was deleted.</p>
    </main>
  );
}
```

- [ ] **Step 3: Smoke test**

After running `pnpm dev`, manually upload a session via the desktop app (or use curl + a real R2 PUT) to land a `transcript.md` and image PNG in R2. Then open `http://localhost:3000/share/<linkId>` — should render the markdown with images loading from R2.

- [ ] **Step 4: Commit**

```bash
git add src/app/share/
git commit -m "Add /share/[linkId] server-rendered viewer with audio + markdown + Open Graph"
```

---

## Phase G — Dashboard pages

### Task 17: /dashboard/sessions list

**Files:**
- Create: `src/app/dashboard/sessions/page.tsx`

- [ ] **Step 1: Implement**

```tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { captureSessions, memberships } from "@/db/schema";
import { eq, inArray, desc } from "drizzle-orm";
import Link from "next/link";

export default async function SessionsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const userOrgs = await db.select({ orgId: memberships.orgId }).from(memberships)
    .where(eq(memberships.clerkUserId, userId));
  const orgIds = userOrgs.map(o => o.orgId);

  const sessions = orgIds.length === 0 ? [] : await db.select().from(captureSessions)
    .where(inArray(captureSessions.orgId, orgIds))
    .orderBy(desc(captureSessions.createdAt))
    .limit(100);

  return (
    <main className="max-w-5xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-6">Your uploaded sessions</h1>
      {sessions.length === 0 ? (
        <p className="text-gray-600">No uploads yet. Use Vision|Pipe desktop to capture and click "Save to cloud".</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-gray-500 border-b">
            <tr>
              <th className="py-2">ID</th>
              <th>Status</th>
              <th>Screenshots</th>
              <th>Duration</th>
              <th>Size</th>
              <th>Uploaded</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sessions.map(s => (
              <tr key={s.id} className="border-b">
                <td className="py-2 font-mono">{s.id.slice(0, 12)}…</td>
                <td>{s.status}</td>
                <td>{s.screenshotCount}</td>
                <td>{Math.round(s.durationSec / 60)}m</td>
                <td>{(s.totalSizeBytes / 1024).toFixed(0)} KB</td>
                <td>{s.uploadedAt?.toLocaleString() ?? "—"}</td>
                <td><Link href={`/dashboard/sessions/${s.id}`} className="text-teal-700 underline">View</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboard/sessions/
git commit -m "Add /dashboard/sessions list of user uploads"
```

---

### Task 18: /dashboard/sessions/[id] detail + share-link management

**Files:**
- Create: `src/app/dashboard/sessions/[id]/page.tsx`
- Create: `src/app/dashboard/sessions/[id]/ManageLinks.tsx`

- [ ] **Step 1: Implement page (server component)**

```tsx
import { auth } from "@clerk/nextjs/server";
import { redirect, notFound } from "next/navigation";
import { db } from "@/db";
import { captureSessions, sharedLinks, memberships } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { ManageLinks } from "./ManageLinks";

interface Props { params: Promise<{ id: string }>; }

export default async function SessionDetailPage({ params }: Props) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const { id } = await params;

  const userOrgs = await db.select({ orgId: memberships.orgId }).from(memberships)
    .where(eq(memberships.clerkUserId, userId));
  const orgIds = userOrgs.map(o => o.orgId);

  const [session] = await db.select().from(captureSessions)
    .where(and(eq(captureSessions.id, id), inArray(captureSessions.orgId, orgIds))).limit(1);
  if (!session) notFound();

  const links = await db.select().from(sharedLinks).where(eq(sharedLinks.captureSessionId, id));

  return (
    <main className="max-w-3xl mx-auto p-8">
      <h1 className="text-xl font-bold mb-4 font-mono">{session.id}</h1>
      <dl className="grid grid-cols-2 gap-y-2 mb-8">
        <dt className="text-gray-500">Status</dt><dd>{session.status}</dd>
        <dt className="text-gray-500">Screenshots</dt><dd>{session.screenshotCount}</dd>
        <dt className="text-gray-500">Duration</dt><dd>{Math.round(session.durationSec / 60)}m {session.durationSec % 60}s</dd>
        <dt className="text-gray-500">Size</dt><dd>{(session.totalSizeBytes / 1024).toFixed(0)} KB</dd>
        <dt className="text-gray-500">Credits charged</dt><dd>{session.creditsCharged}</dd>
        <dt className="text-gray-500">Uploaded</dt><dd>{session.uploadedAt?.toLocaleString() ?? "—"}</dd>
      </dl>
      <ManageLinks captureSessionId={session.id} initialLinks={links.map(l => ({
        ...l,
        createdAt: l.createdAt.toISOString(),
        expiresAt: l.expiresAt?.toISOString() ?? null,
        revokedAt: l.revokedAt?.toISOString() ?? null,
        lastViewedAt: l.lastViewedAt?.toISOString() ?? null,
      }))} />
    </main>
  );
}
```

- [ ] **Step 2: Implement ManageLinks client component**

```tsx
// src/app/dashboard/sessions/[id]/ManageLinks.tsx
"use client";

import { useState } from "react";

interface Link {
  id: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
}

interface Props { captureSessionId: string; initialLinks: Link[]; }

export function ManageLinks({ captureSessionId, initialLinks }: Props) {
  const [links, setLinks] = useState(initialLinks);

  const baseUrl = process.env.NEXT_PUBLIC_SHARE_BASE ?? "https://share.visionpipe.app/s";

  const onCreate = async () => {
    const res = await fetch("/api/share-links", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ captureSessionId, expiresAt: null }),
    });
    if (!res.ok) { alert("create failed"); return; }
    const body = await res.json();
    setLinks([...links, {
      id: body.id, createdAt: new Date().toISOString(),
      expiresAt: body.expiresAt, revokedAt: null,
      viewCount: 0, lastViewedAt: null,
    }]);
  };

  const onRevoke = async (id: string) => {
    if (!confirm("Revoke this link? Anyone with the URL will lose access.")) return;
    await fetch(`/api/share-links/${id}`, { method: "DELETE" });
    setLinks(links.map(l => l.id === id ? { ...l, revokedAt: new Date().toISOString() } : l));
  };

  return (
    <section>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">Share links</h2>
        <button onClick={onCreate} className="bg-teal-700 text-white px-4 py-2 rounded text-sm">+ New link</button>
      </div>
      {links.length === 0 ? (
        <p className="text-gray-500">No share links yet.</p>
      ) : (
        <ul className="space-y-3">
          {links.map(l => (
            <li key={l.id} className="border rounded p-3">
              <div className="flex justify-between items-start">
                <div>
                  <a href={`${baseUrl}/${l.id}`} className="font-mono text-sm text-teal-700 underline" target="_blank">
                    {baseUrl}/{l.id}
                  </a>
                  <p className="text-xs text-gray-500 mt-1">
                    Created {new Date(l.createdAt).toLocaleString()} ·
                    Views: {l.viewCount}
                    {l.revokedAt && <span className="text-red-600"> · REVOKED</span>}
                    {l.expiresAt && !l.revokedAt && <span> · Expires {new Date(l.expiresAt).toLocaleDateString()}</span>}
                  </p>
                </div>
                {!l.revokedAt && (
                  <button onClick={() => onRevoke(l.id)} className="text-sm text-red-600">Revoke</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/sessions/[id]/
git commit -m "Add /dashboard/sessions/[id] detail page with share-link create/revoke UI"
```

---

### Task 19: /dashboard/devices

**Files:**
- Create: `src/app/dashboard/devices/page.tsx`
- Create: `src/app/dashboard/devices/DeviceList.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/app/dashboard/devices/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { desktopInstallTokens, memberships } from "@/db/schema";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { DeviceList } from "./DeviceList";

export default async function DevicesPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const userOrgs = await db.select({ orgId: memberships.orgId }).from(memberships)
    .where(eq(memberships.clerkUserId, userId));
  const orgIds = userOrgs.map(o => o.orgId);

  const tokens = orgIds.length === 0 ? [] : await db.select({
    id: desktopInstallTokens.id,
    installLabel: desktopInstallTokens.installLabel,
    createdAt: desktopInstallTokens.createdAt,
    lastUsedAt: desktopInstallTokens.lastUsedAt,
  }).from(desktopInstallTokens)
    .where(and(inArray(desktopInstallTokens.orgId, orgIds), isNull(desktopInstallTokens.revokedAt)));

  return (
    <main className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-6">Authorized devices</h1>
      <DeviceList tokens={tokens.map(t => ({
        id: t.id, installLabel: t.installLabel,
        createdAt: t.createdAt.toISOString(),
        lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
      }))} />
    </main>
  );
}
```

```tsx
// src/app/dashboard/devices/DeviceList.tsx
"use client";

import { useState } from "react";

interface Token { id: number; installLabel: string | null; createdAt: string; lastUsedAt: string | null; }

export function DeviceList({ tokens: initial }: { tokens: Token[] }) {
  const [tokens, setTokens] = useState(initial);

  const onRevoke = async (id: number) => {
    if (!confirm("Unlink this device? It will need to sign in again.")) return;
    await fetch(`/api/desktop/tokens/${id}`, { method: "DELETE" });
    setTokens(tokens.filter(t => t.id !== id));
  };

  if (tokens.length === 0) return <p className="text-gray-500">No active devices.</p>;

  return (
    <ul className="space-y-3">
      {tokens.map(t => (
        <li key={t.id} className="border rounded p-3 flex justify-between items-center">
          <div>
            <p className="font-semibold">{t.installLabel ?? "Unnamed device"}</p>
            <p className="text-xs text-gray-500">
              Linked {new Date(t.createdAt).toLocaleString()} ·
              Last used: {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : "never"}
            </p>
          </div>
          <button onClick={() => onRevoke(t.id)} className="text-sm text-red-600">Unlink</button>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboard/devices/
git commit -m "Add /dashboard/devices page with revoke UI for desktop tokens"
```

---

## Phase H — Extend /api/me/balance for desktop tokens

### Task 20: /api/me/balance accepts desktop token

**Files:**
- Modify: `src/app/api/me/balance/route.ts`

- [ ] **Step 1: Update existing route**

Read the existing file first (`cat src/app/api/me/balance/route.ts`); the current implementation is Clerk-session-only. Modify to accept either:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { authenticateDesktopRequest } from "@/lib/desktop-auth";
import { getBalance } from "@/db/queries";
import { db } from "@/db";
import { memberships } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const desktop = await authenticateDesktopRequest(req);
  if (desktop) {
    const balance = await getBalance(desktop.orgId);
    return NextResponse.json({ balance, orgId: desktop.orgId });
  }
  const clerk = await auth();
  if (!clerk.userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const userOrgs = await db.select({ orgId: memberships.orgId }).from(memberships)
    .where(eq(memberships.clerkUserId, clerk.userId));
  if (userOrgs.length === 0) return NextResponse.json({ balance: 0 });
  const balance = await getBalance(userOrgs[0].orgId);
  return NextResponse.json({ balance, orgId: userOrgs[0].orgId });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/me/balance/route.ts
git commit -m "Extend /api/me/balance to accept desktop token auth"
```

---

## Phase I — Final integration tests + verification

### Task 21: Manual end-to-end smoke test

**Files:**
- Create: `prd/branch commit updates/feature-cloud-share-secret-link.md` (web-side branch log per visionpipe-web's CLAUDE.md)

> Verify the per-branch log convention in `visionpipe-web` first — `cat CLAUDE.md` and check whether it uses `prd/<branch>.md` or `prd/branch commit updates/<branch>.md`. Use whichever applies.

- [ ] **Step 1: Walk through the full flow manually**

In one terminal: `pnpm dev`.

1. Open `http://localhost:3000/sign-up`. Create an account (Clerk magic link goes to your email).
2. Open `http://localhost:3000/pricing`. Buy a `pack_10` ($10) via Stripe Checkout (use Stripe test card 4242 4242 4242 4242).
3. Confirm `http://localhost:3000/dashboard` shows balance = 1000 credits.
4. Simulate desktop auth manually:
   ```bash
   # Initiate
   CHALLENGE=$(openssl rand -base64 32 | tr -d '\n=' | tr '+/' '-_')
   CHALLENGE_HASH=$(echo -n "$CHALLENGE" | shasum -a 256 | awk '{print $1}')
   INIT=$(curl -s -X POST http://localhost:3000/api/desktop/auth/initiate \
     -H "content-type: application/json" \
     -d "{\"challengeHash\":\"$CHALLENGE_HASH\",\"installLabel\":\"smoke-test\"}")
   PENDING_ID=$(echo $INIT | jq -r .pendingId)
   AUTH_URL=$(echo $INIT | jq -r .authUrl)
   echo "Visit: $AUTH_URL"
   # In your browser: open the AUTH_URL, click Authorize.
   # Then exchange:
   TOKEN=$(curl -s -X POST http://localhost:3000/api/desktop/auth/exchange \
     -H "content-type: application/json" \
     -d "{\"pendingId\":\"$PENDING_ID\",\"challenge\":\"$CHALLENGE\"}" | jq -r .token)
   echo "Token: $TOKEN"
   ```
5. Initiate an upload:
   ```bash
   curl -X POST http://localhost:3000/api/uploads/initiate \
     -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
     -d '{
       "desktopSessionId":"smoke-2026-05-02",
       "files":[
         {"name":"VisionPipe-001-test.png","size":1024},
         {"name":"transcript.md","size":256}
       ],
       "screenshotCount":1,"durationSec":30
     }'
   ```
   Note the `presignedUrls` and `captureSessionId`.
6. PUT a tiny PNG and a tiny markdown file to the presigned URLs:
   ```bash
   echo "test image bytes" > /tmp/test.png
   curl -X PUT --data-binary @/tmp/test.png -H "content-type: image/png" "<presigned_url_1>"
   echo "# test md" > /tmp/test.md
   curl -X PUT --data-binary @/tmp/test.md -H "content-type: text/markdown" "<presigned_url_2>"
   ```
7. Finalize:
   ```bash
   CSID=<captureSessionId>
   curl -X POST "http://localhost:3000/api/uploads/$CSID/finalize" \
     -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
     -d '{"createShareLink":true,"expiresAt":null,"fileNames":["VisionPipe-001-test.png","transcript.md"]}'
   ```
   Expected: `creditsCharged: 50, remainingBalance: 950, shareLink: { url: ... }`
8. Visit the share URL in a browser. Should see the markdown rendered.
9. Confirm balance: `curl http://localhost:3000/api/me/balance -H "authorization: Bearer $TOKEN"` returns `{balance: 950}`.
10. Revoke the share link from `/dashboard/sessions/<id>`. Re-visit URL → "no longer available."

- [ ] **Step 2: Document smoke results in the per-branch log + commit**

Create or update the per-branch progress log per `visionpipe-web`'s CLAUDE.md convention. Stage and commit.

```bash
git add prd/branch\ commit\ updates/feature-cloud-share-secret-link.md  # adjust path per CLAUDE.md
git commit -m "Verify end-to-end cloud-share smoke flow"
```

- [ ] **Step 3: Run full test suite**

```bash
pnpm test
```

Expected: all green. Fix any reds before merging.

- [ ] **Step 4: Open PR back to main**

```bash
git push -u origin feature/cloud-share-secret-link
gh pr create --base main --title "Cloud Share + Secret-Link Sharing (Spec 2 — Web)" \
  --body "Implements Spec 2 web side. See docs/superpowers/specs/2026-05-02-cloud-share-secret-link-design.md"
```

---

## Self-review (run yourself before marking the plan complete)

- [ ] **Spec coverage**: every section of `2026-05-02-cloud-share-secret-link-design.md` web-side maps to a task:
  - §4 architecture (web side): Tasks 1, 9
  - §5 auth flow: Tasks 3-8
  - §6 data model (web side): Tasks 1, 2
  - §7 upload flow: Tasks 10, 11, 12, 13
  - §8 share link + viewer: Tasks 14, 15, 16
  - §9 billing integration (server side): Tasks 2, 11, 12
  - §10 API surface: Tasks 3-19
  - §11 handoff notes: addressed in plan top-of-file + Task 9's R2 setup checklist
  - §12 testing: Tasks 2, 3, 5, 10, 11, 14, 15
  - §13 risk register: addressed by Task 9 lifecycle policy + Task 11 transaction + Task 13 cron + Task 21 smoke checklist
- [ ] **Placeholder scan**: no "TBD/TODO/fill in"
- [ ] **Type consistency**: function names match across tasks (`authenticateDesktopRequest`, `chargeCredits`, `presignPut`, `generateShareLinkId`, `rewriteImagePaths`, `findOrCreateOrgForUser`)
- [ ] **No "see Task N" without context**: each code block self-contained

---

## Out of scope for this plan (do NOT do these in this implementation)

- Desktop UI / desktop auth client / "Save to cloud" button — **see Plan 2b**
- Custom domain on share links — v2
- Viewer authentication ("require sign-in to view") — v2
- Per-org storage quota beyond per-upload (100 MB) — v2
- Bulk operations (multi-session delete, bulk-revoke share links) — v2
- Real-time view notifications (webhook on share-link views) — v2
- Per-share analytics dashboard — v2
- Editing or annotating sessions after upload — never (uploads are immutable)
- International (non-US) tax / billing — inherits Phase 1's US-only constraint
- Removing the dead `cpal`/`candle-*`/etc Rust deps in `visionpipe` — desktop concern, not this plan

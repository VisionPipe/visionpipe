# In-App Credit Purchase (Web API) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend API in the Next.js app (`visionpipe-web`) that handles device registration, credit balance queries, Stripe Checkout session creation, webhook fulfillment, and credit deductions.

**Architecture:** Next.js App Router API routes backed by Vercel Postgres. Stripe SDK for checkout and webhook verification. All routes are stateless — database is the source of truth.

**Tech Stack:** Next.js 15 (App Router), Vercel Postgres (`@vercel/postgres`), Stripe Node SDK, TypeScript

**Repo:** `VisionPipe/visionpipe-web` — PR to `main` branch

**Working directory:** `/Users/drodio/projects/visionpipe-web`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/app/api/devices/register/route.ts` | Create | POST — register device, return balance |
| `src/app/api/balance/route.ts` | Create | GET — return device balance |
| `src/app/api/checkout/route.ts` | Create | POST — create Stripe Checkout Session |
| `src/app/api/stripe/webhook/route.ts` | Create | POST — handle Stripe webhook events |
| `src/app/api/deduct/route.ts` | Create | POST — deduct credits from device |
| `src/lib/db.ts` | Create | Database query helpers |
| `src/lib/stripe.ts` | Create | Stripe client and pack config |
| `.env.local.example` | Create | Document required env vars |

---

### Task 1: Install Dependencies and Create Database Schema

**Files:**
- Modify: `package.json` (via npm install)
- Create: `.env.local.example`

- [ ] **Step 1: Install Stripe and Postgres dependencies**

Run:
```bash
cd /Users/drodio/projects/visionpipe-web && npm install stripe @vercel/postgres
```

- [ ] **Step 2: Create `.env.local.example`**

Create `/Users/drodio/projects/visionpipe-web/.env.local.example`:

```
# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Stripe Price IDs (from your Stripe Dashboard > Products)
STRIPE_STARTER_PRICE_ID=price_...
STRIPE_PRO_PRICE_ID=price_...
STRIPE_BUSINESS_PRICE_ID=price_...

# Vercel Postgres (automatically set when you link a Vercel Postgres database)
POSTGRES_URL=postgres://...
```

- [ ] **Step 3: Commit**

```bash
cd /Users/drodio/projects/visionpipe-web
git checkout -b add-credit-api
git add package.json package-lock.json .env.local.example
git commit -m "chore: add stripe and vercel postgres dependencies"
```

---

### Task 2: Database Helper and Stripe Config

**Files:**
- Create: `src/lib/db.ts`
- Create: `src/lib/stripe.ts`

- [ ] **Step 1: Create database helper**

Create `/Users/drodio/projects/visionpipe-web/src/lib/db.ts`:

```typescript
import { sql } from "@vercel/postgres";

export async function ensureDevicesTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS devices (
      id UUID PRIMARY KEY,
      balance INTEGER NOT NULL DEFAULT 0,
      email TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `;
}

export async function getDevice(deviceId: string) {
  const { rows } = await sql`SELECT id, balance FROM devices WHERE id = ${deviceId}`;
  return rows[0] || null;
}

export async function registerDevice(deviceId: string): Promise<{ id: string; balance: number }> {
  const { rows } = await sql`
    INSERT INTO devices (id, balance) VALUES (${deviceId}, 0)
    ON CONFLICT (id) DO NOTHING
    RETURNING id, balance
  `;
  if (rows.length > 0) return rows[0] as { id: string; balance: number };
  // Device already existed — fetch current balance
  const existing = await getDevice(deviceId);
  return existing || { id: deviceId, balance: 0 };
}

export async function addCredits(deviceId: string, amount: number): Promise<number> {
  const { rows } = await sql`
    UPDATE devices
    SET balance = balance + ${amount}, updated_at = NOW()
    WHERE id = ${deviceId}
    RETURNING balance
  `;
  if (rows.length === 0) throw new Error("Device not found");
  return rows[0].balance as number;
}

export async function deductCredits(
  deviceId: string,
  amount: number
): Promise<{ success: boolean; balance: number }> {
  const { rows } = await sql`
    UPDATE devices
    SET balance = balance - ${amount}, updated_at = NOW()
    WHERE id = ${deviceId} AND balance >= ${amount}
    RETURNING balance
  `;
  if (rows.length > 0) {
    return { success: true, balance: rows[0].balance as number };
  }
  // Insufficient credits — return current balance
  const device = await getDevice(deviceId);
  return { success: false, balance: device?.balance ?? 0 };
}
```

- [ ] **Step 2: Create Stripe config**

Create `/Users/drodio/projects/visionpipe-web/src/lib/stripe.ts`:

```typescript
import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-03-31.basil",
});

export const PACKS: Record<string, { priceId: string; credits: number; name: string }> = {
  starter: {
    priceId: process.env.STRIPE_STARTER_PRICE_ID!,
    credits: 999,
    name: "Starter Pack",
  },
  pro: {
    priceId: process.env.STRIPE_PRO_PRICE_ID!,
    credits: 2999,
    name: "Pro Pack",
  },
  business: {
    priceId: process.env.STRIPE_BUSINESS_PRICE_ID!,
    credits: 9999,
    name: "Business Pack",
  },
};
```

Note: The `apiVersion` should match whatever version your Stripe account uses. Check `2025-03-31.basil` or use the latest from your Stripe Dashboard > Developers > API version. If the exact version string causes a type error, use `as any` on the config object.

- [ ] **Step 3: Commit**

```bash
cd /Users/drodio/projects/visionpipe-web
git add src/lib/db.ts src/lib/stripe.ts
git commit -m "feat: add database helpers and Stripe config"
```

---

### Task 3: Device Registration and Balance Endpoints

**Files:**
- Create: `src/app/api/devices/register/route.ts`
- Create: `src/app/api/balance/route.ts`

- [ ] **Step 1: Create device registration endpoint**

Create `/Users/drodio/projects/visionpipe-web/src/app/api/devices/register/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { ensureDevicesTable, registerDevice } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const { deviceId } = await request.json();

    if (!deviceId || typeof deviceId !== "string") {
      return NextResponse.json({ error: "deviceId is required" }, { status: 400 });
    }

    // Ensure table exists (no-op after first call)
    await ensureDevicesTable();

    const device = await registerDevice(deviceId);

    return NextResponse.json({ deviceId: device.id, balance: device.balance });
  } catch (error) {
    console.error("Device registration failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create balance endpoint**

Create `/Users/drodio/projects/visionpipe-web/src/app/api/balance/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getDevice } from "@/lib/db";

export async function GET(request: NextRequest) {
  const deviceId = request.nextUrl.searchParams.get("deviceId");

  if (!deviceId) {
    return NextResponse.json({ error: "deviceId query param is required" }, { status: 400 });
  }

  try {
    const device = await getDevice(deviceId);

    if (!device) {
      return NextResponse.json({ error: "Device not found" }, { status: 404 });
    }

    return NextResponse.json({ balance: device.balance });
  } catch (error) {
    console.error("Balance lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/drodio/projects/visionpipe-web
git add src/app/api/devices/register/route.ts src/app/api/balance/route.ts
git commit -m "feat: add device registration and balance API endpoints"
```

---

### Task 4: Stripe Checkout Endpoint

**Files:**
- Create: `src/app/api/checkout/route.ts`

- [ ] **Step 1: Create checkout endpoint**

Create `/Users/drodio/projects/visionpipe-web/src/app/api/checkout/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { stripe, PACKS } from "@/lib/stripe";
import { getDevice } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const { deviceId, packId } = await request.json();

    if (!deviceId || !packId) {
      return NextResponse.json({ error: "deviceId and packId are required" }, { status: 400 });
    }

    const pack = PACKS[packId];
    if (!pack) {
      return NextResponse.json(
        { error: `Invalid packId. Valid options: ${Object.keys(PACKS).join(", ")}` },
        { status: 400 }
      );
    }

    // Verify device exists
    const device = await getDevice(deviceId);
    if (!device) {
      return NextResponse.json({ error: "Device not found. Register first." }, { status: 404 });
    }

    const origin = request.nextUrl.origin;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: pack.priceId, quantity: 1 }],
      metadata: {
        deviceId,
        packId,
        credits: pack.credits.toString(),
      },
      success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/pricing`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Checkout session creation failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/drodio/projects/visionpipe-web
git add src/app/api/checkout/route.ts
git commit -m "feat: add Stripe Checkout session endpoint"
```

---

### Task 5: Stripe Webhook Endpoint

**Files:**
- Create: `src/app/api/stripe/webhook/route.ts`

- [ ] **Step 1: Create webhook endpoint**

Create `/Users/drodio/projects/visionpipe-web/src/app/api/stripe/webhook/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { addCredits } from "@/lib/db";

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const deviceId = session.metadata?.deviceId;
      const credits = parseInt(session.metadata?.credits || "0", 10);

      if (!deviceId || credits <= 0) {
        console.error("Webhook missing metadata:", { deviceId, credits });
        return NextResponse.json({ error: "Missing metadata" }, { status: 400 });
      }

      try {
        const newBalance = await addCredits(deviceId, credits);
        console.log(`Granted ${credits} credits to device ${deviceId}. New balance: ${newBalance}`);
      } catch (err) {
        console.error("Failed to grant credits:", err);
        return NextResponse.json({ error: "Failed to grant credits" }, { status: 500 });
      }
      break;
    }

    case "checkout.session.expired": {
      const session = event.data.object;
      console.log(`Checkout session expired for device ${session.metadata?.deviceId}`);
      break;
    }

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  return NextResponse.json({ received: true });
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/drodio/projects/visionpipe-web
git add src/app/api/stripe/webhook/route.ts
git commit -m "feat: add Stripe webhook handler for credit fulfillment"
```

---

### Task 6: Credit Deduction Endpoint

**Files:**
- Create: `src/app/api/deduct/route.ts`

- [ ] **Step 1: Create deduction endpoint**

Create `/Users/drodio/projects/visionpipe-web/src/app/api/deduct/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { deductCredits } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const { deviceId, amount } = await request.json();

    if (!deviceId || typeof amount !== "number" || amount <= 0) {
      return NextResponse.json(
        { error: "deviceId (string) and amount (positive number) are required" },
        { status: 400 }
      );
    }

    const result = await deductCredits(deviceId, amount);

    if (!result.success) {
      return NextResponse.json(
        { error: "insufficient_credits", balance: result.balance },
        { status: 402 }
      );
    }

    return NextResponse.json({ balance: result.balance });
  } catch (error) {
    console.error("Credit deduction failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/drodio/projects/visionpipe-web
git add src/app/api/deduct/route.ts
git commit -m "feat: add credit deduction API endpoint"
```

---

### Task 7: Build Verification

**Files:** None — verification only

- [ ] **Step 1: TypeScript check**

Run: `cd /Users/drodio/projects/visionpipe-web && npx tsc --noEmit`

Expected: No type errors (there may be warnings about missing env vars at build time, which is expected since `.env.local` won't exist in CI).

- [ ] **Step 2: Next.js build**

Run: `cd /Users/drodio/projects/visionpipe-web && npm run build`

Expected: Builds successfully. API routes will be compiled.

- [ ] **Step 3: Commit any remaining changes**

```bash
cd /Users/drodio/projects/visionpipe-web
git add -A
git commit -m "chore: build verification for credit API"
```

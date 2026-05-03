# Branch Progress: spec-2-cloud-share

This document tracks progress on the `spec-2-cloud-share` branch of VisionPipe. It is updated with each commit and serves as a context handoff for any future LLM picking up this work.

---

## Progress Update as of 2026-05-02 18:45 PDT — v0.3.2 (no version bump; spec-only branch)
*(Most recent updates at top)*

### Summary of changes since last update

Initial commit on this branch — wrote and committed the design spec for VisionPipe Cloud Share + Secret-Link Sharing (called "Spec 2" in conversation). Built on top of the recently shipped Spec 1 (multi-screenshot narrated bundle, designed in `2026-05-02-multi-screenshot-narrated-bundle-design.md`) and the existing `visionpipe-web` Phase 1 (Stripe credit billing, Clerk auth, Drizzle/Neon DB, Resend email — all production-ready). Spec 2 adds an opt-in "Save to cloud" path that uploads a session folder to Cloudflare R2, generates a secret share link at `share.visionpipe.app/<linkId>`, and charges 50 credits per upload from the user's existing balance. Free users (no Clerk account) are paywalled. The web viewer is a server-rendered Next.js route in the existing app. No source-code changes in this commit; spec doc only.

### Detail of changes made:

- **New design spec** (`docs/superpowers/specs/2026-05-02-cloud-share-secret-link-design.md`): ~700-line design covering 14 sections — summary + relationship to Spec 1 and `visionpipe-web` Phase 1, goals/non-goals, brainstorming decision table (8 decisions), system architecture diagram (desktop ↔ web ↔ R2 ↔ Neon), desktop-to-web auth flow (challenge-based polling, opaque tokens in macOS Keychain), data model (4 new Drizzle tables + extended `getBalance` query), upload flow (initiate → direct PUT to R2 → finalize with credit charge), share-link generation + web viewer with Open Graph cards, billing integration with paywall UX states, full API surface (8 new routes + 5 new pages), implementation handoff notes, testing strategy, risk register, explicit out-of-scope list.
- **Pre-spec exploration**: dispatched Explore agent into `/Users/drodio/Projects/visionpipe-web` to map the existing infrastructure. Key finding: visionpipe-web Phase 1 already ships Clerk + Stripe + Neon + Drizzle + Resend + Next.js 15 with full credit-pack billing, magic-link auth, organizations model, and idempotent webhook handling. This significantly altered the original Spec 2 recommendations (no anonymous-with-claim-later auth needed; no $8/mo subscription needed — credits are the existing pricing model).
- **Key architectural decisions captured**:
  - Auth = Clerk via challenge-based polling handshake; opaque tokens (not JWTs) stored in macOS Keychain; one token per (org_id, clerk_user_id, install) tuple
  - Pricing = flat 50 credits per upload ($0.50 at base pack rate, ~$0.42 at largest pack); failed uploads cost zero credits (charge on finalize, not initiate)
  - Free tier (no account) = no cloud uploads, paywall modal shown
  - Storage = Cloudflare R2 with custom domain `share.visionpipe.app`, public bucket, opaque keys; `pending/` prefix with 24h lifecycle policy auto-cleanup
  - Direct desktop → R2 PUT via presigned URLs (avoids Vercel 4.5 MB body limit + bandwidth costs)
  - DB additions = 4 tables (`desktop_install_tokens`, `capture_sessions`, `shared_links`, `credit_charges`) extending the existing schema
  - Updated `getBalance(orgId)` adds a single SQL term subtracting unrefunded `credit_charges.amount`
  - Web viewer = server-rendered Next.js route at `/share/[linkId]` with Open Graph preview cards; reuses existing app deploy
  - Refund policy = free deletion + credit refund within 1 hour of upload; soft-delete (no refund) thereafter
- **Decomposition note in spec**: Spec 2 = cloud share only (this spec). Transcription billing is a future Spec 3 (replaces vp-edge's free 60-min/day rate limit with credit-deducting model). This keeps Spec 2 narrow and shippable.
- **Branch created**: `spec-2-cloud-share` off main (currently at v0.3.2). No code changes in this commit; spec doc only.

### Potential concerns to address:

- **Two-repo coordination**: Spec 2 implementation requires changes in BOTH `visionpipe` (desktop) and `visionpipe-web` (Next.js). The eventual implementation plan should split into two coordinated plans (`Plan 2-web`, `Plan 2-desktop`) with the web plan shipping first (or in parallel with mocked desktop client) so the desktop has live endpoints to integrate against. The plan-writer should be told this explicitly.
- **Hard prerequisite**: `visionpipe-web` Phase 1 (`feature/stripe-billing-phase-1` branch) MUST be merged before Spec 2 implementation can start. Phase 1 ships the schema and `getBalance` that Spec 2 extends. Confirmed Phase 1 is "ready to merge" per `prd/feature-stripe-billing-phase-1.md` in that repo.
- **Spec 1 sequencing**: Spec 2 reads Spec 1's session-folder shape. If Spec 2 implementation starts before Spec 1 ships, the implementer must hand-build mock session folders for testing. Recommend Spec 1 → Spec 2 sequencing.
- **Brand-promise erosion**: Spec 1's §11 already noted Deepgram softens the "no uploads, no integrations, no accounts" promise. Spec 2 explicitly breaks ALL THREE for the cloud-share opt-in flow. README and onboarding copy need to be honest about this — local-only stays the default; cloud is paywalled opt-in.
- **`vp-edge` proxy is separate infrastructure from `visionpipe-web`**: implementers must not conflate them. `vp-edge` = Cloudflare Worker WebSocket proxy for Deepgram (Spec 1's prereq). `visionpipe-web` = Next.js app on Vercel for billing + uploads + share viewer (Spec 2's prereq). Two different deploys, two different concerns.
- **R2 lifecycle policy must be configured manually**: spec assumes `pending/` prefix has a 24h auto-delete rule; this is not in code, has to be set up in Cloudflare R2 dashboard or via API during deployment.
- **Stripe refund of a credit pack after credits already spent**: the math allows a negative balance edge case. Spec acknowledges this as v1-acceptable and blocks further uploads when negative. Worth confirming with founder if a stricter policy is needed.
- **Token has no expiry**: only revocable via user action (sign-out from desktop, unlink from dashboard). Acceptable per spec rationale (token security == device security), but should be re-evaluated if device theft becomes a real concern.
- **No webhook on share-link views**: an uploader can't be notified when their link is viewed. Defer to a future polish; for v1, view count is visible in the dashboard only.
- **Plan-writing should follow this commit**: this branch is purely for the spec; the `writing-plans` skill should be invoked next to produce the two-repo implementation plans before any code lands.

---

import type { Screenshot } from "../types/session";

/**
 * Sum the duration of each screenshot's audio segment in seconds. Skips
 * segments where `end` is null (still actively recording — final duration
 * isn't known yet, so it doesn't yet contribute to cost).
 *
 * Known gap: Session.closingNarration (audio AFTER the last screenshot,
 * stored only as transcript text) is NOT included because the type model
 * doesn't carry an AudioOffset for it. This means we slightly UNDERCHARGE
 * for sessions that include closing narration — user-friendly direction.
 */
export function deriveAudioSeconds(
  screenshots: Pick<Screenshot, "audioOffset">[]
): number {
  let total = 0;
  for (const s of screenshots) {
    if (s.audioOffset.end !== null) {
      total += Math.max(0, s.audioOffset.end - s.audioOffset.start);
    }
  }
  return Math.round(total);
}

import { describe, it, expect } from "vitest";
import { deriveAudioSeconds } from "../audio-duration";

const seg = (start: number, end: number | null) => ({
  audioOffset: { start, end },
});

describe("deriveAudioSeconds", () => {
  it("returns 0 for an empty session", () => {
    expect(deriveAudioSeconds([])).toBe(0);
  });

  it("sums durations across multiple screenshots", () => {
    expect(
      deriveAudioSeconds([seg(0, 5), seg(5, 12), seg(12, 30)])
    ).toBe(30);
  });

  it("skips segments still actively recording (end === null)", () => {
    expect(
      deriveAudioSeconds([seg(0, 30), seg(30, null)])
    ).toBe(30);
  });

  it("clamps negative durations to 0", () => {
    // end < start would only happen via a bug elsewhere, but the calculator
    // must not produce a negative cost.
    expect(deriveAudioSeconds([seg(10, 5)])).toBe(0);
  });

  it("rounds the sum (handles fractional seconds)", () => {
    expect(deriveAudioSeconds([seg(0, 10.4), seg(10.4, 20.7)])).toBe(21);
  });

  it("yields the spec's 5-screenshot/47s example correctly", () => {
    // audio across the bundle = 47s
    expect(
      deriveAudioSeconds([seg(0, 20), seg(20, 47), seg(47, 47), seg(47, 47), seg(47, 47)])
    ).toBe(47);
  });
});

import { describe, it, expect } from "vitest";
import { generateBundleName } from "../bundle-name";
import type { Session, Screenshot, CaptureMetadata } from "../../types/session";

const meta = (over: Partial<CaptureMetadata> = {}): CaptureMetadata => ({
  app: "Chrome", window: "GitHub - VisionPipe/visionpipe: Pull request #42",
  resolution: "2560x1600", scale: "2x",
  os: "macOS 15.3", osBuild: "24D81", timestamp: "2026-05-06T16:04:00Z",
  hostname: "h", username: "u", locale: "en-US", timezone: "PDT",
  displayCount: 1, primaryDisplay: "Built-in", colorSpace: "Display P3",
  cpu: "M2", memoryGb: "16", darkMode: true, battery: "80%", uptime: "1d",
  activeUrl: "", captureWidth: 1200, captureHeight: 800,
  captureMethod: "Region", imageSizeKb: 240,
  ...over,
});

const screenshot = (seq: number, over: Partial<Screenshot> = {}): Screenshot => ({
  seq,
  canonicalName: `vp-${seq}`,
  capturedAt: "2026-05-06T16:04:00Z",
  audioOffset: { start: 0, end: null },
  caption: "",
  transcriptSegment: "",
  reRecordedAudio: null,
  metadata: meta(),
  offline: false,
  ...over,
});

const session = (over: Partial<Session> = {}): Session => ({
  id: "2026-05-06_09-04-00",
  folder: "/tmp/x",
  // Use a fixed local-time timestamp so tests are deterministic across machines.
  createdAt: "2026-05-06T09:04:00",
  updatedAt: "2026-05-06T09:04:00",
  audioFile: "audio-master.webm",
  viewMode: "interleaved",
  screenshots: [],
  closingNarration: "",
  ...over,
});

describe("generateBundleName", () => {
  it("uses the user's caption as topic when present", () => {
    const s = session({
      screenshots: [screenshot(1, { caption: "github pr 42 review" })],
    });
    expect(generateBundleName(s)).toBe(
      "VisionPipe-2026-05-06-0904-1shot-github-pr-42-review.md"
    );
  });

  it("falls back to the URL when caption is empty", () => {
    const s = session({
      screenshots: [screenshot(1, {
        metadata: meta({
          activeUrl: "https://github.com/VisionPipe/visionpipe/pull/42",
        }),
      })],
    });
    expect(generateBundleName(s)).toBe(
      "VisionPipe-2026-05-06-0904-1shot-github.com-VisionPipe-visionpipe-pull-42.md"
    );
  });

  it("falls back to the window title when neither caption nor URL is set", () => {
    const s = session({
      screenshots: [screenshot(1, {
        metadata: meta({ window: "VSCode - credit-context.tsx" }),
      })],
    });
    const name = generateBundleName(s);
    expect(name).toMatch(/credit-context.tsx/);
  });

  it("falls back to the app name when nothing else is available", () => {
    const s = session({
      screenshots: [screenshot(1, {
        metadata: meta({ app: "Slack", window: "", activeUrl: "" }),
      })],
    });
    expect(generateBundleName(s)).toBe(
      "VisionPipe-2026-05-06-0904-1shot-Slack.md"
    );
  });

  it("uses 'shots' (plural) for multi-screenshot bundles", () => {
    const s = session({
      screenshots: [
        screenshot(1, { caption: "topic" }),
        screenshot(2),
        screenshot(3),
      ],
    });
    expect(generateBundleName(s)).toBe(
      "VisionPipe-2026-05-06-0904-3shots-topic.md"
    );
  });

  it("uses 'shot' (singular) for a 1-screenshot bundle", () => {
    const s = session({
      screenshots: [screenshot(1, { caption: "topic" })],
    });
    expect(generateBundleName(s)).toContain("1shot-topic");
  });

  it("normalizes 'Google Chrome' to 'Chrome' in the app fallback", () => {
    const s = session({
      screenshots: [screenshot(1, {
        metadata: meta({ app: "Google Chrome", window: "", activeUrl: "" }),
      })],
    });
    expect(generateBundleName(s)).toBe(
      "VisionPipe-2026-05-06-0904-1shot-Chrome.md"
    );
  });

  it("strips path-unsafe characters from window titles", () => {
    const s = session({
      screenshots: [screenshot(1, {
        metadata: meta({
          app: "Slack", window: "design / channel: thread 123?", activeUrl: "",
        }),
      })],
    });
    const name = generateBundleName(s);
    // `/`, `:`, `?` are filesystem-unsafe and must be stripped.
    expect(name).not.toMatch(/[/:?]/);
    expect(name).toMatch(/design-channel-thread-123/);
  });

  it("caps total length at 180 chars (excluding extension)", () => {
    const longCaption = "x".repeat(500);
    const s = session({
      screenshots: [screenshot(1, { caption: longCaption })],
    });
    const name = generateBundleName(s);
    expect(name.endsWith(".md")).toBe(true);
    expect(name.length - ".md".length).toBeLessThanOrEqual(180);
  });

  it("omits the topic gracefully when nothing is available", () => {
    const s = session({
      screenshots: [screenshot(1, {
        metadata: meta({ app: "", window: "", activeUrl: "" }),
      })],
    });
    expect(generateBundleName(s)).toBe(
      "VisionPipe-2026-05-06-0904-1shot.md"
    );
  });

  it("handles unknown timestamps gracefully", () => {
    const s = session({ createdAt: "not-a-date" });
    expect(generateBundleName(s)).toContain("unknown-time");
  });
});

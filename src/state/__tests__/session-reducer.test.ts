import { describe, it, expect } from "vitest";
import { sessionReducer, initialState, type SessionState } from "../session-reducer";
import type { Screenshot, CaptureMetadata } from "../../types/session";

const fakeMeta = (): CaptureMetadata => ({
  app: "Chrome", window: "GitHub", resolution: "2560x1600", scale: "2x",
  os: "macOS 15.3", osBuild: "24D81", timestamp: "2026-05-02T14:23:07Z",
  hostname: "host", username: "user", locale: "en-US", timezone: "PDT",
  displayCount: 1, primaryDisplay: "Built-in", colorSpace: "Display P3",
  cpu: "M2", memoryGb: "16", darkMode: true, battery: "80%", uptime: "1d",
  activeUrl: "https://github.com", captureWidth: 1200, captureHeight: 800,
  captureMethod: "Region", imageSizeKb: 240,
});

const fakeScreenshot = (seq: number): Screenshot => ({
  seq,
  canonicalName: `VisionPipe-${String(seq).padStart(3, "0")}-x`,
  capturedAt: "2026-05-02T14:23:07Z",
  audioOffset: { start: 0, end: null },
  caption: "",
  transcriptSegment: "",
  reRecordedAudio: null,
  metadata: fakeMeta(),
  offline: false,
});

describe("sessionReducer", () => {
  it("starts in idle state", () => {
    expect(initialState.session).toBeNull();
  });

  it("creates a session on START_SESSION", () => {
    const next = sessionReducer(initialState, {
      type: "START_SESSION",
      session: {
        id: "2026-05-02_14-23-07",
        folder: "/tmp/session-x",
        createdAt: "2026-05-02T14:23:07Z",
        updatedAt: "2026-05-02T14:23:07Z",
        audioFile: "audio-master.webm",
        viewMode: "interleaved",
        screenshots: [],
        closingNarration: "",
      },
    });
    expect(next.session?.id).toBe("2026-05-02_14-23-07");
  });

  it("appends screenshots and assigns audioOffset.end to prior", () => {
    const start: SessionState = {
      session: {
        id: "x", folder: "/tmp", createdAt: "", updatedAt: "",
        audioFile: "audio-master.webm", viewMode: "interleaved",
        screenshots: [{ ...fakeScreenshot(1), audioOffset: { start: 0, end: null } }],
        closingNarration: "",
      },
    };
    const next = sessionReducer(start, {
      type: "APPEND_SCREENSHOT",
      screenshot: fakeScreenshot(2),
      audioElapsedSec: 12.5,
    });
    expect(next.session!.screenshots).toHaveLength(2);
    expect(next.session!.screenshots[0].audioOffset.end).toBe(12.5);
    expect(next.session!.screenshots[1].audioOffset.start).toBe(12.5);
  });

  it("never reuses sequence numbers after delete", () => {
    let state: SessionState = {
      session: {
        id: "x", folder: "/tmp", createdAt: "", updatedAt: "",
        audioFile: "audio-master.webm", viewMode: "interleaved",
        screenshots: [fakeScreenshot(1), fakeScreenshot(2), fakeScreenshot(3)],
        closingNarration: "",
      },
    };
    state = sessionReducer(state, { type: "DELETE_SCREENSHOT", seq: 2 });
    expect(state.session!.screenshots.map(s => s.seq)).toEqual([1, 3]);
    state = sessionReducer(state, {
      type: "APPEND_SCREENSHOT",
      screenshot: fakeScreenshot(4),
      audioElapsedSec: 30,
    });
    expect(state.session!.screenshots.map(s => s.seq)).toEqual([1, 3, 4]);
  });

  it("updates a caption by seq", () => {
    let state: SessionState = {
      session: {
        id: "x", folder: "/tmp", createdAt: "", updatedAt: "",
        audioFile: "audio-master.webm", viewMode: "interleaved",
        screenshots: [fakeScreenshot(1), fakeScreenshot(2)],
        closingNarration: "",
      },
    };
    state = sessionReducer(state, { type: "UPDATE_CAPTION", seq: 2, caption: "the bug" });
    expect(state.session!.screenshots[1].caption).toBe("the bug");
    expect(state.session!.screenshots[0].caption).toBe("");
  });

  it("toggles view mode", () => {
    let state: SessionState = {
      session: {
        id: "x", folder: "/tmp", createdAt: "", updatedAt: "",
        audioFile: "audio-master.webm", viewMode: "interleaved",
        screenshots: [], closingNarration: "",
      },
    };
    state = sessionReducer(state, { type: "TOGGLE_VIEW_MODE" });
    expect(state.session!.viewMode).toBe("split");
    state = sessionReducer(state, { type: "TOGGLE_VIEW_MODE" });
    expect(state.session!.viewMode).toBe("interleaved");
  });
});

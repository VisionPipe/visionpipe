import { describe, it, expect } from "vitest";
import { generateCanonicalName, sanitizeContext } from "../canonical-name";

describe("generateCanonicalName", () => {
  const baseTs = "2026-05-02_14-23-07";

  it("uses URL-derived context when activeUrl is present", () => {
    const name = generateCanonicalName({
      seq: 1,
      timestamp: baseTs,
      app: "Google Chrome",
      activeUrl: "https://github.com/anthropics/claude-code/issues/2841",
      windowTitle: "Issue #2841 · anthropics/claude-code",
    });
    expect(name).toBe(
      "VisionPipe-001-2026-05-02_14-23-07-Chrome-github.com-anthropics-claude-code-issues-2841"
    );
  });

  it("falls back to window title when no URL", () => {
    const name = generateCanonicalName({
      seq: 2,
      timestamp: baseTs,
      app: "Visual Studio Code",
      activeUrl: "",
      windowTitle: "visionpipe — App.tsx",
    });
    expect(name).toBe(
      "VisionPipe-002-2026-05-02_14-23-07-VSCode-visionpipe-App.tsx"
    );
  });

  it("emits app-only when neither URL nor window title", () => {
    const name = generateCanonicalName({
      seq: 3,
      timestamp: baseTs,
      app: "Terminal",
      activeUrl: "",
      windowTitle: "",
    });
    expect(name).toBe("VisionPipe-003-2026-05-02_14-23-07-Terminal");
  });

  it("zero-pads sequence to 3 digits", () => {
    const n = generateCanonicalName({
      seq: 47,
      timestamp: baseTs,
      app: "Chrome",
      activeUrl: "https://example.com",
      windowTitle: "",
    });
    expect(n).toMatch(/^VisionPipe-047-/);
  });

  it("hard-caps total length at 180 chars by truncating context only", () => {
    const longPath = "a".repeat(500);
    const n = generateCanonicalName({
      seq: 1,
      timestamp: baseTs,
      app: "Chrome",
      activeUrl: `https://example.com/${longPath}`,
      windowTitle: "",
    });
    expect(n.length).toBeLessThanOrEqual(180);
    expect(n.startsWith("VisionPipe-001-2026-05-02_14-23-07-Chrome-")).toBe(true);
  });

  it("strips path-unsafe characters from context", () => {
    const n = generateCanonicalName({
      seq: 1,
      timestamp: baseTs,
      app: "Chrome",
      activeUrl: "",
      windowTitle: 'foo/bar:baz*qux?<>"|',
    });
    expect(n).toBe("VisionPipe-001-2026-05-02_14-23-07-Chrome-foo-bar-baz-qux");
  });

  it("collapses runs of dashes and trims edges", () => {
    expect(sanitizeContext("foo // bar -- baz")).toBe("foo-bar-baz");
    expect(sanitizeContext("---hello---")).toBe("hello");
  });

  it("normalizes well-known app names", () => {
    expect(
      generateCanonicalName({
        seq: 1,
        timestamp: baseTs,
        app: "Visual Studio Code",
        activeUrl: "",
        windowTitle: "x",
      })
    ).toMatch(/-VSCode-/);
    expect(
      generateCanonicalName({
        seq: 1,
        timestamp: baseTs,
        app: "Google Chrome",
        activeUrl: "https://example.com",
        windowTitle: "",
      })
    ).toMatch(/-Chrome-/);
  });
});

import { describe, it, expect } from "vitest";
import { detectConflict, RESERVED_COMBOS } from "../HotkeyBindingRow";

describe("detectConflict", () => {
  it("flags macOS-reserved combos", () => {
    expect(detectConflict("CmdOrCtrl+Q", [])).toBe("Reserved by macOS (Quit)");
    expect(detectConflict("CmdOrCtrl+W", [])).toBe("Reserved by macOS (Close window)");
    expect(detectConflict("CmdOrCtrl+Tab", [])).toBe("Reserved by macOS (App switcher)");
  });
  it("flags duplicates in the existing bindings list", () => {
    expect(detectConflict("CmdOrCtrl+Shift+C", ["CmdOrCtrl+Shift+C", "CmdOrCtrl+Enter"]))
      .toBe("Conflicts with another VisionPipe binding");
  });
  it("returns null for unique non-reserved combos", () => {
    expect(detectConflict("CmdOrCtrl+Shift+X", ["CmdOrCtrl+Shift+C"])).toBeNull();
  });
  it("RESERVED_COMBOS is a non-empty Map", () => {
    expect(RESERVED_COMBOS.size).toBeGreaterThan(0);
  });
});

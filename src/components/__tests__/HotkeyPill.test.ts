import { describe, it, expect } from "vitest";
import { __test__ } from "../HotkeyPill";

const { formatHotkey } = __test__;

describe("formatHotkey", () => {
  it("renders Cmd+Shift+C as ⌘⇧C", () => {
    expect(formatHotkey("CmdOrCtrl+Shift+C")).toBe("⌘⇧C");
  });

  it("renders Cmd+Enter as ⌘↩", () => {
    expect(formatHotkey("CmdOrCtrl+Enter")).toBe("⌘↩");
  });

  it("renders Cmd+Shift+R as ⌘⇧R", () => {
    expect(formatHotkey("CmdOrCtrl+Shift+R")).toBe("⌘⇧R");
  });

  it("renders Alt + Tab as ⌥⇥", () => {
    expect(formatHotkey("Alt+Tab")).toBe("⌥⇥");
  });

  it("uppercases lowercase single letters", () => {
    expect(formatHotkey("CmdOrCtrl+a")).toBe("⌘A");
  });

  it("preserves multi-char keys (e.g. F-keys)", () => {
    expect(formatHotkey("CmdOrCtrl+F1")).toBe("⌘F1");
  });

  it("handles Space, Backspace, Escape", () => {
    expect(formatHotkey("CmdOrCtrl+Space")).toBe("⌘␣");
    expect(formatHotkey("Backspace")).toBe("⌫");
    expect(formatHotkey("Escape")).toBe("⎋");
  });
});

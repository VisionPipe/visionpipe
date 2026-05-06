import { describe, it, expect } from "vitest";
import { splitKeys } from "../KeyCaps";

describe("splitKeys", () => {
  it("splits CmdOrCtrl+Shift+C into [⌘, ⇧, C]", () => {
    expect(splitKeys("CmdOrCtrl+Shift+C")).toEqual(["⌘", "⇧", "C"]);
  });

  it("renders Cmd+Enter as [⌘, ↩]", () => {
    expect(splitKeys("CmdOrCtrl+Enter")).toEqual(["⌘", "↩"]);
  });

  it("renders Cmd+Shift+R as [⌘, ⇧, R]", () => {
    expect(splitKeys("CmdOrCtrl+Shift+R")).toEqual(["⌘", "⇧", "R"]);
  });

  it("renders Alt+Tab as [⌥, ⇥]", () => {
    expect(splitKeys("Alt+Tab")).toEqual(["⌥", "⇥"]);
  });

  it("uppercases lowercase single letters", () => {
    expect(splitKeys("CmdOrCtrl+a")).toEqual(["⌘", "A"]);
  });

  it("preserves multi-char keys (e.g. F-keys) as a single unit", () => {
    expect(splitKeys("CmdOrCtrl+F1")).toEqual(["⌘", "F1"]);
  });

  it("handles Space, Backspace, Escape", () => {
    expect(splitKeys("CmdOrCtrl+Space")).toEqual(["⌘", "␣"]);
    expect(splitKeys("Backspace")).toEqual(["⌫"]);
    expect(splitKeys("Escape")).toEqual(["⎋"]);
  });

  it("returns an empty array for an empty combo string", () => {
    expect(splitKeys("")).toEqual([]);
  });
});

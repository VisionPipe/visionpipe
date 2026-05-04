import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderMarkdown } from "../markdown-renderer";
import type { Session } from "../../types/session";

const fixtureSession = (name: string): Session =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "__fixtures__", `${name}.json`), "utf-8"));

const fixtureExpected = (name: string): string =>
  fs.readFileSync(path.join(__dirname, "__fixtures__", `${name}.expected.md`), "utf-8");

describe("renderMarkdown", () => {
  it("renders a 2-screenshot session matching the golden fixture", () => {
    const session = fixtureSession("session-2-screenshots");
    const md = renderMarkdown(session);
    expect(md).toBe(fixtureExpected("session-2-screenshots"));
  });

  it("renders an empty narration block for offline-captured screenshots", () => {
    const session = fixtureSession("session-2-screenshots");
    session.screenshots[0].transcriptSegment = "";
    session.screenshots[0].offline = true;
    const md = renderMarkdown(session);
    expect(md).toContain("*Transcription unavailable — captured offline.");
    expect(md).toContain("Audio segment available at `audio-master.webm` from 0.0s to 47.2s.");
  });

  it("renders without a Closing narration section when empty", () => {
    const session = fixtureSession("session-2-screenshots");
    session.closingNarration = "";
    const md = renderMarkdown(session);
    expect(md).not.toContain("## Closing narration");
  });

  it("formats Caption block only when caption is non-empty", () => {
    const session = fixtureSession("session-2-screenshots");
    session.screenshots[0].caption = "";
    const md = renderMarkdown(session);
    // first screenshot has no caption now
    const sec1 = md.split("---")[1] ?? md;
    expect(sec1).not.toContain("**Caption:**");
  });
});

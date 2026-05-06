import type { Session } from "../types/session";
import { sanitizeContext } from "./canonical-name";

const MAX_TOTAL_LENGTH = 180;
const TOPIC_MAX_LENGTH = 80;

const APP_NAME_NORMALIZATION: Record<string, string> = {
  "Google Chrome": "Chrome",
  "Visual Studio Code": "VSCode",
  "Microsoft Visual Studio Code": "VSCode",
  "Sublime Text": "Sublime",
  "iTerm2": "iTerm",
};

function shortenAppName(app: string): string {
  if (APP_NAME_NORMALIZATION[app]) return APP_NAME_NORMALIZATION[app];
  return app.replace(/\.app$/, "").replace(/\s+Inc\.?$/, "").trim();
}

/**
 * Pull a usable topic from the first screenshot's metadata, in priority
 * order: caption → URL path → window title → app name. Returns empty
 * string if nothing useful is available.
 */
function deriveTopic(session: Session): string {
  const first = session.screenshots[0];
  if (!first) return "";

  // 1. Caption — what the user explicitly typed.
  if (first.caption && first.caption.trim()) {
    return sanitizeContext(first.caption.trim()).slice(0, TOPIC_MAX_LENGTH);
  }

  // 2. URL path (if browser metadata captured one).
  if (first.metadata.activeUrl) {
    try {
      const u = new URL(first.metadata.activeUrl);
      const path = u.pathname.replace(/^\//, "").replace(/\/$/, "");
      const combined = path ? `${u.hostname}-${path}` : u.hostname;
      const t = sanitizeContext(combined);
      if (t) return t.slice(0, TOPIC_MAX_LENGTH);
    } catch {
      // Not a valid URL — fall through.
    }
  }

  // 3. Window title.
  if (first.metadata.window) {
    const t = sanitizeContext(first.metadata.window);
    if (t) return t.slice(0, TOPIC_MAX_LENGTH);
  }

  // 4. App name (last-resort topic, since at least it identifies the source).
  if (first.metadata.app) {
    const app = sanitizeContext(shortenAppName(first.metadata.app));
    if (app) return app.slice(0, TOPIC_MAX_LENGTH);
  }

  return "";
}

/**
 * Format the session's createdAt timestamp as "YYYY-MM-DD-HHmm" in the
 * user's local timezone (so the filename matches when they expect it,
 * not UTC). Strips seconds and timezone offset.
 */
function formatTimestamp(createdAt: string): string {
  const d = new Date(createdAt);
  if (isNaN(d.getTime())) return "unknown-time";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const HH = String(d.getHours()).padStart(2, "0");
  const MM = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}-${HH}${MM}`;
}

/**
 * Generate a descriptive markdown bundle filename for a session.
 * Format: VisionPipe-{YYYY-MM-DD-HHmm}-{N}shots-{topic}.md
 *
 * Topic falls back through caption → URL → window title → app, or is
 * omitted entirely if nothing is available. Length is capped at 180
 * chars (matching the screenshot canonical-name cap) by truncating the
 * topic.
 */
export function generateBundleName(session: Session): string {
  const ts = formatTimestamp(session.createdAt);
  const count = session.screenshots.length;
  const shotsPart = `${count}shot${count === 1 ? "" : "s"}`;
  const topic = deriveTopic(session);

  const base = `VisionPipe-${ts}-${shotsPart}`;
  let name = topic ? `${base}-${topic}` : base;

  // Cap total length (excluding extension).
  if (name.length > MAX_TOTAL_LENGTH) {
    if (topic) {
      const room = MAX_TOTAL_LENGTH - base.length - 1; // -1 for the joining "-"
      const trimmedTopic = topic.slice(0, Math.max(0, room));
      name = trimmedTopic ? `${base}-${trimmedTopic}` : base;
    } else {
      name = name.slice(0, MAX_TOTAL_LENGTH);
    }
  }

  return `${name}.md`;
}

/**
 * Generate canonical screenshot names: VisionPipe-{seq}-{ts}-{app}-{context}.
 * See spec §5 for naming format details.
 */

const MAX_TOTAL_LENGTH = 180;
const PATH_UNSAFE = /[\/\\:*?"<>|—–]/g;

const APP_NAME_NORMALIZATION: Record<string, string> = {
  "Google Chrome": "Chrome",
  "Visual Studio Code": "VSCode",
  "Microsoft Visual Studio Code": "VSCode",
  "Sublime Text": "Sublime",
  "iTerm2": "iTerm",
};

function shortenAppName(app: string): string {
  if (APP_NAME_NORMALIZATION[app]) return APP_NAME_NORMALIZATION[app];
  // Drop common .app suffix and "Inc." style noise
  return app.replace(/\.app$/, "").replace(/\s+Inc\.?$/, "").trim();
}

export function sanitizeContext(input: string): string {
  return input
    .replace(PATH_UNSAFE, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function urlToContext(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/^\//, "").replace(/\/$/, "");
    return sanitizeContext(path ? `${u.hostname}-${path}` : u.hostname);
  } catch {
    return "";
  }
}

interface NameInput {
  seq: number;
  timestamp: string;
  app: string;
  activeUrl: string;
  windowTitle: string;
}

export function generateCanonicalName(input: NameInput): string {
  const seq = String(input.seq).padStart(3, "0");
  const app = sanitizeContext(shortenAppName(input.app));
  const prefix = `VisionPipe-${seq}-${input.timestamp}-${app}`;

  let context = "";
  if (input.activeUrl) {
    context = urlToContext(input.activeUrl);
  }
  if (!context && input.windowTitle) {
    context = sanitizeContext(input.windowTitle);
  }

  if (!context) return prefix;

  const fullName = `${prefix}-${context}`;
  if (fullName.length <= MAX_TOTAL_LENGTH) return fullName;

  const remaining = MAX_TOTAL_LENGTH - prefix.length - 1;
  return `${prefix}-${context.slice(0, remaining)}`;
}

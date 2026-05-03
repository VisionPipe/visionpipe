import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { C, FONT_MONO } from "../lib/ui-tokens";

/**
 * Displays the current app version (read from tauri.conf.json via Tauri API).
 * The release script bumps tauri.conf.json's version on every build, so this
 * always reflects the running build with no manual sync required.
 */
export function VersionBadge() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch((err) => {
        console.warn("[VisionPipe] getVersion failed:", err);
      });
  }, []);

  if (!version) return null;

  return (
    <span
      style={{
        fontFamily: FONT_MONO,
        fontSize: 10,
        color: C.textDim,
        letterSpacing: "0.04em",
        userSelect: "text",
      }}
      title={`Vision|Pipe v${version}`}
    >
      v{version}
    </span>
  );
}

import { useEffect } from "react";
import { useSession } from "../state/session-context";
import { convertFileSrc } from "@tauri-apps/api/core";
import { C } from "../lib/ui-tokens";

interface Props {
  seq: number;
  onClose: () => void;
}

export function Lightbox({ seq, onClose }: Props) {
  const { state } = useSession();
  const session = state.session!;
  const idx = session.screenshots.findIndex(s => s.seq === seq);
  const screenshot = session.screenshots[idx];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!screenshot) return null;
  const src = convertFileSrc(`${session.folder}/${screenshot.canonicalName}.png`);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.92)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
      }}
    >
      <img src={src} alt={screenshot.canonicalName}
           style={{ maxWidth: "95vw", maxHeight: "95vh", boxShadow: `0 0 24px ${C.teal}` }} />
    </div>
  );
}

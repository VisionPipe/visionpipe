import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { HotkeyBindingRow } from "./HotkeyBindingRow";
import { C, FONT_BODY } from "../lib/ui-tokens";

interface HotkeyConfig {
  takeNextScreenshot: string;
  copyAndSend: string;
  rerecordActive: string;
  toggleViewMode: string;
}

const DEFAULTS: HotkeyConfig = {
  takeNextScreenshot: "CmdOrCtrl+Shift+C",
  copyAndSend: "CmdOrCtrl+Enter",
  rerecordActive: "CmdOrCtrl+Shift+R",
  toggleViewMode: "CmdOrCtrl+T",
};

interface Props { onClose: () => void; }

interface RustHotkeyConfig {
  take_next_screenshot: string;
  copy_and_send: string;
  rerecord_active: string;
  toggle_view_mode: string;
}

export function SettingsPanel({ onClose }: Props) {
  const [cfg, setCfg] = useState<HotkeyConfig>(DEFAULTS);

  useEffect(() => {
    (async () => {
      const loaded = await invoke<RustHotkeyConfig>("load_hotkey_config");
      setCfg({
        takeNextScreenshot: loaded.take_next_screenshot,
        copyAndSend: loaded.copy_and_send,
        rerecordActive: loaded.rerecord_active,
        toggleViewMode: loaded.toggle_view_mode,
      });
    })();
  }, []);

  const persist = async (next: HotkeyConfig) => {
    setCfg(next);
    await invoke("save_hotkey_config", {
      cfg: {
        take_next_screenshot: next.takeNextScreenshot,
        copy_and_send: next.copyAndSend,
        rerecord_active: next.rerecordActive,
        toggle_view_mode: next.toggleViewMode,
      },
    });
    // Tell the backend to drop and re-register all global shortcuts
    // with the just-saved config. Without this, the global capture
    // combo only changes after an app restart.
    await invoke("resume_global_shortcuts").catch((err) => {
      console.warn("[VisionPipe] resume_global_shortcuts failed:", err);
    });
  };

  const others = (k: keyof HotkeyConfig): string[] => {
    const keys: (keyof HotkeyConfig)[] = ["takeNextScreenshot", "copyAndSend", "rerecordActive", "toggleViewMode"];
    return keys.filter(key => key !== k).map(key => cfg[key]);
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
    }}>
      <div style={{
        background: C.deepForest, borderRadius: 8,
        minWidth: 560, maxWidth: 720, color: C.textBright, fontFamily: FONT_BODY,
        border: `1px solid ${C.borderLight}`,
        // Generous top padding so "Settings" doesn't collide with the
        // macOS chrome / window-title area when the modal sits high in
        // the viewport. 28 px elsewhere; 36 top.
        padding: "36px 28px 24px 28px",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>Settings</h2>
          <button onClick={onClose} style={{
            background: "transparent", border: "none", color: C.textBright,
            fontSize: 24, cursor: "pointer", lineHeight: 1, padding: 0,
          }}>×</button>
        </div>
        <h3 style={{ marginTop: 0, color: C.textMuted, fontSize: 12, textTransform: "uppercase", letterSpacing: 1 }}>
          Hotkeys
        </h3>
        <HotkeyBindingRow label="Take next screenshot" scope="global"
          combo={cfg.takeNextScreenshot} otherBindings={others("takeNextScreenshot")}
          onChange={(c) => persist({ ...cfg, takeNextScreenshot: c })}
          onReset={() => persist({ ...cfg, takeNextScreenshot: DEFAULTS.takeNextScreenshot })}
        />
        <HotkeyBindingRow label="Copy & Send" scope="window"
          combo={cfg.copyAndSend} otherBindings={others("copyAndSend")}
          onChange={(c) => persist({ ...cfg, copyAndSend: c })}
          onReset={() => persist({ ...cfg, copyAndSend: DEFAULTS.copyAndSend })}
        />
        <HotkeyBindingRow label="Re-record active segment" scope="window"
          combo={cfg.rerecordActive} otherBindings={others("rerecordActive")}
          onChange={(c) => persist({ ...cfg, rerecordActive: c })}
          onReset={() => persist({ ...cfg, rerecordActive: DEFAULTS.rerecordActive })}
        />
        <HotkeyBindingRow label="Toggle view mode" scope="window"
          combo={cfg.toggleViewMode} otherBindings={others("toggleViewMode")}
          onChange={(c) => persist({ ...cfg, toggleViewMode: c })}
          onReset={() => persist({ ...cfg, toggleViewMode: DEFAULTS.toggleViewMode })}
        />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
          <button onClick={() => persist(DEFAULTS)} style={{
            background: "transparent", border: `1px solid ${C.borderLight}`,
            color: C.textMuted, padding: "6px 14px", borderRadius: 4, cursor: "pointer",
          }}>Reset all to defaults</button>
          <div style={{ fontSize: 11, color: C.textMuted, alignSelf: "center" }}>
            Hotkey changes take effect immediately.
          </div>
        </div>
      </div>
    </div>
  );
}

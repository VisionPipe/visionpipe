# Branch Progress: feature/multi-screenshot-bundle

This document tracks progress on the `feature/multi-screenshot-bundle` branch of VisionPipe. It is updated with each commit and serves as a context handoff for any future LLM picking up this work.

---

## Progress Update as of 2026-05-03 08:09 PDT — v0.3.3
*(Most recent updates at top)*

### Summary of changes since last update

Re-enable the standard macOS "traffic light" window controls (red/yellow/green close/minimize/zoom buttons) at the top-left of every window. Previous builds had `decorations: false` to support the custom transparent chrome bar, which also hid the system controls. Switched to `decorations: true` + `titleBarStyle: "Overlay"` + `hiddenTitle: true` so the traffic lights float over our custom chrome bar without the standard title bar interfering. Added 80px left-padding to the chrome bar's content so the logo + wordmark don't get hidden behind the buttons.

### Detail of changes made:

- **`src-tauri/tauri.conf.json`** — Window config: `decorations: false → true`, added `"titleBarStyle": "Overlay"` and `"hiddenTitle": true`. The Overlay style is the macOS-native way to keep traffic-light buttons while hiding the default title bar so our custom chrome shows through.
- **`src/App.tsx`** — `ChromeBar` left section now has `padding-left: 80px` (was `12px`) so the logo + wordmark start past the traffic-light buttons. The grip icon stays centered on the bar (it's in the middle flex section, not the left, so the asymmetric padding doesn't move it).

### Potential concerns to address:

- **Selection mode also has the traffic lights now** — when ⌘⇧C launches the full-screen selection overlay, the traffic-light buttons are visible at top-left. They aren't broken (clicking close still closes the window), just visually present during what should be an "edge-to-edge" selection. Could conditionally hide them in selecting mode by toggling decorations at runtime, but that's complex. Acceptable for now.
- **80px padding is a magic number** based on roughly counting the traffic-light buttons (3 × ~14px + spacing). If macOS changes the spacing in a future version, we'd want to bump it. No way to query the exact width programmatically.
- **Resize handles are now active** because `decorations: true`. User can resize the annotation card by dragging edges. The card's `flex: 1` layout adapts gracefully, but onboarding card may look odd at extreme sizes.

---



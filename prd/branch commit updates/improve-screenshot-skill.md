# Branch: improve-screenshot-skill

---

## Progress Update as of 2026-04-15 05:35 PT

### Summary of changes since last update
Updated the `/screenshot` command and `visionpipe-capture` skill to always list available windows and ask the user which one to capture, instead of defaulting to a fullscreen capture of the IDE.

### Detail of changes made:
- `.claude/commands/screenshot.md` — Rewrote the workflow steps so that step 1 always runs `vp list` (or `list_windows` MCP tool) to enumerate windows, step 2 asks the user to pick a window (or fullscreen), and step 3 captures after the user responds. Added a "Shortcut" section: if the user passes an app name directly (e.g., `/screenshot Chrome`), skip the prompt.
- `.claude/skills/visionpipe-capture/SKILL.md` — Same workflow change: always list windows first, ask the user if no app was specified, then capture the selected window. Expanded from 5 to 7 workflow steps for clarity.

### Potential concerns to address:
- The AskUserQuestion tool only supports up to 4 options, so if there are many windows open, only the top few can be shown as choices — the user would need to type "Other" for less common windows.
- The `.mcp.json` still has a hardcoded local path to the `visionpipe-mcp` binary, which won't work for other users out of the box.

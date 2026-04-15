---
description: "Capture a screenshot and analyze what's on screen"
---

Use the visionpipe tools to capture a screenshot and analyze it.

## Steps

1. **Always start by listing available windows** using the `list_windows` MCP tool, or via CLI: `vp list`
2. **Ask the user which window they want captured** — present the list of available apps/windows and ask them to pick one, or offer "fullscreen" as an option
3. Once the user chooses, call `capture_screenshot` (MCP) or `vp capture --app "<name>"` (CLI) with their selection
   - If they chose fullscreen, capture without an app name
4. Read the PNG file at the returned path using the Read tool (it supports images)
5. Read the JSON metadata file for additional context
6. Analyze the screenshot in context of the metadata and the user's question

## Shortcut

If the user already specified an app name in their message (e.g., "/screenshot Chrome"), skip the prompt and capture that app directly.

## Fallback (if MCP server is not available)

Run the CLI directly via Bash:
- `vp list` to see available windows
- `vp capture` or `vp capture --app "<name>"` to capture
- Read the output paths from stdout, then Read the files

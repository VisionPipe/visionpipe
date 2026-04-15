---
name: visionpipe-capture
description: "Use when the user asks about what's on their screen, wants a screenshot, or needs visual context about their desktop or apps"
---

# VisionPipe Screen Capture

## When to Activate

- User asks "what's on my screen"
- User says "take a screenshot" or "capture my screen"
- User asks about a specific app's UI ("what does Chrome show right now")
- User needs visual context to debug a UI issue
- User says "look at my app" or "check my window"

## Available MCP Tools (visionpipe server)

- `list_windows` -- lists all visible windows with app names and IDs
- `capture_screenshot` -- captures fullscreen or a specific app window, returns file paths
- `get_metadata` -- returns system context (active app, URL, resolution, dark mode, etc.)

## Workflow

1. **Always list windows first** — call `list_windows` or `vp list` to see what's available
2. **If the user already specified an app**, verify it's in the list and capture it directly
3. **If the user did NOT specify an app**, present the list of available windows and ask which one they'd like captured (also offer "fullscreen" as an option). Wait for their response before capturing.
4. Capture the selected window with `capture_screenshot` (passing `app_name`) or fullscreen
5. Read the returned PNG file path with the Read tool (Claude Code can view images natively)
6. Read the metadata JSON for additional context (active app, URL, resolution, etc.)
7. Analyze and respond based on what you see and the metadata

## Fallback (if MCP server is unavailable)

Run the `vp` CLI directly via Bash:

```bash
# List available windows
vp list

# Capture fullscreen
vp capture

# Capture a specific app's window
vp capture --app "Google Chrome"

# Get system metadata
vp metadata
```

The CLI outputs file paths to stdout (one per line: PNG path, then JSON path). Read both files after capture.

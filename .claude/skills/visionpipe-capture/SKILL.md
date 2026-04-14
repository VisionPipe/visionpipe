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

1. If the user mentions a specific app, call `list_windows` first to verify it's visible and get the correct name
2. Call `capture_screenshot` with the `app_name` parameter if specified, or without it for fullscreen
3. Read the returned PNG file path with the Read tool (Claude Code can view images natively)
4. Read the metadata JSON for additional context (active app, URL, resolution, etc.)
5. Analyze and respond based on what you see and the metadata

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

---
description: "Capture a screenshot and analyze what's on screen"
---

Use the visionpipe MCP tools to capture a screenshot and analyze it.

## Steps

1. If the user specified an app name, call the `list_windows` MCP tool first to verify it's visible
2. Call the `capture_screenshot` MCP tool (from the visionpipe server)
   - If the user specified an app name, pass it as `app_name`
   - Otherwise capture fullscreen
3. Read the PNG file at the returned `png_path` using the Read tool (it supports images)
4. Read the JSON metadata file at `metadata_path` for additional context
5. Analyze the screenshot in context of the metadata and the user's question
6. Provide your analysis

## Fallback (if MCP server is not available)

Run the CLI directly via Bash:
- `vp list` to see available windows
- `vp capture` or `vp capture --app "<name>"` to capture
- Read the output paths from stdout, then Read the files

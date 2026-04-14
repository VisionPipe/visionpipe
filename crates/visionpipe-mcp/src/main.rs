use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};
use std::process::Command;

/// Find the `vp` binary. Prefer one next to this binary, then fall back to PATH.
fn vp_path() -> String {
    if let Ok(exe) = std::env::current_exe() {
        let sibling = exe.with_file_name("vp");
        if sibling.exists() {
            return sibling.to_string_lossy().to_string();
        }
    }
    "vp".to_string()
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct JsonRpcRequest {
    jsonrpc: String,
    id: Option<Value>,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Serialize)]
struct JsonRpcResponse {
    jsonrpc: String,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<Value>,
}

fn success(id: Value, result: Value) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: "2.0".to_string(),
        id,
        result: Some(result),
        error: None,
    }
}

fn error(id: Value, code: i64, message: &str) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: "2.0".to_string(),
        id,
        result: None,
        error: Some(json!({"code": code, "message": message})),
    }
}

fn handle_initialize(id: Value) -> JsonRpcResponse {
    success(
        id,
        json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {
                "tools": {}
            },
            "serverInfo": {
                "name": "visionpipe",
                "version": "0.1.0"
            }
        }),
    )
}

fn handle_tools_list(id: Value) -> JsonRpcResponse {
    success(
        id,
        json!({
            "tools": [
                {
                    "name": "list_windows",
                    "description": "List all visible application windows on the screen. Returns window IDs, app names, and window titles.",
                    "inputSchema": {
                        "type": "object",
                        "properties": {},
                        "required": []
                    }
                },
                {
                    "name": "capture_screenshot",
                    "description": "Capture a screenshot of the full screen or a specific application window. Returns file paths to the saved PNG image and JSON metadata. Use the Read tool on the PNG path to view the screenshot.",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "app_name": {
                                "type": "string",
                                "description": "Name of the app to capture (e.g. 'Google Chrome', 'Slack'). If omitted, captures the full screen. Use list_windows to see available apps."
                            }
                        },
                        "required": []
                    }
                },
                {
                    "name": "get_metadata",
                    "description": "Get system and app context metadata including active app, window title, URL, resolution, OS version, dark mode status, and more.",
                    "inputSchema": {
                        "type": "object",
                        "properties": {},
                        "required": []
                    }
                }
            ]
        }),
    )
}

fn run_vp(args: &[&str]) -> Result<String, String> {
    let vp = vp_path();
    let output = Command::new(&vp)
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run '{}': {}", vp, e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("vp failed: {}", stderr.trim()));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn handle_tools_call(id: Value, params: &Value) -> JsonRpcResponse {
    let tool_name = params["name"].as_str().unwrap_or("");
    let arguments = &params["arguments"];

    match tool_name {
        "list_windows" => match run_vp(&["list", "--json"]) {
            Ok(output) => {
                let parsed: Value = serde_json::from_str(&output).unwrap_or(json!(output));
                success(
                    id,
                    json!({
                        "content": [{
                            "type": "text",
                            "text": serde_json::to_string_pretty(&parsed).unwrap_or(output)
                        }]
                    }),
                )
            }
            Err(e) => success(
                id,
                json!({
                    "content": [{"type": "text", "text": e}],
                    "isError": true
                }),
            ),
        },

        "capture_screenshot" => {
            let mut args = vec!["capture"];
            let app_name = arguments["app_name"].as_str().unwrap_or("");
            let app_flag;
            if !app_name.is_empty() {
                args.push("--app");
                app_flag = app_name.to_string();
                args.push(&app_flag);
            }

            match run_vp(&args) {
                Ok(output) => {
                    let lines: Vec<&str> = output.lines().collect();
                    let png_path = lines.first().unwrap_or(&"");
                    let json_path = lines.get(1).unwrap_or(&"");

                    success(
                        id,
                        json!({
                            "content": [{
                                "type": "text",
                                "text": format!(
                                    "Screenshot captured!\n\nPNG: {}\nMetadata: {}\n\nUse the Read tool on the PNG path to view the screenshot.",
                                    png_path, json_path
                                )
                            }]
                        }),
                    )
                }
                Err(e) => success(
                    id,
                    json!({
                        "content": [{"type": "text", "text": e}],
                        "isError": true
                    }),
                ),
            }
        }

        "get_metadata" => match run_vp(&["metadata"]) {
            Ok(output) => success(
                id,
                json!({
                    "content": [{"type": "text", "text": output}]
                }),
            ),
            Err(e) => success(
                id,
                json!({
                    "content": [{"type": "text", "text": e}],
                    "isError": true
                }),
            ),
        },

        _ => error(id, -32601, &format!("Unknown tool: {}", tool_name)),
    }
}

fn handle_request(req: &JsonRpcRequest) -> Option<JsonRpcResponse> {
    let id = req.id.clone().unwrap_or(Value::Null);

    match req.method.as_str() {
        "initialize" => Some(handle_initialize(id)),
        "notifications/initialized" => None, // no response for notifications
        "tools/list" => Some(handle_tools_list(id)),
        "tools/call" => Some(handle_tools_call(id, &req.params)),
        _ => {
            // Ignore unknown notifications (no id), error on unknown requests
            if req.id.is_some() {
                Some(error(id, -32601, &format!("Method not found: {}", req.method)))
            } else {
                None
            }
        }
    }
}

fn main() {
    let stdin = io::stdin();
    let mut stdout = io::stdout();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };

        let line = line.trim().to_string();
        if line.is_empty() {
            continue;
        }

        let req: JsonRpcRequest = match serde_json::from_str(&line) {
            Ok(r) => r,
            Err(e) => {
                let resp = error(Value::Null, -32700, &format!("Parse error: {}", e));
                let _ = writeln!(stdout, "{}", serde_json::to_string(&resp).unwrap());
                let _ = stdout.flush();
                continue;
            }
        };

        if let Some(resp) = handle_request(&req) {
            let _ = writeln!(stdout, "{}", serde_json::to_string(&resp).unwrap());
            let _ = stdout.flush();
        }
    }
}

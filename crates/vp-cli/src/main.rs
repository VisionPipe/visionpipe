use clap::{Parser, Subcommand};
use visionpipe_core::{capture, metadata, save, window};

#[derive(Parser)]
#[command(name = "vp", about = "VisionPipe screen capture CLI")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// List visible application windows
    List {
        /// Output as JSON
        #[arg(long)]
        json: bool,
    },
    /// Capture a screenshot
    Capture {
        /// Capture a specific app's window by name
        #[arg(long)]
        app: Option<String>,
    },
    /// Print system/app metadata as JSON
    Metadata,
}

fn main() {
    let cli = Cli::parse();

    let result = match cli.command {
        Commands::List { json } => cmd_list(json),
        Commands::Capture { app } => cmd_capture(app),
        Commands::Metadata => cmd_metadata(),
    };

    if let Err(e) = result {
        eprintln!("Error: {}", e);
        std::process::exit(1);
    }
}

fn cmd_list(json_output: bool) -> Result<(), Box<dyn std::error::Error>> {
    let windows = window::list_windows()?;

    if json_output {
        println!("{}", serde_json::to_string_pretty(&windows)?);
    } else {
        println!("{:<8} {:<25} {}", "ID", "App", "Window Title");
        println!("{}", "-".repeat(70));
        for w in &windows {
            println!("{:<8} {:<25} {}", w.id, w.owner, w.name);
        }
    }

    Ok(())
}

fn cmd_capture(app: Option<String>) -> Result<(), Box<dyn std::error::Error>> {
    let data_uri = match app {
        Some(ref app_name) => {
            let wid = window::find_window_id(app_name)?;
            eprintln!("[VisionPipe] Capturing window ID {} for '{}'", wid, app_name);
            capture::capture_window(wid)?
        }
        None => {
            eprintln!("[VisionPipe] Capturing fullscreen");
            capture::capture_fullscreen()?
        }
    };

    let meta = metadata::collect_metadata();
    let (png_path, json_path) = save::save_capture(&data_uri, &meta)?;

    println!("{}", png_path);
    println!("{}", json_path);

    Ok(())
}

fn cmd_metadata() -> Result<(), Box<dyn std::error::Error>> {
    let meta = metadata::collect_metadata();
    println!("{}", serde_json::to_string_pretty(&meta)?);
    Ok(())
}

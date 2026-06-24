//! Command-line entrypoint for the Trellis Rust runtime process.

use std::path::PathBuf;

use clap::Parser;
use trellis_runtime::{RuntimeMode, RuntimeOptions};

/// Trellis runtime process entrypoint.
#[derive(Debug, Parser)]
#[command(version, about = "Run the Trellis runtime")]
struct Args {
    /// Runtime mode to run: all, platform, jobs, health, or eventlog.
    mode: RuntimeMode,
    /// Path to the Trellis runtime TOML configuration.
    #[arg(long)]
    config: PathBuf,
}

/// Parses CLI arguments and starts the selected runtime process.
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse();
    trellis_runtime::run(RuntimeOptions {
        mode: args.mode,
        config_path: args.config,
    })
    .await?;
    Ok(())
}

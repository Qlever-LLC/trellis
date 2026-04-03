use std::env;

use trellis_client::ServiceConnectOptions;
use trellis_service_jobs::connect_and_run;

fn required_env(name: &str) -> Result<String, String> {
    env::var(name).map_err(|_| format!("missing required env var: {name}"))
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let servers = env::var("NATS_SERVERS").unwrap_or_else(|_| "nats://127.0.0.1:4222".to_string());
    let sentinel_creds_path = required_env("SENTINEL_CREDS_PATH")?;
    let session_key_seed_base64url = required_env("SESSION_KEY_SEED_BASE64URL")?;
    let timeout_ms = env::var("TRELLIS_TIMEOUT_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(2_000);

    connect_and_run(ServiceConnectOptions {
        servers: &servers,
        sentinel_creds_path: &sentinel_creds_path,
        session_key_seed_base64url: &session_key_seed_base64url,
        timeout_ms,
    })
    .await?;

    Ok(())
}

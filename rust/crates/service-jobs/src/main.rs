use std::env;

use trellis::client::ServiceConnectOptions;
use trellis_service_jobs::{connect_service, JobsServiceMode, CONTRACT_DIGEST, CONTRACT_ID};

fn required_env(name: &str) -> Result<String, String> {
    env::var(name).map_err(|_| format!("missing required env var: {name}"))
}

fn service_mode() -> JobsServiceMode {
    match env::var("TRELLIS_JOBS_MODE").as_deref() {
        Ok("rpc-only") => JobsServiceMode::RpcOnly,
        _ => JobsServiceMode::Owner,
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let trellis_url = required_env("TRELLIS_URL")?;
    let session_key_seed_base64url = required_env("SESSION_KEY_SEED_BASE64URL")?;
    let timeout_ms = env::var("TRELLIS_TIMEOUT_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(2_000);

    let service = connect_service(ServiceConnectOptions {
        trellis_url: &trellis_url,
        contract_id: CONTRACT_ID,
        contract_digest: CONTRACT_DIGEST,
        session_key_seed_base64url: &session_key_seed_base64url,
        timeout_ms,
    })
    .await?;

    service.run_with_mode(service_mode()).await?;

    Ok(())
}

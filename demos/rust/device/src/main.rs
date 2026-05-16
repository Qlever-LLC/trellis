use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use clap::Parser;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use trellis_auth::{
    derive_device_identity, start_device_activation_request, DeviceActivationLocalState,
    DeviceActivationSession, DeviceActivationSessionBuilder, DeviceActivationStatus,
};
use trellis_client::{
    download_transfer_grant_from_value, DeviceConnectOptions, ServiceConnectOptions, TrellisClient,
};
use trellis_participant_demo_device::contract as device_contract;
use trellis_participant_demo_device::state::{DraftInspectionState, SelectedSiteState};
use trellis_sdk_demo_service::types::{
    AssignmentsListRequest, EvidenceDownloadRequest, EvidenceListRequest, EvidenceUploadInput,
    ReportsGenerateInput, SitesListRequest, SitesListResponseSitesItem,
};

const DEMO_TIMESTAMP: &str = "2026-04-30T16:00:00.000Z";
const DEFAULT_DEVICE_STORE: &str = ".trellis-demo-device.json";
const LIST_LIMIT: i64 = 50;
const LIST_OFFSET: i64 = 0;

#[derive(Debug, Parser)]
struct Args {
    /// Trellis HTTP URL for service bootstrap mode.
    #[arg(long, env = "TRELLIS_URL")]
    trellis_url: Option<String>,

    /// Session key seed encoded as base64url.
    #[arg(long, env = "TRELLIS_SESSION_KEY_SEED")]
    session_key_seed: Option<String>,

    /// Connect as a service principal instead of user/session mode.
    #[arg(long)]
    service_bootstrap: bool,

    /// Use demo-local activated-device persistence and connect flow.
    #[arg(long, env = "TRELLIS_DEMO_DEVICE")]
    device: bool,

    /// JSON file for demo-local device root secret and activation state.
    #[arg(long, env = "TRELLIS_DEVICE_STORE")]
    device_store: Option<PathBuf>,

    /// Local confirmation code to accept for a pending activated device.
    #[arg(long, env = "TRELLIS_DEVICE_CONFIRM_CODE")]
    device_confirm_code: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
struct PersistedDeviceState {
    trellis_url: String,
    device_root_secret: [u8; 32],
    local_state: DeviceActivationLocalState,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();
    println!("Rust Field Device Demo");
    println!("Activation helper: demo-local activated-device persistence enabled.");
    println!("State helper: generated device/state facade enabled.");

    let client = connect_if_configured(&args).await?;
    if let Some(client) = client.as_ref() {
        spawn_event_watchers(client).await?;
    }

    wizard_loop(client.as_ref()).await
}

async fn connect_if_configured(args: &Args) -> anyhow::Result<Option<TrellisClient>> {
    if args.device {
        return connect_device_if_configured(args).await;
    }

    if args.service_bootstrap {
        let Some(session_key_seed) = args.session_key_seed.as_deref() else {
            println!("Missing --session-key-seed; running offline.");
            return Ok(None);
        };
        let Some(trellis_url) = args.trellis_url.as_deref() else {
            println!("Missing --trellis-url; running offline.");
            return Ok(None);
        };
        return Ok(Some(
            TrellisClient::connect_service(ServiceConnectOptions {
                trellis_url,
                contract_id: device_contract::CONTRACT_ID,
                contract_digest: device_contract::CONTRACT_DIGEST,
                session_key_seed_base64url: session_key_seed,
                timeout_ms: 10_000,
            })
            .await?,
        ));
    }

    println!("No activated-device or service bootstrap credentials provided; running offline.");
    Ok(None)
}

async fn connect_device_if_configured(args: &Args) -> anyhow::Result<Option<TrellisClient>> {
    let store_path = device_store_path(args);
    let persisted = load_device_state(&store_path)?;
    let mut persisted = if let Some(persisted) = persisted {
        persisted
    } else {
        let Some(trellis_url) = args.trellis_url.as_deref() else {
            anyhow::bail!("--device requires --trellis-url when no persisted device state exists");
        };
        let persisted = start_and_persist_device_activation(trellis_url, &store_path).await?;
        print_pending_activation(&persisted.local_state);
        println!(
            "Local confirmation code: {}",
            pending_confirmation_code(&persisted)?
        );
        println!("Device activation started; rerun after approval with --device-confirm-code.");
        return Ok(None);
    };

    let mut session = DeviceActivationSession::from_local_state(
        &persisted.trellis_url,
        &persisted.device_root_secret,
        device_contract::CONTRACT_DIGEST,
        persisted.local_state.clone(),
    )?;

    if session.local_state().status == DeviceActivationStatus::Pending {
        print_pending_activation(session.local_state());
        if let Some(confirm_code) = args.device_confirm_code.as_deref() {
            session.accept_confirmation_code(confirm_code)?;
            persisted.local_state = session.local_state().clone();
            save_device_state(&store_path, &persisted)?;
            println!("Device activation confirmed locally; connecting as activated device.");
        } else {
            println!("Pending activation; pass --device-confirm-code after approval to connect.");
            return Ok(None);
        }
    }

    let identity = derive_device_identity(&persisted.device_root_secret)?;
    Ok(Some(
        TrellisClient::connect_device(DeviceConnectOptions {
            trellis_url: &persisted.trellis_url,
            contract_digest: device_contract::CONTRACT_DIGEST,
            public_identity_key: &persisted.local_state.public_identity_key,
            identity_seed_base64url: &identity.identity_seed_base64url,
            timeout_ms: 10_000,
        })
        .await?,
    ))
}

async fn start_and_persist_device_activation(
    trellis_url: &str,
    store_path: &Path,
) -> anyhow::Result<PersistedDeviceState> {
    let device_root_secret: [u8; 32] = rand::random();
    let nonce_bytes: [u8; 32] = rand::random();
    let nonce = hex_lower(&nonce_bytes);
    let builder = DeviceActivationSessionBuilder::new(&device_root_secret, nonce)?;
    let start_response = start_device_activation_request(trellis_url, builder.payload()).await?;
    let session = builder.pending_session(
        trellis_url,
        device_contract::CONTRACT_DIGEST,
        start_response,
    )?;
    let persisted = PersistedDeviceState {
        trellis_url: session.trellis_url().to_string(),
        device_root_secret,
        local_state: session.local_state().clone(),
    };
    save_device_state(store_path, &persisted)?;
    Ok(persisted)
}

fn device_store_path(args: &Args) -> PathBuf {
    args.device_store
        .clone()
        .unwrap_or_else(|| PathBuf::from(DEFAULT_DEVICE_STORE))
}

fn load_device_state(path: &Path) -> anyhow::Result<Option<PersistedDeviceState>> {
    match fs::read_to_string(path) {
        Ok(contents) => Ok(Some(serde_json::from_str(&contents)?)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn save_device_state(path: &Path, state: &PersistedDeviceState) -> anyhow::Result<()> {
    let contents = serde_json::to_vec_pretty(state)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        let mut file = fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .mode(0o600)
            .open(path)?;
        file.write_all(&contents)?;
        file.set_permissions(fs::Permissions::from_mode(0o600))?;
    }
    #[cfg(not(unix))]
    {
        fs::write(path, contents)?;
    }
    Ok(())
}

fn print_pending_activation(local_state: &DeviceActivationLocalState) {
    println!("Activation URL: {}", local_state.activation_url);
    println!("Public identity key: {}", local_state.public_identity_key);
}

fn pending_confirmation_code(state: &PersistedDeviceState) -> anyhow::Result<String> {
    let session = DeviceActivationSession::from_local_state(
        &state.trellis_url,
        &state.device_root_secret,
        device_contract::CONTRACT_DIGEST,
        state.local_state.clone(),
    )?;
    Ok(session.confirmation_code().to_string())
}

fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

async fn spawn_event_watchers(client: &TrellisClient) -> anyhow::Result<()> {
    let mut activity = trellis_participant_demo_device::Client::new(client)
        .field_ops()
        .subscribe_activity_recorded()
        .await?;
    tokio::spawn(async move {
        while let Some(event) = activity.next().await {
            match event {
                Ok(event) => println!("event Audit.Recorded: {}", event.message),
                Err(error) => eprintln!("activity event error: {error}"),
            }
        }
    });

    let mut evidence = trellis_participant_demo_device::Client::new(client)
        .field_ops()
        .subscribe_evidence_uploaded()
        .await?;
    tokio::spawn(async move {
        while let Some(event) = evidence.next().await {
            match event {
                Ok(event) => println!("event Evidence.Uploaded: {}", event.key),
                Err(error) => eprintln!("evidence event error: {error}"),
            }
        }
    });

    let mut reports = trellis_participant_demo_device::Client::new(client)
        .field_ops()
        .subscribe_reports_published()
        .await?;
    tokio::spawn(async move {
        while let Some(event) = reports.next().await {
            match event {
                Ok(event) => println!("event Reports.Published: {}", event.report_id),
                Err(error) => eprintln!("reports event error: {error}"),
            }
        }
    });

    let mut sites = trellis_participant_demo_device::Client::new(client)
        .field_ops()
        .subscribe_sites_refreshed()
        .await?;
    tokio::spawn(async move {
        while let Some(event) = sites.next().await {
            match event {
                Ok(event) => println!("event Sites.Refreshed: {}", event.site.site_name),
                Err(error) => eprintln!("sites event error: {error}"),
            }
        }
    });

    Ok(())
}

async fn wizard_loop(client: Option<&TrellisClient>) -> anyhow::Result<()> {
    loop {
        println!();
        println!("1. List sites");
        println!("2. List assignments");
        println!("3. List evidence");
        println!("4. Download evidence");
        println!("5. Upload evidence");
        println!("6. Generate report");
        println!("7. Quit");
        let choice = prompt("Choose a step")?;
        match choice.as_str() {
            "1" => list_sites(client).await?,
            "2" => list_assignments(client).await?,
            "3" => list_evidence(client).await?,
            "4" => download_evidence(client).await?,
            "5" => upload_evidence(client).await?,
            "6" => generate_report(client).await?,
            "7" | "q" | "quit" => return Ok(()),
            _ => println!("Unknown step"),
        }
    }
}

async fn list_sites(client: Option<&TrellisClient>) -> anyhow::Result<()> {
    let sites = if let Some(client) = client {
        trellis_participant_demo_device::Client::new(client)
            .field_ops()
            .sites_list(&SitesListRequest {
                limit: LIST_LIMIT,
                offset: LIST_OFFSET,
            })
            .await?
            .sites
    } else {
        offline_sites()
    };
    for site in &sites {
        println!(
            "{} - {} (open: {}, overdue: {}, status: {})",
            site.site_id,
            site.site_name,
            site.open_inspections,
            site.overdue_inspections,
            site.latest_status
        );
    }
    save_selected_site(client, &sites).await?;
    Ok(())
}

async fn save_selected_site(
    client: Option<&TrellisClient>,
    sites: &[SitesListResponseSitesItem],
) -> anyhow::Result<()> {
    if sites.is_empty() {
        return Ok(());
    }

    let site_id = prompt("Site id to select for device state (blank to skip)")?;
    if site_id.is_empty() {
        return Ok(());
    }

    let Some(site) = sites.iter().find(|site| site.site_id == site_id) else {
        println!("No listed site matched {site_id}; selected site state unchanged.");
        return Ok(());
    };

    let selected_site = SelectedSiteState {
        site_id: site.site_id.clone(),
        site_name: site.site_name.clone(),
        selected_at: DEMO_TIMESTAMP.to_string(),
    };

    let Some(client) = client else {
        println!(
            "Offline selected site preview, not persisted: {} ({})",
            selected_site.site_name, selected_site.site_id
        );
        return Ok(());
    };

    trellis_participant_demo_device::Client::new(client)
        .state()
        .selected_site()
        .put(&selected_site)
        .await?;
    println!("Selected site state saved: {}", selected_site.site_id);

    Ok(())
}

async fn list_assignments(client: Option<&TrellisClient>) -> anyhow::Result<()> {
    if let Some(client) = client {
        let response = trellis_participant_demo_device::Client::new(client)
            .field_ops()
            .assignments_list(&AssignmentsListRequest {
                limit: LIST_LIMIT,
                offset: LIST_OFFSET,
            })
            .await?;
        for assignment in response.assignments {
            println!(
                "{} - {} / {} ({})",
                assignment.inspection_id,
                assignment.site_name,
                assignment.asset_name,
                assignment.priority
            );
        }
    } else {
        println!("insp-1001 - North Ridge Substation / Transformer A (high)");
    }
    Ok(())
}

async fn list_evidence(client: Option<&TrellisClient>) -> anyhow::Result<()> {
    if let Some(client) = client {
        let response = trellis_participant_demo_device::Client::new(client)
            .field_ops()
            .evidence_list(&EvidenceListRequest {
                limit: LIST_LIMIT,
                offset: LIST_OFFSET,
                prefix: None,
            })
            .await?;
        for evidence in response.evidence {
            println!("{} - {} bytes", evidence.key, evidence.size);
        }
    } else {
        println!("site-north/transformer-a/photo.txt - 42 bytes");
    }
    Ok(())
}

async fn download_evidence(client: Option<&TrellisClient>) -> anyhow::Result<()> {
    let key = prompt("Evidence key")?;
    let Some(client) = client else {
        println!("Offline mode cannot download transfer bytes.");
        return Ok(());
    };

    let response = trellis_participant_demo_device::Client::new(client)
        .field_ops()
        .evidence_download(&EvidenceDownloadRequest { key })
        .await?;
    let grant = download_transfer_grant_from_value(serde_json::to_value(response.transfer)?)?;
    let bytes = client.download_transfer(&grant).await?;
    println!("Downloaded {} bytes for {}", bytes.len(), grant.info.key);
    Ok(())
}

async fn upload_evidence(client: Option<&TrellisClient>) -> anyhow::Result<()> {
    let key = prompt("Evidence key")?;
    let content = prompt("Text content")?;
    let input = EvidenceUploadInput {
        content_type: Some("text/plain".to_string()),
        evidence_type: "photo".to_string(),
        key: key.clone(),
        metadata: None,
    };

    let Some(client) = client else {
        println!(
            "Offline evidence upload preview, not persisted: {} ({} bytes)",
            key,
            content.len()
        );
        return Ok(());
    };

    let started = trellis_participant_demo_device::Client::new(client)
        .field_ops()
        .evidence_upload()
        .input(&input)
        .transfer(content.as_bytes())
        .start()
        .await
        .map_err(|error| anyhow::anyhow!("evidence upload failed: {}", error.source()))?;

    let file = started.file_info();
    println!(
        "Uploaded {} ({} bytes, content type: {})",
        file.key,
        file.size,
        file.content_type.as_deref().unwrap_or("unknown")
    );

    let snapshot = started.operation_ref().wait().await?;
    if let Some(output) = snapshot.output {
        println!("Evidence upload operation completed: {:?}", output);
    } else {
        println!("Evidence upload operation completed.");
    }

    Ok(())
}

async fn generate_report(client: Option<&TrellisClient>) -> anyhow::Result<()> {
    let inspection_id = prompt("Inspection id")?;
    let site_id = prompt("Site id for draft state")?;
    let checklist_name = prompt("Checklist name for draft state")?;
    let comment = prompt("Report comment")?;
    save_draft_inspection(
        client,
        DraftInspectionState {
            inspection_id: inspection_id.clone(),
            site_id,
            checklist_name,
            notes: comment.clone(),
            updated_at: DEMO_TIMESTAMP.to_string(),
        },
    )
    .await?;

    let Some(client) = client else {
        println!("Offline report draft captured for {inspection_id}: {comment}");
        return Ok(());
    };

    let operation = trellis_participant_demo_device::Client::new(client)
        .field_ops()
        .reports_generate()
        .start(&ReportsGenerateInput {
            inspection_id,
            report_comment: comment,
        })
        .await?;
    let snapshot = operation.wait().await?;
    println!("Report operation completed: {:?}", snapshot.output);
    Ok(())
}

async fn save_draft_inspection(
    client: Option<&TrellisClient>,
    draft: DraftInspectionState,
) -> anyhow::Result<()> {
    let Some(client) = client else {
        println!(
            "Offline draft inspection preview, not persisted: {} ({})",
            draft.inspection_id, draft.site_id
        );
        return Ok(());
    };

    trellis_participant_demo_device::Client::new(client)
        .state()
        .draft_inspections()
        .put(&draft.inspection_id, &draft)
        .await?;
    println!("Draft inspection state saved: {}", draft.inspection_id);

    Ok(())
}

fn prompt(label: &str) -> anyhow::Result<String> {
    print!("{label}: ");
    io::stdout().flush()?;
    let mut input = String::new();
    io::stdin().read_line(&mut input)?;
    Ok(input.trim().to_string())
}

fn offline_sites() -> Vec<SitesListResponseSitesItem> {
    vec![SitesListResponseSitesItem {
        site_id: "site-north".to_string(),
        site_name: "North Ridge Substation".to_string(),
        open_inspections: 2,
        overdue_inspections: 1,
        latest_status: "attention".to_string(),
        last_report_at: DEMO_TIMESTAMP.to_string(),
    }]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn persisted_device_state_roundtrips_as_json() {
        let state = sample_persisted_device_state();

        let json = serde_json::to_string(&state).expect("serialize state");
        let decoded: PersistedDeviceState = serde_json::from_str(&json).expect("decode state");

        assert_eq!(decoded, state);
    }

    #[test]
    fn load_device_state_returns_none_for_missing_path() {
        let path = std::env::temp_dir().join(format!(
            "trellis-demo-device-missing-{}-{}.json",
            std::process::id(),
            rand::random::<u64>()
        ));

        let state = load_device_state(&path).expect("load missing state");

        assert!(state.is_none());
    }

    #[test]
    fn save_and_load_device_state_uses_requested_path() {
        let path = std::env::temp_dir().join(format!(
            "trellis-demo-device-{}-{}.json",
            std::process::id(),
            rand::random::<u64>()
        ));
        let state = sample_persisted_device_state();

        save_device_state(&path, &state).expect("save state");
        let decoded = load_device_state(&path)
            .expect("load state")
            .expect("state exists");
        let _ = fs::remove_file(&path);

        assert_eq!(decoded, state);
    }

    fn sample_persisted_device_state() -> PersistedDeviceState {
        PersistedDeviceState {
            trellis_url: "http://127.0.0.1:3000".to_string(),
            device_root_secret: [7u8; 32],
            local_state: DeviceActivationLocalState {
                status: DeviceActivationStatus::Pending,
                contract_digest: device_contract::CONTRACT_DIGEST.to_string(),
                public_identity_key: "public-key".to_string(),
                flow_id: "flow-1".to_string(),
                instance_id: "instance-1".to_string(),
                deployment_id: "deployment-1".to_string(),
                nonce: "nonce-1".to_string(),
                activation_url: "http://127.0.0.1:3000/activate/flow-1".to_string(),
            },
        }
    }
}

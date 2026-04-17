use crate::app::{connect_authenticated_cli_client, portal_target_id, portal_target_label};
use crate::cli::*;
use crate::contract_input::{default_image_contract_path, resolve_contract_input};
use crate::output;
use miette::IntoDiagnostic;
use serde_json::json;
use trellis_auth as authlib;

pub(super) async fn run(format: OutputFormat, command: PortalCommand) -> miette::Result<()> {
    match command.command {
        PortalSubcommand::List => list_command(format).await,
        PortalSubcommand::Create(args) => create_command(format, &args).await,
        PortalSubcommand::Disable(args) => disable_command(format, &args).await,
        PortalSubcommand::Login(login) => match login.command {
            PortalLoginSubcommand::Default => logins_default_show_command(format).await,
            PortalLoginSubcommand::SetDefault(args) => {
                logins_default_set_command(format, &args).await
            }
            PortalLoginSubcommand::List => logins_list_command(format).await,
            PortalLoginSubcommand::Set(args) => logins_set_command(format, &args).await,
            PortalLoginSubcommand::Clear(args) => logins_clear_command(format, &args).await,
        },
        PortalSubcommand::Device(device) => match device.command {
            PortalDeviceSubcommand::Default => devices_default_show_command(format).await,
            PortalDeviceSubcommand::SetDefault(args) => {
                devices_default_set_command(format, &args).await
            }
            PortalDeviceSubcommand::List => devices_list_command(format).await,
            PortalDeviceSubcommand::Set(args) => devices_set_command(format, &args).await,
            PortalDeviceSubcommand::Clear(args) => devices_clear_command(format, &args).await,
        },
    }
}

async fn list_command(format: OutputFormat) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let portals = auth_client.list_portals().await.into_diagnostic()?;

    if output::is_json(format) {
        output::print_json(&json!({ "portals": portals }))?;
        return Ok(());
    }
    if portals.is_empty() {
        output::print_info("no portals configured");
        return Ok(());
    }
    let rows = portals
        .into_iter()
        .map(|portal| {
            vec![
                portal.portal_id,
                portal.app_contract_id.unwrap_or_else(|| "-".to_string()),
                portal.entry_url,
                if portal.disabled {
                    "Disabled"
                } else {
                    "Active"
                }
                .to_string(),
            ]
        })
        .collect::<Vec<_>>();
    println!(
        "{}",
        output::table(&["portal", "app contract", "entry", "state"], rows)
    );
    Ok(())
}

async fn create_command(format: OutputFormat, args: &PortalCreateArgs) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let app_contract_id = resolve_portal_app_contract_id(args)?;
    let portal = auth_client
        .create_portal(&args.portal_id, app_contract_id.as_deref(), &args.entry_url)
        .await
        .into_diagnostic()?;

    if output::is_json(format) {
        output::print_json(&json!({ "portal": portal }))?;
        return Ok(());
    }
    output::print_success("portal created");
    output::print_info(&format!("portalId={}", portal.portal_id));
    output::print_info(&format!("entry={}", portal.entry_url));
    Ok(())
}

fn resolve_portal_app_contract_id(args: &PortalCreateArgs) -> miette::Result<Option<String>> {
    if let Some(contract_id) = &args.app_contract_id {
        return Ok(Some(contract_id.clone()));
    }

    let resolved = args
        .manifest
        .as_deref()
        .map(|manifest| {
            resolve_contract_input(
                Some(manifest),
                None,
                None,
                "CONTRACT",
                default_image_contract_path(),
            )
        })
        .or_else(|| {
            args.source.as_deref().map(|source| {
                resolve_contract_input(
                    None,
                    Some(source),
                    None,
                    "CONTRACT",
                    default_image_contract_path(),
                )
            })
        })
        .or_else(|| {
            args.image.as_deref().map(|image| {
                resolve_contract_input(
                    None,
                    None,
                    Some(image),
                    "CONTRACT",
                    default_image_contract_path(),
                )
            })
        });

    let Some(resolved) = resolved else {
        return Ok(None);
    };
    let resolved = resolved?;

    Ok(Some(resolved.loaded.manifest.id))
}

#[cfg(test)]
mod tests {
    use super::resolve_portal_app_contract_id;
    use crate::cli::PortalCreateArgs;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn resolves_portal_app_contract_id_from_manifest() {
        let temp = TempDir::new().unwrap();
        let manifest_path = temp.path().join("portal-app.contract.json");
        fs::write(
            &manifest_path,
            r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.portal-app@v1",
  "displayName": "Portal App",
  "description": "Portal app",
  "kind": "app"
}
"#,
        )
        .unwrap();

        let args = PortalCreateArgs {
            portal_id: "main".to_string(),
            entry_url: "https://portal.example.com".to_string(),
            app_contract_id: None,
            manifest: Some(manifest_path),
            source: None,
            image: None,
        };

        let contract_id = resolve_portal_app_contract_id(&args).unwrap();
        assert_eq!(contract_id.as_deref(), Some("trellis.portal-app@v1"));
    }
}

async fn disable_command(format: OutputFormat, args: &PortalDisableArgs) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let success = auth_client
        .disable_portal(&args.portal_id)
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "success": success, "portalId": args.portal_id }))?;
        return Ok(());
    }
    if success {
        output::print_success("portal disabled");
    } else {
        output::print_info("no matching portal found");
    }
    Ok(())
}

async fn logins_default_show_command(format: OutputFormat) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let default_portal = auth_client
        .get_login_portal_default()
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "defaultPortal": default_portal }))?;
        return Ok(());
    }
    output::print_info(&format!(
        "portal={}",
        portal_target_label(default_portal.portal_id.as_deref())
    ));
    Ok(())
}

async fn logins_default_set_command(
    format: OutputFormat,
    args: &PortalDefaultSetArgs,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let default_portal = auth_client
        .set_login_portal_default(portal_target_id(&args.target))
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "defaultPortal": default_portal }))?;
        return Ok(());
    }
    output::print_success("login portal default updated");
    output::print_info(&format!(
        "portal={}",
        portal_target_label(default_portal.portal_id.as_deref())
    ));
    Ok(())
}

async fn logins_list_command(format: OutputFormat) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let selections = auth_client
        .list_login_portal_selections()
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "selections": selections }))?;
        return Ok(());
    }
    if selections.is_empty() {
        output::print_info("no login portal selections configured");
        return Ok(());
    }
    let rows = selections
        .into_iter()
        .map(|selection| {
            vec![
                selection.contract_id,
                portal_target_label(selection.portal_id.as_deref()),
            ]
        })
        .collect::<Vec<_>>();
    println!("{}", output::table(&["contract", "portal"], rows));
    Ok(())
}

async fn logins_set_command(format: OutputFormat, args: &PortalLoginSetArgs) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let selection = auth_client
        .set_login_portal_selection(&args.contract_id, portal_target_id(&args.target))
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "selection": selection }))?;
        return Ok(());
    }
    output::print_success("login portal selection updated");
    output::print_info(&format!("contractId={}", selection.contract_id));
    output::print_info(&format!(
        "portal={}",
        portal_target_label(selection.portal_id.as_deref())
    ));
    Ok(())
}

async fn logins_clear_command(
    format: OutputFormat,
    args: &PortalLoginClearArgs,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let success = auth_client
        .clear_login_portal_selection(&args.contract_id)
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "success": success, "contractId": args.contract_id }))?;
        return Ok(());
    }
    if success {
        output::print_success("login portal selection cleared");
    } else {
        output::print_info("no matching login portal selection found");
    }
    Ok(())
}

async fn devices_default_show_command(format: OutputFormat) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let default_portal = auth_client
        .get_device_portal_default()
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "defaultPortal": default_portal }))?;
        return Ok(());
    }
    output::print_info(&format!(
        "portal={}",
        portal_target_label(default_portal.portal_id.as_deref())
    ));
    Ok(())
}

async fn devices_default_set_command(
    format: OutputFormat,
    args: &PortalDefaultSetArgs,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let default_portal = auth_client
        .set_device_portal_default(portal_target_id(&args.target))
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "defaultPortal": default_portal }))?;
        return Ok(());
    }
    output::print_success("device portal default updated");
    output::print_info(&format!(
        "portal={}",
        portal_target_label(default_portal.portal_id.as_deref())
    ));
    Ok(())
}

async fn devices_list_command(format: OutputFormat) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let selections = auth_client
        .list_device_portal_selections()
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "selections": selections }))?;
        return Ok(());
    }
    if selections.is_empty() {
        output::print_info("no device portal selections configured");
        return Ok(());
    }
    let rows = selections
        .into_iter()
        .map(|selection| {
            vec![
                selection.profile_id,
                portal_target_label(selection.portal_id.as_deref()),
            ]
        })
        .collect::<Vec<_>>();
    println!("{}", output::table(&["profile", "portal"], rows));
    Ok(())
}

async fn devices_set_command(
    format: OutputFormat,
    args: &PortalDeviceSetArgs,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let selection = auth_client
        .set_device_portal_selection(&args.profile, portal_target_id(&args.target))
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "selection": selection }))?;
        return Ok(());
    }
    output::print_success("device portal selection updated");
    output::print_info(&format!("profileId={}", selection.profile_id));
    output::print_info(&format!(
        "portal={}",
        portal_target_label(selection.portal_id.as_deref())
    ));
    Ok(())
}

async fn devices_clear_command(
    format: OutputFormat,
    args: &PortalDeviceClearArgs,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let success = auth_client
        .clear_device_portal_selection(&args.profile)
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "success": success, "profileId": args.profile }))?;
        return Ok(());
    }
    if success {
        output::print_success("device portal selection cleared");
    } else {
        output::print_info("no matching device portal selection found");
    }
    Ok(())
}

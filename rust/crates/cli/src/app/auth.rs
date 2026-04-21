use crate::agent_contract::agent_contract_json;
use crate::app::{connect_authenticated_cli_client, resolve_contract_lineage_id};
use crate::cli::*;
use crate::output;
use miette::IntoDiagnostic;
use qrcode::{render::unicode, QrCode};
use serde_json::{json, Value};
use trellis_auth as authlib;

pub(crate) fn render_agent_login_instructions(login_url: &str) -> miette::Result<String> {
    let qr = QrCode::new(login_url.as_bytes()).into_diagnostic()?;
    let qr = qr.render::<unicode::Dense1x2>().quiet_zone(false).build();
    Ok(format!(
        "Open this activation URL:\n{login_url}\n\nScan this QR code:\n{qr}"
    ))
}

pub(crate) fn pending_agent_login_json(login_url: &str) -> Value {
    json!({
        "status": "pending",
        "loginUrl": login_url,
    })
}

pub(super) async fn run(format: OutputFormat, command: AuthCommand) -> miette::Result<()> {
    match command.command {
        AuthSubcommand::Login(args) => login_command(format, &args).await,
        AuthSubcommand::Logout => logout_command(format).await,
        AuthSubcommand::Approval(command) => match command.command {
            AuthApprovalSubcommand::List(args) => approvals_list_command(format, &args).await,
            AuthApprovalSubcommand::Revoke(args) => approvals_revoke_command(format, &args).await,
        },
        AuthSubcommand::Grant(command) => match command.command {
            AuthGrantSubcommand::List => grants_list_command(format).await,
            AuthGrantSubcommand::Set(args) => grants_set_command(format, &args).await,
            AuthGrantSubcommand::Disable(args) => grants_disable_command(format, &args).await,
        },
        AuthSubcommand::Status => status_command(format).await,
    }
}

async fn login_command(format: OutputFormat, args: &AuthLoginArgs) -> miette::Result<()> {
    let challenge = authlib::start_agent_login(&authlib::StartAgentLoginOpts {
        trellis_url: &args.trellis_url,
        contract_json: agent_contract_json(),
    })
    .await
    .into_diagnostic()?;
    let login_url = challenge.login_url().to_string();

    if output::is_json(format) {
        output::print_json_progress(&pending_agent_login_json(&login_url))?;
    } else {
        output::print_info(&render_agent_login_instructions(&login_url)?);
    }

    let outcome = challenge
        .complete(&args.trellis_url)
        .await
        .into_diagnostic()?;
    let state = outcome.state;
    let me = outcome.user;

    authlib::save_admin_session(&state).into_diagnostic()?;

    if output::is_json(format) {
        output::print_json(&json!({
            "sessionKey": state.session_key,
            "origin": me.origin,
            "id": me.id,
            "name": me.name,
            "capabilities": me.capabilities,
            "expires": state.expires,
        }))?;
    } else {
        output::print_success("logged in delegated agent session");
        output::print_info(&format!("user={}:{}", me.origin, me.id));
        output::print_info(&format!("name={}", me.name));
        output::print_info(&format!("sessionKey={}", state.session_key));
        output::print_info(&format!("expires={}", state.expires));
    }

    Ok(())
}

async fn logout_command(format: OutputFormat) -> miette::Result<()> {
    let mut revoked = false;
    let mut revoke_error = None;
    if let Ok(state) = authlib::load_admin_session() {
        match authlib::connect_admin_client_async(&state).await {
            Ok(connected) => match authlib::AuthClient::new(&connected).logout().await {
                Ok(response) => revoked = response,
                Err(error) => revoke_error = Some(error.to_string()),
            },
            Err(error) => revoke_error = Some(error.to_string()),
        }
    }
    let removed = authlib::clear_admin_session().into_diagnostic()?;
    if output::is_json(format) {
        let mut response = json!({ "cleared": removed, "revoked": revoked });
        if let Some(error) = &revoke_error {
            response["revokeError"] = Value::String(error.clone());
        }
        output::print_json(&response)?;
    } else if removed {
        if revoked {
            output::print_success("revoked remote session and cleared local agent session");
        } else if let Some(error) = &revoke_error {
            output::print_success("cleared stored agent session");
            output::print_info(&format!(
                "warning: remote session revocation failed: {error}"
            ));
        } else {
            output::print_success("cleared stored agent session");
        }
    } else {
        output::print_info("no stored agent session found");
    }
    Ok(())
}

async fn status_command(format: OutputFormat) -> miette::Result<()> {
    let (state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let me = auth_client.me().await.into_diagnostic()?;

    if output::is_json(format) {
        output::print_json(&json!({
            "loggedIn": true,
            "origin": me.origin,
            "id": me.id,
            "name": me.name,
            "capabilities": me.capabilities,
            "sessionKey": state.session_key,
            "expires": state.expires,
        }))?;
    } else {
        output::print_success("delegated agent session is active");
        output::print_info(&format!("user={}:{}", me.origin, me.id));
        output::print_info(&format!("name={}", me.name));
        output::print_info(&format!("sessionKey={}", state.session_key));
        output::print_info(&format!("expires={}", state.expires));
    }

    Ok(())
}

async fn approvals_list_command(
    format: OutputFormat,
    args: &AuthApprovalListArgs,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let approvals = auth_client
        .list_approvals(args.user.as_deref(), args.digest.as_deref())
        .await
        .into_diagnostic()?;

    if output::is_json(format) {
        output::print_json(&json!({
            "user": args.user,
            "digest": args.digest,
            "approvals": approvals,
        }))?;
        return Ok(());
    }

    output::print_info(&format!("matched approvals={}", approvals.len()));
    if let Some(user) = &args.user {
        output::print_info(&format!("user={user}"));
    }
    if let Some(digest) = &args.digest {
        output::print_info(&format!("digest={digest}"));
    }

    let rows = approvals
        .into_iter()
        .map(|entry| {
            let answer = entry
                .answer
                .as_str()
                .map(ToOwned::to_owned)
                .unwrap_or_else(|| entry.answer.to_string());
            vec![
                entry.user,
                entry.approval.display_name,
                answer,
                entry.approval.contract_digest,
                entry.updated_at,
            ]
        })
        .collect();
    println!(
        "{}",
        output::table(&["user", "app", "answer", "digest", "updated"], rows)
    );
    Ok(())
}

async fn approvals_revoke_command(
    format: OutputFormat,
    args: &AuthApprovalRevokeArgs,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let success = auth_client
        .revoke_approval(&args.digest, args.user.as_deref())
        .await
        .into_diagnostic()?;

    if output::is_json(format) {
        output::print_json(&json!({
            "success": success,
            "digest": args.digest,
            "user": args.user,
        }))?;
        return Ok(());
    }

    if success {
        output::print_success("revoked approval");
    } else {
        output::print_info("no matching approval found");
    }
    output::print_info(&format!("digest={}", args.digest));
    if let Some(user) = &args.user {
        output::print_info(&format!("user={user}"));
    }
    Ok(())
}

async fn grants_list_command(format: OutputFormat) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let policies = auth_client
        .list_instance_grant_policies()
        .await
        .into_diagnostic()?;

    if output::is_json(format) {
        output::print_json(&json!({ "policies": policies }))?;
        return Ok(());
    }

    if policies.is_empty() {
        output::print_info("no instance grant policies configured");
        return Ok(());
    }

    let rows = policies
        .into_iter()
        .map(|policy| {
            vec![
                policy.contract_id,
                policy.implied_capabilities.join(", "),
                policy.allowed_origins.unwrap_or_default().join(", "),
                if policy.disabled {
                    "Disabled"
                } else {
                    "Active"
                }
                .to_string(),
                policy.updated_at,
            ]
        })
        .collect::<Vec<_>>();
    println!(
        "{}",
        output::table(
            &["contract", "capabilities", "origins", "state", "updated"],
            rows,
        )
    );
    Ok(())
}

async fn grants_set_command(format: OutputFormat, args: &AuthGrantSetArgs) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let contract_id = resolve_contract_lineage_id(&connected, &args.contract).await?;
    let policy = auth_client
        .upsert_instance_grant_policy(
            &contract_id,
            &args.capabilities,
            if args.allowed_origins.is_empty() {
                None
            } else {
                Some(args.allowed_origins.as_slice())
            },
        )
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "policy": policy }))?;
        return Ok(());
    }

    output::print_success("instance grant policy saved");
    output::print_info(&format!("contractId={}", policy.contract_id));
    output::print_info(&format!(
        "capabilities={}",
        if policy.implied_capabilities.is_empty() {
            "-".to_string()
        } else {
            policy.implied_capabilities.join(", ")
        }
    ));
    output::print_info(&format!(
        "allowedOrigins={}",
        policy.allowed_origins.unwrap_or_default().join(", ")
    ));
    Ok(())
}

async fn grants_disable_command(
    format: OutputFormat,
    args: &AuthGrantDisableArgs,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let policy = auth_client
        .disable_instance_grant_policy(&args.contract_id)
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "policy": policy }))?;
        return Ok(());
    }

    output::print_success("instance grant policy disabled");
    output::print_info(&format!("contractId={}", policy.contract_id));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{pending_agent_login_json, render_agent_login_instructions};
    use serde_json::json;

    #[test]
    fn agent_login_instructions_include_plain_url_and_terminal_qr() {
        let instructions = render_agent_login_instructions(
            "https://auth.example.com/_trellis/portal/users/login?flowId=flow_123",
        )
        .expect("render instructions");

        assert!(instructions.contains("Open this activation URL:"));
        assert!(instructions
            .contains("https://auth.example.com/_trellis/portal/users/login?flowId=flow_123"));
        assert!(instructions.contains("Scan this QR code:"));
        assert!(
            instructions.contains("█") || instructions.contains("▀") || instructions.contains("▄")
        );
    }

    #[test]
    fn pending_agent_login_json_includes_login_url() {
        assert_eq!(
            pending_agent_login_json(
                "https://auth.example.com/_trellis/portal/users/login?flowId=flow_123"
            ),
            json!({
                "status": "pending",
                "loginUrl": "https://auth.example.com/_trellis/portal/users/login?flowId=flow_123",
            })
        );
    }
}

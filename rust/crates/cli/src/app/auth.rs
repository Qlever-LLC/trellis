use crate::app::{resolve_servers, try_open_browser};
use crate::cli::*;
use crate::cli_contract::cli_contract_json;
use crate::output;
use miette::IntoDiagnostic;
use serde_json::{json, Value};
use trellis_auth as authlib;

pub(super) async fn run(
    format: OutputFormat,
    global_nats_servers: Option<String>,
    command: AuthCommand,
) -> miette::Result<()> {
    match command.command {
        AuthSubcommand::Login(args) => login_command(format, global_nats_servers, &args).await,
        AuthSubcommand::Logout => logout_command(format).await,
        AuthSubcommand::Approvals(command) => match command.command {
            AuthApprovalsSubcommand::List(args) => approvals_list_command(format, &args).await,
            AuthApprovalsSubcommand::Revoke(args) => approvals_revoke_command(format, &args).await,
        },
        AuthSubcommand::Status => status_command(format).await,
    }
}

async fn login_command(
    format: OutputFormat,
    global_nats_servers: Option<String>,
    args: &AuthLoginArgs,
) -> miette::Result<()> {
    let nats_servers = resolve_servers(global_nats_servers, None);
    let challenge = authlib::start_browser_login(&authlib::StartBrowserLoginOpts {
        auth_url: &args.auth_url,
        listen: &args.listen,
        contract_json: cli_contract_json(),
    })
    .await
    .into_diagnostic()?;
    let login_url = challenge.login_url().to_string();

    if !output::is_json(format) {
        output::print_info(&format!("Open this URL to sign in: {login_url}"));
    }
    try_open_browser(&login_url);

    let outcome = challenge
        .complete(&args.auth_url, &nats_servers)
        .await
        .into_diagnostic()?;
    let state = outcome.state;
    let me = outcome.user;

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
        output::print_success("logged in admin session");
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
            output::print_success("revoked remote session and cleared local admin session");
        } else if let Some(error) = &revoke_error {
            output::print_success("cleared stored admin session");
            output::print_info(&format!(
                "warning: remote session revocation failed: {error}"
            ));
        } else {
            output::print_success("cleared stored admin session");
        }
    } else {
        output::print_info("no stored admin session found");
    }
    Ok(())
}

async fn status_command(format: OutputFormat) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state)
        .await
        .into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let me = auth_client.me().await.into_diagnostic()?;
    auth_client
        .renew_binding_token(&mut state)
        .await
        .into_diagnostic()?;

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
        output::print_success("admin session is active");
        output::print_info(&format!("user={}:{}", me.origin, me.id));
        output::print_info(&format!("name={}", me.name));
        output::print_info(&format!("sessionKey={}", state.session_key));
        output::print_info(&format!("expires={}", state.expires));
    }

    Ok(())
}

async fn approvals_list_command(
    format: OutputFormat,
    args: &AuthApprovalsListArgs,
) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state)
        .await
        .into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let approvals = auth_client
        .list_approvals(args.user.as_deref(), args.digest.as_deref())
        .await
        .into_diagnostic()?;
    auth_client
        .renew_binding_token(&mut state)
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
    args: &AuthApprovalsRevokeArgs,
) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state)
        .await
        .into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let success = auth_client
        .revoke_approval(&args.digest, args.user.as_deref())
        .await
        .into_diagnostic()?;
    auth_client
        .renew_binding_token(&mut state)
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

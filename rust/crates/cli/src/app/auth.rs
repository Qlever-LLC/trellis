use crate::agent_contract::agent_contract_json;
use crate::app::connect_authenticated_cli_client;
use crate::cli::*;
use crate::output;
use miette::IntoDiagnostic;
use qrcode::{render::unicode, QrCode};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
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

fn authenticated_user_json(me: &authlib::AuthenticatedUser) -> Value {
    json!({
        "userId": &me.user_id,
        "identity": &me.identity,
        "name": &me.name,
        "capabilities": &me.capabilities,
    })
}

fn authenticated_identity_label(identity: &authlib::AuthenticatedIdentity) -> String {
    format!("{}:{}", identity.provider, identity.subject)
}

pub(super) async fn login(format: OutputFormat, args: &LoginArgs) -> miette::Result<()> {
    login_command(format, args).await
}

pub(super) async fn logout(format: OutputFormat) -> miette::Result<()> {
    logout_command(format).await
}

pub(super) async fn whoami(format: OutputFormat) -> miette::Result<()> {
    status_command(format).await
}

pub(super) async fn approvals(
    format: OutputFormat,
    command: ApprovalsCommand,
) -> miette::Result<()> {
    match command.command {
        ApprovalsSubcommand::List(args) => approvals_list_command(format, &args).await,
        ApprovalsSubcommand::Revoke(args) => approvals_revoke_command(format, &args).await,
    }
}

pub(super) async fn users(format: OutputFormat, command: UsersCommand) -> miette::Result<()> {
    match command.command {
        UsersSubcommand::List => users_list_command(format).await,
        UsersSubcommand::Show(args) => users_show_command(format, &args).await,
        UsersSubcommand::Create(args) => users_create_command(format, &args).await,
        UsersSubcommand::Edit(args) => users_edit_command(format, &args).await,
    }
}

pub(super) async fn portals(format: OutputFormat, command: PortalsCommand) -> miette::Result<()> {
    portals_command(format, command).await
}

async fn portals_command(format: OutputFormat, command: PortalsCommand) -> miette::Result<()> {
    let command_name = match command.command {
        PortalsSubcommand::List => "portals list",
        PortalsSubcommand::Login(login) => match login.command {
            PortalsLoginSubcommand::Default => "portals login default",
            PortalsLoginSubcommand::Selection => "portals login selection",
        },
    };
    if output::is_json(format) {
        output::print_json(&json!({
            "status": "not_implemented",
            "command": command_name,
            "message": "Portal admin RPC client wiring is pending; use Console or call Auth.Portals.* RPCs directly."
        }))?;
    } else {
        output::print_info(&format!(
            "{command_name}: portal admin RPC client wiring is pending; use Console or call Auth.Portals.* RPCs directly."
        ));
    }
    Ok(())
}

fn trimmed_optional(value: &Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn identity_labels(identities: &[Value]) -> String {
    identities
        .iter()
        .filter_map(|identity| {
            let provider = identity.get("provider")?.as_str()?;
            let subject = identity.get("subject")?.as_str()?;
            Some(format!("{provider}:{subject}"))
        })
        .collect::<Vec<_>>()
        .join(",")
}

fn latest_last_auth_by_user(sessions: &[Value]) -> BTreeMap<String, String> {
    let mut last_auth_by_user: BTreeMap<String, String> = BTreeMap::new();
    for session in sessions {
        let Some(user_id) = session
            .get("principal")
            .and_then(|principal| principal.get("userId"))
            .and_then(Value::as_str)
        else {
            continue;
        };
        let Some(last_auth) = session.get("lastAuth").and_then(Value::as_str) else {
            continue;
        };
        match last_auth_by_user.get(user_id) {
            Some(existing) if existing.as_str() >= last_auth => {}
            _ => {
                last_auth_by_user.insert(user_id.to_string(), last_auth.to_string());
            }
        }
    }
    last_auth_by_user
}

fn user_label(user: &Value) -> String {
    user.get("name")
        .and_then(Value::as_str)
        .or_else(|| user.get("email").and_then(Value::as_str))
        .unwrap_or("")
        .to_string()
}

fn user_email(user: &Value) -> String {
    user.get("email")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

fn string_array_field(user: &Value, field: &str) -> Vec<String> {
    user.get(field)
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn direct_capabilities(user: &Value) -> String {
    string_array_field(user, "capabilities").join(",")
}

fn capability_groups(user: &Value) -> String {
    string_array_field(user, "capabilityGroups").join(",")
}

fn identities_field(user: &Value) -> String {
    user.get("identities")
        .and_then(Value::as_array)
        .map(|identities| identity_labels(identities))
        .unwrap_or_default()
}

fn user_row(user: &Value, last_auth_by_user: &BTreeMap<String, String>) -> Vec<String> {
    let user_id = user
        .get("userId")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    vec![
        user_id.clone(),
        user_label(user),
        user_email(user),
        user.get("active")
            .and_then(Value::as_bool)
            .map(|active| active.to_string())
            .unwrap_or_default(),
        direct_capabilities(user),
        capability_groups(user),
        identities_field(user),
        last_auth_by_user.get(&user_id).cloned().unwrap_or_default(),
    ]
}

async fn users_list_command(format: OutputFormat) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let users = auth_client
        .list_users(500, Some(0))
        .await
        .into_diagnostic()?;
    let user_values = users
        .iter()
        .map(serde_json::to_value)
        .collect::<Result<Vec<_>, _>>()
        .into_diagnostic()?;
    let sessions = auth_client
        .list_sessions(500, Some(0), None)
        .await
        .unwrap_or_default();
    let last_auth_by_user = latest_last_auth_by_user(&sessions);

    if output::is_json(format) {
        output::print_json(&json!({
            "users": users,
            "lastAuthByUser": last_auth_by_user,
        }))?;
        return Ok(());
    }

    let rows = user_values
        .iter()
        .map(|user| user_row(user, &last_auth_by_user))
        .collect();
    println!(
        "{}",
        output::table(
            &[
                "userId",
                "label",
                "email",
                "active",
                "direct",
                "groups",
                "identities",
                "lastAuth"
            ],
            rows
        )
    );
    Ok(())
}

async fn users_show_command(format: OutputFormat, args: &UserRefArgs) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let user = auth_client
        .get_user(&args.user_id)
        .await
        .into_diagnostic()?;

    if output::is_json(format) {
        output::print_json(&json!({ "user": user }))?;
        return Ok(());
    }

    let user_value = serde_json::to_value(&user).into_diagnostic()?;
    output::print_info(&format!("userId={}", user.user_id));
    output::print_info(&format!("active={}", user.active));
    output::print_info(&format!("name={}", user.name.as_deref().unwrap_or("")));
    output::print_info(&format!("email={}", user.email.as_deref().unwrap_or("")));
    output::print_info(&format!("direct={}", direct_capabilities(&user_value)));
    output::print_info(&format!("groups={}", capability_groups(&user_value)));
    output::print_info(&format!("identities={}", identities_field(&user_value)));
    Ok(())
}

async fn users_create_command(format: OutputFormat, args: &UserCreateArgs) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let username = trimmed_optional(&args.username)
        .ok_or_else(|| miette::miette!("--username is required to create a local user"))?;
    let user = auth_client
        .create_user(&authlib::AuthUsersCreateRequest {
            active: Some(!args.inactive),
            capabilities: Some(args.capabilities.clone()),
            capability_groups: Some(args.groups.clone()),
            email: trimmed_optional(&args.email),
            name: trimmed_optional(&args.name),
            username: Some(username),
        })
        .await
        .into_diagnostic()?;
    let setup_flow = auth_client
        .create_password_reset_flow(&authlib::AuthUsersPasswordResetCreateRequest {
            expires_in_seconds: None,
            user_id: user.user_id.clone(),
        })
        .await
        .into_diagnostic()?;

    if output::is_json(format) {
        output::print_json(&json!({
            "user": user,
            "setupFlow": setup_flow,
        }))?;
        return Ok(());
    }

    output::print_success("created user");
    output::print_info(&format!("userId={}", user.user_id));
    output::print_info(&format!("setupUrl={}", setup_flow.url));
    Ok(())
}

async fn users_edit_command(format: OutputFormat, args: &UserEditArgs) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let current = auth_client
        .get_user(&args.user_id)
        .await
        .into_diagnostic()?;
    let groups = auth_client
        .list_capability_groups(500, Some(0))
        .await
        .into_diagnostic()?;

    let mut capabilities = current
        .capabilities
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>();
    let mut capability_groups = current
        .capability_groups
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>();

    if args.clear_capabilities {
        capabilities.clear();
    }
    if !args.set_capabilities.is_empty() {
        capabilities = args.set_capabilities.iter().cloned().collect();
    }
    for capability in &args.add_capabilities {
        capabilities.insert(capability.clone());
    }
    for capability in &args.remove_capabilities {
        capabilities.remove(capability);
    }

    if args.clear_groups {
        capability_groups.clear();
    }
    if !args.set_groups.is_empty() {
        capability_groups = args.set_groups.iter().cloned().collect();
    }
    for group in &args.add_groups {
        capability_groups.insert(group.clone());
    }
    for group in &args.remove_groups {
        capability_groups.remove(group);
    }

    let group_capabilities = capabilities_provided_by_groups(&capability_groups, &groups);
    capabilities.retain(|capability| !group_capabilities.contains(capability));

    let next_capabilities = capabilities.into_iter().collect::<Vec<_>>();
    let next_groups = capability_groups.into_iter().collect::<Vec<_>>();
    let next_active = if args.active {
        Some(true)
    } else if args.inactive {
        Some(false)
    } else {
        None
    };
    let next_name = trimmed_optional(&args.name);
    let next_email = trimmed_optional(&args.email);

    let success = auth_client
        .update_user(&authlib::AuthUsersUpdateRequest {
            active: next_active.filter(|active| *active != current.active),
            capabilities: (next_capabilities != current.capabilities).then_some(next_capabilities),
            capability_groups: (next_groups != current.capability_groups).then_some(next_groups),
            email: next_email.filter(|email| Some(email) != current.email.as_ref()),
            name: next_name.filter(|name| Some(name) != current.name.as_ref()),
            user_id: args.user_id.clone(),
        })
        .await
        .into_diagnostic()?;

    if output::is_json(format) {
        output::print_json(&json!({
            "success": success,
            "userId": args.user_id,
        }))?;
        return Ok(());
    }

    if success {
        output::print_success("updated user");
    } else {
        output::print_info("no matching user updated");
    }
    output::print_info(&format!("userId={}", args.user_id));
    Ok(())
}

fn capabilities_provided_by_groups(
    selected_groups: &BTreeSet<String>,
    groups: &[authlib::AuthCapabilityGroupsListResponseEntriesItem],
) -> BTreeSet<String> {
    let groups_by_key = groups
        .iter()
        .map(|group| (group.group_key.as_str(), group))
        .collect::<BTreeMap<_, _>>();
    let mut visited = BTreeSet::new();
    let mut capabilities = BTreeSet::new();
    for group in selected_groups {
        collect_group_capabilities(group, &groups_by_key, &mut visited, &mut capabilities);
    }
    capabilities
}

fn collect_group_capabilities(
    group_key: &str,
    groups_by_key: &BTreeMap<&str, &authlib::AuthCapabilityGroupsListResponseEntriesItem>,
    visited: &mut BTreeSet<String>,
    capabilities: &mut BTreeSet<String>,
) {
    if !visited.insert(group_key.to_string()) {
        return;
    }
    let Some(group) = groups_by_key.get(group_key) else {
        return;
    };
    capabilities.extend(group.capabilities.iter().cloned());
    for included_group in &group.included_groups {
        collect_group_capabilities(included_group, groups_by_key, visited, capabilities);
    }
}

async fn login_command(format: OutputFormat, args: &LoginArgs) -> miette::Result<()> {
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
        let mut response = authenticated_user_json(&me);
        response["sessionKey"] = Value::String(state.session_key);
        response["expires"] = Value::String(state.expires);
        output::print_json(&response)?;
    } else {
        output::print_success("logged in delegated agent session");
        output::print_info(&format!("userId={}", me.user_id));
        output::print_info(&format!(
            "identity={}",
            authenticated_identity_label(&me.identity)
        ));
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
        let mut response = authenticated_user_json(&me);
        response["loggedIn"] = Value::Bool(true);
        response["sessionKey"] = Value::String(state.session_key);
        response["expires"] = Value::String(state.expires);
        output::print_json(&response)?;
    } else {
        output::print_success("delegated agent session is active");
        output::print_info(&format!("userId={}", me.user_id));
        output::print_info(&format!(
            "identity={}",
            authenticated_identity_label(&me.identity)
        ));
        output::print_info(&format!("name={}", me.name));
        output::print_info(&format!("sessionKey={}", state.session_key));
        output::print_info(&format!("expires={}", state.expires));
    }

    Ok(())
}

async fn approvals_list_command(
    format: OutputFormat,
    args: &ApprovalsListArgs,
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
                entry.identity_envelope_id,
                entry.user,
                entry.display_name,
                answer,
                entry.contract_evidence.contract_digest,
                entry.updated_at,
            ]
        })
        .collect();
    println!(
        "{}",
        output::table(
            &[
                "identityEnvelopeId",
                "user",
                "app",
                "answer",
                "digest",
                "updated"
            ],
            rows
        )
    );
    Ok(())
}

async fn approvals_revoke_command(
    format: OutputFormat,
    args: &ApprovalsRevokeArgs,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let success = auth_client
        .revoke_approval(&args.identity_envelope_id, args.user.as_deref())
        .await
        .into_diagnostic()?;

    if output::is_json(format) {
        output::print_json(&json!({
            "success": success,
            "identityEnvelopeId": args.identity_envelope_id,
            "user": args.user,
        }))?;
        return Ok(());
    }

    if success {
        output::print_success("revoked approval");
    } else {
        output::print_info("no matching approval found");
    }
    output::print_info(&format!("identityEnvelopeId={}", args.identity_envelope_id));
    if let Some(user) = &args.user {
        output::print_info(&format!("user={user}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        authenticated_identity_label, authenticated_user_json, pending_agent_login_json,
        render_agent_login_instructions,
    };
    use serde_json::json;
    use trellis_auth::{AuthenticatedIdentity, AuthenticatedUser};

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

    #[test]
    fn authenticated_user_output_is_account_first() {
        let user = AuthenticatedUser {
            active: true,
            capabilities: vec!["admin".to_string()],
            email: "ada@example.com".to_string(),
            identity: AuthenticatedIdentity {
                identity_id: "idn_github_123".to_string(),
                provider: "github".to_string(),
                subject: "123".to_string(),
            },
            image: None,
            last_login: None,
            name: "Ada".to_string(),
            user_id: "usr_123".to_string(),
        };

        assert_eq!(
            authenticated_user_json(&user),
            json!({
                "userId": "usr_123",
                "identity": {
                    "identityId": "idn_github_123",
                    "provider": "github",
                    "subject": "123",
                },
                "name": "Ada",
                "capabilities": ["admin"],
            })
        );
        assert_eq!(authenticated_identity_label(&user.identity), "github:123");
    }
}

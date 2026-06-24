use crate::types::{GeneratedMetadata, NatsBootstrapNames};

/// Render the local development NATS server config.
#[must_use]
pub fn render_nats_config(server_name: &str) -> String {
    format!(
        r#"server_name: {server_name}

listen: 0.0.0.0:4222
http: 0.0.0.0:8222

websocket {{
  listen: 0.0.0.0:8080
  no_tls: true
}}

jetstream {{
  store_dir: /data
}}

include ./jwt.conf
"#
    )
}

/// Builds the default NATS server-name slug from the Trellis name.
#[must_use]
pub fn slug_from_name(trellis_name: &str) -> String {
    let mut slug = String::new();
    let mut previous_was_separator = false;
    for character in trellis_name
        .trim()
        .chars()
        .map(|character| character.to_ascii_lowercase())
    {
        if character.is_ascii_alphanumeric() {
            slug.push(character);
            previous_was_separator = false;
        } else if !slug.is_empty() && !previous_was_separator {
            slug.push('-');
            previous_was_separator = true;
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.is_empty() {
        "trellis".to_string()
    } else {
        slug
    }
}

pub(crate) fn resolved_server_name(names: &NatsBootstrapNames, trellis_name: &str) -> String {
    names
        .server_name
        .as_ref()
        .map_or_else(|| slug_from_name(trellis_name), Clone::clone)
}

/// Render the auth callout environment file without seed material in the manifest.
#[must_use]
pub fn render_auth_callout_env(generated: &GeneratedMetadata) -> String {
    format!(
        r#"AUTH_ACCOUNT={auth_account}
AUTH_ACCOUNT_PUBLIC_KEY={auth_public}
TRELLIS_ACCOUNT={trellis_account}
TRELLIS_ACCOUNT_PUBLIC_KEY={trellis_public}
AUTH_USER_PUBLIC_KEY={auth_user}
TRELLIS_USER_PUBLIC_KEY={trellis_user}
SENTINEL_USER_PUBLIC_KEY={sentinel_user}
AUTH_ISSUER_SIGNING_SEED_FILE=./secrets/auth-issuer-signing.seed
AUTH_TARGET_SIGNING_SEED_FILE=./secrets/auth-target-signing.seed
AUTH_CALLOUT_XKEY_SEED_FILE=./secrets/auth-sx.seed
SENTINEL_CREDS_FILE=./creds/sentinel.creds
AUTH_SERVICE_CREDS_FILE=./creds/auth-auth.creds
TRELLIS_SERVICE_CREDS_FILE=./creds/trellis-auth.creds
"#,
        auth_account = generated.auth_account_name,
        auth_public = generated.auth_account_public_key,
        trellis_account = generated.trellis_account_name,
        trellis_public = generated.trellis_account_public_key,
        auth_user = generated.auth_user_public_key,
        trellis_user = generated.trellis_user_public_key,
        sentinel_user = generated.sentinel_user_public_key,
    )
}

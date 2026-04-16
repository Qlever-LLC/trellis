use std::net::SocketAddr;
use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use ed25519_dalek::SigningKey;
use reqwest::Client as HttpClient;
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio::time::timeout;

use crate::client::{connect_admin_client_async, AuthClient};
use crate::models::{
    AdminLoginOutcome, AdminReauthOutcome, AdminSessionState, BindResponse, BindResponseBound,
    BoundSession, BrowserLoginChallenge, CallbackOutcome, CallbackTokenRequest,
    StartBrowserLoginOpts,
};
use crate::{AuthStartRequest, AuthStartResponse, ClientTransportsRecord};
use crate::TrellisAuthError;
use trellis_client::SessionAuth;

fn join_native_nats_servers(
    transports: &ClientTransportsRecord,
) -> Result<String, TrellisAuthError> {
    let Some(native) = &transports.native else {
        return Err(TrellisAuthError::UnexpectedBindStatus(
            "missing_native_transport".to_string(),
        ));
    };
    let servers = &native.nats_servers;
    if servers.is_empty() {
        return Err(TrellisAuthError::UnexpectedBindStatus(
            "missing_native_transport".to_string(),
        ));
    }
    Ok(servers.join(","))
}

fn base64url_encode(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

pub(crate) fn callback_page_html() -> &'static str {
    r#"<!doctype html>
<html>
  <head>
    <meta charset=\"utf-8\" />
    <title>Trellis CLI Login</title>
  </head>
  <body>
    <p id=\"status\">Completing Trellis CLI login...</p>
    <script>
      const params = new URLSearchParams(window.location.search);
      const flowId = params.get("flowId");
      const authError = params.get("authError");
      const status = document.getElementById("status");
      if (!flowId && !authError) {
        status.textContent = "Missing auth result in callback URL.";
      } else {
        fetch("/token", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ flowId, authError })
        }).then(async (response) => {
          if (!response.ok) {
            throw new Error(await response.text());
          }
          status.textContent = authError
            ? `Login failed: ${authError}`
            : "Login complete. You can close this window.";
        }).catch((error) => {
          status.textContent = `Login handoff failed: ${error}`;
        });
      }
    </script>
  </body>
</html>
"#
}

fn http_response(status_line: &str, content_type: &str, body: &[u8]) -> Vec<u8> {
    let mut out = format!(
        "HTTP/1.1 {status_line}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    )
    .into_bytes();
    out.extend_from_slice(body);
    out
}

fn find_header_end(bytes: &[u8]) -> Option<usize> {
    bytes.windows(4).position(|window| window == b"\r\n\r\n")
}

async fn read_http_request(
    stream: &mut tokio::net::TcpStream,
) -> Result<(String, String, Vec<u8>), TrellisAuthError> {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 4096];
    let mut header_end = None;
    let mut content_length = 0usize;

    loop {
        let read = stream.read(&mut chunk).await?;
        if read == 0 {
            return Err(TrellisAuthError::InvalidCallbackRequest);
        }
        buffer.extend_from_slice(&chunk[..read]);

        if header_end.is_none() {
            header_end = find_header_end(&buffer);
            if let Some(end) = header_end {
                let header_text = String::from_utf8_lossy(&buffer[..end]);
                for line in header_text.lines() {
                    if let Some(value) = line.strip_prefix("Content-Length:") {
                        content_length = value
                            .trim()
                            .parse()
                            .map_err(|_| TrellisAuthError::InvalidCallbackRequest)?;
                    }
                }
            }
        }

        if let Some(end) = header_end {
            let body_start = end + 4;
            if buffer.len() >= body_start + content_length {
                let header_text = String::from_utf8_lossy(&buffer[..end]);
                let request_line = header_text
                    .lines()
                    .next()
                    .ok_or(TrellisAuthError::InvalidCallbackRequest)?;
                let mut parts = request_line.split_whitespace();
                let method = parts
                    .next()
                    .ok_or(TrellisAuthError::InvalidCallbackRequest)?
                    .to_string();
                let path = parts
                    .next()
                    .ok_or(TrellisAuthError::InvalidCallbackRequest)?
                    .to_string();
                let body = buffer[body_start..body_start + content_length].to_vec();
                return Ok((method, path, body));
            }
        }
    }
}

/// Generate a new base64url-encoded Ed25519 session seed and public key.
pub fn generate_session_keypair() -> (String, String) {
    let seed: [u8; 32] = rand::random();
    let signing_key = SigningKey::from_bytes(&seed);
    let public_key = signing_key.verifying_key().to_bytes();
    (base64url_encode(&seed), base64url_encode(&public_key))
}

async fn start_auth_request(
    auth_url: &str,
    redirect_to: &str,
    auth: &SessionAuth,
    contract_json: &str,
) -> Result<AuthStartResponse, TrellisAuthError> {
    let sig = auth.sign_sha256_domain("oauth-init", &format!("{redirect_to}:null"));
    let contract: Value = serde_json::from_str(contract_json)?;
    let contract = contract
        .as_object()
        .cloned()
        .ok_or_else(|| TrellisAuthError::InvalidArgument("contract json must be an object".to_string()))?
        .into_iter()
        .collect();
    let client = HttpClient::builder().build()?;
    let response = client
        .post(format!("{}/auth/requests", auth_url.trim_end_matches('/')))
        .json(&AuthStartRequest {
            provider: None,
            redirect_to: redirect_to.to_string(),
            session_key: auth.session_key.clone(),
            sig,
            contract,
            context: None,
        })
        .send()
        .await?;
    let status = response.status();
    let text = response.text().await?;
    if !status.is_success() {
        return Err(TrellisAuthError::AuthRequestHttpFailure(status.as_u16(), text));
    }
    Ok(serde_json::from_str::<AuthStartResponse>(&text)?)
}

async fn start_callback_server(
    listen: &str,
) -> Result<
    (
        SocketAddr,
        oneshot::Receiver<CallbackOutcome>,
        tokio::task::JoinHandle<()>,
    ),
    TrellisAuthError,
> {
    let listener = TcpListener::bind(listen).await?;
    let local_addr = listener.local_addr()?;
    let (token_tx, token_rx) = oneshot::channel::<CallbackOutcome>();
    let shared_tx = std::sync::Arc::new(std::sync::Mutex::new(Some(token_tx)));

    let handle = tokio::spawn(async move {
        loop {
            let Ok((mut stream, _)) = listener.accept().await else {
                break;
            };
            let response = match read_http_request(&mut stream).await {
                Ok((method, path, _body)) if method == "GET" && path.starts_with("/callback") => {
                    http_response(
                        "200 OK",
                        "text/html; charset=utf-8",
                        callback_page_html().as_bytes(),
                    )
                }
                Ok((method, path, body)) if method == "POST" && path == "/token" => {
                    let parsed = serde_json::from_slice::<CallbackTokenRequest>(&body);
                    match parsed {
                        Ok(payload) => {
                            let outcome = payload
                                .flow_id
                                .filter(|value| !value.is_empty())
                                .map(CallbackOutcome::FlowId)
                                .or_else(|| {
                                    payload
                                        .auth_error
                                        .filter(|value| !value.is_empty())
                                        .map(CallbackOutcome::AuthError)
                                });
                            match outcome {
                                Some(value) => {
                                    if let Some(sender) =
                                        shared_tx.lock().expect("callback mutex poisoned").take()
                                    {
                                        let _ = sender.send(value);
                                    }
                                    http_response("200 OK", "text/plain; charset=utf-8", b"ok")
                                }
                                None => http_response(
                                    "400 Bad Request",
                                    "text/plain; charset=utf-8",
                                    b"invalid auth callback payload",
                                ),
                            }
                        }
                        Err(_) => http_response(
                            "400 Bad Request",
                            "text/plain; charset=utf-8",
                            b"invalid auth callback payload",
                        ),
                    }
                }
                Ok(_) => http_response("404 Not Found", "text/plain; charset=utf-8", b"not found"),
                Err(_) => http_response(
                    "400 Bad Request",
                    "text/plain; charset=utf-8",
                    b"invalid request",
                ),
            };

            let _ = stream.write_all(&response).await;
            let _ = stream.shutdown().await;
        }
    });

    Ok((local_addr, token_rx, handle))
}

async fn bind_session(
    auth_url: &str,
    auth: &SessionAuth,
    flow_id: &str,
) -> Result<BoundSession, TrellisAuthError> {
    let client = HttpClient::builder().build()?;
    let bind_url = format!(
        "{}/auth/flow/{}/bind",
        auth_url.trim_end_matches('/'),
        flow_id
    );
    let sig = auth.sign_sha256_domain("bind-flow", flow_id);
    let response = client
        .post(bind_url)
        .json(&json!({
            "sessionKey": auth.session_key,
            "sig": sig,
        }))
        .send()
        .await?;
    let status = response.status();
    let text = response.text().await?;
    if !status.is_success() {
        return Err(TrellisAuthError::BindHttpFailure(status.as_u16(), text));
    }

    match serde_json::from_str::<BindResponse>(&text)? {
        BindResponse::Bound(BindResponseBound {
            binding_token,
            inbox_prefix,
            expires,
            sentinel,
            transports,
        }) => Ok(BoundSession {
            binding_token,
            inbox_prefix,
            expires,
            nats_servers: join_native_nats_servers(&transports)?,
            sentinel,
        }),
        BindResponse::ApprovalRequired { approval } => Err(TrellisAuthError::UnexpectedBindStatus(
            format!("approval_required:{approval}"),
        )),
        BindResponse::ApprovalDenied { approval } => Err(TrellisAuthError::UnexpectedBindStatus(
            format!("approval_denied:{approval}"),
        )),
        BindResponse::InsufficientCapabilities {
            approval,
            missing_capabilities,
        } => Err(TrellisAuthError::UnexpectedBindStatus(format!(
            "insufficient_capabilities:{approval}:{missing_capabilities:?}"
        ))),
    }
}

impl BrowserLoginChallenge {
    /// Return the URL the user should open to complete login.
    pub fn login_url(&self) -> &str {
        &self.login_url
    }

    /// Wait for the callback, bind the session, and confirm the user is an admin.
    pub async fn complete(self, auth_url: &str) -> Result<AdminLoginOutcome, TrellisAuthError> {
        let outcome = timeout(Duration::from_secs(300), self.receiver)
            .await
            .map_err(|_| TrellisAuthError::LoginTimedOut)?
            .map_err(|_| TrellisAuthError::LoginInterrupted)?;
        self.server_handle.abort();

        let flow_id = match outcome {
            CallbackOutcome::FlowId(value) => value,
            CallbackOutcome::AuthError(value) => {
                return Err(TrellisAuthError::AuthFlowFailed(value))
            }
        };

        let bound = bind_session(auth_url, &self.auth, &flow_id).await?;
        let state = AdminSessionState {
            auth_url: auth_url.to_string(),
            nats_servers: bound.nats_servers.clone(),
            session_seed: self.session_seed,
            session_key: self.auth.session_key.clone(),
            binding_token: bound.binding_token,
            sentinel_jwt: bound.sentinel.jwt,
            sentinel_seed: bound.sentinel.seed,
            expires: bound.expires,
        };

        let client = connect_admin_client_async(&state).await?;
        let auth_client = AuthClient::new(&client);
        let user = auth_client.me().await?;
        if !user
            .capabilities
            .iter()
            .any(|capability| capability == "admin")
        {
            return Err(TrellisAuthError::NotAdmin);
        }

        Ok(AdminLoginOutcome { state, user })
    }
}

/// Start the browser login flow and local callback listener.
pub async fn start_browser_login(
    opts: &StartBrowserLoginOpts<'_>,
) -> Result<BrowserLoginChallenge, TrellisAuthError> {
    let (session_seed, _session_key) = generate_session_keypair();
    let auth = SessionAuth::from_seed_base64url(&session_seed)?;
    let (callback_addr, receiver, server_handle) = start_callback_server(opts.listen).await?;
    let redirect_to = format!("http://{callback_addr}/callback");
    let login_url = match start_auth_request(opts.auth_url, &redirect_to, &auth, opts.contract_json)
        .await?
    {
        AuthStartResponse::FlowStarted { login_url, .. } => login_url,
        AuthStartResponse::Bound { .. } => {
            return Err(TrellisAuthError::UnexpectedAuthRequestStatus(
                "bound_without_existing_session".to_string(),
            ))
        }
    };

    Ok(BrowserLoginChallenge {
        login_url,
        session_seed,
        auth,
        receiver,
        server_handle,
    })
}

/// Start admin reauthentication for a changed contract using the stored session key.
pub async fn start_admin_reauth(
    state: &AdminSessionState,
    listen: &str,
    contract_json: &str,
) -> Result<AdminReauthOutcome, TrellisAuthError> {
    let auth = SessionAuth::from_seed_base64url(&state.session_seed)?;
    let (callback_addr, receiver, server_handle) = start_callback_server(listen).await?;
    let redirect_to = format!("http://{callback_addr}/callback");
    match start_auth_request(&state.auth_url, &redirect_to, &auth, contract_json).await? {
        AuthStartResponse::Bound {
            binding_token,
            inbox_prefix: _,
            expires,
            sentinel,
            transports,
        } => {
            server_handle.abort();
            let next_state = AdminSessionState {
                auth_url: state.auth_url.clone(),
                nats_servers: join_native_nats_servers(&transports)?,
                session_seed: state.session_seed.clone(),
                session_key: auth.session_key.clone(),
                binding_token,
                sentinel_jwt: sentinel.jwt,
                sentinel_seed: sentinel.seed,
                expires,
            };
            let client = connect_admin_client_async(&next_state).await?;
            let auth_client = AuthClient::new(&client);
            let user = auth_client.me().await?;
            if !user.capabilities.iter().any(|capability| capability == "admin") {
                return Err(TrellisAuthError::NotAdmin);
            }
            Ok(AdminReauthOutcome::Bound(AdminLoginOutcome {
                state: next_state,
                user,
            }))
        }
        AuthStartResponse::FlowStarted { login_url, .. } => Ok(AdminReauthOutcome::Flow(
            BrowserLoginChallenge {
                login_url,
                session_seed: state.session_seed.clone(),
                auth,
                receiver,
                server_handle,
            },
        )),
    }
}

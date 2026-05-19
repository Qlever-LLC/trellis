use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use ed25519_dalek::{Signer, SigningKey};
use hkdf::Hkdf;
use hmac::{Hmac, KeyInit, Mac};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use url::Url;

use crate::models::{
    DeviceActivationPayload, DeviceActivationWaitRequest, DeviceConnectInfoRequest,
    DeviceConnectInfoResponse, DeviceIdentity, GetDeviceConnectInfoOpts,
    WaitForDeviceActivationOpts, WaitForDeviceActivationResponse,
};
use crate::TrellisAuthError;

type HmacSha256 = Hmac<Sha256>;

const DEVICE_IDENTITY_HKDF_INFO: &str = "trellis/device-identity/v1";
const DEVICE_ACTIVATION_HKDF_INFO: &str = "trellis/device-activate/v1";
const DEVICE_QR_MAC_DOMAIN: &str = "trellis-device-qr/v1";
const DEVICE_CONFIRMATION_DOMAIN: &str = "trellis-device-confirm/v1";
const CROCKFORD_ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

fn base64url_encode(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

fn base64url_decode(value: &str) -> Result<Vec<u8>, TrellisAuthError> {
    URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|error| TrellisAuthError::InvalidArgument(format!("invalid base64url: {error}")))
}

fn hmac_sha256(key: &[u8], data: &[u8]) -> Result<Vec<u8>, TrellisAuthError> {
    let mut mac = HmacSha256::new_from_slice(key)
        .map_err(|error| TrellisAuthError::InvalidArgument(format!("invalid hmac key: {error}")))?;
    mac.update(data);
    Ok(mac.finalize().into_bytes().to_vec())
}

fn concat_bytes(parts: &[&[u8]]) -> Vec<u8> {
    let size = parts.iter().map(|part| part.len()).sum();
    let mut out = Vec::with_capacity(size);
    for part in parts {
        out.extend_from_slice(part);
    }
    out
}

fn crockford_encode(bytes: &[u8]) -> String {
    let mut value = 0u32;
    let mut bits = 0u32;
    let mut out = String::new();

    for byte in bytes {
        value = (value << 8) | (*byte as u32);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out.push(CROCKFORD_ALPHABET[((value >> bits) & 31) as usize] as char);
        }
    }

    if bits > 0 {
        out.push(CROCKFORD_ALPHABET[((value << (5 - bits)) & 31) as usize] as char);
    }

    out
}

fn normalize_crockford(value: &str) -> String {
    value
        .trim()
        .to_uppercase()
        .replace('O', "0")
        .replace(['I', 'L'], "1")
}

pub fn derive_device_identity(
    device_root_secret: &[u8],
) -> Result<DeviceIdentity, TrellisAuthError> {
    if device_root_secret.len() != 32 {
        return Err(TrellisAuthError::InvalidArgument(format!(
            "invalid device root secret length: {} (expected 32)",
            device_root_secret.len()
        )));
    }

    let hkdf = Hkdf::<Sha256>::new(Some(&[]), device_root_secret);
    let mut identity_seed = [0u8; 32];
    hkdf.expand(DEVICE_IDENTITY_HKDF_INFO.as_bytes(), &mut identity_seed)
        .map_err(|error| {
            TrellisAuthError::InvalidArgument(format!(
                "failed to derive device identity seed: {error}"
            ))
        })?;
    let mut activation_key = [0u8; 32];
    hkdf.expand(DEVICE_ACTIVATION_HKDF_INFO.as_bytes(), &mut activation_key)
        .map_err(|error| {
            TrellisAuthError::InvalidArgument(format!("failed to derive activation key: {error}"))
        })?;

    let signing_key = SigningKey::from_bytes(&identity_seed);
    let public_identity_key = base64url_encode(&signing_key.verifying_key().to_bytes());

    Ok(DeviceIdentity {
        identity_seed_base64url: base64url_encode(&identity_seed),
        public_identity_key,
        activation_key_base64url: base64url_encode(&activation_key),
    })
}

pub fn derive_device_qr_mac(
    activation_key_base64url: &str,
    public_identity_key: &str,
    nonce: &str,
) -> Result<String, TrellisAuthError> {
    let activation_key = base64url_decode(activation_key_base64url)?;
    let mac = hmac_sha256(
        &activation_key,
        &concat_bytes(&[
            DEVICE_QR_MAC_DOMAIN.as_bytes(),
            public_identity_key.as_bytes(),
            nonce.as_bytes(),
        ]),
    )?;
    Ok(base64url_encode(&mac[..8]))
}

pub fn build_device_activation_payload(
    activation_key_base64url: &str,
    public_identity_key: &str,
    nonce: &str,
) -> Result<DeviceActivationPayload, TrellisAuthError> {
    Ok(DeviceActivationPayload {
        v: 1,
        public_identity_key: public_identity_key.to_string(),
        nonce: nonce.to_string(),
        qr_mac: derive_device_qr_mac(activation_key_base64url, public_identity_key, nonce)?,
    })
}

pub fn encode_device_activation_payload(
    payload: &DeviceActivationPayload,
) -> Result<String, TrellisAuthError> {
    serde_json::to_vec(payload)
        .map(|bytes| base64url_encode(&bytes))
        .map_err(|error| {
            TrellisAuthError::InvalidArgument(format!("invalid device activation payload: {error}"))
        })
}

pub fn parse_device_activation_payload(
    payload_base64url: &str,
) -> Result<DeviceActivationPayload, TrellisAuthError> {
    let bytes = base64url_decode(payload_base64url)?;
    serde_json::from_slice(&bytes).map_err(|error| {
        TrellisAuthError::InvalidArgument(format!("invalid device activation payload: {error}"))
    })
}

#[derive(Debug, Clone, Serialize)]
struct DeviceActivationStartRequest<'a> {
    payload: &'a DeviceActivationPayload,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct DeviceActivationStartResponse {
    #[serde(rename = "flowId")]
    pub flow_id: String,
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    #[serde(rename = "activationUrl")]
    pub activation_url: String,
}

/// Local activation status tracked by the Rust convenience facade.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DeviceActivationStatus {
    /// The device has started activation but has not observed approval yet.
    Pending,
    /// The device has locally observed activation completion.
    Activated,
}

/// Serializable local activation state owned by the application.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct DeviceActivationLocalState {
    /// Current local activation status.
    pub status: DeviceActivationStatus,
    /// Contract digest this activation state belongs to.
    #[serde(rename = "contractDigest")]
    pub contract_digest: String,
    /// Public device identity key derived from the root secret.
    #[serde(rename = "publicIdentityKey")]
    pub public_identity_key: String,
    /// Auth activation flow id returned by activation start.
    #[serde(rename = "flowId")]
    pub flow_id: String,
    /// Auth-owned device instance id returned by activation start.
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    /// Device deployment id returned by activation start.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// Activation nonce included in the outbound payload.
    pub nonce: String,
    /// Browser URL the device should display for activation.
    #[serde(rename = "activationUrl")]
    pub activation_url: String,
}

/// Request-free activation builder for deriving identity and outbound payload data.
#[derive(Debug, Clone)]
pub struct DeviceActivationSessionBuilder {
    identity: DeviceIdentity,
    nonce: String,
    payload: DeviceActivationPayload,
    encoded_payload: String,
    confirmation_code: String,
}

impl DeviceActivationSessionBuilder {
    /// Derive device identity and build the activation payload from a root secret.
    pub fn new(
        device_root_secret: &[u8],
        nonce: impl Into<String>,
    ) -> Result<Self, TrellisAuthError> {
        let nonce = nonce.into();
        let identity = derive_device_identity(device_root_secret)?;
        let payload = build_device_activation_payload(
            &identity.activation_key_base64url,
            &identity.public_identity_key,
            &nonce,
        )?;
        let encoded_payload = encode_device_activation_payload(&payload)?;
        let confirmation_code = derive_device_confirmation_code(
            &identity.activation_key_base64url,
            &identity.public_identity_key,
            &nonce,
        )?;

        Ok(Self {
            identity,
            nonce,
            payload,
            encoded_payload,
            confirmation_code,
        })
    }

    /// Return the derived public identity key for preregistration and display context.
    pub fn public_identity_key(&self) -> &str {
        &self.identity.public_identity_key
    }

    /// Return the activation payload to send to the auth start endpoint.
    pub fn payload(&self) -> &DeviceActivationPayload {
        &self.payload
    }

    /// Return the base64url-encoded activation payload for QR or URL embedding.
    pub fn encoded_payload(&self) -> &str {
        &self.encoded_payload
    }

    /// Return the local confirmation code for offline approval checks.
    pub fn confirmation_code(&self) -> &str {
        &self.confirmation_code
    }

    /// Build a pending local activation session from an injected start response.
    pub fn pending_session(
        self,
        trellis_url: impl Into<String>,
        contract_digest: impl Into<String>,
        start_response: DeviceActivationStartResponse,
    ) -> Result<DeviceActivationSession, TrellisAuthError> {
        let contract_digest = contract_digest.into();
        if contract_digest.is_empty() {
            return Err(TrellisAuthError::InvalidArgument(
                "contract digest must not be empty".to_string(),
            ));
        }

        let activation_key_base64url = self.identity.activation_key_base64url.clone();

        Ok(DeviceActivationSession {
            trellis_url: trellis_url.into(),
            identity: self.identity,
            activation_key_base64url,
            confirmation_code: self.confirmation_code,
            local_state: DeviceActivationLocalState {
                status: DeviceActivationStatus::Pending,
                contract_digest,
                public_identity_key: self.payload.public_identity_key,
                flow_id: start_response.flow_id,
                instance_id: start_response.instance_id,
                deployment_id: start_response.deployment_id,
                nonce: self.nonce,
                activation_url: start_response.activation_url,
            },
        })
    }
}

/// Local device activation session facade for status, confirmation, and wait signing.
#[derive(Debug, Clone)]
pub struct DeviceActivationSession {
    trellis_url: String,
    identity: DeviceIdentity,
    activation_key_base64url: String,
    confirmation_code: String,
    local_state: DeviceActivationLocalState,
}

impl DeviceActivationSession {
    /// Rebuild a local activation session from caller-persisted state.
    pub fn from_local_state(
        trellis_url: impl Into<String>,
        device_root_secret: &[u8],
        expected_contract_digest: &str,
        local_state: DeviceActivationLocalState,
    ) -> Result<Self, TrellisAuthError> {
        let identity = derive_device_identity(device_root_secret)?;
        if identity.public_identity_key != local_state.public_identity_key {
            return Err(TrellisAuthError::InvalidArgument(
                "public identity key mismatch for device activation local state".to_string(),
            ));
        }
        if local_state.contract_digest != expected_contract_digest {
            return Err(TrellisAuthError::InvalidArgument(
                "contract digest mismatch for device activation local state".to_string(),
            ));
        }

        let activation_key_base64url = identity.activation_key_base64url.clone();
        let confirmation_code = derive_device_confirmation_code(
            &activation_key_base64url,
            &identity.public_identity_key,
            &local_state.nonce,
        )?;

        Ok(Self {
            trellis_url: trellis_url.into(),
            identity,
            activation_key_base64url,
            confirmation_code,
            local_state,
        })
    }

    /// Return the Trellis deployment URL this activation session belongs to.
    pub fn trellis_url(&self) -> &str {
        &self.trellis_url
    }

    /// Return the browser URL the user should open to approve activation.
    pub fn activation_url(&self) -> &str {
        &self.local_state.activation_url
    }

    /// Return the public identity key derived from the device root secret.
    pub fn public_identity_key(&self) -> &str {
        &self.identity.public_identity_key
    }

    /// Return the local confirmation code for offline approval.
    pub fn confirmation_code(&self) -> &str {
        &self.confirmation_code
    }

    /// Return the serializable local activation state for caller-owned persistence.
    pub fn local_state(&self) -> &DeviceActivationLocalState {
        &self.local_state
    }

    /// Build a signed wait request for the auth activation wait endpoint.
    pub fn build_wait_request(
        &self,
        iat: u64,
    ) -> Result<DeviceActivationWaitRequest, TrellisAuthError> {
        sign_device_wait_request(
            &self.local_state.flow_id,
            &self.identity.public_identity_key,
            &self.local_state.nonce,
            &self.identity.identity_seed_base64url,
            Some(&self.local_state.contract_digest),
            iat,
        )
    }

    /// Verify an offline confirmation code and mark the pending local state activated.
    pub fn accept_confirmation_code(
        &mut self,
        confirmation_code: &str,
    ) -> Result<(), TrellisAuthError> {
        if self.local_state.status != DeviceActivationStatus::Pending {
            return Err(TrellisAuthError::InvalidArgument(
                "device activation session is not pending".to_string(),
            ));
        }

        let ok = verify_device_confirmation_code(
            &self.activation_key_base64url,
            &self.identity.public_identity_key,
            &self.local_state.nonce,
            confirmation_code,
        )?;
        if !ok {
            return Err(TrellisAuthError::InvalidArgument(
                "invalid device confirmation code".to_string(),
            ));
        }

        self.local_state.status = DeviceActivationStatus::Activated;
        Ok(())
    }
}

pub async fn start_device_activation_request(
    trellis_url: &str,
    payload: &DeviceActivationPayload,
) -> Result<DeviceActivationStartResponse, TrellisAuthError> {
    let url = Url::parse(trellis_url)?.join("/auth/devices/activate/requests")?;
    let response = Client::new()
        .post(url)
        .json(&DeviceActivationStartRequest { payload })
        .send()
        .await?;
    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        return Err(TrellisAuthError::DeviceActivationStartFailure(status, body));
    }

    response.json().await.map_err(TrellisAuthError::from)
}

/// Build the length-prefixed byte input signed by device activation wait requests.
pub fn build_device_wait_proof_input(
    flow_id: &str,
    public_identity_key: &str,
    nonce: &str,
    iat: u64,
    contract_digest: Option<&str>,
) -> Vec<u8> {
    let flow_id = flow_id.as_bytes();
    let public_identity_key = public_identity_key.as_bytes();
    let nonce = nonce.as_bytes();
    let iat = iat.to_string();
    let iat = iat.as_bytes();
    let contract_digest = contract_digest.unwrap_or_default().as_bytes();

    let mut out = Vec::with_capacity(
        4 + flow_id.len()
            + 4
            + public_identity_key.len()
            + 4
            + nonce.len()
            + 4
            + iat.len()
            + 4
            + contract_digest.len(),
    );
    out.extend_from_slice(&(flow_id.len() as u32).to_be_bytes());
    out.extend_from_slice(flow_id);
    out.extend_from_slice(&(public_identity_key.len() as u32).to_be_bytes());
    out.extend_from_slice(public_identity_key);
    out.extend_from_slice(&(nonce.len() as u32).to_be_bytes());
    out.extend_from_slice(nonce);
    out.extend_from_slice(&(iat.len() as u32).to_be_bytes());
    out.extend_from_slice(iat);
    out.extend_from_slice(&(contract_digest.len() as u32).to_be_bytes());
    out.extend_from_slice(contract_digest);
    out
}

/// Build and sign a pre-auth device activation wait request.
pub fn sign_device_wait_request(
    flow_id: &str,
    public_identity_key: &str,
    nonce: &str,
    identity_seed_base64url: &str,
    contract_digest: Option<&str>,
    iat: u64,
) -> Result<DeviceActivationWaitRequest, TrellisAuthError> {
    let identity_seed = base64url_decode(identity_seed_base64url)?;
    if identity_seed.len() != 32 {
        return Err(TrellisAuthError::InvalidArgument(format!(
            "invalid identity seed length: {} (expected 32)",
            identity_seed.len()
        )));
    }
    let mut seed = [0u8; 32];
    seed.copy_from_slice(&identity_seed);
    let signing_key = SigningKey::from_bytes(&seed);
    let digest = Sha256::digest(build_device_wait_proof_input(
        flow_id,
        public_identity_key,
        nonce,
        iat,
        contract_digest,
    ));
    let signature = signing_key.sign(&digest);

    Ok(DeviceActivationWaitRequest {
        flow_id: flow_id.to_string(),
        public_identity_key: public_identity_key.to_string(),
        contract_digest: contract_digest.map(ToOwned::to_owned),
        nonce: nonce.to_string(),
        iat,
        sig: base64url_encode(&signature.to_bytes()),
    })
}

pub async fn wait_for_device_activation_response(
    trellis_url: &str,
    request: &DeviceActivationWaitRequest,
) -> Result<WaitForDeviceActivationResponse, TrellisAuthError> {
    let url = Url::parse(trellis_url)?.join("/auth/devices/activate/wait")?;
    let response = Client::new().post(url).json(request).send().await?;
    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        return Err(TrellisAuthError::DeviceActivationWaitFailure(status, body));
    }

    response.json().await.map_err(TrellisAuthError::from)
}

/// Fetch current runtime connect info for an already activated device.
pub async fn get_device_connect_info(
    opts: GetDeviceConnectInfoOpts<'_>,
) -> Result<DeviceConnectInfoResponse, TrellisAuthError> {
    let signed = sign_device_wait_request(
        "connect-info",
        opts.public_identity_key,
        "connect-info",
        opts.identity_seed_base64url,
        Some(opts.contract_digest),
        opts.iat,
    )?;
    let request = DeviceConnectInfoRequest {
        public_identity_key: signed.public_identity_key,
        contract_digest: signed.contract_digest.ok_or_else(|| {
            TrellisAuthError::InvalidArgument("contract digest must not be empty".to_string())
        })?,
        iat: signed.iat,
        sig: signed.sig,
    };

    let url = Url::parse(opts.trellis_url)?.join("/auth/devices/connect-info")?;
    let response = Client::new().post(url).json(&request).send().await?;
    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        return Err(TrellisAuthError::DeviceConnectInfoFailure(status, body));
    }

    let response: DeviceConnectInfoResponse = response.json().await?;
    validate_device_connect_info_response(opts.contract_digest, &response)?;

    Ok(response)
}

fn validate_device_connect_info_response(
    expected_contract_digest: &str,
    response: &DeviceConnectInfoResponse,
) -> Result<(), TrellisAuthError> {
    if response.status != "ready" {
        return Err(TrellisAuthError::UnexpectedDeviceConnectInfoStatus(
            response.status.clone(),
        ));
    }
    if response.connect_info.contract_digest != expected_contract_digest {
        return Err(TrellisAuthError::InvalidArgument(format!(
            "device connect info contract digest mismatch: expected '{expected_contract_digest}', got '{}'",
            response.connect_info.contract_digest
        )));
    }
    if response.connect_info.auth.mode != crate::models::DeviceConnectInfoAuthMode::DeviceIdentity {
        return Err(TrellisAuthError::InvalidArgument(
            "unexpected device connect info auth mode".to_string(),
        ));
    }
    let native = response
        .connect_info
        .transports
        .native
        .as_ref()
        .ok_or_else(|| TrellisAuthError::InvalidArgument("missing native NATS transport".into()))?;
    if native.nats_servers.is_empty() {
        return Err(TrellisAuthError::InvalidArgument(
            "native NATS transport has no servers".into(),
        ));
    }

    Ok(())
}

pub async fn wait_for_device_activation(
    opts: WaitForDeviceActivationOpts<'_>,
) -> Result<serde_json::Value, TrellisAuthError> {
    loop {
        let request = sign_device_wait_request(
            opts.flow_id,
            opts.public_identity_key,
            opts.nonce,
            opts.identity_seed_base64url,
            opts.contract_digest,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        )?;
        match wait_for_device_activation_response(opts.trellis_url, &request).await? {
            WaitForDeviceActivationResponse::Activated { connect_info, .. } => {
                return Ok(connect_info);
            }
            WaitForDeviceActivationResponse::Rejected { reason } => {
                return Err(TrellisAuthError::DeviceActivationRejected(match reason {
                    Some(reason) => format!(": {reason}"),
                    None => String::new(),
                }));
            }
            WaitForDeviceActivationResponse::Pending => {
                tokio::time::sleep(match opts.poll_interval {
                    duration if duration.is_zero() => Duration::from_millis(1),
                    duration => duration,
                })
                .await
            }
        }
    }
}

pub fn derive_device_confirmation_code(
    activation_key_base64url: &str,
    public_identity_key: &str,
    nonce: &str,
) -> Result<String, TrellisAuthError> {
    let activation_key = base64url_decode(activation_key_base64url)?;
    let mac = hmac_sha256(
        &activation_key,
        &concat_bytes(&[
            DEVICE_CONFIRMATION_DOMAIN.as_bytes(),
            public_identity_key.as_bytes(),
            nonce.as_bytes(),
        ]),
    )?;
    Ok(crockford_encode(&mac[..5]))
}

pub fn verify_device_confirmation_code(
    activation_key_base64url: &str,
    public_identity_key: &str,
    nonce: &str,
    confirmation_code: &str,
) -> Result<bool, TrellisAuthError> {
    Ok(normalize_crockford(&derive_device_confirmation_code(
        activation_key_base64url,
        public_identity_key,
        nonce,
    )?) == normalize_crockford(confirmation_code))
}

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
    DeviceActivationPayload, DeviceActivationWaitRequest, DeviceIdentity,
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
    #[serde(rename = "profileId")]
    pub profile_id: String,
    #[serde(rename = "activationUrl")]
    pub activation_url: String,
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

pub fn build_device_wait_proof_input(public_identity_key: &str, nonce: &str, iat: u64) -> Vec<u8> {
    let public_identity_key = public_identity_key.as_bytes();
    let nonce = nonce.as_bytes();
    let iat = iat.to_string();
    let iat = iat.as_bytes();

    let mut out =
        Vec::with_capacity(4 + public_identity_key.len() + 4 + nonce.len() + 4 + iat.len());
    out.extend_from_slice(&(public_identity_key.len() as u32).to_be_bytes());
    out.extend_from_slice(public_identity_key);
    out.extend_from_slice(&(nonce.len() as u32).to_be_bytes());
    out.extend_from_slice(nonce);
    out.extend_from_slice(&(iat.len() as u32).to_be_bytes());
    out.extend_from_slice(iat);
    out
}

pub fn sign_device_wait_request(
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
        public_identity_key,
        nonce,
        iat,
    ));
    let signature = signing_key.sign(&digest);

    Ok(DeviceActivationWaitRequest {
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

pub async fn wait_for_device_activation(
    opts: WaitForDeviceActivationOpts<'_>,
) -> Result<serde_json::Value, TrellisAuthError> {
    loop {
        let request = sign_device_wait_request(
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

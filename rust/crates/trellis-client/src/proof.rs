use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use sha2::{Digest, Sha256};

use crate::TrellisClientError;

pub(crate) fn sha256(bytes: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    digest.into()
}

pub(crate) fn base64url_encode(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

pub(crate) fn base64url_decode(value: &str) -> Result<Vec<u8>, base64::DecodeError> {
    URL_SAFE_NO_PAD.decode(value)
}

pub(crate) fn now_iat_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub(crate) fn build_proof_input(session_key: &str, subject: &str, payload_hash: &[u8]) -> Vec<u8> {
    let session_key = session_key.as_bytes();
    let subject = subject.as_bytes();

    let mut out =
        Vec::with_capacity(4 + session_key.len() + 4 + subject.len() + 4 + payload_hash.len());
    out.extend_from_slice(&(session_key.len() as u32).to_be_bytes());
    out.extend_from_slice(session_key);
    out.extend_from_slice(&(subject.len() as u32).to_be_bytes());
    out.extend_from_slice(subject);
    out.extend_from_slice(&(payload_hash.len() as u32).to_be_bytes());
    out.extend_from_slice(payload_hash);
    out
}

/// Verify the `proof` header for a signed Trellis RPC payload.
pub fn verify_proof(
    public_session_key: &str,
    subject: &str,
    payload: &[u8],
    proof_base64url: &str,
) -> Result<bool, TrellisClientError> {
    let public_key_bytes = base64url_decode(public_session_key)?;
    if public_key_bytes.len() != 32 {
        return Ok(false);
    }
    let mut public_key = [0u8; 32];
    public_key.copy_from_slice(&public_key_bytes);

    let signature_bytes = base64url_decode(proof_base64url)?;
    if signature_bytes.len() != 64 {
        return Ok(false);
    }
    let mut signature = [0u8; 64];
    signature.copy_from_slice(&signature_bytes);

    let payload_hash = sha256(payload);
    let input = build_proof_input(public_session_key, subject, &payload_hash);
    let digest = sha256(&input);

    let public_key = VerifyingKey::from_bytes(&public_key)
        .map_err(|error| TrellisClientError::RpcError(error.to_string()))?;
    let signature = Signature::from_bytes(&signature);
    Ok(public_key.verify(&digest, &signature).is_ok())
}

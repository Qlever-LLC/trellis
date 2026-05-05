use ed25519_dalek::{Signature, Signer, SigningKey};
use serde_json::json;

use crate::proof::{base64url_decode, base64url_encode, build_proof_input, sha256};
use crate::TrellisClientError;

/// Session-scoped signing material used for Trellis auth and RPC proofs.
pub struct SessionAuth {
    /// Public session key in base64url form.
    pub session_key: String,
    signing_key: SigningKey,
}

impl SessionAuth {
    /// Construct a session authenticator from a base64url-encoded Ed25519 seed.
    pub fn from_seed_base64url(seed_b64url: &str) -> Result<Self, TrellisClientError> {
        let seed = base64url_decode(seed_b64url)?;
        if seed.len() != 32 {
            return Err(TrellisClientError::InvalidSeedLen(seed.len()));
        }
        let mut seed32 = [0u8; 32];
        seed32.copy_from_slice(&seed);
        let signing_key = SigningKey::from_bytes(&seed32);
        let public = signing_key.verifying_key().to_bytes();
        let session_key = base64url_encode(&public);
        Ok(Self {
            session_key,
            signing_key,
        })
    }

    /// Sign a domain-separated string value with `SHA-256(prefix:value)`.
    pub fn sign_sha256_domain(&self, prefix: &str, value: &str) -> String {
        let digest = sha256(format!("{prefix}:{value}").as_bytes());
        let signature: Signature = self.signing_key.sign(&digest);
        base64url_encode(&signature.to_bytes())
    }

    pub(crate) fn sign_sha256_bytes(&self, bytes: &[u8]) -> String {
        let digest = sha256(bytes);
        let signature: Signature = self.signing_key.sign(&digest);
        base64url_encode(&signature.to_bytes())
    }

    /// Create a service auth-callout token using an `iat` timestamp and contract digest.
    pub fn nats_connect_token(&self, iat: u64, contract_digest: &str) -> String {
        let signature =
            self.sign_sha256_domain("nats-connect", &format!("{iat}:{contract_digest}"));
        serde_json::to_string(&json!({
          "v": 1,
          "sessionKey": self.session_key,
          "iat": iat,
          "contractDigest": contract_digest,
          "sig": signature,
        }))
        .expect("nats auth token json")
    }

    /// Create a user auth-callout token using an `iat` timestamp and contract digest.
    pub fn nats_connect_user_token(&self, iat: u64, contract_digest: &str) -> String {
        self.nats_connect_token(iat, contract_digest)
    }

    /// Return the inbox prefix derived from the session key.
    pub fn inbox_prefix(&self) -> String {
        format!(
            "_INBOX.{}",
            &self.session_key[..16.min(self.session_key.len())]
        )
    }

    /// Create the `proof` header for a signed RPC request payload.
    pub fn create_proof(&self, subject: &str, payload: &[u8]) -> String {
        let payload_hash = sha256(payload);
        let input = build_proof_input(&self.session_key, subject, &payload_hash);
        let digest = sha256(&input);
        let signature: Signature = self.signing_key.sign(&digest);
        base64url_encode(&signature.to_bytes())
    }
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::SessionAuth;

    #[test]
    fn service_nats_token_matches_auth_proof_conformance_vectors() {
        let vectors: Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../conformance/auth-proof/vectors.json"
        )))
        .expect("auth proof vectors should parse");

        for vector in vectors.as_array().expect("vectors should be an array") {
            let auth = SessionAuth::from_seed_base64url(
                vector["seed"]
                    .as_str()
                    .expect("vector seed should be string"),
            )
            .expect("vector seed should be valid");
            let nats_connect = &vector["natsConnect"];
            let iat = nats_connect["iat"].as_u64().expect("iat should be u64");
            let contract_digest = nats_connect["contractDigest"]
                .as_str()
                .expect("contract digest should be string");

            assert_eq!(auth.session_key, vector["sessionKey"]);
            assert_eq!(
                auth.sign_sha256_domain("nats-connect", &format!("{iat}:{contract_digest}")),
                nats_connect["iatSig"]
            );
            assert_eq!(
                auth.nats_connect_token(iat, contract_digest),
                nats_connect["runtimeToken"]
            );
        }
    }
}

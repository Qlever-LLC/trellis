use std::fmt;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use jsonptr::PointerBuf;
use nkeys::KeyPairType;
use serde::{de, Deserialize, Deserializer, Serialize};
use serde_json::Value;
use sha2::{Digest as _, Sha256};

use crate::{canonicalize_json, ProtocolError, SessionProofErrorCode};

/// Strict wire format for auth, bootstrap, and authorization-context refresh proofs.
pub const SESSION_PROOF_FORMAT_V1: &str = "trellis.session-proof.v1";

const MAXIMUM_SAFE_JSON_INTEGER: i64 = 9_007_199_254_740_991;
const MAXIMUM_REQUEST_ID_BYTES: usize = 256;
const MAXIMUM_TEXT_BYTES: usize = 16 * 1024;
const MAXIMUM_PROOF_WINDOW_MS: i64 = 5 * 60 * 1_000;

/// One fixed signature domain within [`SESSION_PROOF_FORMAT_V1`].
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SessionProofPurpose {
    /// Start a user app or agent browser-auth request.
    UserAuthRequest,
    /// Claim an approved browser-auth flow with its enrolled session key.
    UserAuthBind,
    /// Bootstrap a provisioned service instance.
    ServiceBootstrap,
    /// Bootstrap a provisioned or activated device.
    DeviceBootstrap,
    /// Refresh an authorization context using the durable session key.
    AuthorizationContextRefresh,
}

impl SessionProofPurpose {
    fn as_str(self) -> &'static str {
        match self {
            Self::UserAuthRequest => "userAuthRequest",
            Self::UserAuthBind => "userAuthBind",
            Self::ServiceBootstrap => "serviceBootstrap",
            Self::DeviceBootstrap => "deviceBootstrap",
            Self::AuthorizationContextRefresh => "authorizationContextRefresh",
        }
    }
}

impl fmt::Display for SessionProofPurpose {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// Validated purpose-specific input to one session proof.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SessionProofInput {
    purpose: SessionProofPurpose,
    request_id: String,
    issued_at: i64,
    signer_key_id: String,
    transcript_fields: Vec<Vec<u8>>,
    nkey_binding: Option<NkeyBinding>,
}

/// Owned fields for a user browser-auth initiation proof.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UserAuthRequestSessionProofInput {
    /// Caller-generated request identifier.
    pub request_id: String,
    /// Claimed Unix issue time in milliseconds.
    pub issued_at: i64,
    /// Unpadded base64url Ed25519 session public key.
    pub session_public_key: String,
    /// NATS User NKey encoding the session public key.
    pub session_nkey: String,
    /// Participant identifier requesting authorization.
    pub participant_id: String,
    /// Canonical participant artifact digest.
    pub participant_digest: String,
    /// Exact post-authentication redirect target.
    pub redirect_target: String,
    /// Digest of the complete request with its proof signature removed.
    pub request_digest: String,
}

/// Owned fields for claiming an approved browser-auth flow.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UserAuthBindSessionProofInput {
    /// Caller-generated proof request identifier.
    pub request_id: String,
    /// Claimed Unix issue time in milliseconds.
    pub issued_at: i64,
    /// Immutable browser flow identifier.
    pub flow_id: String,
    /// Enrolled unpadded base64url Ed25519 session public key.
    pub session_public_key: String,
    /// Digest of the complete bind request with its proof signature removed.
    pub request_digest: String,
}

/// Owned fields for a provisioned service-instance bootstrap proof.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ServiceBootstrapSessionProofInput {
    /// Caller-generated request identifier.
    pub request_id: String,
    /// Claimed Unix issue time in milliseconds.
    pub issued_at: i64,
    /// Deployment containing the service instance.
    pub deployment_id: String,
    /// Service instance identifier.
    pub instance_id: String,
    /// Provisioned identity signing-key identifier.
    pub provisioned_identity_key_id: String,
    /// Unpadded base64url Ed25519 public key for the new session.
    pub new_session_public_key: String,
    /// NATS User NKey encoding the new session public key.
    pub new_session_nkey: String,
    /// Participant identifier presented by the service.
    pub participant_id: String,
    /// Canonical participant artifact digest.
    pub participant_digest: String,
    /// Digest of the complete request with its proof signature removed.
    pub request_digest: String,
}

/// Owned fields for a provisioned or activated device bootstrap proof.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DeviceBootstrapSessionProofInput {
    /// Caller-generated request identifier.
    pub request_id: String,
    /// Claimed Unix issue time in milliseconds.
    pub issued_at: i64,
    /// Deployment containing the device instance.
    pub deployment_id: String,
    /// Device instance identifier.
    pub instance_id: String,
    /// Device identity signing-key identifier.
    pub device_identity_key_id: String,
    /// Unpadded base64url Ed25519 public key for the new session.
    pub new_session_public_key: String,
    /// NATS User NKey encoding the new session public key.
    pub new_session_nkey: String,
    /// Participant identifier presented by the device.
    pub participant_id: String,
    /// Canonical participant artifact digest.
    pub participant_digest: String,
    /// Optional digest of the activation challenge.
    pub challenge_digest: Option<String>,
    /// Digest of the complete request with its proof signature removed.
    pub request_digest: String,
}

/// Owned fields for an authorization-context refresh proof.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthorizationContextRefreshSessionProofInput {
    /// Caller-generated request identifier.
    pub request_id: String,
    /// Claimed Unix issue time in milliseconds.
    pub issued_at: i64,
    /// Durable session identifier.
    pub session_id: String,
    /// Durable session signing-key identifier.
    pub session_key_id: String,
    /// Digest of the currently usable context, when one remains usable.
    pub current_context_digest: Option<String>,
    /// Expected canonical participant artifact digest, when known.
    pub expected_participant_digest: Option<String>,
    /// Expected canonical participant-needs digest, when known.
    pub expected_needs_digest: Option<String>,
    /// Pinned authorization root signing-key identifier.
    pub known_root_key_id: String,
    /// Lowest accepted issuer-manifest generation.
    pub minimum_manifest_generation: i64,
    /// Digest of the complete request with its proof signature removed.
    pub request_digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum NkeyBinding {
    PublicKey {
        nkey: String,
        public_key: VerifyingKey,
    },
}

impl SessionProofInput {
    /// Build a user browser-auth initiation proof input.
    ///
    /// `request_digest` is the output of [`session_proof_request_digest`].
    ///
    /// # Errors
    ///
    /// Returns [`ProtocolError::SessionProof`] when a field is noncanonical,
    /// unsafe, empty, malformed, or the NKey does not encode `session_public_key`.
    pub fn user_auth_request(
        input: UserAuthRequestSessionProofInput,
    ) -> Result<Self, ProtocolError> {
        let UserAuthRequestSessionProofInput {
            request_id,
            issued_at,
            session_public_key,
            session_nkey,
            participant_id,
            participant_digest,
            redirect_target,
            request_digest,
        } = input;
        let key = decode_public_key(&session_public_key, &["sessionPublicKey"])?;
        let session_nkey_bytes = validate_nkey_binding(&session_nkey, &key, &["sessionNkey"])?;
        let signer_key_id = derived_key_id(&key);

        Self::new(
            SessionProofPurpose::UserAuthRequest,
            request_id,
            issued_at,
            signer_key_id,
            vec![
                key.as_bytes().to_vec(),
                session_nkey_bytes.to_vec(),
                text(&participant_id, &["participantId"])?,
                digest(&participant_digest, &["participantDigest"])?,
                text(&redirect_target, &["redirectTarget"])?,
                digest(&request_digest, &["requestDigest"])?,
            ],
            Some(NkeyBinding::PublicKey {
                nkey: session_nkey,
                public_key: key,
            }),
        )
    }

    /// Build a proof input for claiming an approved browser-auth flow.
    ///
    /// # Errors
    ///
    /// Returns [`ProtocolError::SessionProof`] when a field is noncanonical,
    /// unsafe, empty, or malformed.
    pub fn user_auth_bind(input: UserAuthBindSessionProofInput) -> Result<Self, ProtocolError> {
        let UserAuthBindSessionProofInput {
            request_id,
            issued_at,
            flow_id,
            session_public_key,
            request_digest,
        } = input;
        if ulid::Ulid::from_string(&request_id)
            .map(|parsed| parsed.to_string() != request_id)
            .unwrap_or(true)
        {
            return Err(proof_error(
                SessionProofErrorCode::InvalidFormat,
                ["requestId"],
                "browser bind request ID must be a canonical ULID",
            ));
        }
        let key = decode_public_key(&session_public_key, &["sessionPublicKey"])?;
        let signer_key_id = derived_key_id(&key);

        Self::new(
            SessionProofPurpose::UserAuthBind,
            request_id,
            issued_at,
            signer_key_id,
            vec![
                text(&flow_id, &["flowId"])?,
                key.as_bytes().to_vec(),
                digest(&request_digest, &["requestDigest"])?,
            ],
            None,
        )
    }

    /// Build a provisioned service-instance bootstrap proof input.
    ///
    /// # Errors
    ///
    /// Returns [`ProtocolError::SessionProof`] when a field is noncanonical,
    /// unsafe, empty, malformed, or the NKey does not encode `new_session_public_key`.
    pub fn service_bootstrap(
        input: ServiceBootstrapSessionProofInput,
    ) -> Result<Self, ProtocolError> {
        let ServiceBootstrapSessionProofInput {
            request_id,
            issued_at,
            deployment_id,
            instance_id,
            provisioned_identity_key_id,
            new_session_public_key,
            new_session_nkey,
            participant_id,
            participant_digest,
            request_digest,
        } = input;
        validate_key_id(&provisioned_identity_key_id, &["provisionedIdentityKeyId"])?;
        let session_key = decode_public_key(&new_session_public_key, &["newSessionPublicKey"])?;
        let session_nkey_bytes =
            validate_nkey_binding(&new_session_nkey, &session_key, &["newSessionNkey"])?;

        Self::new(
            SessionProofPurpose::ServiceBootstrap,
            request_id,
            issued_at,
            provisioned_identity_key_id.clone(),
            vec![
                text(&deployment_id, &["deploymentId"])?,
                text(&instance_id, &["instanceId"])?,
                digest(&provisioned_identity_key_id, &["provisionedIdentityKeyId"])?,
                session_key.as_bytes().to_vec(),
                session_nkey_bytes.to_vec(),
                text(&participant_id, &["participantId"])?,
                digest(&participant_digest, &["participantDigest"])?,
                digest(&request_digest, &["requestDigest"])?,
            ],
            Some(NkeyBinding::PublicKey {
                nkey: new_session_nkey,
                public_key: session_key,
            }),
        )
    }

    /// Build a provisioned or activated device bootstrap proof input.
    ///
    /// # Errors
    ///
    /// Returns [`ProtocolError::SessionProof`] when a field is noncanonical,
    /// unsafe, empty, malformed, or the NKey does not encode `new_session_public_key`.
    pub fn device_bootstrap(
        input: DeviceBootstrapSessionProofInput,
    ) -> Result<Self, ProtocolError> {
        let DeviceBootstrapSessionProofInput {
            request_id,
            issued_at,
            deployment_id,
            instance_id,
            device_identity_key_id,
            new_session_public_key,
            new_session_nkey,
            participant_id,
            participant_digest,
            challenge_digest,
            request_digest,
        } = input;
        validate_key_id(&device_identity_key_id, &["deviceIdentityKeyId"])?;
        let session_key = decode_public_key(&new_session_public_key, &["newSessionPublicKey"])?;
        let session_nkey_bytes =
            validate_nkey_binding(&new_session_nkey, &session_key, &["newSessionNkey"])?;

        Self::new(
            SessionProofPurpose::DeviceBootstrap,
            request_id,
            issued_at,
            device_identity_key_id.clone(),
            vec![
                text(&deployment_id, &["deploymentId"])?,
                text(&instance_id, &["instanceId"])?,
                digest(&device_identity_key_id, &["deviceIdentityKeyId"])?,
                session_key.as_bytes().to_vec(),
                session_nkey_bytes.to_vec(),
                text(&participant_id, &["participantId"])?,
                digest(&participant_digest, &["participantDigest"])?,
                optional_digest(challenge_digest.as_deref(), &["challengeDigest"])?,
                digest(&request_digest, &["requestDigest"])?,
            ],
            Some(NkeyBinding::PublicKey {
                nkey: new_session_nkey,
                public_key: session_key,
            }),
        )
    }

    /// Build a proof input for refreshing the current authorization context.
    ///
    /// # Errors
    ///
    /// Returns [`ProtocolError::SessionProof`] when a field is noncanonical,
    /// unsafe, empty, or malformed.
    pub fn authorization_context_refresh(
        input: AuthorizationContextRefreshSessionProofInput,
    ) -> Result<Self, ProtocolError> {
        let AuthorizationContextRefreshSessionProofInput {
            request_id,
            issued_at,
            session_id,
            session_key_id,
            current_context_digest,
            expected_participant_digest,
            expected_needs_digest,
            known_root_key_id,
            minimum_manifest_generation,
            request_digest,
        } = input;
        validate_key_id(&session_key_id, &["sessionKeyId"])?;
        validate_key_id(&known_root_key_id, &["knownRootKeyId"])?;
        if minimum_manifest_generation <= 0 {
            return Err(proof_error(
                SessionProofErrorCode::InvalidFormat,
                ["minimumManifestGeneration"],
                "minimum manifest generation must be positive",
            ));
        }
        validate_safe_integer(minimum_manifest_generation, &["minimumManifestGeneration"])?;

        Self::new(
            SessionProofPurpose::AuthorizationContextRefresh,
            request_id,
            issued_at,
            session_key_id.clone(),
            vec![
                text(&session_id, &["sessionId"])?,
                digest(&session_key_id, &["sessionKeyId"])?,
                optional_digest(current_context_digest.as_deref(), &["currentContextDigest"])?,
                optional_digest(
                    expected_participant_digest.as_deref(),
                    &["expectedParticipantDigest"],
                )?,
                optional_digest(expected_needs_digest.as_deref(), &["expectedNeedsDigest"])?,
                digest(&known_root_key_id, &["knownRootKeyId"])?,
                minimum_manifest_generation.to_string().into_bytes(),
                digest(&request_digest, &["requestDigest"])?,
            ],
            None,
        )
    }

    fn new(
        purpose: SessionProofPurpose,
        request_id: String,
        issued_at: i64,
        signer_key_id: String,
        transcript_fields: Vec<Vec<u8>>,
        nkey_binding: Option<NkeyBinding>,
    ) -> Result<Self, ProtocolError> {
        validate_request_id(&request_id)?;
        validate_safe_integer(issued_at, &["issuedAt"])?;
        Ok(Self {
            purpose,
            request_id,
            issued_at,
            signer_key_id,
            transcript_fields,
            nkey_binding,
        })
    }

    /// Return the fixed signature purpose.
    #[must_use]
    pub fn purpose(&self) -> SessionProofPurpose {
        self.purpose
    }

    /// Return the caller-generated request identifier.
    #[must_use]
    pub fn request_id(&self) -> &str {
        &self.request_id
    }

    /// Return the claimed Unix issue time in milliseconds.
    #[must_use]
    pub fn issued_at(&self) -> i64 {
        self.issued_at
    }

    /// Return the expected signing-key identifier.
    #[must_use]
    pub fn signer_key_id(&self) -> &str {
        &self.signer_key_id
    }

    fn digest(&self) -> Result<[u8; 32], ProtocolError> {
        let mut transcript = Vec::new();
        push_length_prefixed(&mut transcript, SESSION_PROOF_FORMAT_V1.as_bytes())?;
        push_length_prefixed(&mut transcript, self.purpose.as_str().as_bytes())?;
        push_length_prefixed(&mut transcript, self.request_id.as_bytes())?;
        push_length_prefixed(&mut transcript, self.issued_at.to_string().as_bytes())?;
        for field in &self.transcript_fields {
            push_length_prefixed(&mut transcript, field)?;
        }
        Ok(sha256(&transcript))
    }

    fn validate_signer(&self, key: &VerifyingKey) -> Result<(), ProtocolError> {
        if self.signer_key_id != derived_key_id(key) {
            return Err(proof_error(
                SessionProofErrorCode::InvalidKeyId,
                ["signerKeyId"],
                "signer key id does not match the verification key",
            ));
        }
        match &self.nkey_binding {
            Some(NkeyBinding::PublicKey { nkey, public_key }) => {
                validate_nkey_binding(nkey, public_key, &["sessionNkey"]).map(|_| ())
            }
            None => Ok(()),
        }
    }
}

/// One strict session-proof signature envelope.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionProof {
    format: String,
    signature: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WireSessionProof {
    format: String,
    signature: String,
}

impl<'de> Deserialize<'de> for SessionProof {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let wire = WireSessionProof::deserialize(deserializer)?;
        parse_wire_proof(wire).map_err(de::Error::custom)
    }
}

impl SessionProof {
    /// Return the proof format identifier.
    #[must_use]
    pub fn format(&self) -> &str {
        &self.format
    }

    /// Return the canonical unpadded base64url Ed25519 signature.
    #[must_use]
    pub fn signature(&self) -> &str {
        &self.signature
    }
}

/// Freshness limits applied while verifying session proofs.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SessionProofPolicy {
    maximum_age_ms: i64,
    maximum_future_skew_ms: i64,
}

impl SessionProofPolicy {
    /// Construct bounded proof freshness policy.
    ///
    /// # Errors
    ///
    /// Returns [`ProtocolError::SessionProof`] when either limit is negative,
    /// exceeds five minutes, or their sum overflows.
    pub fn new(maximum_age_ms: i64, maximum_future_skew_ms: i64) -> Result<Self, ProtocolError> {
        if !(0..=MAXIMUM_PROOF_WINDOW_MS).contains(&maximum_age_ms)
            || !(0..=MAXIMUM_PROOF_WINDOW_MS).contains(&maximum_future_skew_ms)
        {
            return Err(proof_error(
                SessionProofErrorCode::InvalidFormat,
                std::iter::empty::<&str>(),
                "proof age and future skew must be between zero and five minutes",
            ));
        }
        maximum_age_ms
            .checked_add(maximum_future_skew_ms)
            .ok_or_else(|| {
                proof_error(
                    SessionProofErrorCode::InvalidFormat,
                    std::iter::empty::<&str>(),
                    "proof validity window overflows",
                )
            })?;
        Ok(Self {
            maximum_age_ms,
            maximum_future_skew_ms,
        })
    }

    /// Return the maximum accepted proof age in milliseconds.
    #[must_use]
    pub fn maximum_age_ms(self) -> i64 {
        self.maximum_age_ms
    }

    /// Return the maximum accepted future clock skew in milliseconds.
    #[must_use]
    pub fn maximum_future_skew_ms(self) -> i64 {
        self.maximum_future_skew_ms
    }
}

impl Default for SessionProofPolicy {
    fn default() -> Self {
        Self {
            maximum_age_ms: 30_000,
            maximum_future_skew_ms: 30_000,
        }
    }
}

/// Parse and structurally validate one session-proof envelope.
///
/// # Errors
///
/// Returns [`ProtocolError::SessionProof`] when the value has a wrong format
/// or noncanonical signature encoding.
pub fn parse_session_proof(value: &Value) -> Result<SessionProof, ProtocolError> {
    let wire: WireSessionProof = serde_json::from_value(value.clone()).map_err(|error| {
        proof_error(
            SessionProofErrorCode::InvalidFormat,
            std::iter::empty::<&str>(),
            error.to_string(),
        )
    })?;
    parse_wire_proof(wire)
}

/// Compute the canonical request digest used by HTTP session proofs.
///
/// The input must contain a top-level `proof` object with the exact format and a
/// `signature` member. Only that signature member is removed before Trellis JSON
/// canonicalization and SHA-256 hashing.
///
/// # Errors
///
/// Returns [`ProtocolError::SessionProof`] when the request/proof shape is wrong,
/// the proof format differs, or canonicalization fails.
pub fn session_proof_request_digest(request: &Value) -> Result<String, ProtocolError> {
    let mut unsigned = request.clone();
    let object = unsigned.as_object_mut().ok_or_else(|| {
        proof_error(
            SessionProofErrorCode::InvalidFormat,
            std::iter::empty::<&str>(),
            "proof-bearing request must be an object",
        )
    })?;
    let proof = object
        .get_mut("proof")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| {
            proof_error(
                SessionProofErrorCode::InvalidFormat,
                ["proof"],
                "proof must be an object",
            )
        })?;
    if proof.get("format").and_then(Value::as_str) != Some(SESSION_PROOF_FORMAT_V1) {
        return Err(proof_error(
            SessionProofErrorCode::InvalidFormat,
            ["proof", "format"],
            format!("format must equal '{SESSION_PROOF_FORMAT_V1}'"),
        ));
    }
    if proof.remove("signature").is_none() {
        return Err(proof_error(
            SessionProofErrorCode::InvalidFormat,
            ["proof", "signature"],
            "signature member is required",
        ));
    }
    validate_safe_json_integers(&unsigned, &mut Vec::new())?;
    let canonical = canonicalize_json(&unsigned)?;
    Ok(encode_base64url(&sha256(canonical.as_bytes())))
}

/// Compute the canonical SHA-256 signing digest for one validated proof input.
///
/// This is the cross-language boundary used by WebCrypto clients and WASM
/// bindings. Signatures are Ed25519 signatures over the decoded 32 digest bytes.
///
/// # Errors
///
/// Returns [`ProtocolError::SessionProof`] if a length-prefixed transcript
/// component cannot be encoded.
pub fn session_proof_signing_digest(input: &SessionProofInput) -> Result<String, ProtocolError> {
    Ok(encode_base64url(&input.digest()?))
}

/// Sign one validated purpose-specific session-proof input.
///
/// # Errors
///
/// Returns [`ProtocolError::SessionProof`] when the supplied signing key does not
/// match the input's signer identity or a transcript component cannot be encoded.
pub fn sign_session_proof(
    input: &SessionProofInput,
    signing_key: &SigningKey,
) -> Result<SessionProof, ProtocolError> {
    input.validate_signer(&signing_key.verifying_key())?;
    let digest = input.digest()?;
    Ok(SessionProof {
        format: SESSION_PROOF_FORMAT_V1.to_owned(),
        signature: encode_base64url(&signing_key.sign(&digest).to_bytes()),
    })
}

/// Verify one session proof against its expected signer and freshness policy.
///
/// # Errors
///
/// Returns [`ProtocolError::SessionProof`] when signer identity, proof format,
/// freshness, transcript encoding, or signature verification fails.
pub fn verify_session_proof(
    input: &SessionProofInput,
    proof: &SessionProof,
    expected_signer_public_key: &str,
    now_ms: i64,
    policy: SessionProofPolicy,
) -> Result<(), ProtocolError> {
    validate_safe_integer(now_ms, &["now"])?;
    if proof.format != SESSION_PROOF_FORMAT_V1 {
        return Err(proof_error(
            SessionProofErrorCode::InvalidFormat,
            ["proof", "format"],
            format!("format must equal '{SESSION_PROOF_FORMAT_V1}'"),
        ));
    }
    let oldest = now_ms.checked_sub(policy.maximum_age_ms).ok_or_else(|| {
        proof_error(
            SessionProofErrorCode::ProofIatOutOfRange,
            ["issuedAt"],
            "proof age calculation underflowed",
        )
    })?;
    let newest = now_ms
        .checked_add(policy.maximum_future_skew_ms)
        .ok_or_else(|| {
            proof_error(
                SessionProofErrorCode::ProofIatOutOfRange,
                ["issuedAt"],
                "proof future-skew calculation overflowed",
            )
        })?;
    if !(oldest..=newest).contains(&input.issued_at) {
        return Err(proof_error(
            SessionProofErrorCode::ProofIatOutOfRange,
            ["issuedAt"],
            "proof issue time is outside the accepted policy window",
        ));
    }

    let key = decode_public_key(expected_signer_public_key, &["signerPublicKey"])?;
    input.validate_signer(&key)?;
    let digest = input.digest()?;
    let signature = decode_base64url::<64>(
        &proof.signature,
        &["proof", "signature"],
        SessionProofErrorCode::InvalidSignature,
    )?;
    key.verify_strict(&digest, &Signature::from_bytes(&signature))
        .map_err(|_| {
            proof_error(
                SessionProofErrorCode::InvalidSignature,
                ["proof", "signature"],
                "signature verification failed",
            )
        })?;

    Ok(())
}

fn parse_wire_proof(wire: WireSessionProof) -> Result<SessionProof, ProtocolError> {
    if wire.format != SESSION_PROOF_FORMAT_V1 {
        return Err(proof_error(
            SessionProofErrorCode::InvalidFormat,
            ["format"],
            format!("format must equal '{SESSION_PROOF_FORMAT_V1}'"),
        ));
    }
    decode_base64url::<64>(
        &wire.signature,
        &["signature"],
        SessionProofErrorCode::InvalidSignature,
    )?;
    Ok(SessionProof {
        format: wire.format,
        signature: wire.signature,
    })
}

fn proof_error<'a>(
    code: SessionProofErrorCode,
    tokens: impl IntoIterator<Item = &'a str>,
    message: impl Into<String>,
) -> ProtocolError {
    ProtocolError::SessionProof {
        code,
        path: Box::new(PointerBuf::from_tokens(tokens)),
        message: message.into(),
    }
}

fn sha256(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

fn encode_base64url(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

fn decode_base64url<const N: usize>(
    encoded: &str,
    path: &[&str],
    code: SessionProofErrorCode,
) -> Result<[u8; N], ProtocolError> {
    if encoded.contains('=') {
        return Err(proof_error(
            SessionProofErrorCode::InvalidEncoding,
            path.iter().copied(),
            "padded base64url is not accepted",
        ));
    }
    let decoded = URL_SAFE_NO_PAD.decode(encoded).map_err(|_| {
        proof_error(
            SessionProofErrorCode::InvalidEncoding,
            path.iter().copied(),
            "value is not unpadded base64url",
        )
    })?;
    if decoded.len() != N || encode_base64url(&decoded) != encoded {
        return Err(proof_error(
            code,
            path.iter().copied(),
            format!("value must canonically encode exactly {N} bytes"),
        ));
    }
    decoded.try_into().map_err(|_| {
        proof_error(
            code,
            path.iter().copied(),
            format!("value must encode exactly {N} bytes"),
        )
    })
}

fn decode_public_key(encoded: &str, path: &[&str]) -> Result<VerifyingKey, ProtocolError> {
    let key = VerifyingKey::from_bytes(&decode_base64url::<32>(
        encoded,
        path,
        SessionProofErrorCode::InvalidPublicKey,
    )?)
    .map_err(|_| {
        proof_error(
            SessionProofErrorCode::InvalidPublicKey,
            path.iter().copied(),
            "value is not a valid Ed25519 public key",
        )
    })?;
    if key.is_weak() {
        return Err(proof_error(
            SessionProofErrorCode::InvalidPublicKey,
            path.iter().copied(),
            "weak Ed25519 public keys are not accepted",
        ));
    }
    Ok(key)
}

fn derived_key_id(key: &VerifyingKey) -> String {
    encode_base64url(&sha256(key.as_bytes()))
}

fn validate_key_id(value: &str, path: &[&str]) -> Result<(), ProtocolError> {
    decode_base64url::<32>(value, path, SessionProofErrorCode::InvalidKeyId).map(|_| ())
}

fn validate_nkey(value: &str, path: &[&str]) -> Result<[u8; 32], ProtocolError> {
    let (kind, bytes) = nkeys::from_public_key(value).map_err(|_| {
        proof_error(
            SessionProofErrorCode::InvalidNatsKey,
            path.iter().copied(),
            "value is not a canonical NATS public key",
        )
    })?;
    if KeyPairType::from(kind) != KeyPairType::User {
        return Err(proof_error(
            SessionProofErrorCode::InvalidNatsKey,
            path.iter().copied(),
            "value must be a NATS User NKey",
        ));
    }
    Ok(bytes)
}

fn validate_nkey_binding(
    nkey: &str,
    key: &VerifyingKey,
    path: &[&str],
) -> Result<[u8; 32], ProtocolError> {
    let nkey_bytes = validate_nkey(nkey, path)?;
    if nkey_bytes == *key.as_bytes() {
        Ok(nkey_bytes)
    } else {
        Err(proof_error(
            SessionProofErrorCode::InvalidNatsKey,
            path.iter().copied(),
            "NATS User NKey does not encode the session public key",
        ))
    }
}

fn validate_safe_json_integers(value: &Value, path: &mut Vec<String>) -> Result<(), ProtocolError> {
    match value {
        Value::Number(number) => {
            let unsafe_integer = if let Some(value) = number.as_i64() {
                value.unsigned_abs() > MAXIMUM_SAFE_JSON_INTEGER as u64
            } else if let Some(value) = number.as_u64() {
                value > MAXIMUM_SAFE_JSON_INTEGER as u64
            } else {
                number.as_f64().is_some_and(|value| {
                    value.fract() == 0.0 && value.abs() > MAXIMUM_SAFE_JSON_INTEGER as f64
                })
            };
            if unsafe_integer {
                return Err(ProtocolError::SessionProof {
                    code: SessionProofErrorCode::UnsafeJsonInteger,
                    path: Box::new(PointerBuf::from_tokens(path.iter().map(String::as_str))),
                    message: "integer must be within the interoperable JSON safe-integer range"
                        .to_owned(),
                });
            }
        }
        Value::Array(values) => {
            for (index, value) in values.iter().enumerate() {
                path.push(index.to_string());
                validate_safe_json_integers(value, path)?;
                path.pop();
            }
        }
        Value::Object(values) => {
            for (name, value) in values {
                path.push(name.clone());
                validate_safe_json_integers(value, path)?;
                path.pop();
            }
        }
        Value::Null | Value::Bool(_) | Value::String(_) => {}
    }
    Ok(())
}

fn validate_safe_integer(value: i64, path: &[&str]) -> Result<(), ProtocolError> {
    if (-MAXIMUM_SAFE_JSON_INTEGER..=MAXIMUM_SAFE_JSON_INTEGER).contains(&value) {
        Ok(())
    } else {
        Err(proof_error(
            SessionProofErrorCode::UnsafeJsonInteger,
            path.iter().copied(),
            "integer must be within the interoperable JSON safe-integer range",
        ))
    }
}

fn validate_request_id(value: &str) -> Result<(), ProtocolError> {
    validate_text(value, &["requestId"])?;
    if value.len() <= MAXIMUM_REQUEST_ID_BYTES {
        Ok(())
    } else {
        Err(proof_error(
            SessionProofErrorCode::InvalidFormat,
            ["requestId"],
            "request ID exceeds 256 UTF-8 bytes",
        ))
    }
}

fn validate_text(value: &str, path: &[&str]) -> Result<(), ProtocolError> {
    if value.is_empty()
        || value.len() > MAXIMUM_TEXT_BYTES
        || value.trim() != value
        || value.chars().any(|character| character.is_ascii_control())
    {
        return Err(proof_error(
            SessionProofErrorCode::InvalidFormat,
            path.iter().copied(),
            "value must be bounded, nonempty protocol-safe text",
        ));
    }
    Ok(())
}

fn text(value: &str, path: &[&str]) -> Result<Vec<u8>, ProtocolError> {
    validate_text(value, path)?;
    Ok(value.as_bytes().to_vec())
}

fn digest(value: &str, path: &[&str]) -> Result<Vec<u8>, ProtocolError> {
    Ok(decode_base64url::<32>(value, path, SessionProofErrorCode::InvalidEncoding)?.to_vec())
}

fn optional_digest(value: Option<&str>, path: &[&str]) -> Result<Vec<u8>, ProtocolError> {
    value.map_or_else(|| Ok(Vec::new()), |value| digest(value, path))
}

fn push_length_prefixed(output: &mut Vec<u8>, bytes: &[u8]) -> Result<(), ProtocolError> {
    let length = u32::try_from(bytes.len()).map_err(|_| {
        proof_error(
            SessionProofErrorCode::InvalidFormat,
            std::iter::empty::<&str>(),
            "signature input component exceeds u32 length",
        )
    })?;
    output.extend_from_slice(&length.to_be_bytes());
    output.extend_from_slice(bytes);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const DIGEST: &str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    #[test]
    fn user_auth_bind_proof_is_bound_to_the_flow() -> Result<(), ProtocolError> {
        let signing_key = SigningKey::from_bytes(&[7; 32]);
        let public_key = encode_base64url(signing_key.verifying_key().as_bytes());
        let bind = |flow_id: &str| {
            SessionProofInput::user_auth_bind(UserAuthBindSessionProofInput {
                request_id: "01ARZ3NDEKTSV4RRFFQ69G5FAV".to_owned(),
                issued_at: 1_000,
                flow_id: flow_id.to_owned(),
                session_public_key: public_key.clone(),
                request_digest: DIGEST.to_owned(),
            })
        };
        let proof = sign_session_proof(&bind("flow_1")?, &signing_key)?;
        verify_session_proof(
            &bind("flow_1")?,
            &proof,
            &public_key,
            1_000,
            SessionProofPolicy::default(),
        )?;
        assert!(verify_session_proof(
            &bind("flow_2")?,
            &proof,
            &public_key,
            1_000,
            SessionProofPolicy::default(),
        )
        .is_err());
        assert!(
            SessionProofInput::user_auth_bind(UserAuthBindSessionProofInput {
                request_id: "req_bind_1".to_owned(),
                issued_at: 1_000,
                flow_id: "flow_1".to_owned(),
                session_public_key: public_key,
                request_digest: DIGEST.to_owned(),
            })
            .is_err()
        );
        Ok(())
    }

    #[test]
    fn authorization_context_refresh_requires_positive_manifest_floor() -> Result<(), ProtocolError>
    {
        assert!(SessionProofInput::authorization_context_refresh(
            AuthorizationContextRefreshSessionProofInput {
                request_id: "req_refresh_1".to_owned(),
                issued_at: 1_735_689_600_000,
                session_id: "ses_1".to_owned(),
                session_key_id: DIGEST.to_owned(),
                current_context_digest: None,
                expected_participant_digest: None,
                expected_needs_digest: None,
                known_root_key_id: DIGEST.to_owned(),
                minimum_manifest_generation: 0,
                request_digest: DIGEST.to_owned(),
            },
        )
        .is_err());
        Ok(())
    }

    #[test]
    fn canonical_request_digest_removes_only_signature() -> Result<(), ProtocolError> {
        let first = json!({
            "requestId": "req_1",
            "proof": {"format": SESSION_PROOF_FORMAT_V1, "signature": "first"},
            "nullable": null
        });
        let second = json!({
            "nullable": null,
            "proof": {"signature": "second", "format": SESSION_PROOF_FORMAT_V1},
            "requestId": "req_1"
        });
        assert_eq!(
            session_proof_request_digest(&first)?,
            session_proof_request_digest(&second)?
        );
        Ok(())
    }

    #[test]
    fn rejects_unsafe_request_integers_and_weak_keys() {
        let unsafe_request = json!({
            "proof": {
                "format": SESSION_PROOF_FORMAT_V1,
                "signature": encode_base64url(&[0; 64])
            },
            "nested": {"counter": 9_007_199_254_740_992_u64}
        });
        assert!(matches!(
            session_proof_request_digest(&unsafe_request),
            Err(ProtocolError::SessionProof {
                code: SessionProofErrorCode::UnsafeJsonInteger,
                ..
            })
        ));
        assert!(matches!(
            decode_public_key(&encode_base64url(&[0; 32]), &["sessionPublicKey"]),
            Err(ProtocolError::SessionProof {
                code: SessionProofErrorCode::InvalidPublicKey,
                ..
            })
        ));
    }

    fn vector_field<'a>(value: &'a Value, name: &str) -> &'a str {
        value[name]
            .as_str()
            .unwrap_or_else(|| panic!("missing vector field {name}"))
    }

    fn vector_time(value: &Value) -> i64 {
        value["issuedAt"].as_i64().expect("vector issuedAt")
    }

    fn vector_input(case: &Value) -> Result<SessionProofInput, ProtocolError> {
        let value = case.get("request").unwrap_or(&case["input"]);
        let request_digest = case["requestDigest"].as_str();
        match vector_field(case, "purpose") {
            "userAuthRequest" => {
                SessionProofInput::user_auth_request(UserAuthRequestSessionProofInput {
                    request_id: vector_field(value, "requestId").to_owned(),
                    issued_at: vector_time(value),
                    session_public_key: vector_field(value, "sessionPublicKey").to_owned(),
                    session_nkey: vector_field(value, "sessionNkey").to_owned(),
                    participant_id: vector_field(value, "participantId").to_owned(),
                    participant_digest: vector_field(value, "participantDigest").to_owned(),
                    redirect_target: vector_field(value, "redirectTarget").to_owned(),
                    request_digest: request_digest.expect("user request digest").to_owned(),
                })
            }
            "serviceBootstrap" => {
                SessionProofInput::service_bootstrap(ServiceBootstrapSessionProofInput {
                    request_id: vector_field(value, "requestId").to_owned(),
                    issued_at: vector_time(value),
                    deployment_id: vector_field(value, "deploymentId").to_owned(),
                    instance_id: vector_field(value, "instanceId").to_owned(),
                    provisioned_identity_key_id: vector_field(value, "provisionedIdentityKeyId")
                        .to_owned(),
                    new_session_public_key: vector_field(value, "newSessionPublicKey").to_owned(),
                    new_session_nkey: vector_field(value, "newSessionNkey").to_owned(),
                    participant_id: vector_field(value, "participantId").to_owned(),
                    participant_digest: vector_field(value, "participantDigest").to_owned(),
                    request_digest: request_digest.expect("service request digest").to_owned(),
                })
            }
            "deviceBootstrap" => {
                SessionProofInput::device_bootstrap(DeviceBootstrapSessionProofInput {
                    request_id: vector_field(value, "requestId").to_owned(),
                    issued_at: vector_time(value),
                    deployment_id: vector_field(value, "deploymentId").to_owned(),
                    instance_id: vector_field(value, "instanceId").to_owned(),
                    device_identity_key_id: vector_field(value, "deviceIdentityKeyId").to_owned(),
                    new_session_public_key: vector_field(value, "newSessionPublicKey").to_owned(),
                    new_session_nkey: vector_field(value, "newSessionNkey").to_owned(),
                    participant_id: vector_field(value, "participantId").to_owned(),
                    participant_digest: vector_field(value, "participantDigest").to_owned(),
                    challenge_digest: value["challengeDigest"].as_str().map(str::to_owned),
                    request_digest: request_digest.expect("device request digest").to_owned(),
                })
            }
            "authorizationContextRefresh" => SessionProofInput::authorization_context_refresh(
                AuthorizationContextRefreshSessionProofInput {
                    request_id: vector_field(value, "requestId").to_owned(),
                    issued_at: vector_time(value),
                    session_id: vector_field(value, "sessionId").to_owned(),
                    session_key_id: derived_key_id(&decode_public_key(
                        vector_field(case, "signerPublicKey"),
                        &["signerPublicKey"],
                    )?),
                    current_context_digest: value["currentContextDigest"]
                        .as_str()
                        .map(str::to_owned),
                    expected_participant_digest: value["expectedParticipantDigest"]
                        .as_str()
                        .map(str::to_owned),
                    expected_needs_digest: value["expectedNeedsDigest"].as_str().map(str::to_owned),
                    known_root_key_id: vector_field(value, "knownRootKeyId").to_owned(),
                    minimum_manifest_generation: value["minimumManifestGeneration"]
                        .as_i64()
                        .expect("minimum manifest generation"),
                    request_digest: request_digest
                        .expect("context refresh request digest")
                        .to_owned(),
                },
            ),
            purpose => panic!("unknown vector purpose {purpose}"),
        }
    }

    #[test]
    fn shared_vectors_match_rust() -> Result<(), ProtocolError> {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../../conformance/session-proof/vectors.json"
        ))?;
        let seed = decode_base64url::<32>(
            vector_field(&fixture, "identitySeed"),
            &["identitySeed"],
            SessionProofErrorCode::InvalidEncoding,
        )?;
        let signing_key = SigningKey::from_bytes(&seed);
        for case in fixture["cases"].as_array().expect("vector cases") {
            let value = case.get("request").unwrap_or(&case["input"]);
            if let Some(expected) = case["requestDigest"].as_str() {
                assert_eq!(session_proof_request_digest(value)?, expected);
            }
            let input = vector_input(case)?;
            let proof = parse_session_proof(&value["proof"])?;
            assert_eq!(sign_session_proof(&input, &signing_key)?, proof);
            verify_session_proof(
                &input,
                &proof,
                vector_field(case, "signerPublicKey"),
                input.issued_at(),
                SessionProofPolicy::default(),
            )?;
            assert_eq!(
                session_proof_signing_digest(&input)?,
                vector_field(case, "transcriptDigest")
            );
            assert_eq!(proof.signature(), vector_field(case, "signature"));
        }
        Ok(())
    }

    #[test]
    fn shared_invalid_vectors_cover_failures() -> Result<(), ProtocolError> {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../../conformance/session-proof/vectors.json"
        ))?;
        let cases = fixture["cases"].as_array().expect("vector cases");
        let find = |name: &str| {
            cases
                .iter()
                .find(|case| case["name"] == name)
                .unwrap_or_else(|| panic!("missing base vector {name}"))
        };
        let public_key = vector_field(&fixture, "identityPublicKey");
        for invalid in fixture["invalidCases"].as_array().expect("invalid cases") {
            let base = find(vector_field(invalid, "base"));
            let value = base.get("request").unwrap_or(&base["input"]);
            let proof = parse_session_proof(&value["proof"])?;
            let mutation = vector_field(invalid, "mutation");
            let error = match mutation {
                "devicePurpose" => {
                    let request = &base["request"];
                    let input =
                        SessionProofInput::device_bootstrap(DeviceBootstrapSessionProofInput {
                            request_id: vector_field(request, "requestId").to_owned(),
                            issued_at: vector_time(request),
                            deployment_id: vector_field(request, "deploymentId").to_owned(),
                            instance_id: vector_field(request, "instanceId").to_owned(),
                            device_identity_key_id: vector_field(
                                request,
                                "provisionedIdentityKeyId",
                            )
                            .to_owned(),
                            new_session_public_key: vector_field(request, "newSessionPublicKey")
                                .to_owned(),
                            new_session_nkey: vector_field(request, "newSessionNkey").to_owned(),
                            participant_id: vector_field(request, "participantId").to_owned(),
                            participant_digest: vector_field(request, "participantDigest")
                                .to_owned(),
                            challenge_digest: None,
                            request_digest: vector_field(base, "requestDigest").to_owned(),
                        })?;
                    verify_session_proof(
                        &input,
                        &proof,
                        public_key,
                        input.issued_at(),
                        SessionProofPolicy::default(),
                    )
                    .expect_err("wrong purpose must fail")
                }
                "identityAsNewSession" => {
                    let request = &base["request"];
                    let input =
                        SessionProofInput::service_bootstrap(ServiceBootstrapSessionProofInput {
                            request_id: vector_field(request, "requestId").to_owned(),
                            issued_at: vector_time(request),
                            deployment_id: vector_field(request, "deploymentId").to_owned(),
                            instance_id: vector_field(request, "instanceId").to_owned(),
                            provisioned_identity_key_id: vector_field(
                                request,
                                "provisionedIdentityKeyId",
                            )
                            .to_owned(),
                            new_session_public_key: vector_field(&fixture, "identityPublicKey")
                                .to_owned(),
                            new_session_nkey: vector_field(&fixture, "identityNkey").to_owned(),
                            participant_id: vector_field(request, "participantId").to_owned(),
                            participant_digest: vector_field(request, "participantDigest")
                                .to_owned(),
                            request_digest: vector_field(base, "requestDigest").to_owned(),
                        })?;
                    verify_session_proof(
                        &input,
                        &proof,
                        public_key,
                        input.issued_at(),
                        SessionProofPolicy::default(),
                    )
                    .expect_err("modified session must fail")
                }
                "participantDigest" | "deploymentId" | "instanceId" | "redirectTarget"
                | "requestId" => {
                    let mut changed = base.clone();
                    let request = changed["request"].as_object_mut().expect("request object");
                    let field = match mutation {
                        "participantDigest" => "participantDigest",
                        "deploymentId" => "deploymentId",
                        "instanceId" => "instanceId",
                        "redirectTarget" => "redirectTarget",
                        "requestId" => "requestId",
                        _ => unreachable!(),
                    };
                    request.insert(
                        field.to_owned(),
                        Value::String(if mutation == "participantDigest" {
                            "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE".to_owned()
                        } else {
                            format!("changed-{}", vector_field(value, field))
                        }),
                    );
                    let input = vector_input(&changed)?;
                    verify_session_proof(
                        &input,
                        &proof,
                        public_key,
                        input.issued_at(),
                        SessionProofPolicy::default(),
                    )
                    .expect_err("modified field must fail")
                }
                "paddedPublicKey" => {
                    let request = &base["request"];
                    SessionProofInput::user_auth_request(UserAuthRequestSessionProofInput {
                        request_id: vector_field(request, "requestId").to_owned(),
                        issued_at: vector_time(request),
                        session_public_key: format!(
                            "{}=",
                            vector_field(request, "sessionPublicKey")
                        ),
                        session_nkey: vector_field(request, "sessionNkey").to_owned(),
                        participant_id: vector_field(request, "participantId").to_owned(),
                        participant_digest: vector_field(request, "participantDigest").to_owned(),
                        redirect_target: vector_field(request, "redirectTarget").to_owned(),
                        request_digest: vector_field(base, "requestDigest").to_owned(),
                    })
                    .expect_err("padded public key must fail")
                }
                "signature" => {
                    let input = vector_input(base)?;
                    let bad = parse_session_proof(&json!({
                        "format": SESSION_PROOF_FORMAT_V1,
                        "signature": encode_base64url(&[0; 64])
                    }))?;
                    verify_session_proof(
                        &input,
                        &bad,
                        public_key,
                        input.issued_at(),
                        SessionProofPolicy::default(),
                    )
                    .expect_err("bad signature must fail")
                }
                "expiredNow" | "futureNow" => {
                    let input = vector_input(base)?;
                    let now = if mutation == "expiredNow" {
                        input.issued_at() + 30_001
                    } else {
                        input.issued_at() - 30_001
                    };
                    verify_session_proof(
                        &input,
                        &proof,
                        public_key,
                        now,
                        SessionProofPolicy::default(),
                    )
                    .expect_err("out-of-window proof must fail")
                }
                other => panic!("unknown invalid-vector mutation {other}"),
            };
            let code = match error {
                ProtocolError::SessionProof { code, .. } => format!("{code:?}"),
                other => panic!("unexpected error {other}"),
            };
            assert_eq!(code, vector_field(invalid, "expected"));
        }
        Ok(())
    }
}

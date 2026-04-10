use std::fs;
use std::path::PathBuf;

use serde::Deserialize;

use crate::proof::{base64url_encode, build_proof_input, sha256};
use crate::{verify_proof, SessionAuth};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthProofFixture {
    name: String,
    seed: String,
    session_key: String,
    oauth_init: DomainSigFixture,
    bind: DomainSigFixture,
    nats_connect: NatsConnectFixture,
    rpc_proof: RpcProofFixture,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DomainSigFixture {
    redirect_to: Option<String>,
    auth_token: Option<String>,
    sig: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NatsConnectFixture {
    binding_token: String,
    binding_token_sig: String,
    iat: u64,
    iat_sig: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RpcProofFixture {
    subject: String,
    payload: String,
    payload_hash_base64url: String,
    proof_input_hex: String,
    proof_digest_base64url: String,
    proof: String,
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        write!(&mut out, "{:02x}", byte).unwrap();
    }
    out
}

#[test]
fn auth_proof_matches_shared_conformance_vectors() {
    let fixture_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../conformance/auth-proof/vectors.json");
    let fixtures: Vec<AuthProofFixture> =
        serde_json::from_str(&fs::read_to_string(fixture_path).unwrap()).unwrap();

    assert!(fixtures.len() >= 2);

    for fixture in fixtures {
        assert!(fixture.name.starts_with("proof-layout-v1"));
        let auth = SessionAuth::from_seed_base64url(&fixture.seed).unwrap();
        assert_eq!(auth.session_key, fixture.session_key);

        assert_eq!(
            auth.sign_sha256_domain(
                "oauth-init",
                &format!(
                    "{}:null",
                    fixture.oauth_init.redirect_to.as_deref().unwrap()
                )
            ),
            fixture.oauth_init.sig
        );
        assert_eq!(
            auth.sign_sha256_domain("bind", fixture.bind.auth_token.as_deref().unwrap()),
            fixture.bind.sig
        );
        assert_eq!(
            auth.sign_sha256_domain("nats-connect", &fixture.nats_connect.binding_token),
            fixture.nats_connect.binding_token_sig
        );
        assert_eq!(
            auth.sign_sha256_domain("nats-connect", &fixture.nats_connect.iat.to_string()),
            fixture.nats_connect.iat_sig
        );

        let payload_hash = sha256(fixture.rpc_proof.payload.as_bytes());
        assert_eq!(
            base64url_encode(&payload_hash),
            fixture.rpc_proof.payload_hash_base64url
        );

        let proof_input = build_proof_input(
            &fixture.session_key,
            &fixture.rpc_proof.subject,
            &payload_hash,
        );
        assert_eq!(
            bytes_to_hex(&proof_input),
            fixture.rpc_proof.proof_input_hex
        );

        let proof_digest = sha256(&proof_input);
        assert_eq!(
            base64url_encode(&proof_digest),
            fixture.rpc_proof.proof_digest_base64url
        );

        assert_eq!(
            auth.create_proof(
                &fixture.rpc_proof.subject,
                fixture.rpc_proof.payload.as_bytes()
            ),
            fixture.rpc_proof.proof
        );

        assert!(verify_proof(
            &fixture.session_key,
            &fixture.rpc_proof.subject,
            fixture.rpc_proof.payload.as_bytes(),
            &fixture.rpc_proof.proof,
        )
        .unwrap());
    }
}

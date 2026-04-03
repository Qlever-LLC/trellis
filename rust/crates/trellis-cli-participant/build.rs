use std::env;
use std::fs;
use std::path::PathBuf;

use trellis_sdk_auth::contract::CONTRACT_JSON as AUTH_CONTRACT_JSON;
use trellis_sdk_core::contract::CONTRACT_JSON as CORE_CONTRACT_JSON;

include!("src/manifest_json.rs");

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("manifest dir"));
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("out dir")).join("generated");
    let contract_dir = out_dir.join("contracts");
    fs::create_dir_all(&contract_dir).expect("create generated contract dir");

    let cli_manifest_path = contract_dir.join("trellis.cli@v1.json");
    let auth_manifest_path = contract_dir.join("trellis.auth@v1.json");
    let core_manifest_path = contract_dir.join("trellis.core@v1.json");

    fs::write(&cli_manifest_path, CONTRACT_JSON).expect("write cli contract manifest");
    fs::write(&auth_manifest_path, AUTH_CONTRACT_JSON).expect("write auth contract manifest");
    fs::write(&core_manifest_path, CORE_CONTRACT_JSON).expect("write core contract manifest");

    println!("cargo:rerun-if-changed=src/manifest_json.rs");
    println!("cargo:rerun-if-changed=../../../generated/rust/sdks/auth/src/contract.rs");
    println!("cargo:rerun-if-changed=../../../generated/rust/sdks/trellis-core/src/contract.rs");

    trellis_codegen_rust::generate_rust_participant_generated_sources(
        &trellis_codegen_rust::GenerateRustParticipantFacadeOpts {
            manifest_path: cli_manifest_path,
            out_dir,
            crate_name: "trellis-cli-participant-generated".to_string(),
            crate_version: env::var("CARGO_PKG_VERSION").expect("pkg version"),
            runtime_deps: trellis_codegen_rust::RustRuntimeDeps {
                source: trellis_codegen_rust::RustRuntimeSource::Local,
                version: env::var("CARGO_PKG_VERSION").expect("pkg version"),
                repo_root: Some(manifest_dir.join("../..")),
            },
            owned_sdk_crate_name: None,
            owned_sdk_path: None,
            alias_mappings: vec![
                trellis_codegen_rust::ParticipantAliasMapping {
                    alias: "auth".to_string(),
                    crate_name: "trellis-sdk-auth".to_string(),
                    manifest_path: auth_manifest_path,
                    crate_path: Some(manifest_dir.join("../../../generated/rust/sdks/auth")),
                },
                trellis_codegen_rust::ParticipantAliasMapping {
                    alias: "core".to_string(),
                    crate_name: "trellis-sdk-core".to_string(),
                    manifest_path: core_manifest_path,
                    crate_path: Some(
                        manifest_dir.join("../../../generated/rust/sdks/trellis-core"),
                    ),
                },
            ],
        },
    )
    .expect("generate cli participant facade");
}

use std::env;
use std::path::PathBuf;

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("manifest dir"));
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("out dir")).join("generated");

    println!("cargo:rerun-if-changed=trellis.cli@v1.json");
    println!("cargo:rerun-if-changed=trellis.auth@v1.json");
    println!("cargo:rerun-if-changed=trellis.core@v1.json");

    trellis_codegen_rust::generate_rust_participant_generated_sources(
        &trellis_codegen_rust::GenerateRustParticipantFacadeOpts {
            manifest_path: manifest_dir.join("trellis.cli@v1.json"),
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
                    manifest_path: manifest_dir.join("trellis.auth@v1.json"),
                },
                trellis_codegen_rust::ParticipantAliasMapping {
                    alias: "core".to_string(),
                    crate_name: "trellis-sdk-core".to_string(),
                    manifest_path: manifest_dir.join("trellis.core@v1.json"),
                },
            ],
        },
    )
    .expect("generate cli participant facade");
}

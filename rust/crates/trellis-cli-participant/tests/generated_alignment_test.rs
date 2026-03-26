#[test]
fn generated_facade_still_matches_cli_alias_shape() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let manifest_path = temp_dir.path().join("trellis.cli@v1.json");
    let auth_manifest = temp_dir.path().join("trellis.auth@v1.json");
    let core_manifest = temp_dir.path().join("trellis.core@v1.json");
    std::fs::write(
        &manifest_path,
        format!("{}\n", trellis_cli_participant::contract::contract_json()),
    )
    .expect("write manifest");
    std::fs::write(
        &auth_manifest,
        format!("{}\n", trellis_sdk_auth::contract::CONTRACT_JSON),
    )
    .expect("write auth manifest");
    std::fs::write(
        &core_manifest,
        format!("{}\n", trellis_sdk_core::contract::CONTRACT_JSON),
    )
    .expect("write core manifest");

    trellis_codegen_rust::generate_rust_participant_facade(
        &trellis_codegen_rust::GenerateRustParticipantFacadeOpts {
            manifest_path,
            out_dir: temp_dir.path().join("generated"),
            crate_name: "trellis-cli-participant-generated".to_string(),
            crate_version: "0.1.0".to_string(),
            runtime_deps: trellis_codegen_rust::RustRuntimeDeps {
                source: trellis_codegen_rust::RustRuntimeSource::Local,
                version: "0.1.0".to_string(),
                repo_root: Some(
                    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../.."),
                ),
            },
            owned_sdk_crate_name: None,
            owned_sdk_path: None,
            alias_mappings: vec![
                trellis_codegen_rust::ParticipantAliasMapping {
                    alias: "auth".to_string(),
                    crate_name: "trellis-sdk-auth".to_string(),
                    manifest_path: auth_manifest,
                    crate_path: Some(
                        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                            .join("../trellis-sdk-auth"),
                    ),
                },
                trellis_codegen_rust::ParticipantAliasMapping {
                    alias: "core".to_string(),
                    crate_name: "trellis-sdk-core".to_string(),
                    manifest_path: core_manifest,
                    crate_path: Some(
                        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                            .join("../trellis-sdk-core"),
                    ),
                },
            ],
        },
    )
    .expect("generate participant facade");

    let cargo_toml = std::fs::read_to_string(temp_dir.path().join("generated/Cargo.toml"))
        .expect("read cargo toml");
    let build_rs = std::fs::read_to_string(temp_dir.path().join("generated/build.rs"))
        .expect("read build script");
    let lib_rs = std::fs::read_to_string(temp_dir.path().join("generated/src/lib.rs"))
        .expect("read generated lib");

    assert!(cargo_toml.contains("build = \"build.rs\""));
    assert!(build_rs.contains("generate_rust_participant_generated_sources"));
    assert!(lib_rs.contains("generated/src/facade.rs"));
    assert!(temp_dir
        .path()
        .join("generated/contracts/auth.json")
        .exists());
    assert!(temp_dir
        .path()
        .join("generated/contracts/core.json")
        .exists());
}

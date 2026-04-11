use std::fs;
use std::path::PathBuf;

fn main() {
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("manifest dir"));
    let embedded_dir = manifest_dir.join("schemas");
    let shared_dir = manifest_dir.join("../../../js/packages/contracts/schemas");

    println!("cargo:rerun-if-changed={}", embedded_dir.display());
    println!("cargo:rerun-if-changed={}", shared_dir.display());

    if !shared_dir.exists() {
        return;
    }

    for schema_name in [
        "trellis.contract.v1.schema.json",
        "trellis.catalog.v1.schema.json",
    ] {
        let embedded = fs::read_to_string(embedded_dir.join(schema_name)).unwrap_or_else(|error| {
            panic!("failed to read embedded schema {schema_name}: {error}")
        });
        let shared = fs::read_to_string(shared_dir.join(schema_name))
            .unwrap_or_else(|error| panic!("failed to read shared schema {schema_name}: {error}"));

        if embedded != shared {
            panic!(
                "embedded schema {schema_name} is out of sync with js/packages/contracts/schemas; copy the shared schema into rust/crates/contracts/schemas"
            );
        }
    }
}

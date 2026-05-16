use std::env;
use std::path::{Path, PathBuf};

use miette::{miette, Result};

pub(crate) fn repo_root() -> Result<PathBuf> {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    for ancestor in manifest_dir.ancestors() {
        if ancestor.join("rust/tools/generate/Cargo.toml").exists()
            && ancestor.join("js/deno.json").exists()
        {
            return Ok(ancestor.to_path_buf());
        }
    }
    Err(miette!(
        "failed to resolve repository root from integration harness manifest"
    ))
}

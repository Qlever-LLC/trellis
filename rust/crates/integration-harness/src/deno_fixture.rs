use std::path::{Path, PathBuf};

use miette::{miette, IntoDiagnostic, Result, WrapErr};

use crate::workspace::repo_root;

pub(crate) fn deno_fixture_path(relative_path: &str) -> Result<PathBuf> {
    if relative_path.contains("..") || Path::new(relative_path).is_absolute() {
        return Err(miette!("invalid Deno fixture path `{relative_path}`"));
    }
    let path = repo_root()?
        .join("rust/crates/integration-harness/fixtures")
        .join(relative_path);
    if path.extension().and_then(|extension| extension.to_str()) != Some("ts") {
        return Err(miette!(
            "Deno fixture path must point at a .ts file: {relative_path}"
        ));
    }
    if !path.exists() {
        return Err(miette!("Deno fixture does not exist: {}", path.display()));
    }
    Ok(path)
}

pub(crate) fn deno_fixture_log_paths(name: &str) -> Result<(PathBuf, PathBuf)> {
    Ok((
        deno_fixture_log_path(name, "stdout")?,
        deno_fixture_log_path(name, "stderr")?,
    ))
}

fn deno_fixture_log_path(name: &str, stream: &str) -> Result<PathBuf> {
    let sanitized_name = sanitize_fixture_name(name);
    let file = tempfile::Builder::new()
        .prefix(&format!("trellis-integration-{sanitized_name}-"))
        .suffix(&format!(".{stream}.log"))
        .tempfile()
        .into_diagnostic()
        .wrap_err_with(|| format!("failed to create Deno fixture {stream} log"))?;
    file.keep().map(|(_, path)| path).map_err(|error| {
        miette!(
            "failed to persist Deno fixture log {}: {}",
            error.file.path().display(),
            error.error
        )
    })
}

fn sanitize_fixture_name(name: &str) -> String {
    let mut sanitized = String::new();
    let mut previous_was_dash = false;
    for character in name.chars() {
        let safe = matches!(character, 'a'..='z' | 'A'..='Z' | '0'..='9' | '_' | '-');
        if safe {
            sanitized.push(character);
            previous_was_dash = false;
        } else if !previous_was_dash {
            sanitized.push('-');
            previous_was_dash = true;
        }
    }
    let sanitized = sanitized.trim_matches('-');
    if sanitized.is_empty() {
        "fixture".to_string()
    } else {
        sanitized.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::{deno_fixture_log_paths, deno_fixture_path};

    #[test]
    fn deno_fixture_path_resolves_checked_fixture() {
        let path = deno_fixture_path("rpc/client.ts").expect("resolve fixture");

        assert!(path.ends_with("rust/crates/integration-harness/fixtures/rpc/client.ts"));
    }

    #[test]
    fn deno_fixture_path_rejects_parent_traversal() {
        let error = deno_fixture_path("../client.ts").expect_err("path should fail");

        assert!(error.to_string().contains("invalid Deno fixture path"));
    }

    #[test]
    fn deno_fixture_log_paths_create_temp_logs() {
        let (stdout, stderr) = deno_fixture_log_paths("../bad name").expect("log paths");

        assert!(stdout
            .file_name()
            .unwrap()
            .to_string_lossy()
            .contains("bad-name"));
        assert!(stdout.ends_with(stdout.file_name().unwrap()));
        assert!(stderr
            .file_name()
            .unwrap()
            .to_string_lossy()
            .ends_with(".stderr.log"));
        let _ = std::fs::remove_file(stdout);
        let _ = std::fs::remove_file(stderr);
    }
}

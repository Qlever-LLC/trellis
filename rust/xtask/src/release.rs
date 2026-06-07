use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use miette::{miette, IntoDiagnostic, Result, WrapErr};

const RELEASE_JS_INTERNAL_NPM_VERSION_FILES: &[&str] = &[
    "js/packages/trellis/scripts/build_npm.ts",
    "js/packages/trellis-svelte/scripts/build_npm.ts",
    "js/packages/trellis/tests/publishing_targets_test.ts",
];

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) enum ReleaseCommand {
    CheckVersions,
    Prepare {
        tag: Option<String>,
    },
    Bump {
        from: String,
        to: String,
    },
    ChangelogCheck {
        version: String,
        since: Option<String>,
    },
    WriteNotes {
        tag: String,
        output: PathBuf,
    },
    CheckMetadata {
        version: Option<String>,
        since: Option<String>,
    },
    PretagCheck {
        tag: String,
        git_ref: String,
    },
    Verify {
        version: String,
        since: String,
        skip_integration: bool,
        keep_workdir: bool,
    },
}

pub(crate) fn parse_release_command<I>(mut args: I) -> Result<ReleaseCommand>
where
    I: Iterator<Item = String>,
{
    match args.next().as_deref() {
        Some("check-versions") => {
            reject_extra(args, "release check-versions").map(|()| ReleaseCommand::CheckVersions)
        }
        Some("prepare") => parse_prepare(args),
        Some("bump") => parse_bump(args),
        Some("changelog-check") => parse_changelog_check(args),
        Some("write-notes") => parse_write_notes(args),
        Some("check-metadata") => parse_check_metadata(args),
        Some("pretag-check") => parse_pretag_check(args),
        Some("verify") => parse_verify(args),
        Some(command) => Err(miette!(
            "unsupported release command `{command}`\n{}",
            release_usage_text()
        )),
        None => Err(miette!(release_usage_text())),
    }
}

pub(crate) fn release_usage_text() -> &'static str {
    "usage: cargo xtask release check-versions | cargo xtask release prepare [--tag <tag>] | cargo xtask release bump --from <version> --to <version> | cargo xtask release changelog-check --version <version> [--since <tag>] | cargo xtask release write-notes --tag <tag> --output <path> | cargo xtask release check-metadata [--version <version>] [--since <tag>] | cargo xtask release pretag-check --tag <tag> [--ref <ref>] | cargo xtask release verify --version <version> --since <tag> [--skip-integration] [--keep-workdir]"
}

pub(crate) fn run_release(repo_root: &Path, command: ReleaseCommand) -> Result<()> {
    match command {
        ReleaseCommand::CheckVersions => {
            let version = check_versions(repo_root)?;
            println!("All release-managed Trellis versions are {version}.");
            Ok(())
        }
        ReleaseCommand::Prepare { tag } => {
            let Some(tag) = tag.filter(|tag| !tag.trim().is_empty()) else {
                println!("release tag is not set; skipping release version preparation.");
                return Ok(());
            };
            let release = parse_release_tag(&tag)?;
            let changed = prepare_release(repo_root, &release)?;
            write_github_env("TRELLIS_RELEASE_VERSION", &release.version)?;
            write_github_env("TRELLIS_RELEASE_BASE_VERSION", &release.base_version)?;
            println!(
                "Prepared release version {} from tag {tag} in {} file(s).",
                release.version,
                changed.len()
            );
            for path in changed {
                println!("- {}", display_repo_path(repo_root, &path));
            }
            Ok(())
        }
        ReleaseCommand::Bump { from, to } => {
            require_stable_version(&from, "--from")?;
            require_stable_version(&to, "--to")?;
            let changed = bump_versions(repo_root, &from, &to)?;
            println!(
                "Bumped release-managed Trellis versions from {from} to {to} in {} file(s).",
                changed.len()
            );
            for path in changed {
                println!("- {}", display_repo_path(repo_root, &path));
            }
            Ok(())
        }
        ReleaseCommand::ChangelogCheck { version, since } => {
            check_changelog(repo_root, &version, since.as_deref())?;
            Ok(())
        }
        ReleaseCommand::WriteNotes { tag, output } => {
            let release = parse_release_tag(&tag)?;
            write_release_notes(repo_root, &release.version, &output)?;
            println!("Wrote release notes for {tag} to {}.", output.display());
            Ok(())
        }
        ReleaseCommand::CheckMetadata { version, since } => {
            let checked_version = check_versions(repo_root)?;
            if let Some(version) = version {
                let version_base = version_base(&version)?;
                if version != checked_version && version_base != checked_version {
                    return Err(miette!(
                        "requested release version {version} has base version {version_base}, but release-managed versions use {checked_version}"
                    ));
                }
                check_changelog(repo_root, &version, since.as_deref())?;
            }
            println!("Release metadata verification passed for {checked_version}.");
            println!(
                "Before publishing, run `release verify` locally or use the GitHub release gate."
            );
            Ok(())
        }
        ReleaseCommand::PretagCheck { tag, git_ref } => run_pretag_check(repo_root, &tag, &git_ref),
        ReleaseCommand::Verify {
            version,
            since,
            skip_integration,
            keep_workdir,
        } => run_verify(repo_root, &version, &since, skip_integration, keep_workdir),
    }
}

fn parse_prepare<I>(args: I) -> Result<ReleaseCommand>
where
    I: Iterator<Item = String>,
{
    let options = parse_options(args, &["tag"])?;
    Ok(ReleaseCommand::Prepare {
        tag: options.get("tag").cloned(),
    })
}

fn parse_bump<I>(args: I) -> Result<ReleaseCommand>
where
    I: Iterator<Item = String>,
{
    let options = parse_options(args, &["from", "to"])?;
    let from = required_option(&options, "from")?;
    let to = required_option(&options, "to")?;
    Ok(ReleaseCommand::Bump { from, to })
}

fn parse_changelog_check<I>(args: I) -> Result<ReleaseCommand>
where
    I: Iterator<Item = String>,
{
    let options = parse_options(args, &["version", "since"])?;
    let version = required_option(&options, "version")?;
    let since = options.get("since").cloned();
    Ok(ReleaseCommand::ChangelogCheck { version, since })
}

fn parse_write_notes<I>(args: I) -> Result<ReleaseCommand>
where
    I: Iterator<Item = String>,
{
    let options = parse_options(args, &["tag", "output"])?;
    let tag = required_option(&options, "tag")?;
    let output = PathBuf::from(required_option(&options, "output")?);
    Ok(ReleaseCommand::WriteNotes { tag, output })
}

fn parse_check_metadata<I>(args: I) -> Result<ReleaseCommand>
where
    I: Iterator<Item = String>,
{
    let options = parse_options(args, &["version", "since"])?;
    Ok(ReleaseCommand::CheckMetadata {
        version: options.get("version").cloned(),
        since: options.get("since").cloned(),
    })
}

fn parse_pretag_check<I>(args: I) -> Result<ReleaseCommand>
where
    I: Iterator<Item = String>,
{
    let options = parse_options(args, &["tag", "ref"])?;
    let tag = required_option(&options, "tag")?;
    parse_release_tag(&tag)?;
    Ok(ReleaseCommand::PretagCheck {
        tag,
        git_ref: options
            .get("ref")
            .filter(|value| !value.trim().is_empty())
            .cloned()
            .unwrap_or_else(|| "main".to_string()),
    })
}

fn parse_verify<I>(args: I) -> Result<ReleaseCommand>
where
    I: Iterator<Item = String>,
{
    let mut version = None;
    let mut since = None;
    let mut skip_integration = false;
    let mut keep_workdir = false;
    let mut args = args.peekable();

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--version" => version = Some(next_option_value(&mut args, &arg)?),
            "--since" => since = Some(next_option_value(&mut args, &arg)?),
            "--skip-integration" => skip_integration = true,
            "--keep-workdir" => keep_workdir = true,
            _ if arg.starts_with("--") => {
                return Err(miette!("unknown option `{arg}`\n{}", release_usage_text()));
            }
            _ => {
                return Err(miette!(
                    "unexpected argument `{arg}`\n{}",
                    release_usage_text()
                ));
            }
        }
    }

    let version = version.ok_or_else(|| miette!("missing required option `--version`"))?;
    version_base(&version)?;
    let since = since.ok_or_else(|| miette!("missing required option `--since`"))?;
    parse_release_tag(&since)?;
    Ok(ReleaseCommand::Verify {
        version,
        since,
        skip_integration,
        keep_workdir,
    })
}

fn next_option_value<I>(args: &mut std::iter::Peekable<I>, option: &str) -> Result<String>
where
    I: Iterator<Item = String>,
{
    let value = args
        .next()
        .ok_or_else(|| miette!("missing value for `{option}`"))?;
    if value.starts_with("--") {
        return Err(miette!("missing value for `{option}`"));
    }
    Ok(value)
}

fn parse_options<I>(mut args: I, allowed: &[&str]) -> Result<BTreeMap<String, String>>
where
    I: Iterator<Item = String>,
{
    let mut options = BTreeMap::new();
    while let Some(arg) = args.next() {
        let Some(name) = arg.strip_prefix("--") else {
            return Err(miette!(
                "unexpected argument `{arg}`\n{}",
                release_usage_text()
            ));
        };
        if !allowed.contains(&name) {
            return Err(miette!("unknown option `{arg}`\n{}", release_usage_text()));
        }
        let value = args
            .next()
            .ok_or_else(|| miette!("missing value for `{arg}`"))?;
        if value.starts_with("--") {
            return Err(miette!("missing value for `{arg}`"));
        }
        options.insert(name.to_string(), value);
    }
    Ok(options)
}

fn required_option(options: &BTreeMap<String, String>, name: &str) -> Result<String> {
    options
        .get(name)
        .cloned()
        .ok_or_else(|| miette!("missing required option `--{name}`"))
}

fn reject_extra<I>(mut args: I, command: &str) -> Result<()>
where
    I: Iterator<Item = String>,
{
    if let Some(extra) = args.next() {
        return Err(miette!(
            "unexpected argument `{extra}` for {command}\n{}",
            release_usage_text()
        ));
    }
    Ok(())
}

fn check_versions(repo_root: &Path) -> Result<String> {
    let versions = collect_versions(repo_root)?;
    if versions.is_empty() {
        return Err(miette!("no release-managed Trellis versions were found"));
    }
    let expected = versions[0].version.clone();
    let mismatches: Vec<_> = versions
        .iter()
        .filter(|entry| entry.version != expected)
        .collect();
    if !mismatches.is_empty() {
        let mut message =
            format!("release-managed Trellis versions are inconsistent; expected {expected}");
        for mismatch in mismatches {
            message.push_str(&format!("\n- {} uses {}", mismatch.label, mismatch.version));
        }
        return Err(miette!(message));
    }
    Ok(expected)
}

fn bump_versions(repo_root: &Path, from: &str, to: &str) -> Result<Vec<PathBuf>> {
    let mut changed = Vec::new();
    for path in release_manifest_paths(repo_root)? {
        let original = fs::read_to_string(&path)
            .into_diagnostic()
            .wrap_err_with(|| format!("failed to read {}", path.display()))?;
        let updated = if is_json_manifest(&path) {
            rewrite_json_manifest_version(&original, from, to, &path)?
        } else if path.file_name().is_some_and(|name| name == "Cargo.toml") {
            rewrite_cargo_manifest_versions(&original, from, to, &path)?
        } else if is_release_js_internal_npm_version_file(repo_root, &path) {
            rewrite_js_internal_npm_dependency_versions(&original, from, to, &path)?
        } else {
            original.clone()
        };
        if updated != original {
            fs::write(&path, updated)
                .into_diagnostic()
                .wrap_err_with(|| format!("failed to write {}", path.display()))?;
            changed.push(path);
        }
    }
    Ok(changed)
}

fn prepare_release(repo_root: &Path, release: &ReleaseVersion) -> Result<Vec<PathBuf>> {
    let mut changed = Vec::new();
    for path in release_manifest_paths(repo_root)? {
        let original = fs::read_to_string(&path)
            .into_diagnostic()
            .wrap_err_with(|| format!("failed to read {}", path.display()))?;
        let updated = if is_json_manifest(&path) {
            rewrite_json_manifest_version_for_release(
                &original,
                &release.version,
                &release.base_version,
                &path,
            )?
        } else if path.file_name().is_some_and(|name| name == "Cargo.toml") {
            rewrite_cargo_manifest_versions_for_release(
                &original,
                &release.version,
                &release.base_version,
                &path,
            )?
        } else {
            original.clone()
        };
        if updated != original {
            fs::write(&path, updated)
                .into_diagnostic()
                .wrap_err_with(|| format!("failed to write {}", path.display()))?;
            changed.push(path);
        }
    }
    Ok(changed)
}

fn collect_versions(repo_root: &Path) -> Result<Vec<VersionEntry>> {
    let mut versions = Vec::new();
    for path in release_manifest_paths(repo_root)? {
        let contents = fs::read_to_string(&path)
            .into_diagnostic()
            .wrap_err_with(|| format!("failed to read {}", path.display()))?;
        if is_json_manifest(&path) {
            if let Some(version) = json_manifest_version(&contents) {
                if version != "0.0.0" {
                    versions.push(VersionEntry::new(
                        display_repo_path(repo_root, &path),
                        version,
                    ));
                }
            }
            continue;
        }

        if path.file_name().is_some_and(|name| name == "Cargo.toml") {
            collect_cargo_versions(repo_root, &path, &contents, &mut versions);
            continue;
        }

        if is_release_js_internal_npm_version_file(repo_root, &path) {
            collect_js_internal_npm_versions(repo_root, &path, &contents, &mut versions);
        }
    }
    Ok(versions)
}

fn release_manifest_paths(repo_root: &Path) -> Result<Vec<PathBuf>> {
    let mut paths = Vec::new();
    collect_manifest_paths(&repo_root.join("generated"), &mut paths)?;
    collect_manifest_paths(&repo_root.join("js"), &mut paths)?;
    collect_manifest_paths(&repo_root.join("rust"), &mut paths)?;
    for relative_path in RELEASE_JS_INTERNAL_NPM_VERSION_FILES {
        let path = repo_root.join(relative_path);
        if path.exists() {
            paths.push(path);
        }
    }
    paths.sort();
    paths.dedup();
    Ok(paths)
}

fn is_release_js_internal_npm_version_file(repo_root: &Path, path: &Path) -> bool {
    path.strip_prefix(repo_root)
        .ok()
        .and_then(Path::to_str)
        .is_some_and(|relative| RELEASE_JS_INTERNAL_NPM_VERSION_FILES.contains(&relative))
}

fn collect_manifest_paths(dir: &Path, paths: &mut Vec<PathBuf>) -> Result<()> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(dir)
        .into_diagnostic()
        .wrap_err_with(|| format!("failed to read directory {}", dir.display()))?
    {
        let entry = entry.into_diagnostic()?;
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if entry.file_type().into_diagnostic()?.is_dir() {
            if matches!(
                name.as_ref(),
                ".git" | "node_modules" | ".svelte-kit" | "target"
            ) {
                continue;
            }
            collect_manifest_paths(&path, paths)?;
            continue;
        }
        if is_json_manifest(&path) || path.file_name().is_some_and(|file| file == "Cargo.toml") {
            paths.push(path);
        }
    }
    Ok(())
}

fn is_json_manifest(path: &Path) -> bool {
    path.file_name().is_some_and(|name| {
        matches!(
            name.to_string_lossy().as_ref(),
            "deno.json" | "deno.npm.json" | "package.json"
        )
    })
}

fn json_manifest_version(contents: &str) -> Option<String> {
    for line in contents.lines() {
        if !line.contains("\"version\"") {
            continue;
        }
        let colon = line.find(':')?;
        let after_colon = &line[colon + 1..];
        let start = after_colon.find('"')? + colon + 2;
        let end = line[start..].find('"')? + start;
        return Some(line[start..end].to_string());
    }
    None
}

fn rewrite_json_manifest_version(
    contents: &str,
    from: &str,
    to: &str,
    path: &Path,
) -> Result<String> {
    let Some(version) = json_manifest_version(contents) else {
        return Ok(contents.to_string());
    };
    if version == "0.0.0" {
        return Ok(contents.to_string());
    }
    if version != from {
        return Err(miette!(
            "{} uses version {}, expected {from}",
            path.display(),
            version
        ));
    }
    Ok(replace_first_version_literal(contents, &version, to))
}

fn rewrite_json_manifest_version_for_release(
    contents: &str,
    release_version: &str,
    expected_base_version: &str,
    path: &Path,
) -> Result<String> {
    let Some(version) = json_manifest_version(contents) else {
        return Ok(contents.to_string());
    };
    let actual_base_version = version_base(&version)?;
    if actual_base_version == "0.0.0" {
        return Ok(contents.to_string());
    }
    if actual_base_version != expected_base_version {
        return Err(miette!(
            "{} uses version {}, but release tag requires base version {expected_base_version}",
            path.display(),
            version
        ));
    }
    if version == release_version {
        return Ok(contents.to_string());
    }
    Ok(replace_first_version_literal(
        contents,
        &version,
        release_version,
    ))
}

fn collect_js_internal_npm_versions(
    repo_root: &Path,
    path: &Path,
    contents: &str,
    versions: &mut Vec<VersionEntry>,
) {
    for line in contents.lines() {
        let trimmed = line.trim();
        let Some((name, spec)) = json_like_string_property(trimmed) else {
            continue;
        };
        if !is_internal_npm_package(&name) {
            continue;
        }
        if let Some(version) = npm_dependency_spec_version(&spec) {
            versions.push(VersionEntry::new(
                format!("{} dependency {name}", display_repo_path(repo_root, path)),
                version,
            ));
        }
    }
}

fn rewrite_js_internal_npm_dependency_versions(
    contents: &str,
    from: &str,
    to: &str,
    path: &Path,
) -> Result<String> {
    let mut lines = Vec::new();
    for line in contents.lines() {
        let trimmed = line.trim();
        let Some((name, spec)) = json_like_string_property(trimmed) else {
            lines.push(line.to_string());
            continue;
        };
        if !is_internal_npm_package(&name) {
            lines.push(line.to_string());
            continue;
        }

        let Some(version) = npm_dependency_spec_version(&spec) else {
            lines.push(line.to_string());
            continue;
        };
        if version != from {
            return Err(miette!(
                "{} dependency {name} uses version {}, expected {from}",
                path.display(),
                version
            ));
        }

        let replacement = replace_npm_dependency_spec_version(&spec, to);
        lines.push(line.replacen(&format!("\"{spec}\""), &format!("\"{replacement}\""), 1));
    }
    let mut updated = lines.join("\n");
    if contents.ends_with('\n') {
        updated.push('\n');
    }
    Ok(updated)
}

fn json_like_string_property(trimmed: &str) -> Option<(String, String)> {
    let property_start = trimmed.find("\"@qlever-llc/")?;
    let rest = trimmed[property_start..].strip_prefix('"')?;
    let (name, after_name) = rest.split_once('"')?;
    let after_colon = after_name.trim_start().strip_prefix(':')?.trim_start();
    let value_rest = after_colon.strip_prefix('"')?;
    let (value, _) = value_rest.split_once('"')?;
    Some((name.to_string(), value.to_string()))
}

fn npm_dependency_spec_version(spec: &str) -> Option<String> {
    let version = spec.strip_prefix(['^', '~']).unwrap_or(spec);
    is_stable_semver(version).then(|| version.to_string())
}

fn replace_npm_dependency_spec_version(spec: &str, version: &str) -> String {
    let prefix = spec
        .chars()
        .next()
        .filter(|ch| matches!(ch, '^' | '~'))
        .map(|ch| ch.to_string())
        .unwrap_or_default();
    format!("{prefix}{version}")
}

fn replace_first_version_literal(contents: &str, from: &str, to: &str) -> String {
    let target = format!("\"version\": \"{from}\"");
    let replacement = format!("\"version\": \"{to}\"");
    if contents.contains(&target) {
        return contents.replacen(&target, &replacement, 1);
    }
    contents.replacen(
        &format!("\"version\":\"{from}\""),
        &format!("\"version\":\"{to}\""),
        1,
    )
}

fn collect_cargo_versions(
    repo_root: &Path,
    path: &Path,
    contents: &str,
    versions: &mut Vec<VersionEntry>,
) {
    let package_name = cargo_package_name(contents);
    let mut section = CargoSection::Other;
    for line in contents.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            section = match trimmed {
                "[package]" => CargoSection::Package,
                "[workspace.package]" => CargoSection::WorkspacePackage,
                _ => CargoSection::Other,
            };
            continue;
        }
        if matches!(section, CargoSection::WorkspacePackage) {
            if let Some(version) = cargo_version_assignment(trimmed) {
                versions.push(VersionEntry::new(
                    "rust workspace version".to_string(),
                    version,
                ));
            }
        }
        if matches!(section, CargoSection::Package)
            && package_name.as_deref().is_some_and(is_internal_rust_crate)
        {
            if let Some(version) = cargo_version_assignment(trimmed) {
                versions.push(VersionEntry::new(
                    format!("{} package version", display_repo_path(repo_root, path)),
                    version,
                ));
            }
        }
        if let Some((name, version)) = cargo_inline_dependency_version(trimmed) {
            if is_internal_rust_crate(&name) {
                versions.push(VersionEntry::new(
                    format!("{} dependency {name}", display_repo_path(repo_root, path)),
                    version,
                ));
            }
        }
    }
}

fn rewrite_cargo_manifest_versions(
    contents: &str,
    from: &str,
    to: &str,
    path: &Path,
) -> Result<String> {
    let package_name = cargo_package_name(contents);
    let mut section = CargoSection::Other;
    let mut lines = Vec::new();
    for line in contents.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            section = match trimmed {
                "[package]" => CargoSection::Package,
                "[workspace.package]" => CargoSection::WorkspacePackage,
                _ => CargoSection::Other,
            };
            lines.push(line.to_string());
            continue;
        }

        let should_update_package_version = matches!(section, CargoSection::WorkspacePackage)
            || (matches!(section, CargoSection::Package)
                && package_name.as_deref().is_some_and(is_internal_rust_crate));
        if should_update_package_version {
            if let Some(version) = cargo_version_assignment(trimmed) {
                if version != from {
                    return Err(miette!(
                        "{} uses version {}, expected {from}",
                        path.display(),
                        version
                    ));
                }
                lines.push(line.replacen(&format!("\"{from}\""), &format!("\"{to}\""), 1));
                continue;
            }
        }

        if let Some((name, version)) = cargo_inline_dependency_version(trimmed) {
            if is_internal_rust_crate(&name) {
                if version != from {
                    return Err(miette!(
                        "{} dependency {name} uses version {}, expected {from}",
                        path.display(),
                        version
                    ));
                }
                lines.push(line.replacen(
                    &format!("version = \"{from}\""),
                    &format!("version = \"{to}\""),
                    1,
                ));
                continue;
            }
        }
        lines.push(line.to_string());
    }
    let mut updated = lines.join("\n");
    if contents.ends_with('\n') {
        updated.push('\n');
    }
    Ok(updated)
}

fn rewrite_cargo_manifest_versions_for_release(
    contents: &str,
    release_version: &str,
    expected_base_version: &str,
    path: &Path,
) -> Result<String> {
    let package_name = cargo_package_name(contents);
    let mut section = CargoSection::Other;
    let mut lines = Vec::new();
    for line in contents.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            section = match trimmed {
                "[package]" => CargoSection::Package,
                "[workspace.package]" => CargoSection::WorkspacePackage,
                _ => CargoSection::Other,
            };
            lines.push(line.to_string());
            continue;
        }

        let should_update_package_version = matches!(section, CargoSection::WorkspacePackage)
            || (matches!(section, CargoSection::Package)
                && package_name.as_deref().is_some_and(is_internal_rust_crate));
        if should_update_package_version {
            if let Some(version) = cargo_version_assignment(trimmed) {
                require_version_base(&version, expected_base_version, path, "version")?;
                lines.push(line.replacen(
                    &format!("\"{version}\""),
                    &format!("\"{release_version}\""),
                    1,
                ));
                continue;
            }
        }

        if let Some((name, version)) = cargo_inline_dependency_version(trimmed) {
            if is_internal_rust_crate(&name) {
                require_version_base(
                    &version,
                    expected_base_version,
                    path,
                    &format!("dependency {name}"),
                )?;
                lines.push(line.replacen(
                    &format!("version = \"{version}\""),
                    &format!("version = \"{release_version}\""),
                    1,
                ));
                continue;
            }
        }
        lines.push(line.to_string());
    }
    let mut updated = lines.join("\n");
    if contents.ends_with('\n') {
        updated.push('\n');
    }
    Ok(updated)
}

fn require_version_base(
    version: &str,
    expected_base_version: &str,
    path: &Path,
    label: &str,
) -> Result<()> {
    let actual_base_version = version_base(version)?;
    if actual_base_version == expected_base_version {
        Ok(())
    } else {
        Err(miette!(
            "{} {label} uses version {version}, but release tag requires base version {expected_base_version}",
            path.display()
        ))
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum CargoSection {
    Package,
    WorkspacePackage,
    Other,
}

fn cargo_package_name(contents: &str) -> Option<String> {
    let mut in_package = false;
    for line in contents.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            in_package = trimmed == "[package]";
            continue;
        }
        if in_package && trimmed.starts_with("name") {
            return quoted_value_after_equals(trimmed);
        }
    }
    None
}

fn cargo_version_assignment(trimmed: &str) -> Option<String> {
    if !trimmed.starts_with("version") || trimmed.contains("workspace") {
        return None;
    }
    quoted_value_after_equals(trimmed)
}

fn cargo_inline_dependency_version(trimmed: &str) -> Option<(String, String)> {
    let (name, rest) = trimmed.split_once('=')?;
    if !rest.contains("version") {
        return None;
    }
    let version_index = rest.find("version")?;
    let version_rest = &rest[version_index..];
    Some((
        name.trim().to_string(),
        quoted_value_after_equals(version_rest)?,
    ))
}

fn quoted_value_after_equals(value: &str) -> Option<String> {
    let equals = value.find('=')?;
    let rest = &value[equals + 1..];
    let start = rest.find('"')? + equals + 2;
    let end = value[start..].find('"')? + start;
    Some(value[start..end].to_string())
}

fn is_internal_rust_crate(name: &str) -> bool {
    name.starts_with("trellis-")
}

fn is_internal_npm_package(name: &str) -> bool {
    matches!(
        name,
        "@qlever-llc/result" | "@qlever-llc/trellis" | "@qlever-llc/trellis-svelte"
    )
}

fn check_changelog(repo_root: &Path, version: &str, since: Option<&str>) -> Result<()> {
    let changelog_path = repo_root.join("CHANGELOG.md");
    let changelog = fs::read_to_string(&changelog_path)
        .into_diagnostic()
        .wrap_err("failed to read CHANGELOG.md")?;
    let section = extract_changelog_section(&changelog, version)?;
    if section.trim().is_empty() {
        return Err(miette!("CHANGELOG.md section for {version} is empty"));
    }
    if section.contains("TODO") || section.contains("TBD") {
        return Err(miette!(
            "CHANGELOG.md section for {version} still contains TODO/TBD text"
        ));
    }
    println!("CHANGELOG.md contains a release section for {version}.");
    if let Some(since) = since {
        print_changes_since(repo_root, since)?;
    }
    Ok(())
}

fn write_release_notes(repo_root: &Path, version: &str, output_path: &Path) -> Result<()> {
    let changelog_path = repo_root.join("CHANGELOG.md");
    let changelog = fs::read_to_string(&changelog_path)
        .into_diagnostic()
        .wrap_err("failed to read CHANGELOG.md")?;
    let section = extract_changelog_section(&changelog, version)?;
    if let Some(parent) = output_path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .into_diagnostic()
                .wrap_err_with(|| format!("failed to create {}", parent.display()))?;
        }
    }
    fs::write(output_path, format!("{}\n", section.trim()))
        .into_diagnostic()
        .wrap_err_with(|| format!("failed to write {}", output_path.display()))
}

fn extract_changelog_section(changelog: &str, version: &str) -> Result<String> {
    let heading = format!("## [{version}]");
    let heading_with_date_prefix = format!("## [{version}] - ");
    let lines: Vec<_> = changelog
        .replace("\r\n", "\n")
        .lines()
        .map(str::to_string)
        .collect();
    let start = lines
        .iter()
        .position(|line| line == &heading || line.starts_with(&heading_with_date_prefix))
        .ok_or_else(|| miette!("CHANGELOG.md does not contain a section for {version}"))?;
    let end = lines
        .iter()
        .enumerate()
        .skip(start + 1)
        .find_map(|(index, line)| line.starts_with("## [").then_some(index))
        .unwrap_or(lines.len());
    Ok(lines[start + 1..end].join("\n"))
}

fn print_changes_since(repo_root: &Path, since: &str) -> Result<()> {
    let output = Command::new("git")
        .arg("diff")
        .arg("--name-status")
        .arg(format!("{since}..HEAD"))
        .current_dir(repo_root)
        .output()
        .into_diagnostic()
        .wrap_err("failed to run git diff for changelog review")?;
    if !output.status.success() {
        return Err(miette!(
            "git diff {since}..HEAD failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.trim().is_empty() {
        println!("No file changes found since {since}.");
    } else {
        println!("Files changed since {since}; verify CHANGELOG.md covers user-visible changes:");
        for line in stdout.lines() {
            println!("- {line}");
        }
    }
    Ok(())
}

fn run_pretag_check(repo_root: &Path, tag: &str, git_ref: &str) -> Result<()> {
    parse_release_tag(tag)?;
    if let Err(error) = require_usable_gh(repo_root) {
        print_pretag_fallback(tag, git_ref, true);
        return Err(error);
    }

    let existing_run_ids: BTreeSet<_> = match list_pretag_workflow_run_ids(repo_root, git_ref) {
        Ok(run_ids) => run_ids.into_iter().collect(),
        Err(error) => {
            print_pretag_fallback(tag, git_ref, true);
            return Err(error);
        }
    };

    let dispatch = pretag_dispatch_command(tag, git_ref);
    if let Err(error) =
        run_checked_command(repo_root, &dispatch, "failed to dispatch Release workflow")
    {
        print_pretag_fallback(tag, git_ref, true);
        return Err(error);
    }

    let run_id = match resolve_new_pretag_workflow_run(repo_root, git_ref, &existing_run_ids) {
        Ok(run_id) => run_id,
        Err(error) => {
            print_pretag_fallback(tag, git_ref, false);
            return Err(error);
        }
    };
    println!("Watching Release workflow run {run_id}.");
    run_checked_command(
        repo_root,
        &pretag_watch_command(&run_id),
        "Release workflow run failed",
    )
}

fn require_usable_gh(repo_root: &Path) -> Result<()> {
    for spec in gh_prerequisite_commands() {
        let output = Command::new(&spec.program)
            .args(&spec.args)
            .current_dir(repo_root)
            .output()
            .into_diagnostic()
            .wrap_err_with(|| format!("failed to run {}", command_text(&spec)))?;
        if !output.status.success() {
            return Err(miette!(
                "GitHub CLI prerequisite failed: {}\n{}",
                command_text(&spec),
                String::from_utf8_lossy(&output.stderr)
            ));
        }
    }
    Ok(())
}

fn resolve_new_pretag_workflow_run(
    repo_root: &Path,
    git_ref: &str,
    existing_run_ids: &BTreeSet<String>,
) -> Result<String> {
    for attempt in 1..=12 {
        let new_run_ids: Vec<_> = list_pretag_workflow_run_ids(repo_root, git_ref)?
            .into_iter()
            .filter(|run_id| !existing_run_ids.contains(run_id))
            .collect();
        if new_run_ids.len() == 1 {
            return Ok(new_run_ids[0].clone());
        }
        if new_run_ids.len() > 1 {
            return Err(miette!(
                "found multiple newly dispatched Release workflow runs for ref `{git_ref}`: {}",
                new_run_ids.join(", ")
            ));
        }

        if attempt < 12 {
            std::thread::sleep(Duration::from_secs(5));
        }
    }

    Err(miette!(
        "failed to resolve a newly dispatched workflow_dispatch Release run for ref `{git_ref}`"
    ))
}

fn list_pretag_workflow_run_ids(repo_root: &Path, git_ref: &str) -> Result<Vec<String>> {
    let spec = pretag_list_command(git_ref);
    let output = run_output_command(repo_root, &spec)
        .wrap_err("failed to list Release workflow dry-run candidates")?;
    if !output.status.success() {
        return Err(miette!(
            "{} failed: {}",
            command_text(&spec),
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut run_ids = Vec::new();
    for run_id in stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        if !run_id.chars().all(|ch| ch.is_ascii_digit()) {
            return Err(miette!(
                "resolved Release workflow run id `{run_id}` is not numeric"
            ));
        }
        run_ids.push(run_id.to_string());
    }
    Ok(run_ids)
}

fn run_verify(
    repo_root: &Path,
    version: &str,
    since: &str,
    skip_integration: bool,
    keep_workdir: bool,
) -> Result<()> {
    version_base(version)?;
    parse_release_tag(since)?;
    if skip_integration {
        println!(
            "WARNING: --skip-integration was set; release verification is incomplete until the full integration harness passes."
        );
    }

    for spec in verify_command_specs(version, since, skip_integration, keep_workdir) {
        run_checked_command(repo_root, &spec, "release verification command failed")?;
    }
    Ok(())
}

fn verify_command_specs(
    version: &str,
    since: &str,
    skip_integration: bool,
    keep_workdir: bool,
) -> Vec<CommandSpec> {
    let mut specs = vec![
        CommandSpec::new(
            "cargo",
            vec![
                "run",
                "--manifest-path",
                "xtask/Cargo.toml",
                "--",
                "release",
                "check-metadata",
                "--version",
                version,
                "--since",
                since,
            ],
        ),
        CommandSpec::new(
            "cargo",
            vec![
                "run",
                "--manifest-path",
                "xtask/Cargo.toml",
                "--",
                "prepare",
            ],
        ),
        CommandSpec::new("deno", vec!["fmt", "-c", "js/deno.json", "--check"]),
        CommandSpec::new(
            "cargo",
            vec![
                "fmt",
                "--manifest-path",
                "rust/Cargo.toml",
                "--all",
                "--check",
            ],
        ),
        CommandSpec::new(
            "cargo",
            vec![
                "fmt",
                "--manifest-path",
                "rust/tools/generate/Cargo.toml",
                "--check",
            ],
        ),
        CommandSpec::new(
            "cargo",
            vec!["fmt", "--manifest-path", "rust/xtask/Cargo.toml", "--check"],
        ),
        CommandSpec::new(
            "deno",
            vec![
                "check",
                "-c",
                "js/deno.json",
                "js/packages/trellis/index.ts",
                "js/packages/trellis-svelte/src/index.ts",
                "js/packages/trellis-svelte/src/context.svelte.ts",
                "js/services/trellis/main.ts",
            ],
        ),
        CommandSpec::new("deno", vec!["test", "-c", "js/deno.json", "-A"]),
        CommandSpec::new(
            "cargo",
            vec!["test", "--manifest-path", "rust/Cargo.toml", "--workspace"],
        ),
        CommandSpec::new(
            "cargo",
            vec!["test", "--manifest-path", "rust/tools/generate/Cargo.toml"],
        ),
        CommandSpec::new(
            "cargo",
            vec!["test", "--manifest-path", "rust/xtask/Cargo.toml"],
        ),
        CommandSpec::new("cargo", vec!["test", "--manifest-path", "xtask/Cargo.toml"]),
    ];

    if !skip_integration {
        let mut args = vec![
            "run".to_string(),
            "--manifest-path".to_string(),
            "xtask/Cargo.toml".to_string(),
            "--".to_string(),
            "integration".to_string(),
            "run".to_string(),
            "--skip-prepare".to_string(),
        ];
        if keep_workdir {
            args.push("--keep-workdir".to_string());
        }
        specs.push(CommandSpec::new("cargo", args));
    }

    specs
}

fn gh_prerequisite_commands() -> Vec<CommandSpec> {
    vec![
        CommandSpec::new("gh", vec!["--version"]),
        CommandSpec::new("gh", vec!["auth", "status"]),
    ]
}

fn pretag_dispatch_command(tag: &str, git_ref: &str) -> CommandSpec {
    CommandSpec::new(
        "gh",
        vec![
            "workflow".to_string(),
            "run".to_string(),
            ".github/workflows/release.yml".to_string(),
            "--ref".to_string(),
            git_ref.to_string(),
            "-f".to_string(),
            format!("tag={tag}"),
            "-f".to_string(),
            "publish=false".to_string(),
        ],
    )
}

fn pretag_list_command(git_ref: &str) -> CommandSpec {
    CommandSpec::new(
        "gh",
        vec![
            "run",
            "list",
            "--workflow",
            ".github/workflows/release.yml",
            "--event",
            "workflow_dispatch",
            "--branch",
            git_ref,
            "--limit",
            "20",
            "--json",
            "databaseId",
            "--jq",
            ".[].databaseId",
        ],
    )
}

fn pretag_watch_command(run_id: &str) -> CommandSpec {
    CommandSpec::new("gh", vec!["run", "watch", run_id, "--exit-status"])
}

fn print_pretag_fallback(tag: &str, git_ref: &str, dispatch_may_be_needed: bool) {
    eprintln!("Unable to verify the pre-tag Release workflow with GitHub CLI (`gh`).");
    eprintln!(
        "Run this fallback manually and do not create or push the release tag until it passes:"
    );
    if dispatch_may_be_needed {
        eprintln!("{}", command_text(&pretag_dispatch_command(tag, git_ref)));
    } else {
        eprintln!("A Release workflow dispatch may already have succeeded; inspect recent runs before dispatching another one.");
    }
    eprintln!("{}", command_text(&pretag_list_command(git_ref)));
    eprintln!("{}", command_text(&pretag_watch_command("<run-id>")));
}

fn run_checked_command(repo_root: &Path, spec: &CommandSpec, context: &str) -> Result<()> {
    println!("$ {}", command_text(spec));
    let status = Command::new(&spec.program)
        .args(&spec.args)
        .current_dir(repo_root)
        .status()
        .into_diagnostic()
        .wrap_err_with(|| format!("failed to run {}", command_text(spec)))?;
    if status.success() {
        Ok(())
    } else {
        Err(miette!(
            "{context}: {} exited with {status}",
            command_text(spec)
        ))
    }
}

fn run_output_command(repo_root: &Path, spec: &CommandSpec) -> Result<std::process::Output> {
    println!("$ {}", command_text(spec));
    Command::new(&spec.program)
        .args(&spec.args)
        .current_dir(repo_root)
        .output()
        .into_diagnostic()
        .wrap_err_with(|| format!("failed to run {}", command_text(spec)))
}

fn command_text(spec: &CommandSpec) -> String {
    std::iter::once(spec.program.as_str())
        .chain(spec.args.iter().map(String::as_str))
        .map(shell_word)
        .collect::<Vec<_>>()
        .join(" ")
}

fn shell_word(word: &str) -> String {
    if word
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '/' | '.' | '_' | '-' | '=' | ':'))
    {
        word.to_string()
    } else {
        format!("'{}'", word.replace('\'', "'\\''"))
    }
}

#[derive(Debug, Clone, Eq, PartialEq)]
struct CommandSpec {
    program: String,
    args: Vec<String>,
}

impl CommandSpec {
    fn new<S, I>(program: &str, args: I) -> Self
    where
        S: Into<String>,
        I: IntoIterator<Item = S>,
    {
        Self {
            program: program.to_string(),
            args: args.into_iter().map(Into::into).collect(),
        }
    }
}

fn require_stable_version(version: &str, label: &str) -> Result<()> {
    if is_stable_semver(version) {
        Ok(())
    } else {
        Err(miette!(
            "{label} must be a stable semver version like 0.9.0"
        ))
    }
}

fn parse_release_tag(tag: &str) -> Result<ReleaseVersion> {
    let tag = tag.trim();
    let Some(version) = tag.strip_prefix('v') else {
        return Err(miette!(
            "invalid release tag `{tag}`; expected a tag like v0.9.0 or v0.9.0-rc.1"
        ));
    };
    let base_version = version_base(version)?;
    Ok(ReleaseVersion {
        version: version.to_string(),
        base_version,
    })
}

fn version_base(version: &str) -> Result<String> {
    let version = version.trim();
    let suffix_start = [version.find('-'), version.find('+')]
        .into_iter()
        .flatten()
        .min()
        .unwrap_or(version.len());
    let base = &version[..suffix_start];
    if is_stable_semver(base) {
        if !version
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '+'))
        {
            return Err(miette!("invalid release version `{version}`"));
        }
        Ok(base.to_string())
    } else {
        Err(miette!("invalid release version `{version}`"))
    }
}

fn write_github_env(name: &str, value: &str) -> Result<()> {
    let Some(path) = std::env::var_os("GITHUB_ENV") else {
        return Ok(());
    };
    if path.is_empty() {
        return Ok(());
    }
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .into_diagnostic()
        .wrap_err("failed to open GITHUB_ENV")?;
    writeln!(file, "{name}={value}")
        .into_diagnostic()
        .wrap_err("failed to write GITHUB_ENV")
}

#[derive(Debug, Clone, Eq, PartialEq)]
struct ReleaseVersion {
    version: String,
    base_version: String,
}

fn is_stable_semver(version: &str) -> bool {
    let mut parts = version.split('.');
    let Some(major) = parts.next() else {
        return false;
    };
    let Some(minor) = parts.next() else {
        return false;
    };
    let Some(patch) = parts.next() else {
        return false;
    };
    parts.next().is_none()
        && [major, minor, patch]
            .iter()
            .all(|part| !part.is_empty() && part.chars().all(|ch| ch.is_ascii_digit()))
}

fn display_repo_path(repo_root: &Path, path: &Path) -> String {
    path.strip_prefix(repo_root)
        .unwrap_or(path)
        .display()
        .to_string()
}

#[derive(Debug, Clone, Eq, PartialEq)]
struct VersionEntry {
    label: String,
    version: String,
}

impl VersionEntry {
    fn new(label: String, version: String) -> Self {
        Self { label, version }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        collect_versions, command_text, extract_changelog_section, parse_release_command,
        pretag_dispatch_command, pretag_list_command, pretag_watch_command,
        rewrite_cargo_manifest_versions, rewrite_cargo_manifest_versions_for_release,
        rewrite_js_internal_npm_dependency_versions, rewrite_json_manifest_version,
        rewrite_json_manifest_version_for_release, verify_command_specs, version_base,
        ReleaseCommand,
    };
    use std::fs;

    #[test]
    fn parse_release_bump_command() {
        let command = parse_release_command(
            ["bump", "--from", "0.8.2", "--to", "0.9.0"]
                .into_iter()
                .map(str::to_string),
        )
        .expect("parse release bump");
        assert_eq!(
            command,
            ReleaseCommand::Bump {
                from: "0.8.2".to_string(),
                to: "0.9.0".to_string(),
            }
        );
    }

    #[test]
    fn parse_release_prepare_command() {
        let command = parse_release_command(
            ["prepare", "--tag", "v0.9.0-rc.1"]
                .into_iter()
                .map(str::to_string),
        )
        .expect("parse release prepare");
        assert_eq!(
            command,
            ReleaseCommand::Prepare {
                tag: Some("v0.9.0-rc.1".to_string())
            }
        );
    }

    #[test]
    fn parse_release_write_notes_command() {
        let command = parse_release_command(
            [
                "write-notes",
                "--tag",
                "v0.9.0",
                "--output",
                "dist/notes.md",
            ]
            .into_iter()
            .map(str::to_string),
        )
        .expect("parse release write-notes");
        assert_eq!(
            command,
            ReleaseCommand::WriteNotes {
                tag: "v0.9.0".to_string(),
                output: std::path::PathBuf::from("dist/notes.md")
            }
        );
    }

    #[test]
    fn parse_release_pretag_check_defaults_ref() {
        let command = parse_release_command(
            ["pretag-check", "--tag", "v0.9.0-rc.1"]
                .into_iter()
                .map(str::to_string),
        )
        .expect("parse release pretag-check");
        assert_eq!(
            command,
            ReleaseCommand::PretagCheck {
                tag: "v0.9.0-rc.1".to_string(),
                git_ref: "main".to_string(),
            }
        );
    }

    #[test]
    fn parse_release_pretag_check_accepts_ref() {
        let command = parse_release_command(
            ["pretag-check", "--tag", "v0.9.0", "--ref", "release/v0.9"]
                .into_iter()
                .map(str::to_string),
        )
        .expect("parse release pretag-check ref");
        assert_eq!(
            command,
            ReleaseCommand::PretagCheck {
                tag: "v0.9.0".to_string(),
                git_ref: "release/v0.9".to_string(),
            }
        );
    }

    #[test]
    fn parse_release_pretag_check_rejects_invalid_tag() {
        let error = parse_release_command(
            ["pretag-check", "--tag", "0.9.0"]
                .into_iter()
                .map(str::to_string),
        )
        .expect_err("pretag-check should reject invalid tag");
        assert!(error.to_string().contains("invalid release tag"));
    }

    #[test]
    fn parse_release_check_metadata_command() {
        let command = parse_release_command(
            [
                "check-metadata",
                "--version",
                "0.9.0-rc.1",
                "--since",
                "v0.8.2",
            ]
            .into_iter()
            .map(str::to_string),
        )
        .expect("parse release check-metadata");
        assert_eq!(
            command,
            ReleaseCommand::CheckMetadata {
                version: Some("0.9.0-rc.1".to_string()),
                since: Some("v0.8.2".to_string()),
            }
        );
    }

    #[test]
    fn parse_release_verify_command() {
        let command = parse_release_command(
            [
                "verify",
                "--version",
                "0.9.0-rc.1",
                "--since",
                "v0.8.2",
                "--skip-integration",
                "--keep-workdir",
            ]
            .into_iter()
            .map(str::to_string),
        )
        .expect("parse release verify");
        assert_eq!(
            command,
            ReleaseCommand::Verify {
                version: "0.9.0-rc.1".to_string(),
                since: "v0.8.2".to_string(),
                skip_integration: true,
                keep_workdir: true,
            }
        );
    }

    #[test]
    fn parse_release_verify_requires_release_tag_since() {
        let error = parse_release_command(
            ["verify", "--version", "0.9.0", "--since", "0.8.2"]
                .into_iter()
                .map(str::to_string),
        )
        .expect_err("verify should reject non-tag since");
        assert!(error.to_string().contains("invalid release tag"));
    }

    #[test]
    fn parse_release_rejects_old_local_verify_command() {
        let error = parse_release_command(
            ["local-verify", "--version", "0.9.0", "--since", "v0.8.2"]
                .into_iter()
                .map(str::to_string),
        )
        .expect_err("local-verify should not be accepted");
        assert!(error.to_string().contains("unsupported release command"));
    }

    #[test]
    fn pretag_check_command_specs_construct_gh_invocations() {
        assert_eq!(
            command_text(&pretag_dispatch_command("v0.9.0", "main")),
            "gh workflow run .github/workflows/release.yml --ref main -f tag=v0.9.0 -f publish=false"
        );
        assert_eq!(
            command_text(&pretag_list_command("main")),
            "gh run list --workflow .github/workflows/release.yml --event workflow_dispatch --branch main --limit 20 --json databaseId --jq '.[].databaseId'"
        );
        assert_eq!(
            command_text(&pretag_watch_command("12345")),
            "gh run watch 12345 --exit-status"
        );
    }

    #[test]
    fn verify_command_specs_include_checks_and_integration() {
        let specs = verify_command_specs("0.9.0", "v0.8.2", false, true);
        let commands: Vec<_> = specs.iter().map(command_text).collect();

        assert!(commands.contains(&"cargo run --manifest-path xtask/Cargo.toml -- release check-metadata --version 0.9.0 --since v0.8.2".to_string()));
        assert!(commands
            .contains(&"cargo fmt --manifest-path rust/Cargo.toml --all --check".to_string()));
        assert!(commands.contains(
            &"cargo fmt --manifest-path rust/tools/generate/Cargo.toml --check".to_string()
        ));
        assert!(commands
            .contains(&"cargo fmt --manifest-path rust/xtask/Cargo.toml --check".to_string()));
        assert!(commands
            .contains(&"cargo test --manifest-path rust/tools/generate/Cargo.toml".to_string()));
        assert!(commands.contains(&"cargo test --manifest-path rust/xtask/Cargo.toml".to_string()));
        assert!(commands.contains(&"cargo test --manifest-path xtask/Cargo.toml".to_string()));
        assert_eq!(
            commands.last().expect("last release verify command"),
            "cargo run --manifest-path xtask/Cargo.toml -- integration run --skip-prepare --keep-workdir"
        );
    }

    #[test]
    fn verify_command_specs_skip_integration() {
        let commands: Vec<_> = verify_command_specs("0.9.0", "v0.8.2", true, true)
            .iter()
            .map(command_text)
            .collect();

        assert!(!commands
            .iter()
            .any(|command| command.contains(" integration run ")));
    }

    #[test]
    fn rewrite_json_manifest_preserves_layout() {
        let original = "{\n  \"name\": \"@qlever-llc/trellis\",\n  \"version\": \"0.8.2\"\n}\n";
        let updated = rewrite_json_manifest_version(
            original,
            "0.8.2",
            "0.9.0",
            std::path::Path::new("deno.json"),
        )
        .expect("rewrite json version");
        assert_eq!(
            updated,
            "{\n  \"name\": \"@qlever-llc/trellis\",\n  \"version\": \"0.9.0\"\n}\n"
        );
    }

    #[test]
    fn rewrite_json_manifest_for_release_accepts_base_version() {
        let original = "{\n  \"name\": \"@qlever-llc/trellis\",\n  \"version\": \"0.8.2\"\n}\n";
        let updated = rewrite_json_manifest_version_for_release(
            original,
            "0.8.2-rc.1",
            "0.8.2",
            std::path::Path::new("deno.json"),
        )
        .expect("rewrite json release version");
        assert_eq!(
            updated,
            "{\n  \"name\": \"@qlever-llc/trellis\",\n  \"version\": \"0.8.2-rc.1\"\n}\n"
        );
    }

    #[test]
    fn rewrite_cargo_manifest_updates_workspace_and_internal_dependencies() {
        let original = "[workspace.package]\nversion = \"0.8.2\"\n\n[dependencies]\ntrellis-rs = { path = \"../trellis\", version = \"0.8.2\" }\ntrellis-client = { path = \"../client\", version = \"0.8.2\" }\nserde = { version = \"1.0\" }\n";
        let updated = rewrite_cargo_manifest_versions(
            original,
            "0.8.2",
            "0.9.0",
            std::path::Path::new("Cargo.toml"),
        )
        .expect("rewrite cargo versions");
        assert_eq!(
            updated,
            "[workspace.package]\nversion = \"0.9.0\"\n\n[dependencies]\ntrellis-rs = { path = \"../trellis\", version = \"0.9.0\" }\ntrellis-client = { path = \"../client\", version = \"0.9.0\" }\nserde = { version = \"1.0\" }\n"
        );
    }

    #[test]
    fn rewrite_cargo_manifest_for_release_updates_generated_sdk_dependencies() {
        let original = "[workspace.package]\nversion = \"0.8.2\"\n\n[dependencies]\ntrellis-rs = { path = \"../trellis\", version = \"0.8.2\" }\ntrellis-local-bootstrap = { path = \"../local-bootstrap\", version = \"0.8.2\" }\ntrellis-sdk-health = { path = \"../generated/packages/cargo/health\", version = \"0.8.2\" }\ntrellis-sdk-state = { path = \"../generated/packages/cargo/state\", version = \"0.8.2\" }\nserde = { version = \"1.0\" }\n";
        let updated = rewrite_cargo_manifest_versions_for_release(
            original,
            "0.8.2-rc.1",
            "0.8.2",
            std::path::Path::new("Cargo.toml"),
        )
        .expect("rewrite cargo release versions");
        assert_eq!(
            updated,
            "[workspace.package]\nversion = \"0.8.2-rc.1\"\n\n[dependencies]\ntrellis-rs = { path = \"../trellis\", version = \"0.8.2-rc.1\" }\ntrellis-local-bootstrap = { path = \"../local-bootstrap\", version = \"0.8.2-rc.1\" }\ntrellis-sdk-health = { path = \"../generated/packages/cargo/health\", version = \"0.8.2-rc.1\" }\ntrellis-sdk-state = { path = \"../generated/packages/cargo/state\", version = \"0.8.2-rc.1\" }\nserde = { version = \"1.0\" }\n"
        );
    }

    #[test]
    fn rewrite_js_internal_npm_dependency_versions_updates_build_scripts() {
        let original = "const dependencies = {\n  \"@qlever-llc/result\": \"^0.8.2\",\n  \"@qlever-llc/trellis\": \"~0.8.2\",\n  \"typebox\": \"^1.0.15\",\n};\nassertStringIncludes(source, '\"@qlever-llc/result\": \"^0.8.2\"');\n";
        let updated = rewrite_js_internal_npm_dependency_versions(
            original,
            "0.8.2",
            "0.9.0",
            std::path::Path::new("build_npm.ts"),
        )
        .expect("rewrite js internal npm dependencies");
        assert_eq!(
            updated,
            "const dependencies = {\n  \"@qlever-llc/result\": \"^0.9.0\",\n  \"@qlever-llc/trellis\": \"~0.9.0\",\n  \"typebox\": \"^1.0.15\",\n};\nassertStringIncludes(source, '\"@qlever-llc/result\": \"^0.9.0\"');\n"
        );
    }

    #[test]
    fn collect_versions_includes_internal_npm_dependency_specs() {
        let root = temp_repo_root();
        let script = root.join("js/packages/trellis/scripts/build_npm.ts");
        fs::create_dir_all(script.parent().expect("script parent")).expect("mkdir script parent");
        fs::create_dir_all(root.join("rust")).expect("mkdir rust");
        fs::write(
            root.join("rust/Cargo.toml"),
            "[workspace.package]\nversion = \"0.8.2\"\n",
        )
        .expect("write cargo manifest");
        fs::write(
            script,
            "const dependencies = {\n  \"@qlever-llc/result\": \"^0.8.1\",\n};\n",
        )
        .expect("write script");

        let versions = collect_versions(&root).expect("collect versions");

        assert!(versions.iter().any(|entry| {
            entry.label.ends_with("dependency @qlever-llc/result") && entry.version == "0.8.1"
        }));
        fs::remove_dir_all(root).expect("remove temp repo");
    }

    #[test]
    fn collect_versions_skips_zero_version_apps() {
        let root = temp_repo_root();
        fs::create_dir_all(root.join("js/packages/trellis")).expect("mkdir package");
        fs::create_dir_all(root.join("js/apps/console")).expect("mkdir app");
        fs::create_dir_all(root.join("rust")).expect("mkdir rust");
        fs::write(
            root.join("js/packages/trellis/deno.json"),
            "{\"version\":\"0.8.2\"}\n",
        )
        .expect("write package manifest");
        fs::write(
            root.join("js/apps/console/deno.json"),
            "{\"version\":\"0.0.0\"}\n",
        )
        .expect("write app manifest");
        fs::write(
            root.join("rust/Cargo.toml"),
            "[workspace.package]\nversion = \"0.8.2\"\n",
        )
        .expect("write cargo manifest");
        let versions = collect_versions(&root).expect("collect versions");
        assert_eq!(versions.len(), 2);
        fs::remove_dir_all(root).expect("remove temp repo");
    }

    #[test]
    fn extract_changelog_section_finds_dated_heading() {
        let section = extract_changelog_section(
            "# Changelog\n\n## [0.9.0] - 2026-05-19\n\n### Added\n\n- Thing\n\n## [0.8.2]\n",
            "0.9.0",
        )
        .expect("extract changelog");
        assert!(section.contains("Thing"));
    }

    #[test]
    fn version_base_accepts_prerelease_versions() {
        assert_eq!(version_base("0.9.0-rc.1").expect("version base"), "0.9.0");
    }

    fn temp_repo_root() -> std::path::PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "trellis-release-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time")
                .as_nanos()
        ));
        path
    }
}

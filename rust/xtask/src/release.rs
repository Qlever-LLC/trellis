use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

use miette::{miette, IntoDiagnostic, Result, WrapErr};

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
    Verify {
        version: Option<String>,
        since: Option<String>,
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
        Some("verify") => parse_verify(args),
        Some(command) => Err(miette!(
            "unsupported release command `{command}`\n{}",
            release_usage_text()
        )),
        None => Err(miette!(release_usage_text())),
    }
}

pub(crate) fn release_usage_text() -> &'static str {
    "usage: cargo xtask release check-versions | cargo xtask release prepare [--tag <tag>] | cargo xtask release bump --from <version> --to <version> | cargo xtask release changelog-check --version <version> [--since <tag>] | cargo xtask release write-notes --tag <tag> --output <path> | cargo xtask release verify [--version <version>] [--since <tag>]"
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
                "Prepared release version {} from tag {tag} in {} manifest(s).",
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
                "Bumped release-managed Trellis versions from {from} to {to} in {} manifest(s).",
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
        ReleaseCommand::Verify { version, since } => {
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
                "Before the release commit, run formatting, type checks, unit tests, package checks, generated-artifact prepare, and the full integration harness."
            );
            Ok(())
        }
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

fn parse_verify<I>(args: I) -> Result<ReleaseCommand>
where
    I: Iterator<Item = String>,
{
    let options = parse_options(args, &["version", "since"])?;
    Ok(ReleaseCommand::Verify {
        version: options.get("version").cloned(),
        since: options.get("since").cloned(),
    })
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
        }
    }
    Ok(versions)
}

fn release_manifest_paths(repo_root: &Path) -> Result<Vec<PathBuf>> {
    let mut paths = Vec::new();
    collect_manifest_paths(&repo_root.join("generated"), &mut paths)?;
    collect_manifest_paths(&repo_root.join("js"), &mut paths)?;
    collect_manifest_paths(&repo_root.join("rust"), &mut paths)?;
    paths.sort();
    Ok(paths)
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
    name == "trellis" || name.starts_with("trellis-")
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
        collect_versions, extract_changelog_section, parse_release_command,
        rewrite_cargo_manifest_versions, rewrite_cargo_manifest_versions_for_release,
        rewrite_json_manifest_version, rewrite_json_manifest_version_for_release, version_base,
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
        let original = "[workspace.package]\nversion = \"0.8.2\"\n\n[dependencies]\ntrellis = { path = \"../trellis\", version = \"0.8.2\" }\ntrellis-client = { path = \"../client\", version = \"0.8.2\" }\nserde = { version = \"1.0\" }\n";
        let updated = rewrite_cargo_manifest_versions(
            original,
            "0.8.2",
            "0.9.0",
            std::path::Path::new("Cargo.toml"),
        )
        .expect("rewrite cargo versions");
        assert_eq!(
            updated,
            "[workspace.package]\nversion = \"0.9.0\"\n\n[dependencies]\ntrellis = { path = \"../trellis\", version = \"0.9.0\" }\ntrellis-client = { path = \"../client\", version = \"0.9.0\" }\nserde = { version = \"1.0\" }\n"
        );
    }

    #[test]
    fn rewrite_cargo_manifest_for_release_updates_generated_sdk_dependencies() {
        let original = "[workspace.package]\nversion = \"0.8.2\"\n\n[dependencies]\ntrellis = { path = \"../trellis\", version = \"0.8.2\" }\ntrellis-local-bootstrap = { path = \"../local-bootstrap\", version = \"0.8.2\" }\ntrellis-sdk-health = { path = \"../generated/packages/cargo/health\", version = \"0.8.2\" }\ntrellis-sdk-state = { path = \"../generated/packages/cargo/state\", version = \"0.8.2\" }\nserde = { version = \"1.0\" }\n";
        let updated = rewrite_cargo_manifest_versions_for_release(
            original,
            "0.8.2-rc.1",
            "0.8.2",
            std::path::Path::new("Cargo.toml"),
        )
        .expect("rewrite cargo release versions");
        assert_eq!(
            updated,
            "[workspace.package]\nversion = \"0.8.2-rc.1\"\n\n[dependencies]\ntrellis = { path = \"../trellis\", version = \"0.8.2-rc.1\" }\ntrellis-local-bootstrap = { path = \"../local-bootstrap\", version = \"0.8.2-rc.1\" }\ntrellis-sdk-health = { path = \"../generated/packages/cargo/health\", version = \"0.8.2-rc.1\" }\ntrellis-sdk-state = { path = \"../generated/packages/cargo/state\", version = \"0.8.2-rc.1\" }\nserde = { version = \"1.0\" }\n"
        );
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

//! Project API dependency and publication commands.

use std::{collections::BTreeMap, fs, path::Path};

use miette::{miette, IntoDiagnostic, Result, WrapErr};
use semver::{Version, VersionReq};
use serde::Serialize;

use crate::{
    cli::{AddArgs, OutputFormat, ProjectRootArgs, PublishArgs, RmArgs},
    oci, output,
    project::{
        read_lock, read_manifest, restore_project_files, write_lock, write_manifest_and_lock,
        ApiDependency, LockedApi, ProjectLock, ProjectManifest,
    },
};

#[derive(Debug, Serialize)]
struct PackageResult {
    installed_apis: usize,
    changed_dependencies: usize,
    generated_projects: usize,
    #[serde(skip)]
    owned_api_paths: Vec<std::path::PathBuf>,
}

pub async fn add(format: OutputFormat, args: &AddArgs) -> Result<()> {
    let root = canonical_root(&args.project.root)?;
    let manifest_path = root.join("trellis.toml");
    let previous_manifest = fs::read(&manifest_path).into_diagnostic()?;
    let previous_lock = read_optional(&root.join("trellis.lock"))?;
    let mut manifest = read_manifest(&manifest_path)?;
    let source_path = Path::new(&args.source);
    let (id, release, path, registry) = if root.join(source_path).is_file() {
        if source_path.is_absolute() {
            return Err(miette!(
                "API paths in trellis.toml must be relative to the project root"
            ));
        }
        let (id, release, _) = read_path_api(&root, "", &args.source)?;
        (id, release, Some(args.source.clone()), None)
    } else {
        trellis_protocol::validate_api_id(&args.source)
            .map_err(|error| miette!("invalid API id '{}': {error}", args.source))?;
        let registry = args
            .registry
            .clone()
            .or_else(|| manifest.default_registry.clone())
            .ok_or_else(|| miette!("remote add requires --registry or default-registry"))?;
        let config = manifest
            .registries
            .get(&registry)
            .ok_or_else(|| miette!("registry '{registry}' is not configured"))?;
        let requirement = args
            .version
            .as_deref()
            .map(VersionReq::parse)
            .transpose()
            .map_err(|error| miette!("invalid version requirement: {error}"))?;
        let release = select_remote_version(config, &args.source, requirement.as_ref()).await?;
        (args.source.clone(), release, None, Some(registry))
    };
    let requirement = args
        .version
        .clone()
        .unwrap_or_else(|| format!("^{release}"));
    VersionReq::parse(&requirement)
        .map_err(|error| miette!("invalid version requirement '{requirement}': {error}"))?;
    manifest.apis.insert(
        id.clone(),
        ApiDependency {
            version: requirement.clone(),
            path,
            registry,
        },
    );
    let edited_manifest = edit_manifest_api(&previous_manifest, &id, manifest.apis.get(&id))?;
    let lock = resolve_lock(&root, &manifest).await?;
    let result = commit_and_install(
        &root,
        &manifest,
        &lock,
        &previous_manifest,
        previous_lock.as_deref(),
        Some(&edited_manifest),
    )
    .await?;
    print_result(format, &result, Some(format!("Added {id} {requirement}")))
}

pub async fn remove(format: OutputFormat, args: &RmArgs) -> Result<()> {
    let root = canonical_root(&args.project.root)?;
    let previous_manifest = fs::read(root.join("trellis.toml")).into_diagnostic()?;
    let previous_lock = read_optional(&root.join("trellis.lock"))?;
    let mut manifest = read_manifest(&root.join("trellis.toml"))?;
    if manifest.apis.remove(&args.api_id).is_none() {
        return Err(miette!("API '{}' is not in trellis.toml", args.api_id));
    }
    let edited_manifest = edit_manifest_api(&previous_manifest, &args.api_id, None)?;
    let lock = resolve_lock(&root, &manifest).await?;
    let result = commit_and_install(
        &root,
        &manifest,
        &lock,
        &previous_manifest,
        previous_lock.as_deref(),
        Some(&edited_manifest),
    )
    .await?;
    print_result(format, &result, Some(format!("Removed {}", args.api_id)))
}

pub async fn update(format: OutputFormat, args: &ProjectRootArgs) -> Result<()> {
    let root = canonical_root(&args.root)?;
    let manifest = read_manifest(&root.join("trellis.toml"))?;
    let previous_lock = read_optional(&root.join("trellis.lock"))?;
    let lock = resolve_lock(&root, &manifest).await?;
    write_lock(&root.join("trellis.lock"), &lock)?;
    let result = match install_root(&root, &manifest, &lock).await {
        Ok(result) => result,
        Err(error) => {
            restore_project_files(
                &root.join("trellis.toml"),
                &fs::read(root.join("trellis.toml")).into_diagnostic()?,
                &root.join("trellis.lock"),
                previous_lock.as_deref(),
            )?;
            return Err(error);
        }
    };
    print_result(format, &result, None)
}

pub async fn install(format: OutputFormat, args: &ProjectRootArgs) -> Result<()> {
    let root = canonical_root(&args.root)?;
    let manifest = read_manifest(&root.join("trellis.toml"))?;
    let lock_path = root.join("trellis.lock");
    if !lock_path.exists() {
        return Err(miette!("trellis.lock is missing; run `trellis update`"));
    }
    let lock = read_lock(&lock_path)?;
    let result = install_root(&root, &manifest, &lock).await?;
    print_result(format, &result, None)
}

pub async fn publish(format: OutputFormat, args: &PublishArgs) -> Result<()> {
    let root = canonical_root(&args.project.root)?;
    let manifest = read_manifest(&root.join("trellis.toml"))?;
    let lock = read_lock(&root.join("trellis.lock"))?;
    let install = install_root(&root, &manifest, &lock).await?;
    let registry = args
        .registry
        .as_ref()
        .or(manifest.default_registry.as_ref())
        .ok_or_else(|| miette!("publish requires --registry or default-registry"))?;
    let config = manifest
        .registries
        .get(registry)
        .ok_or_else(|| miette!("registry '{registry}' is not configured"))?;
    let mut paths = install.owned_api_paths;
    paths.sort();
    if paths.is_empty() {
        return Err(miette!("project has no owned canonical APIs to publish"));
    }
    let mut checked = Vec::new();
    for path in paths {
        let value =
            serde_json::from_slice(&fs::read(&path).into_diagnostic()?).into_diagnostic()?;
        let candidate =
            trellis_protocol::parse_api(&value).map_err(|error| miette!(error.to_string()))?;
        let (version, existing_digest) = check_publication(config, &candidate).await?;
        let id = candidate.id().to_owned();
        checked.push((candidate, id, version.to_string(), existing_digest));
    }
    let mut published = Vec::new();
    for (candidate, id, version, existing_digest) in checked {
        let (digest, changed) = match existing_digest {
            Some(digest) => (digest, false),
            None => (oci::publish(config, &candidate).await?, true),
        };
        published.push((id, version, digest, changed));
    }
    if output::is_json(format) {
        output::print_json(&published)
    } else {
        for (id, version, digest, changed) in published {
            if changed {
                println!("Published {id} {version}");
            } else {
                println!("{id} {version} already published");
            }
            println!("{}@{digest}", oci::repository(config, &id)?);
        }
        Ok(())
    }
}

async fn check_publication(
    config: &crate::project::RegistryConfig,
    candidate: &trellis_protocol::ApiArtifact,
) -> Result<(Version, Option<String>)> {
    let version = Version::parse(candidate.version()).map_err(|error| miette!(error))?;
    let versions = oci::versions(config, candidate.id()).await?;
    if versions.binary_search(&version).is_ok() {
        let remote = oci::pull_tag(config, candidate.id(), &version).await?;
        if remote.manifest_digest != oci::artifact_digest(candidate)? {
            return Err(miette!(
                "release {} {} already exists with different content",
                candidate.id(),
                version
            ));
        }
        return Ok((version, Some(remote.manifest_digest)));
    }
    if let Some(previous_version) = versions.last() {
        if version <= *previous_version {
            // Releases are monotonic; add historical backfills only when required.
            return Err(miette!(
                "release {version} must be newer than {previous_version}"
            ));
        }
        let previous = oci::pull_tag(config, candidate.id(), previous_version).await?;
        let report = trellis_protocol::compare_api_replacement(&previous.api, candidate)
            .map_err(|error| miette!(error.to_string()))?;
        if !report.compatible {
            let issues = report
                .issues
                .iter()
                .map(|issue| issue.message.as_str())
                .collect::<Vec<_>>()
                .join("; ");
            return Err(miette!("release {} {version} is not compatible with previous release {previous_version}: {issues}; use a new stable API identity such as @v2", candidate.id()));
        }
    }
    Ok((version, None))
}

fn canonical_root(root: &Path) -> Result<std::path::PathBuf> {
    root.canonicalize()
        .into_diagnostic()
        .wrap_err_with(|| format!("invalid project root {}", root.display()))
}

fn read_optional(path: &Path) -> Result<Option<Vec<u8>>> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error).into_diagnostic(),
    }
}

async fn commit_and_install(
    root: &Path,
    manifest: &ProjectManifest,
    lock: &ProjectLock,
    previous_manifest: &[u8],
    previous_lock: Option<&[u8]>,
    manifest_bytes: Option<&[u8]>,
) -> Result<PackageResult> {
    let manifest_path = root.join("trellis.toml");
    let lock_path = root.join("trellis.lock");
    write_manifest_and_lock(&manifest_path, manifest, manifest_bytes, &lock_path, lock)?;
    match install_root(root, manifest, lock).await {
        Ok(result) => Ok(result),
        Err(error) => {
            restore_project_files(&manifest_path, previous_manifest, &lock_path, previous_lock)?;
            Err(error)
        }
    }
}

fn edit_manifest_api(
    previous: &[u8],
    id: &str,
    dependency: Option<&ApiDependency>,
) -> Result<Vec<u8>> {
    let source = std::str::from_utf8(previous).into_diagnostic()?;
    let mut document = source.parse::<toml_edit::DocumentMut>().into_diagnostic()?;
    let apis = document
        .get_mut("apis")
        .and_then(toml_edit::Item::as_table_mut)
        .ok_or_else(|| miette!("trellis.toml must contain an [apis] table"))?;
    match dependency {
        Some(dependency) => {
            apis.insert(
                id,
                toml_edit::ser::to_document(dependency)
                    .into_diagnostic()?
                    .into_item(),
            );
        }
        None => {
            apis.remove(id);
        }
    }
    let bytes = document.to_string().into_bytes();
    let parsed: ProjectManifest = toml::from_slice(&bytes).into_diagnostic()?;
    parsed.validate()?;
    Ok(bytes)
}

fn resolve_path_api(
    root: &Path,
    expected_id: &str,
    dependency: &ApiDependency,
) -> Result<(String, Version, String)> {
    let path = dependency
        .path
        .as_deref()
        .ok_or_else(|| miette!("API '{expected_id}' is not a path dependency"))?;
    let (id, version, digest) = read_path_api(root, expected_id, path)?;
    let requirement = VersionReq::parse(&dependency.version).map_err(|error| miette!(error))?;
    if !requirement.matches(&version) {
        return Err(miette!(
            "{id} release {version} does not satisfy {}",
            dependency.version
        ));
    }
    Ok((id, version, digest))
}

fn read_path_api(
    root: &Path,
    expected_id: &str,
    dependency_path: &str,
) -> Result<(String, Version, String)> {
    let path = root.join(dependency_path);
    let value: serde_json::Value = serde_json::from_slice(
        &fs::read(&path)
            .into_diagnostic()
            .wrap_err_with(|| format!("failed to read API artifact {}", path.display()))?,
    )
    .into_diagnostic()
    .wrap_err_with(|| format!("failed to parse API artifact {}", path.display()))?;
    let api = trellis_protocol::parse_api(&value).map_err(|error| miette!(error.to_string()))?;
    if !expected_id.is_empty() && api.id() != expected_id {
        return Err(miette!(
            "manifest API '{expected_id}' but path contains '{}'",
            api.id()
        ));
    }
    let version = Version::parse(api.version())
        .map_err(|error| miette!("invalid release version for '{}': {error}", api.id()))?;
    let digest = api.digest().map_err(|error| miette!(error.to_string()))?;
    Ok((api.id().to_owned(), version, digest))
}

async fn resolve_lock(root: &Path, manifest: &ProjectManifest) -> Result<ProjectLock> {
    let mut api = Vec::with_capacity(manifest.apis.len());
    for (id, dependency) in &manifest.apis {
        let (version, api_digest, oci_digest) = if let Some(registry) = &dependency.registry {
            let config = manifest
                .registries
                .get(registry)
                .ok_or_else(|| miette!("registry '{registry}' is not configured"))?;
            let requirement =
                VersionReq::parse(&dependency.version).map_err(|error| miette!(error))?;
            let version = select_remote_version(config, id, Some(&requirement)).await?;
            let pulled = oci::pull_tag(config, id, &version).await?;
            (
                version,
                pulled
                    .api
                    .digest()
                    .map_err(|error| miette!(error.to_string()))?,
                Some(pulled.manifest_digest),
            )
        } else {
            let (_, version, digest) = resolve_path_api(root, id, dependency)?;
            (version, digest, None)
        };
        api.push(LockedApi {
            id: id.clone(),
            version: version.to_string(),
            api_digest,
            path: dependency.path.clone(),
            registry: dependency.registry.clone(),
            oci_digest,
        });
    }
    Ok(ProjectLock {
        format: 1,
        manifest_digest: manifest.digest()?,
        api,
    })
}

async fn install_root(
    root: &Path,
    manifest: &ProjectManifest,
    lock: &ProjectLock,
) -> Result<PackageResult> {
    if lock.manifest_digest != manifest.digest()? {
        return Err(miette!(
            "trellis.toml changed since trellis.lock; run `trellis update`"
        ));
    }
    if lock.api.len() != manifest.apis.len() {
        return Err(miette!(
            "trellis.lock does not match trellis.toml; run `trellis update`"
        ));
    }
    for locked in &lock.api {
        trellis_generation::planning::validate_output_identity("API", &locked.id)?;
        let dependency = manifest
            .apis
            .get(&locked.id)
            .ok_or_else(|| miette!("locked API '{}' is absent from trellis.toml", locked.id))?;
        if dependency.path != locked.path || dependency.registry != locked.registry {
            return Err(miette!(
                "locked path for '{}' does not match trellis.toml",
                locked.id
            ));
        }
        if dependency.path.is_some() {
            let (_, version, digest) = resolve_path_api(root, &locked.id, dependency)?;
            if version.to_string() != locked.version {
                return Err(miette!(
                    "locked {} is {} but path now contains {}; run `trellis update`",
                    locked.id,
                    locked.version,
                    version
                ));
            }
            if digest != locked.api_digest {
                return Err(miette!(
                    "locked API digest does not match canonical path artifact"
                ));
            }
        }
    }

    let discovered = trellis_generation::discovery::discover_contracts(root)?;
    let has_ts = root.join("deno.json").is_file()
        || root.join("deno.jsonc").is_file()
        || discovered
            .iter()
            .any(|item| item.language == trellis_generation::discovery::SourceLanguage::TypeScript);
    let has_rust = root.join("Cargo.toml").is_file()
        || discovered
            .iter()
            .any(|item| item.language == trellis_generation::discovery::SourceLanguage::Rust);
    if has_ts && !lock.api.is_empty() {
        let config = [root.join("deno.json"), root.join("deno.jsonc")]
            .into_iter()
            .find(|path| path.is_file())
            .ok_or_else(|| miette!("TypeScript projects require deno.json or deno.jsonc"))?;
        let contents = fs::read_to_string(config).into_diagnostic()?;
        if !contents.contains(".trellis/generated/ts/trellis-apis") {
            return Err(miette!(
                "add `.trellis/generated/ts/trellis-apis` to the root Deno `links` array"
            ));
        }
    }
    if has_rust && !lock.api.is_empty() {
        let mut package_stems = BTreeMap::new();
        for api in &lock.api {
            let stem = trellis_generation::artifacts::sdk_output_stem(&api.id);
            if let Some(existing) = package_stems.insert(stem.clone(), &api.id) {
                return Err(miette!(
                    "Rust SDK output '{stem}' collides between '{existing}' and '{}'",
                    api.id
                ));
            }
        }
        let manifest_path = root.join("Cargo.toml");
        let contents = fs::read_to_string(&manifest_path)
            .into_diagnostic()
            .wrap_err("Rust projects require a root Cargo.toml")?;
        let cargo: toml::Value = toml::from_str(&contents).into_diagnostic()?;
        let dependency = cargo
            .get("dependencies")
            .and_then(|value| value.get("trellis-apis"))
            .or_else(|| {
                cargo
                    .get("workspace")
                    .and_then(|value| value.get("dependencies"))
                    .and_then(|value| value.get("trellis-apis"))
            });
        let expected_path = ".trellis/generated/rust/trellis-apis";
        if dependency.and_then(|value| value.get("path"))
            != Some(&toml::Value::String(expected_path.to_owned()))
        {
            return Err(miette!(
                "add `trellis-apis = {{ path = \"{expected_path}\" }}` to the root Cargo.toml"
            ));
        }
    }
    let fingerprints = trellis_generation::artifacts::current_generator_fingerprints();
    let marker = trellis_protocol::digest_json(&serde_json::json!({
        "lock": lock,
        "typescript": has_ts,
        "rust": has_rust,
        "aggregateFormat": 1,
        "model": fingerprints.model,
        "tsCodegen": fingerprints.ts,
        "rustCodegen": fingerprints.rust,
        "runtimeVersion": trellis_generation::artifacts::trellis_package_version(),
    }))
    .map_err(|error| miette!(error.to_string()))?;
    let trellis_root = root.join(".trellis");
    let marker_path = trellis_root.join("install-digest");
    let dependencies_fresh = fs::read_to_string(&marker_path).ok().as_deref() == Some(&marker)
        && lock.api.iter().all(|api| {
            let materialized = trellis_root
                .join("apis")
                .join(&api.id)
                .join(&api.version)
                .join("trellis.api.json");
            let stem = api.id.split('@').next().unwrap_or(&api.id);
            let ts_out = has_ts.then(|| trellis_root.join("generated/ts/packages").join(stem));
            let rust_out = has_rust.then(|| {
                trellis_root
                    .join("generated/rust/packages")
                    .join(trellis_generation::artifacts::sdk_output_stem(&api.id))
            });
            trellis_generation::artifacts::installed_api_is_fresh(
                &api.id,
                &api.version,
                &api.api_digest,
                &materialized,
                ts_out.as_deref(),
                rust_out.as_deref(),
            )
        })
        && (!has_rust
            || ["Cargo.toml", "src/lib.rs"].iter().all(|path| {
                trellis_root
                    .join("generated/rust/trellis-apis")
                    .join(path)
                    .is_file()
            }))
        && (!has_ts
            || (trellis_root
                .join("generated/ts/trellis-apis/deno.json")
                .is_file()
                && lock.api.iter().all(|api| {
                    let stem = api.id.split('@').next().unwrap_or(&api.id);
                    [format!("{stem}.ts"), format!("{stem}.api.ts")]
                        .iter()
                        .all(|file| {
                            trellis_root
                                .join("generated/ts/trellis-apis")
                                .join(file)
                                .is_file()
                        })
                })));
    if dependencies_fresh {
        let generated = trellis_generation::project::generate_project(
            root,
            &trellis_root,
            lock.api
                .iter()
                .map(|api| (api.id.clone(), api.api_digest.clone()))
                .collect(),
        )?;
        return Ok(PackageResult {
            installed_apis: lock.api.len(),
            changed_dependencies: 0,
            generated_projects: generated.generated,
            owned_api_paths: generated.owned_api_paths,
        });
    }

    let backup_root = tempfile::Builder::new()
        .prefix(".trellis-install-backup-")
        .tempdir_in(root)
        .into_diagnostic()?;
    let backup = backup_root.path().join(".trellis");
    if trellis_root.exists() {
        fs::rename(&trellis_root, &backup).into_diagnostic()?;
    }
    let install_result: Result<PackageResult> = async {
        let changed_dependencies = stage_dependencies(
            root,
            manifest,
            lock,
            has_ts,
            has_rust,
            &trellis_root,
            &marker,
        )
        .await?;
        let generated = trellis_generation::project::generate_project(
            root,
            &trellis_root,
            lock.api
                .iter()
                .map(|api| (api.id.clone(), api.api_digest.clone()))
                .collect(),
        )?;
        Ok(PackageResult {
            installed_apis: lock.api.len(),
            changed_dependencies,
            generated_projects: generated.generated,
            owned_api_paths: generated.owned_api_paths,
        })
    }
    .await;
    match install_result {
        Ok(result) => Ok(result),
        Err(error) => {
            remove_path(&trellis_root)?;
            if backup.exists() {
                fs::rename(&backup, &trellis_root)
                    .into_diagnostic()
                    .wrap_err("failed to restore the previous .trellis installation")?;
            }
            Err(error)
        }
    }
}

fn remove_path(path: &Path) -> Result<()> {
    if path.is_dir() {
        fs::remove_dir_all(path).into_diagnostic()?;
    } else if path.exists() {
        fs::remove_file(path).into_diagnostic()?;
    }
    Ok(())
}

async fn stage_dependencies(
    root: &Path,
    manifest: &ProjectManifest,
    lock: &ProjectLock,
    has_ts: bool,
    has_rust: bool,
    trellis_root: &Path,
    marker: &str,
) -> Result<usize> {
    fs::create_dir_all(trellis_root).into_diagnostic()?;
    let staging = tempfile::Builder::new()
        .prefix(".install-")
        .tempdir_in(trellis_root)
        .into_diagnostic()?;
    let staged = staging.path();
    let mut modules = BTreeMap::new();
    for locked in &lock.api {
        let stem = locked.id.split('@').next().unwrap_or(&locked.id);
        let package_stem = trellis_generation::artifacts::sdk_output_stem(&locked.id);
        let api_out = staged
            .join("apis")
            .join(&locked.id)
            .join(&locked.version)
            .join("trellis.api.json");
        let ts_out = has_ts.then(|| staged.join("generated/ts/packages").join(stem));
        let rust_out = has_rust.then(|| staged.join("generated/rust/packages").join(&package_stem));
        let source = if let Some(path) = &locked.path {
            root.join(path)
        } else {
            let registry = locked
                .registry
                .as_ref()
                .ok_or_else(|| miette!("locked API '{}' has no registry", locked.id))?;
            let config = manifest
                .registries
                .get(registry)
                .ok_or_else(|| miette!("registry '{registry}' is not configured"))?;
            let digest = locked
                .oci_digest
                .as_deref()
                .ok_or_else(|| miette!("locked API '{}' has no OCI digest", locked.id))?;
            let pulled = oci::pull_locked(
                config,
                &locked.id,
                &locked.version,
                &locked.api_digest,
                digest,
            )
            .await?;
            let source = staged.join("oci").join(format!("{}.json", locked.id));
            fs::create_dir_all(source.parent().unwrap()).into_diagnostic()?;
            fs::write(&source, pulled.bytes).into_diagnostic()?;
            source
        };
        trellis_generation::artifacts::generate_installed_api(
            &source,
            &api_out,
            ts_out.as_deref(),
            rust_out.as_deref(),
        )?;
        if has_rust {
            let module = stem
                .strip_prefix("trellis.")
                .unwrap_or(stem)
                .replace(['.', '-'], "_");
            if let Some(existing) = modules.insert(module.clone(), locked.id.clone()) {
                return Err(miette!(
                    "Rust API module name '{module}' collides between {existing} and {}",
                    locked.id
                ));
            }
        }
    }
    if has_rust {
        write_aggregate_crate(staged, &modules)?;
    }
    if has_ts {
        write_ts_aggregate(staged, lock)?;
    }
    fs::write(staged.join("install-digest"), marker).into_diagnostic()?;
    replace_managed_paths(
        staged,
        trellis_root,
        &["apis", "generated/ts", "generated/rust", "install-digest"],
    )?;
    Ok(lock.api.len())
}

async fn select_remote_version(
    config: &crate::project::RegistryConfig,
    id: &str,
    requirement: Option<&VersionReq>,
) -> Result<Version> {
    select_version(oci::versions(config, id).await?, requirement).ok_or_else(|| {
        miette!(
            "no release of {id} satisfies {}",
            requirement.map_or("any version".to_owned(), ToString::to_string)
        )
    })
}

fn select_version(versions: Vec<Version>, requirement: Option<&VersionReq>) -> Option<Version> {
    versions
        .into_iter()
        .filter(|version| requirement.is_none_or(|requirement| requirement.matches(version)))
        .max()
}

fn replace_managed_paths(staged: &Path, root: &Path, relative_paths: &[&str]) -> Result<()> {
    let paths = relative_paths
        .iter()
        .map(|relative| {
            let destination = root.join(relative);
            let backup = destination.with_extension("trellis-install-old");
            (staged.join(relative), destination, backup)
        })
        .collect::<Vec<_>>();
    for (_, _, backup) in &paths {
        if backup.is_dir() {
            fs::remove_dir_all(backup).into_diagnostic()?;
        } else if backup.exists() {
            fs::remove_file(backup).into_diagnostic()?;
        }
    }
    for (_, destination, backup) in &paths {
        if destination.exists() {
            if let Err(error) = fs::rename(destination, backup) {
                for (_, previous_destination, previous_backup) in &paths {
                    if previous_backup.exists() {
                        let _ = fs::rename(previous_backup, previous_destination);
                    }
                }
                return Err(error).into_diagnostic();
            }
        }
    }
    for (source, destination, _) in &paths {
        if source.exists() {
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent).into_diagnostic()?;
            }
            if let Err(error) = fs::rename(source, destination) {
                for (_, moved_destination, backup) in paths.iter().rev() {
                    if moved_destination.is_dir() {
                        let _ = fs::remove_dir_all(moved_destination);
                    } else if moved_destination.exists() {
                        let _ = fs::remove_file(moved_destination);
                    }
                    if backup.exists() {
                        let _ = fs::rename(backup, moved_destination);
                    }
                }
                return Err(error).into_diagnostic();
            }
        }
    }
    for (_, _, backup) in &paths {
        if backup.is_dir() {
            let _ = fs::remove_dir_all(backup);
        } else if backup.exists() {
            let _ = fs::remove_file(backup);
        }
    }
    Ok(())
}

fn write_aggregate_crate(root: &Path, modules: &BTreeMap<String, String>) -> Result<()> {
    let aggregate = root.join("generated/rust/trellis-apis");
    fs::create_dir_all(aggregate.join("src")).into_diagnostic()?;
    let dependencies = modules
        .values()
        .map(|id| {
            let name = trellis_generation::artifacts::default_rust_crate_name_from_id(id);
            format!(
                "{name} = {{ path = \"../packages/{}\" }}\n",
                trellis_generation::artifacts::sdk_output_stem(id)
            )
        })
        .collect::<String>();
    fs::write(
        aggregate.join("Cargo.toml"),
        format!(
            "[package]\nname = \"trellis-apis\"\nversion = \"0.0.0\"\nedition = \"2021\"\npublish = false\n\n[dependencies]\n{dependencies}"
        ),
    )
    .into_diagnostic()?;
    let modules = modules
        .iter()
        .map(|(module, id)| {
            let crate_name = trellis_generation::artifacts::default_rust_crate_name_from_id(id);
            format!(
                "pub mod {module} {{\n    pub use {}::*;\n}}\n",
                crate_name.replace('-', "_")
            )
        })
        .collect::<String>();
    fs::write(aggregate.join("src/lib.rs"), modules).into_diagnostic()?;
    Ok(())
}

fn write_ts_aggregate(root: &Path, lock: &ProjectLock) -> Result<()> {
    let aggregate = root.join("generated/ts/trellis-apis");
    fs::create_dir_all(&aggregate).into_diagnostic()?;
    let mut exports = serde_json::Map::new();
    for api in &lock.api {
        let stem = api.id.split('@').next().unwrap_or(&api.id);
        let file = format!("{stem}.ts");
        exports.insert(format!("./{stem}"), serde_json::json!(format!("./{file}")));
        let api_file = format!("{stem}.api.ts");
        exports.insert(
            format!("./{stem}/api"),
            serde_json::json!(format!("./{api_file}")),
        );
        fs::write(
            aggregate.join(&file),
            format!(
                "export * from \"../packages/{stem}/mod.ts\";\nexport {{ API, API_DIGEST, API_ID }} from \"../packages/{stem}/api.ts\";\n"
            ),
        )
        .into_diagnostic()?;
        fs::write(
            aggregate.join(api_file),
            format!("export {{ API, API_DIGEST, API_ID }} from \"../packages/{stem}/api.ts\";\n"),
        )
        .into_diagnostic()?;
    }
    fs::write(
        aggregate.join("deno.json"),
        format!(
            "{}\n",
            serde_json::to_string_pretty(&serde_json::json!({
                "name": "@trellis/apis",
                "version": "0.0.0",
                "exports": exports,
                "publish": false,
            }))
            .into_diagnostic()?
        ),
    )
    .into_diagnostic()?;
    Ok(())
}

fn print_result(
    format: OutputFormat,
    result: &PackageResult,
    headline: Option<String>,
) -> Result<()> {
    if output::is_json(format) {
        output::print_json(result)
    } else {
        if let Some(headline) = headline {
            println!("{headline}");
        }
        if result.changed_dependencies == 0 && result.generated_projects == 0 {
            println!("Installed 0 changes");
        } else {
            println!("Installed {} API(s)", result.installed_apis);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use axum::{
        body::{to_bytes, Body},
        extract::State,
        http::{header::HOST, Request, Response, StatusCode},
        routing::any,
        Router,
    };
    use registry_testkit::{RegistryConfig as TestRegistryConfig, RegistryServer};

    #[derive(Clone)]
    struct PagingRegistry {
        backend: String,
        tags: Arc<Vec<String>>,
        client: reqwest::Client,
    }

    async fn paging_registry(
        State(state): State<PagingRegistry>,
        request: Request<Body>,
    ) -> Response<Body> {
        if request.uri().path().ends_with("/tags/list") {
            let last = request
                .uri()
                .query()
                .and_then(|query| query.split('&').find_map(|part| part.strip_prefix("last=")));
            let start = last
                .and_then(|last| state.tags.iter().position(|tag| tag == last))
                .map_or(0, |position| position + 1);
            let tags = state.tags.iter().skip(start).take(1).collect::<Vec<_>>();
            return Response::builder()
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&serde_json::json!({
                        "name": "acme.orders-v1",
                        "tags": tags,
                    }))
                    .unwrap(),
                ))
                .unwrap();
        }

        let (parts, body) = request.into_parts();
        let body = match to_bytes(body, usize::MAX).await {
            Ok(body) => body,
            Err(_) => return Response::new(Body::empty()),
        };
        let mut forwarded = state
            .client
            .request(parts.method, format!("{}{}", state.backend, parts.uri));
        for (name, value) in &parts.headers {
            if name != HOST {
                forwarded = forwarded.header(name, value);
            }
        }
        match forwarded.body(body).send().await {
            Ok(response) => {
                let status = response.status();
                let headers = response.headers().clone();
                match response.bytes().await {
                    Ok(body) => {
                        let mut forwarded = Response::builder().status(status);
                        for (name, value) in headers {
                            if let Some(name) = name {
                                forwarded = forwarded.header(name, value);
                            }
                        }
                        forwarded.body(Body::from(body)).unwrap()
                    }
                    Err(_) => Response::builder()
                        .status(StatusCode::BAD_GATEWAY)
                        .body(Body::empty())
                        .unwrap(),
                }
            }
            Err(_) => Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .body(Body::empty())
                .unwrap(),
        }
    }

    async fn start_paging_registry(
        backend_port: u16,
        tags: Vec<String>,
    ) -> (String, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let app = Router::new()
            .fallback(any(paging_registry))
            .with_state(PagingRegistry {
                backend: format!("http://127.0.0.1:{backend_port}"),
                tags: Arc::new(tags),
                client: reqwest::Client::new(),
            });
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (format!("127.0.0.1:{}", address.port()), task)
    }

    #[tokio::test]
    async fn paginated_releases_drive_update_and_publish_compatibility() {
        let _guard = crate::oci::TEST_ENV_LOCK.lock().await;
        let cache = tempfile::tempdir().unwrap();
        unsafe { std::env::set_var("TRELLIS_CACHE", cache.path()) };
        let backend = RegistryServer::new(TestRegistryConfig::memory())
            .await
            .unwrap();
        let tags = ["1.0.0", "1.1.0", "1.2.0"].map(str::to_owned).to_vec();
        let (prefix, proxy) = start_paging_registry(backend.port(), tags).await;
        let registry = crate::project::RegistryConfig { prefix };
        for version in ["1.0.0", "1.1.0"] {
            let api = trellis_protocol::parse_api(&serde_json::json!({
                "format": "trellis.api.v1",
                "id": "acme.orders@v1",
                "version": version,
                "displayName": "Orders",
                "description": "Orders API"
            }))
            .unwrap();
            crate::oci::publish(&registry, &api).await.unwrap();
        }
        let latest = trellis_protocol::parse_api(&serde_json::json!({
            "format": "trellis.api.v1",
            "id": "acme.orders@v1",
            "version": "1.2.0",
            "displayName": "Orders",
            "description": "Orders API",
            "schemas": {
                "Empty": { "type": "object", "properties": {}, "required": [] }
            },
            "rpc": {
                "Orders.Get": {
                    "version": "v1",
                    "input": { "schema": "Empty" },
                    "output": { "schema": "Empty" }
                }
            }
        }))
        .unwrap();
        crate::oci::publish(&registry, &latest).await.unwrap();

        let root = tempfile::tempdir().unwrap();
        crate::project::write_manifest(
            &root.path().join("trellis.toml"),
            &ProjectManifest {
                format: 1,
                default_registry: Some("local".into()),
                registries: BTreeMap::from([("local".into(), registry.clone())]),
                apis: BTreeMap::from([(
                    "acme.orders@v1".into(),
                    ApiDependency {
                        version: "^1.0".into(),
                        path: None,
                        registry: Some("local".into()),
                    },
                )]),
            },
        )
        .unwrap();
        update(
            OutputFormat::Text,
            &ProjectRootArgs {
                root: root.path().to_path_buf(),
            },
        )
        .await
        .unwrap();
        assert_eq!(
            crate::project::read_lock(&root.path().join("trellis.lock"))
                .unwrap()
                .api[0]
                .version,
            "1.2.0"
        );

        let drift = trellis_protocol::parse_api(&serde_json::json!({
            "format": "trellis.api.v1",
            "id": "acme.orders@v1",
            "version": "1.2.0",
            "displayName": "Changed Orders",
            "description": "Orders API"
        }))
        .unwrap();
        let error = check_publication(&registry, &drift).await.unwrap_err();
        assert!(error
            .to_string()
            .contains("already exists with different content"));

        let older = trellis_protocol::parse_api(&serde_json::json!({
            "format": "trellis.api.v1",
            "id": "acme.orders@v1",
            "version": "1.1.5",
            "displayName": "Orders",
            "description": "Orders API"
        }))
        .unwrap();
        let error = check_publication(&registry, &older).await.unwrap_err();
        assert!(error.to_string().contains("must be newer than 1.2.0"));

        let candidate = trellis_protocol::parse_api(&serde_json::json!({
            "format": "trellis.api.v1",
            "id": "acme.orders@v1",
            "version": "1.3.0",
            "displayName": "Orders",
            "description": "Orders API"
        }))
        .unwrap();
        let error = check_publication(&registry, &candidate).await.unwrap_err();
        assert!(error.to_string().contains("previous release 1.2.0"));
        proxy.abort();
        unsafe { std::env::remove_var("TRELLIS_CACHE") };
    }

    #[tokio::test]
    async fn publish_prunes_stale_owned_api_output_after_source_removal() {
        let root = tempfile::tempdir().unwrap();
        let manifest = ProjectManifest {
            format: 1,
            default_registry: Some("unused".into()),
            registries: BTreeMap::from([(
                "unused".into(),
                crate::project::RegistryConfig {
                    prefix: "registry.invalid".into(),
                },
            )]),
            apis: BTreeMap::new(),
        };
        crate::project::write_manifest(&root.path().join("trellis.toml"), &manifest).unwrap();
        let lock = ProjectLock {
            format: 1,
            manifest_digest: manifest.digest().unwrap(),
            api: Vec::new(),
        };
        crate::project::write_lock(&root.path().join("trellis.lock"), &lock).unwrap();
        install_root(root.path(), &manifest, &lock).await.unwrap();
        let stale = root
            .path()
            .join(".trellis/generated/protocol/apis/acme.a@v1.json");
        fs::create_dir_all(stale.parent().unwrap()).unwrap();
        fs::write(
            &stale,
            serde_json::to_vec(&serde_json::json!({
                "format": "trellis.api.v1",
                "id": "acme.a@v1",
                "version": "1.0.0",
                "displayName": "A",
                "description": "Deleted contract"
            }))
            .unwrap(),
        )
        .unwrap();

        let error = publish(
            OutputFormat::Text,
            &PublishArgs {
                registry: None,
                project: ProjectRootArgs {
                    root: root.path().to_path_buf(),
                },
            },
        )
        .await
        .unwrap_err();
        assert!(error.to_string().contains("no owned canonical APIs"));
        assert!(!stale.exists());
    }

    #[test]
    fn remote_version_selection_uses_standard_semver_prerelease_rules() {
        let versions = ["1.4.2", "1.5.0-rc.1", "1.5.0-rc.2"]
            .map(|version| Version::parse(version).unwrap())
            .to_vec();
        assert_eq!(
            select_version(
                versions.clone(),
                Some(&VersionReq::parse("^1.5.0-rc.1").unwrap())
            )
            .unwrap(),
            Version::parse("1.5.0-rc.2").unwrap()
        );
        assert_eq!(
            select_version(versions, Some(&VersionReq::parse("^1.4").unwrap())).unwrap(),
            Version::parse("1.4.2").unwrap()
        );
    }

    #[tokio::test]
    async fn remote_lock_installs_from_oci_and_global_cache() {
        let _guard = crate::oci::TEST_ENV_LOCK.lock().await;
        let root = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        unsafe { std::env::set_var("TRELLIS_CACHE", cache.path()) };
        let server = RegistryServer::new(TestRegistryConfig::memory())
            .await
            .unwrap();
        let registry = crate::project::RegistryConfig {
            prefix: format!("127.0.0.1:{}", server.port()),
        };
        let api = trellis_protocol::parse_api(&serde_json::json!({
            "format": "trellis.api.v1",
            "id": "acme.orders@v1",
            "version": "1.4.2",
            "displayName": "Orders",
            "description": "Orders API"
        }))
        .unwrap();
        let api_digest = api.digest().unwrap();
        let oci_digest = crate::oci::publish(&registry, &api).await.unwrap();
        let manifest = ProjectManifest {
            format: 1,
            default_registry: Some("local".into()),
            registries: BTreeMap::from([("local".into(), registry)]),
            apis: BTreeMap::from([(
                api.id().into(),
                ApiDependency {
                    version: "^1.4".into(),
                    path: None,
                    registry: Some("local".into()),
                },
            )]),
        };
        let lock = ProjectLock {
            format: 1,
            manifest_digest: manifest.digest().unwrap(),
            api: vec![LockedApi {
                id: api.id().into(),
                version: api.version().into(),
                api_digest,
                path: None,
                registry: Some("local".into()),
                oci_digest: Some(oci_digest),
            }],
        };

        let first = install_root(root.path(), &manifest, &lock).await.unwrap();
        assert_eq!(first.installed_apis, 1);
        let docker_config = tempfile::tempdir().unwrap();
        fs::write(docker_config.path().join("config.json"), "{").unwrap();
        unsafe { std::env::set_var("DOCKER_CONFIG", docker_config.path()) };
        assert_eq!(
            install_root(root.path(), &manifest, &lock)
                .await
                .unwrap()
                .changed_dependencies,
            0
        );
        let second = tempfile::tempdir().unwrap();
        assert_eq!(
            install_root(second.path(), &manifest, &lock)
                .await
                .unwrap()
                .installed_apis,
            1
        );
        fs::remove_dir_all(root.path().join(".trellis")).unwrap();
        let cached = install_root(root.path(), &manifest, &lock).await.unwrap();
        assert_eq!(cached.installed_apis, 1);
        assert!(root
            .path()
            .join(".trellis/apis/acme.orders@v1/1.4.2/trellis.api.json")
            .is_file());
        unsafe { std::env::remove_var("DOCKER_CONFIG") };
        unsafe { std::env::remove_var("TRELLIS_CACHE") };
    }

    #[tokio::test]
    async fn install_is_exact_and_preserves_previous_materialization_on_drift() {
        let root = tempfile::tempdir().unwrap();
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../runtime/trellis.api.json");
        fs::copy(source, root.path().join("auth.json")).unwrap();
        let manifest = ProjectManifest {
            format: 1,
            default_registry: None,
            registries: BTreeMap::new(),
            apis: BTreeMap::from([(
                "trellis.auth@v1".to_owned(),
                ApiDependency {
                    version: "^1.0".to_owned(),
                    path: Some("auth.json".to_owned()),
                    registry: None,
                },
            )]),
        };
        let lock = resolve_lock(root.path(), &manifest).await.unwrap();
        install_root(root.path(), &manifest, &lock).await.unwrap();
        let installed = root
            .path()
            .join(".trellis/apis/trellis.auth@v1/1.0.0/trellis.api.json");
        let previous = fs::read(&installed).unwrap();

        let mut changed: serde_json::Value =
            serde_json::from_slice(&fs::read(root.path().join("auth.json")).unwrap()).unwrap();
        changed["version"] = serde_json::json!("1.0.1");
        fs::write(
            root.path().join("auth.json"),
            serde_json::to_vec_pretty(&changed).unwrap(),
        )
        .unwrap();
        let error = install_root(root.path(), &manifest, &lock)
            .await
            .unwrap_err();
        assert!(error.to_string().contains("path now contains 1.0.1"));
        assert_eq!(fs::read(&installed).unwrap(), previous);

        changed["version"] = serde_json::json!("1.0.0");
        changed["schemas"]["AuthSessionsMeRequest"]["properties"]["extra"] =
            serde_json::json!({ "type": "string" });
        fs::write(
            root.path().join("auth.json"),
            serde_json::to_vec_pretty(&changed).unwrap(),
        )
        .unwrap();
        let error = install_root(root.path(), &manifest, &lock)
            .await
            .unwrap_err();
        assert!(error.to_string().contains("digest does not match"));
        assert_eq!(fs::read(installed).unwrap(), previous);
    }

    #[tokio::test]
    async fn add_update_and_remove_share_the_locked_installer() {
        let root = tempfile::tempdir().unwrap();
        fs::write(
            root.path().join("trellis.toml"),
            "# project dependencies\nformat = 1\n\n[apis]\n# keep this explanation\n",
        )
        .unwrap();
        let api_path = root.path().join("auth.json");
        let mut api = serde_json::json!({
            "format": "trellis.api.v1",
            "id": "acme.auth@v1",
            "version": "1.4.2",
            "displayName": "Auth",
            "description": "Fixture API"
        });
        fs::write(&api_path, serde_json::to_vec_pretty(&api).unwrap()).unwrap();

        add(
            OutputFormat::Text,
            &AddArgs {
                source: "auth.json".to_owned(),
                version: None,
                registry: None,
                project: ProjectRootArgs {
                    root: root.path().to_path_buf(),
                },
            },
        )
        .await
        .unwrap();
        let manifest = crate::project::read_manifest(&root.path().join("trellis.toml")).unwrap();
        assert_eq!(manifest.apis["acme.auth@v1"].version, "^1.4.2");
        assert!(fs::read_to_string(root.path().join("trellis.toml"))
            .unwrap()
            .contains("# keep this explanation"));
        let initial_lock = crate::project::read_lock(&root.path().join("trellis.lock")).unwrap();
        assert_eq!(initial_lock.api[0].version, "1.4.2");

        api["version"] = serde_json::json!("1.4.3");
        fs::write(&api_path, serde_json::to_vec_pretty(&api).unwrap()).unwrap();
        let project = ProjectRootArgs {
            root: root.path().to_path_buf(),
        };
        update(OutputFormat::Text, &project).await.unwrap();
        let updated_lock = crate::project::read_lock(&root.path().join("trellis.lock")).unwrap();
        assert_eq!(updated_lock.api[0].version, "1.4.3");
        assert_eq!(
            updated_lock.api[0].api_digest,
            initial_lock.api[0].api_digest
        );
        assert!(root
            .path()
            .join(".trellis/apis/acme.auth@v1/1.4.3/trellis.api.json")
            .is_file());
        assert!(!root
            .path()
            .join(".trellis/apis/acme.auth@v1/1.4.2")
            .exists());

        api["version"] = serde_json::json!("2.0.0");
        fs::write(&api_path, serde_json::to_vec_pretty(&api).unwrap()).unwrap();
        assert!(update(OutputFormat::Text, &project)
            .await
            .unwrap_err()
            .to_string()
            .contains("does not satisfy ^1.4.2"));
        assert_eq!(
            crate::project::read_lock(&root.path().join("trellis.lock")).unwrap(),
            updated_lock
        );

        remove(
            OutputFormat::Text,
            &RmArgs {
                api_id: "acme.auth@v1".to_owned(),
                project,
            },
        )
        .await
        .unwrap();
        assert!(
            crate::project::read_manifest(&root.path().join("trellis.toml"))
                .unwrap()
                .apis
                .is_empty()
        );
        assert!(fs::read_to_string(root.path().join("trellis.toml"))
            .unwrap()
            .contains("# keep this explanation"));
        assert!(crate::project::read_lock(&root.path().join("trellis.lock"))
            .unwrap()
            .api
            .is_empty());
        assert!(!root.path().join(".trellis/apis/acme.auth@v1").exists());
        assert!(api_path.is_file());

        let empty_lock = crate::project::read_lock(&root.path().join("trellis.lock")).unwrap();
        fs::remove_file(root.path().join("trellis.lock")).unwrap();
        assert!(install(
            OutputFormat::Text,
            &ProjectRootArgs {
                root: root.path().to_path_buf()
            }
        )
        .await
        .unwrap_err()
        .to_string()
        .contains("trellis.lock is missing"));
        crate::project::write_lock(&root.path().join("trellis.lock"), &empty_lock).unwrap();
        let mut changed_manifest =
            crate::project::read_manifest(&root.path().join("trellis.toml")).unwrap();
        changed_manifest.apis.insert(
            "acme.auth@v1".to_owned(),
            ApiDependency {
                version: "^1.4".to_owned(),
                path: Some("auth.json".to_owned()),
                registry: None,
            },
        );
        crate::project::write_manifest(&root.path().join("trellis.toml"), &changed_manifest)
            .unwrap();
        assert!(install(
            OutputFormat::Text,
            &ProjectRootArgs {
                root: root.path().to_path_buf()
            }
        )
        .await
        .unwrap_err()
        .to_string()
        .contains("trellis.toml changed since trellis.lock"));
    }

    #[tokio::test]
    async fn add_installs_a_prerelease_api() {
        let root = tempfile::tempdir().unwrap();
        crate::project::write_manifest(
            &root.path().join("trellis.toml"),
            &ProjectManifest {
                format: 1,
                default_registry: None,
                registries: BTreeMap::new(),
                apis: BTreeMap::new(),
            },
        )
        .unwrap();
        fs::write(
            root.path().join("orders.json"),
            serde_json::to_vec_pretty(&serde_json::json!({
                "format": "trellis.api.v1",
                "id": "acme.orders@v1",
                "version": "1.5.0-rc.1",
                "displayName": "Orders",
                "description": "Prerelease fixture API"
            }))
            .unwrap(),
        )
        .unwrap();

        add(
            OutputFormat::Text,
            &AddArgs {
                source: "orders.json".to_owned(),
                version: Some("^1.5.0-rc.1".to_owned()),
                registry: None,
                project: ProjectRootArgs {
                    root: root.path().to_path_buf(),
                },
            },
        )
        .await
        .unwrap();

        let lock = crate::project::read_lock(&root.path().join("trellis.lock")).unwrap();
        assert_eq!(lock.api[0].version, "1.5.0-rc.1");
        assert!(root
            .path()
            .join(".trellis/apis/acme.orders@v1/1.5.0-rc.1/trellis.api.json")
            .is_file());
        install(
            OutputFormat::Text,
            &ProjectRootArgs {
                root: root.path().to_path_buf(),
            },
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn install_bootstraps_typescript_dependency_before_participant() {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../..")
            .canonicalize()
            .unwrap();
        let root = tempfile::tempdir().unwrap();
        let mut api = serde_json::json!({
            "format": "trellis.api.v1",
            "id": "acme.auth@v1",
            "version": "1.0.0",
            "displayName": "Auth",
            "description": "Fixture API",
            "schemas": {
                "Empty": { "type": "object", "properties": {}, "required": [] },
                "Session": {
                    "type": "object",
                    "properties": { "id": { "type": "string" } },
                    "required": ["id"]
                }
            },
            "rpc": {
                "Auth.Sessions.Me": {
                    "version": "v1",
                    "input": { "schema": "Empty" },
                    "output": { "schema": "Session" }
                }
            }
        });
        fs::write(
            root.path().join("auth.json"),
            serde_json::to_vec_pretty(&api).unwrap(),
        )
        .unwrap();
        fs::write(
            root.path().join("deno.json"),
            format!(
                r#"{{
  "links": [".trellis/generated/ts/trellis-apis"],
  "imports": {{
    "@qlever-llc/trellis": "file://{0}/ts/packages/trellis/index.ts",
    "@qlever-llc/trellis/": "file://{0}/ts/packages/trellis/",
    "@qlever-llc/trellis/contracts": "file://{0}/ts/packages/trellis/contracts.ts",
    "@trellis/apis/acme.auth": "./.trellis/generated/ts/trellis-apis/acme.auth.ts"
  }}
}}
"#,
                repo.display()
            ),
        )
        .unwrap();
        fs::write(
            root.path().join("package.json"),
            "{\"name\":\"consumer\",\"version\":\"1.0.0\"}\n",
        )
        .unwrap();
        fs::write(
            root.path().join("contract.ts"),
            r#"import { defineAppContract } from "@qlever-llc/trellis";
import { AuthSessionsMe } from "@trellis/apis/acme.auth";

export default defineAppContract(() => ({
  id: "acme.consumer@v1",
  apiId: "acme.consumer-api@v1",
  apiVersion: "1.0.0",
  displayName: "Consumer",
  description: "Consumer fixture",
  uses: [AuthSessionsMe],
}));
"#,
        )
        .unwrap();
        let manifest = ProjectManifest {
            format: 1,
            default_registry: None,
            registries: BTreeMap::new(),
            apis: BTreeMap::from([(
                "acme.auth@v1".to_owned(),
                ApiDependency {
                    version: "^1.0".to_owned(),
                    path: Some("auth.json".to_owned()),
                    registry: None,
                },
            )]),
        };
        let lock = resolve_lock(root.path(), &manifest).await.unwrap();

        install_root(root.path(), &manifest, &lock).await.unwrap();
        let participant: serde_json::Value = serde_json::from_slice(
            &fs::read(
                root.path()
                    .join(".trellis/generated/protocol/participants/acme.consumer@v1.json"),
            )
            .unwrap(),
        )
        .unwrap();
        let used = participant["uses"]["required"]
            .as_object()
            .unwrap()
            .values()
            .next()
            .unwrap();
        assert_eq!(used["api"], "acme.auth@v1");
        assert_eq!(used["apiDigest"], lock.api[0].api_digest);

        let warm = install_root(root.path(), &manifest, &lock).await.unwrap();
        assert_eq!(warm.changed_dependencies, 0);
        assert_eq!(warm.generated_projects, 0);

        let aggregate_export = root
            .path()
            .join(".trellis/generated/ts/trellis-apis/acme.auth.ts");
        fs::remove_file(&aggregate_export).unwrap();
        let repaired = install_root(root.path(), &manifest, &lock).await.unwrap();
        assert!(repaired.changed_dependencies > 0);
        assert!(aggregate_export.is_file());
        let api_export = root
            .path()
            .join(".trellis/generated/ts/trellis-apis/acme.auth.api.ts");
        fs::remove_file(&api_export).unwrap();
        let repaired = install_root(root.path(), &manifest, &lock).await.unwrap();
        assert!(repaired.changed_dependencies > 0);
        assert!(api_export.is_file());
        let warm = install_root(root.path(), &manifest, &lock).await.unwrap();
        assert_eq!(warm.changed_dependencies, 0);
        assert_eq!(warm.generated_projects, 0);

        let participant_path = root
            .path()
            .join(".trellis/generated/protocol/participants/acme.consumer@v1.json");
        let owned_api_path = root
            .path()
            .join(".trellis/generated/protocol/apis/acme.consumer-api@v1.json");
        let owned_sdk_path = root
            .path()
            .join(".trellis/generated/packages/jsr/acme-consumer-api");
        assert!(owned_api_path.is_file());
        assert!(participant_path.is_file());
        assert!(owned_sdk_path.is_dir());
        let previous_participant = fs::read(&participant_path).unwrap();
        api["version"] = serde_json::json!("1.0.1");
        fs::write(
            root.path().join("auth.json"),
            serde_json::to_vec_pretty(&api).unwrap(),
        )
        .unwrap();
        let next_lock = resolve_lock(root.path(), &manifest).await.unwrap();
        let source = fs::read_to_string(root.path().join("contract.ts")).unwrap();
        fs::write(
            root.path().join("contract.ts"),
            format!("throw new Error(\"fixture failure\");\n{source}"),
        )
        .unwrap();
        assert!(install_root(root.path(), &manifest, &next_lock)
            .await
            .is_err());
        assert!(root
            .path()
            .join(".trellis/apis/acme.auth@v1/1.0.0/trellis.api.json")
            .is_file());
        assert!(!root
            .path()
            .join(".trellis/apis/acme.auth@v1/1.0.1")
            .exists());
        assert_eq!(fs::read(&participant_path).unwrap(), previous_participant);

        fs::remove_file(root.path().join("contract.ts")).unwrap();
        api["version"] = serde_json::json!("1.0.0");
        fs::write(
            root.path().join("auth.json"),
            serde_json::to_vec_pretty(&api).unwrap(),
        )
        .unwrap();
        install_root(root.path(), &manifest, &lock).await.unwrap();
        assert!(aggregate_export.is_file());
        assert!(!owned_api_path.exists());
        assert!(!participant_path.exists());
        assert!(!owned_sdk_path.exists());
    }

    #[tokio::test]
    async fn install_bootstraps_rust_dependency_before_participant() {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../..")
            .canonicalize()
            .unwrap();
        let root = tempfile::tempdir().unwrap();
        let api = serde_json::json!({
            "format": "trellis.api.v1",
            "id": "trellis.jobs@v1",
            "version": "1.0.0",
            "displayName": "Auth",
            "description": "Fixture API",
            "schemas": {
                "Empty": { "type": "object", "properties": {}, "required": [] },
                "Session": {
                    "type": "object",
                    "properties": { "id": { "type": "string" } },
                    "required": ["id"]
                }
            },
            "rpc": {
                "Auth.Sessions.Me": {
                    "version": "v1",
                    "input": { "schema": "Empty" },
                    "output": { "schema": "Session" }
                }
            }
        });
        fs::write(
            root.path().join("auth.json"),
            serde_json::to_vec_pretty(&api).unwrap(),
        )
        .unwrap();
        fs::create_dir(root.path().join("contracts")).unwrap();
        fs::create_dir(root.path().join("src")).unwrap();
        fs::write(root.path().join("src/lib.rs"), "").unwrap();
        fs::write(
            root.path().join("Cargo.toml"),
            format!(
                "[package]\nname = \"consumer\"\nversion = \"0.4.0\"\nedition = \"2021\"\n\n[dependencies]\nserde_json = \"1\"\ntrellis-contracts = {{ path = \"{}/rust/crates/contracts\" }}\ntrellis-apis = {{ path = \".trellis/generated/rust/trellis-apis\" }}\n",
                repo.display()
            ),
        )
        .unwrap();
        fs::write(
            root.path().join("contracts/consumer.rs"),
            r#"use trellis_apis::jobs::{api::API_JSON, rpc::AuthSessionsMeRpc, API_ID};
use trellis_contracts::{use_contract, ApiArtifact, ApiBuilder, ContractArtifacts, ContractBuilder, ContractKind, ContractsError};

pub fn api_artifact() -> Result<ApiArtifact, ContractsError> {
    ApiBuilder::new(serde_json::json!({
        "format": "trellis.api.v1",
        "id": "acme.consumer-api@v1",
        "version": "2.3.4",
        "displayName": "Consumer",
        "description": "Consumer fixture"
    })).build()
}

pub fn contract_artifacts() -> Result<ContractArtifacts, ContractsError> {
    let _ = std::any::TypeId::of::<AuthSessionsMeRpc>();
    ContractBuilder::authoring("acme.consumer@v1", "acme.consumer-api@v1", "2.3.4", "Consumer", "Consumer fixture", ContractKind::App)
        .use_ref("jobs", use_contract(API_ID).with_rpc_call(["Auth.Sessions.Me"]))
        .referenced_api(API_ID, serde_json::from_str(API_JSON)?)
        .build()
}
"#,
        )
        .unwrap();
        let manifest = ProjectManifest {
            format: 1,
            default_registry: None,
            registries: BTreeMap::new(),
            apis: BTreeMap::from([(
                "trellis.jobs@v1".to_owned(),
                ApiDependency {
                    version: "^1.0".to_owned(),
                    path: Some("auth.json".to_owned()),
                    registry: None,
                },
            )]),
        };
        let lock = resolve_lock(root.path(), &manifest).await.unwrap();

        install_root(root.path(), &manifest, &lock).await.unwrap();
        let participant: serde_json::Value = serde_json::from_slice(
            &fs::read(
                root.path()
                    .join(".trellis/generated/protocol/participants/acme.consumer@v1.json"),
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(
            participant["uses"]["required"]["jobs"]["api"],
            "trellis.jobs@v1"
        );
        assert_eq!(
            participant["uses"]["required"]["jobs"]["apiDigest"],
            lock.api[0].api_digest
        );
        assert!(root
            .path()
            .join(".trellis/generated/rust/trellis-apis/src/lib.rs")
            .is_file());
        let own_sdk_path = root
            .path()
            .join(".trellis/generated/packages/cargo/acme-consumer-api/Cargo.toml");
        let own_sdk = fs::read_to_string(&own_sdk_path).unwrap();
        assert!(own_sdk.contains("version = \"2.3.4\""));
        assert!(own_sdk.contains(&format!(
            "trellis-rs = \"{}\"",
            trellis_generation::artifacts::trellis_package_version()
        )));
        let participant_facade_path = root
            .path()
            .join(".trellis/generated/packages/cargo-participants/acme-consumer/Cargo.toml");
        let participant_facade = fs::read_to_string(&participant_facade_path).unwrap();
        assert!(participant_facade.contains("version = \"0.4.0\""));
        assert!(participant_facade.contains(&format!(
            "trellis-rs = \"{}\"",
            trellis_generation::artifacts::trellis_package_version()
        )));

        let cargo_manifest = root.path().join("Cargo.toml");
        fs::write(
            &cargo_manifest,
            fs::read_to_string(&cargo_manifest).unwrap().replacen(
                "version = \"0.4.0\"",
                "version = \"0.5.0\"",
                1,
            ),
        )
        .unwrap();
        install_root(root.path(), &manifest, &lock).await.unwrap();
        assert_eq!(fs::read_to_string(&own_sdk_path).unwrap(), own_sdk);
        let updated_participant_facade = fs::read_to_string(&participant_facade_path).unwrap();
        assert!(updated_participant_facade.contains("version = \"0.5.0\""));
        assert_ne!(updated_participant_facade, participant_facade);

        let aggregate_lib = root
            .path()
            .join(".trellis/generated/rust/trellis-apis/src/lib.rs");
        fs::remove_file(&aggregate_lib).unwrap();
        let repaired = install_root(root.path(), &manifest, &lock).await.unwrap();
        assert!(repaired.changed_dependencies > 0);
        assert!(aggregate_lib.is_file());
        let warm = install_root(root.path(), &manifest, &lock).await.unwrap();
        assert_eq!(warm.changed_dependencies, 0);
        assert_eq!(warm.generated_projects, 0);

        fs::remove_file(root.path().join("contracts/consumer.rs")).unwrap();
        install_root(root.path(), &manifest, &lock).await.unwrap();
        assert!(aggregate_lib.is_file());
    }
}

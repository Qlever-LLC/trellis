//! OCI distribution, Docker credentials, and the content-addressed API cache.

use std::{
    collections::{BTreeMap, BTreeSet},
    fmt::Write as _,
    fs,
    path::PathBuf,
    str::FromStr,
};

use docker_credential::{CredentialRetrievalError, DockerCredential};
use miette::{miette, IntoDiagnostic, Result, WrapErr};
use oci_client::{
    client::{Client, ClientConfig, ClientProtocol, Config, ImageLayer},
    errors::{OciDistributionError, OciErrorCode},
    manifest::{OciImageManifest, OCI_IMAGE_MEDIA_TYPE},
    secrets::RegistryAuth,
    Reference,
};
use sha2::{Digest, Sha256};

use crate::project::RegistryConfig;

pub const API_MEDIA_TYPE: &str = "application/vnd.trellis.api.v1+json";
const EMPTY_CONFIG_MEDIA_TYPE: &str = "application/vnd.oci.empty.v1+json";
const EMPTY_CONFIG_DIGEST: &str =
    "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a";
#[cfg(test)]
pub(crate) static TEST_ENV_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Exact validated bytes and distribution identity for one OCI API release.
#[derive(Debug)]
pub struct PulledApi {
    /// Parsed canonical API.
    pub api: trellis_protocol::ApiArtifact,
    /// Exact canonical API layer bytes.
    pub bytes: Vec<u8>,
    /// Exact raw OCI manifest bytes.
    pub manifest_bytes: Vec<u8>,
    /// Exact OCI manifest digest.
    pub manifest_digest: String,
}

/// Derive the one OCI repository owned by a stable API ID.
pub fn repository(config: &RegistryConfig, api_id: &str) -> Result<String> {
    let (name, major) = api_id
        .rsplit_once("@v")
        .ok_or_else(|| miette!("invalid API id '{api_id}'"))?;
    // API IDs map directly until a real registry requires overrides.
    let repository = format!("{}/{name}-v{major}", config.prefix.trim_end_matches('/'));
    Reference::from_str(&format!("{repository}:probe"))
        .map_err(|error| miette!("invalid OCI repository for '{api_id}': {error}"))?;
    Ok(repository)
}

/// List every valid SemVer release tag in one API repository.
pub async fn versions(config: &RegistryConfig, api_id: &str) -> Result<Vec<semver::Version>> {
    let reference = Reference::from_str(&format!("{}:probe", repository(config, api_id)?))
        .map_err(|error| miette!(error.to_string()))?;
    let auth = registry_auth(reference.resolve_registry())?;
    let client = client(reference.resolve_registry())?;
    let mut tags = Vec::new();
    let mut cursors = BTreeSet::new();
    let mut last = None;
    loop {
        let response = match client
            .list_tags(&reference, &auth, Some(100), last.as_deref())
            .await
        {
            Ok(response) => response,
            Err(error) if tags.is_empty() && missing_repository(&error) => return Ok(Vec::new()),
            Err(error) => return Err(miette!("failed to list releases for '{api_id}': {error}")),
        };
        let Some(next) = response.tags.last().cloned() else {
            break;
        };
        if !cursors.insert(next.clone()) {
            return Err(miette!(
                "registry returned a non-advancing tag page for '{api_id}'"
            ));
        }
        tags.extend(response.tags);
        last = Some(next);
    }
    let mut versions = tags
        .into_iter()
        .filter_map(|tag| semver::Version::parse(&tag).ok())
        .collect::<Vec<_>>();
    versions.sort();
    versions.dedup();
    Ok(versions)
}

/// Pull and validate a tagged API release.
pub async fn pull_tag(
    config: &RegistryConfig,
    api_id: &str,
    version: &semver::Version,
) -> Result<PulledApi> {
    let reference = Reference::from_str(&format!("{}:{version}", repository(config, api_id)?))
        .map_err(|error| miette!(error.to_string()))?;
    let pulled = pull_reference(&reference).await?;
    validate_api(&pulled, api_id, &version.to_string(), None)?;
    write_cache(&pulled)?;
    Ok(pulled)
}

/// Read a locked API from cache or pull its exact manifest digest.
pub async fn pull_locked(
    config: &RegistryConfig,
    api_id: &str,
    version: &str,
    api_digest: &str,
    manifest_digest: &str,
) -> Result<PulledApi> {
    match read_cache(manifest_digest) {
        Ok(pulled) => {
            if validate_api(&pulled, api_id, version, Some(api_digest)).is_ok() {
                return Ok(pulled);
            }
            let _ = fs::remove_dir_all(cache_entry(manifest_digest)?);
        }
        Err(_) => {
            let _ = fs::remove_dir_all(cache_entry(manifest_digest)?);
        }
    }
    let reference = Reference::from_str(&format!(
        "{}@{manifest_digest}",
        repository(config, api_id)?
    ))
    .map_err(|error| miette!(error.to_string()))?;
    let pulled = pull_reference(&reference)
        .await
        .wrap_err_with(|| format!("locked OCI artifact {manifest_digest} is unavailable"))?;
    if pulled.manifest_digest != manifest_digest {
        return Err(miette!("OCI manifest digest differs from lock"));
    }
    validate_api(&pulled, api_id, version, Some(api_digest))?;
    write_cache(&pulled)?;
    Ok(pulled)
}

/// Build and publish one deterministic canonical API artifact.
pub async fn publish(
    config: &RegistryConfig,
    api: &trellis_protocol::ApiArtifact,
) -> Result<String> {
    let version = semver::Version::parse(api.version())
        .map_err(|error| miette!("invalid API release version: {error}"))?;
    let reference = Reference::from_str(&format!("{}:{version}", repository(config, api.id())?))
        .map_err(|error| miette!(error.to_string()))?;
    let auth = registry_auth(reference.resolve_registry())?;
    let (layer, config_blob, manifest, expected_digest) = artifact(api)?;
    client(reference.resolve_registry())?
        .push(&reference, &[layer], config_blob, &auth, Some(manifest))
        .await
        .map_err(|error| miette!("failed to publish {}: {error}", api.id()))?;
    let pulled = pull_reference(&reference).await?;
    if pulled.manifest_digest != expected_digest {
        return Err(miette!("registry stored a different OCI manifest digest"));
    }
    validate_api(
        &pulled,
        api.id(),
        api.version(),
        Some(&api.digest().map_err(|e| miette!(e.to_string()))?),
    )?;
    Ok(pulled.manifest_digest)
}

/// Compute the deterministic OCI manifest digest without contacting a registry.
pub fn artifact_digest(api: &trellis_protocol::ApiArtifact) -> Result<String> {
    Ok(artifact(api)?.3)
}

fn artifact(
    api: &trellis_protocol::ApiArtifact,
) -> Result<(ImageLayer, Config, OciImageManifest, String)> {
    let bytes = api
        .canonical_json()
        .map_err(|error| miette!(error.to_string()))?
        .into_bytes();
    let layer = ImageLayer::new(bytes, API_MEDIA_TYPE.to_owned(), None);
    let config = Config::new(b"{}".as_slice(), EMPTY_CONFIG_MEDIA_TYPE.to_owned(), None);
    let mut annotations = BTreeMap::new();
    annotations.insert("dev.trellis.api.id".to_owned(), api.id().to_owned());
    annotations.insert(
        "dev.trellis.api.version".to_owned(),
        api.version().to_owned(),
    );
    annotations.insert(
        "dev.trellis.api.digest".to_owned(),
        api.digest().map_err(|error| miette!(error.to_string()))?,
    );
    let mut manifest =
        OciImageManifest::build(std::slice::from_ref(&layer), &config, Some(annotations));
    manifest.media_type = Some(OCI_IMAGE_MEDIA_TYPE.to_owned());
    manifest.artifact_type = Some(API_MEDIA_TYPE.to_owned());
    let bytes =
        trellis_protocol::canonicalize_json(&serde_json::to_value(&manifest).into_diagnostic()?)
            .map_err(|error| miette!(error.to_string()))?;
    let digest = sha256(bytes.as_bytes());
    Ok((layer, config, manifest, digest))
}

async fn pull_reference(reference: &Reference) -> Result<PulledApi> {
    let client = client(reference.resolve_registry())?;
    let auth = registry_auth(reference.resolve_registry())?;
    let (manifest_bytes, manifest_digest) = client
        .pull_manifest_raw(reference, &auth, &[OCI_IMAGE_MEDIA_TYPE])
        .await
        .map_err(|error| miette!("failed to pull {reference}: {error}"))?;
    if sha256(&manifest_bytes) != manifest_digest {
        return Err(miette!(
            "registry returned a manifest with the wrong digest"
        ));
    }
    let manifest: OciImageManifest = serde_json::from_slice(&manifest_bytes)
        .into_diagnostic()
        .wrap_err("invalid OCI image manifest")?;
    validate_manifest(&manifest)?;
    let mut bytes = Vec::new();
    client
        .pull_blob(reference, &manifest.layers[0], &mut bytes)
        .await
        .map_err(|error| miette!("failed to pull Trellis API layer: {error}"))?;
    if sha256(&bytes) != manifest.layers[0].digest {
        return Err(miette!("Trellis API layer digest mismatch"));
    }
    let value = serde_json::from_slice(&bytes).into_diagnostic()?;
    let api = trellis_protocol::parse_api(&value).map_err(|error| miette!(error.to_string()))?;
    Ok(PulledApi {
        api,
        bytes,
        manifest_bytes: manifest_bytes.to_vec(),
        manifest_digest,
    })
}

fn validate_manifest(manifest: &OciImageManifest) -> Result<()> {
    if manifest.schema_version != 2
        || manifest.media_type.as_deref() != Some(OCI_IMAGE_MEDIA_TYPE)
        || manifest.artifact_type.as_deref() != Some(API_MEDIA_TYPE)
        || manifest.config.media_type != EMPTY_CONFIG_MEDIA_TYPE
        || manifest.config.digest != EMPTY_CONFIG_DIGEST
        || manifest.config.size != 2
        || manifest.layers.len() != 1
        || manifest.layers[0].media_type != API_MEDIA_TYPE
    {
        return Err(miette!(
            "OCI artifact is not a Trellis API v1 image manifest"
        ));
    }
    Ok(())
}

fn validate_api(pulled: &PulledApi, id: &str, version: &str, digest: Option<&str>) -> Result<()> {
    if pulled.bytes
        != pulled
            .api
            .canonical_json()
            .map_err(|error| miette!(error.to_string()))?
            .as_bytes()
    {
        return Err(miette!("remote API layer is not canonical Trellis JSON"));
    }
    if pulled.api.id() != id {
        return Err(miette!("remote '{id}' contains API '{}'", pulled.api.id()));
    }
    if pulled.api.version() != version {
        return Err(miette!(
            "remote {id}:{version} contains API version {}",
            pulled.api.version()
        ));
    }
    let actual = pulled
        .api
        .digest()
        .map_err(|error| miette!(error.to_string()))?;
    if digest.is_some_and(|expected| expected != actual) {
        return Err(miette!("Trellis API semantic digest differs from lock"));
    }
    Ok(())
}

fn registry_auth(host: &str) -> Result<RegistryAuth> {
    let config = std::env::var_os("DOCKER_CONFIG")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".docker")))
        .map(|directory| directory.join("config.json"));
    if config.as_ref().is_none_or(|path| !path.exists()) {
        return Ok(RegistryAuth::Anonymous);
    }
    credential_auth(docker_credential::get_credential(host), host)
}

fn credential_auth(
    credential: std::result::Result<DockerCredential, CredentialRetrievalError>,
    host: &str,
) -> Result<RegistryAuth> {
    match credential {
        Ok(DockerCredential::UsernamePassword(username, password)) => {
            Ok(RegistryAuth::Basic(username, password))
        }
        Ok(DockerCredential::IdentityToken(token)) => Ok(RegistryAuth::Bearer(token)),
        Err(
            CredentialRetrievalError::ConfigNotFound
            | CredentialRetrievalError::NoCredentialConfigured,
        ) => Ok(RegistryAuth::Anonymous),
        Err(CredentialRetrievalError::HelperFailure { .. }) => Err(miette!(
            "configured Docker credential helper failed for {host}"
        )),
        Err(CredentialRetrievalError::HelperCommunicationError) => Err(miette!(
            "failed to start the configured Docker credential helper for {host}"
        )),
        Err(_) => Err(miette!(
            "Docker credential configuration for {host} is malformed"
        )),
    }
}

fn client(host: &str) -> Result<Client> {
    let loopback = host.starts_with("localhost:") || host.starts_with("127.0.0.1:");
    Client::try_from(ClientConfig {
        protocol: if loopback {
            ClientProtocol::HttpsExcept(vec![host.to_owned()])
        } else {
            ClientProtocol::Https
        },
        ..ClientConfig::default()
    })
    .map_err(|error| miette!("failed to configure OCI client: {error}"))
}

fn missing_repository(error: &OciDistributionError) -> bool {
    match error {
        OciDistributionError::RegistryError { envelope, .. } => envelope
            .errors
            .iter()
            .all(|error| error.code == OciErrorCode::NameUnknown),
        OciDistributionError::ServerError { code: 404, .. } => true,
        _ => false,
    }
}

fn cache_root() -> PathBuf {
    std::env::var_os("TRELLIS_CACHE")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("XDG_CACHE_HOME").map(|path| PathBuf::from(path).join("trellis"))
        })
        .or_else(|| std::env::var_os("HOME").map(|path| PathBuf::from(path).join(".cache/trellis")))
        .unwrap_or_else(|| std::env::temp_dir().join(format!("trellis-{}", std::process::id())))
        .join("oci")
}

fn cache_entry(digest: &str) -> Result<PathBuf> {
    let hex = digest
        .strip_prefix("sha256:")
        .filter(|value| value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .ok_or_else(|| miette!("invalid OCI manifest digest '{digest}'"))?;
    Ok(cache_root().join("sha256").join(hex))
}

fn read_cache(digest: &str) -> Result<PulledApi> {
    let entry = cache_entry(digest)?;
    let manifest_bytes = fs::read(entry.join("manifest.json")).into_diagnostic()?;
    if sha256(&manifest_bytes) != digest {
        return Err(miette!("cached OCI manifest digest mismatch"));
    }
    let manifest: OciImageManifest = serde_json::from_slice(&manifest_bytes).into_diagnostic()?;
    validate_manifest(&manifest)?;
    let bytes = fs::read(entry.join("api.json")).into_diagnostic()?;
    if sha256(&bytes) != manifest.layers[0].digest {
        return Err(miette!("cached OCI layer digest mismatch"));
    }
    let value = serde_json::from_slice(&bytes).into_diagnostic()?;
    let api = trellis_protocol::parse_api(&value).map_err(|error| miette!(error.to_string()))?;
    Ok(PulledApi {
        api,
        bytes,
        manifest_bytes,
        manifest_digest: digest.to_owned(),
    })
}

fn write_cache(pulled: &PulledApi) -> Result<()> {
    let destination = cache_entry(&pulled.manifest_digest)?;
    if destination.is_dir() {
        if read_cache(&pulled.manifest_digest).is_ok() {
            return Ok(());
        }
        fs::remove_dir_all(&destination).into_diagnostic()?;
    }
    let parent = destination
        .parent()
        .ok_or_else(|| miette!("invalid cache path"))?;
    fs::create_dir_all(parent).into_diagnostic()?;
    let staging = tempfile::Builder::new()
        .prefix(".pull-")
        .tempdir_in(parent)
        .into_diagnostic()?;
    fs::write(staging.path().join("api.json"), &pulled.bytes).into_diagnostic()?;
    fs::write(staging.path().join("manifest.json"), &pulled.manifest_bytes).into_diagnostic()?;
    fs::File::open(staging.path().join("api.json"))
        .into_diagnostic()?
        .sync_all()
        .into_diagnostic()?;
    fs::File::open(staging.path().join("manifest.json"))
        .into_diagnostic()?
        .sync_all()
        .into_diagnostic()?;
    // Identical digest writers race benignly; the first complete rename wins.
    if let Err(error) = fs::rename(staging.path(), &destination) {
        if !destination.is_dir() {
            return Err(error).into_diagnostic();
        }
    }
    Ok(())
}

fn sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .fold("sha256:".to_owned(), |mut output, byte| {
            write!(output, "{byte:02x}").expect("writing to a String cannot fail");
            output
        })
}

#[cfg(test)]
mod tests {
    use registry_testkit::{RegistryConfig as TestRegistryConfig, RegistryServer};

    use super::*;

    #[test]
    fn rejects_noncanonical_api_layer_bytes() {
        let value = serde_json::json!({
            "format": "trellis.api.v1",
            "id": "acme.orders@v1",
            "version": "1.4.2",
            "displayName": "Orders",
            "description": "Orders API"
        });
        let api = trellis_protocol::parse_api(&value).unwrap();
        let pulled = PulledApi {
            api,
            bytes: serde_json::to_vec_pretty(&value).unwrap(),
            manifest_bytes: Vec::new(),
            manifest_digest: "sha256:test".into(),
        };

        assert!(validate_api(&pulled, "acme.orders@v1", "1.4.2", None)
            .unwrap_err()
            .to_string()
            .contains("not canonical"));
    }

    #[tokio::test]
    async fn publishes_pulls_and_repairs_exact_cached_api_artifacts() {
        let _guard = TEST_ENV_LOCK.lock().await;
        let cache = tempfile::tempdir().unwrap();
        std::env::set_var("TRELLIS_CACHE", cache.path());
        let server = RegistryServer::new(TestRegistryConfig::memory())
            .await
            .unwrap();
        let config = RegistryConfig {
            prefix: format!("127.0.0.1:{}", server.port()),
        };
        let value = serde_json::json!({
            "format": "trellis.api.v1",
            "id": "acme.orders@v1",
            "version": "1.4.2",
            "displayName": "Orders",
            "description": "Orders API"
        });
        let api = trellis_protocol::parse_api(&value).unwrap();
        let api_digest = api.digest().unwrap();
        assert!(versions(&config, api.id()).await.unwrap().is_empty());
        let first = publish(&config, &api).await.unwrap();
        assert_eq!(publish(&config, &api).await.unwrap(), first);
        let pulled = pull_locked(&config, api.id(), api.version(), &api_digest, &first)
            .await
            .unwrap();
        assert_eq!(pulled.api.digest().unwrap(), api_digest);
        fs::write(cache_entry(&first).unwrap().join("api.json"), b"corrupt").unwrap();
        let repaired = pull_locked(&config, api.id(), api.version(), &api_digest, &first)
            .await
            .unwrap();
        assert_eq!(repaired.bytes, api.canonical_json().unwrap().as_bytes());
        assert_eq!(read_cache(&first).unwrap().bytes, repaired.bytes);

        let mut next = value;
        next["version"] = serde_json::json!("1.4.3");
        let next = trellis_protocol::parse_api(&next).unwrap();
        assert_eq!(next.digest().unwrap(), api_digest);
        assert_ne!(publish(&config, &next).await.unwrap(), first);
        std::env::remove_var("TRELLIS_CACHE");
    }

    #[test]
    fn maps_docker_credentials_without_exposing_secrets() {
        assert_eq!(
            credential_auth(
                Ok(DockerCredential::UsernamePassword(
                    "user".into(),
                    "secret".into()
                )),
                "registry.example"
            )
            .unwrap(),
            RegistryAuth::Basic("user".into(), "secret".into())
        );
        assert_eq!(
            credential_auth(
                Ok(DockerCredential::IdentityToken("token".into())),
                "registry.example"
            )
            .unwrap(),
            RegistryAuth::Bearer("token".into())
        );
        assert_eq!(
            credential_auth(
                Err(CredentialRetrievalError::ConfigNotFound),
                "registry.example"
            )
            .unwrap(),
            RegistryAuth::Anonymous
        );
        assert!(credential_auth(
            Err(CredentialRetrievalError::ConfigReadError),
            "registry.example"
        )
        .is_err());
        let helper_error = credential_auth(
            Err(CredentialRetrievalError::HelperFailure {
                helper: "test".into(),
                stdout: "secret-token".into(),
                stderr: "secret-password".into(),
            }),
            "registry.example",
        )
        .unwrap_err()
        .to_string();
        assert!(!helper_error.contains("secret"));
    }
}

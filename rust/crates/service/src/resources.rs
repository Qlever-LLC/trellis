use std::{fmt, future::Future, io::Cursor};

use async_nats::jetstream::object_store::GetErrorKind;
use bytes::Bytes;
use futures_util::{StreamExt, TryStreamExt};
use tokio::io::AsyncReadExt;

use crate::{KvResourceBinding, ServerError, StoreResourceBinding};

/// Runtime seam used to open service-owned resources from bootstrap bindings.
pub trait ResourceRuntimeClient {
    /// KV client type returned for a bound KV resource.
    type Kv: KvResourceClient;
    /// Object-store client type returned for a bound store resource.
    type Store: StoreResourceClient;

    /// Open the concrete KV bucket described by `binding`.
    fn open_kv(
        &self,
        binding: &KvResourceBinding,
    ) -> impl Future<Output = Result<Self::Kv, ServerError>> + Send;

    /// Open the concrete object-store bucket described by `binding`.
    fn open_store(
        &self,
        binding: &StoreResourceBinding,
    ) -> impl Future<Output = Result<Self::Store, ServerError>> + Send;
}

/// Operations required by a high-level bound KV resource handle.
pub trait KvResourceClient: Clone + fmt::Debug + Send + Sync + 'static {
    /// Read the latest bytes for `key`, or `None` when the key is absent.
    fn get(&self, key: &str) -> impl Future<Output = Result<Option<Bytes>, ServerError>> + Send;

    /// Persist `value` at `key`.
    fn put(&self, key: &str, value: Bytes) -> impl Future<Output = Result<(), ServerError>> + Send;

    /// List active keys in this bucket.
    fn list(&self) -> impl Future<Output = Result<Vec<String>, ServerError>> + Send;

    /// Delete `key` from this bucket.
    fn delete(&self, key: &str) -> impl Future<Output = Result<(), ServerError>> + Send;
}

/// Operations required by a high-level bound object-store resource handle.
pub trait StoreResourceClient: Clone + fmt::Debug + Send + Sync + 'static {
    /// Read all bytes for `key`, or `None` when the object is absent.
    fn read(&self, key: &str) -> impl Future<Output = Result<Option<Bytes>, ServerError>> + Send;

    /// Persist `value` at `key`.
    fn write(
        &self,
        key: &str,
        value: Bytes,
    ) -> impl Future<Output = Result<(), ServerError>> + Send;

    /// List active object names in this store.
    fn list(&self) -> impl Future<Output = Result<Vec<String>, ServerError>> + Send;

    /// Delete `key` from this store.
    fn delete(&self, key: &str) -> impl Future<Output = Result<(), ServerError>> + Send;
}

/// High-level handle for one service-owned KV resource alias.
#[derive(Debug, Clone)]
pub struct KvResourceHandle<C> {
    resource_name: String,
    binding: KvResourceBinding,
    client: C,
}

impl<C> KvResourceHandle<C>
where
    C: KvResourceClient,
{
    /// Create a KV resource handle from a validated binding and opened client.
    pub(crate) fn new(
        resource_name: impl Into<String>,
        binding: KvResourceBinding,
        client: C,
    ) -> Self {
        Self {
            resource_name: resource_name.into(),
            binding,
            client,
        }
    }

    /// Contract-local resource alias used to open this handle.
    pub fn resource_name(&self) -> &str {
        &self.resource_name
    }

    /// Concrete resource binding resolved during bootstrap.
    pub fn binding(&self) -> &KvResourceBinding {
        &self.binding
    }

    /// Read the latest bytes for `key`, or `None` when the key is absent.
    pub async fn get(&self, key: &str) -> Result<Option<Bytes>, ServerError> {
        self.client.get(key).await
    }

    /// Persist `value` at `key`.
    pub async fn put(&self, key: &str, value: impl Into<Bytes>) -> Result<(), ServerError> {
        self.client.put(key, value.into()).await
    }

    /// List active keys in this bucket.
    pub async fn list(&self) -> Result<Vec<String>, ServerError> {
        self.client.list().await
    }

    /// Delete `key` from this bucket.
    pub async fn delete(&self, key: &str) -> Result<(), ServerError> {
        self.client.delete(key).await
    }
}

/// High-level handle for one service-owned object-store resource alias.
#[derive(Debug, Clone)]
pub struct StoreResourceHandle<C> {
    service_name: String,
    resource_name: String,
    binding: StoreResourceBinding,
    client: C,
}

impl<C> StoreResourceHandle<C>
where
    C: StoreResourceClient,
{
    /// Create a store resource handle from a validated binding and opened client.
    pub(crate) fn new(
        service_name: impl Into<String>,
        resource_name: impl Into<String>,
        binding: StoreResourceBinding,
        client: C,
    ) -> Self {
        Self {
            service_name: service_name.into(),
            resource_name: resource_name.into(),
            binding,
            client,
        }
    }

    /// Contract-local resource alias used to open this handle.
    pub fn resource_name(&self) -> &str {
        &self.resource_name
    }

    /// Concrete resource binding resolved during bootstrap.
    pub fn binding(&self) -> &StoreResourceBinding {
        &self.binding
    }

    /// Read all bytes for `key`, or `None` when the object is absent.
    pub async fn read(&self, key: &str) -> Result<Option<Bytes>, ServerError> {
        self.client.read(key).await
    }

    /// Persist `value` at `key`.
    pub async fn write(&self, key: &str, value: impl Into<Bytes>) -> Result<(), ServerError> {
        let value = value.into();
        if let Some(max_bytes) = self
            .binding
            .max_object_bytes
            .and_then(|value| u64::try_from(value).ok())
        {
            if value.len() as u64 > max_bytes {
                return Err(ServerError::TransferObjectTooLarge {
                    service_name: self.service_name.clone(),
                    store: self.resource_name.clone(),
                    key: key.to_string(),
                    size: value.len() as u64,
                    max_bytes,
                });
            }
        }

        self.client.write(key, value).await
    }

    /// List active object names in this store.
    pub async fn list(&self) -> Result<Vec<String>, ServerError> {
        self.client.list().await
    }

    /// Delete `key` from this store.
    pub async fn delete(&self, key: &str) -> Result<(), ServerError> {
        self.client.delete(key).await
    }
}

/// Concrete async-nats KV client used by `ConnectedService::kv`.
#[derive(Debug, Clone)]
pub struct NatsKvResourceClient {
    store: async_nats::jetstream::kv::Store,
}

impl KvResourceClient for NatsKvResourceClient {
    async fn get(&self, key: &str) -> Result<Option<Bytes>, ServerError> {
        self.store.get(key.to_string()).await.map_err(nats_error)
    }

    async fn put(&self, key: &str, value: Bytes) -> Result<(), ServerError> {
        self.store
            .put(key, value)
            .await
            .map(|_| ())
            .map_err(nats_error)
    }

    async fn list(&self) -> Result<Vec<String>, ServerError> {
        let keys = self.store.keys().await.map_err(nats_error)?;
        keys.try_collect().await.map_err(nats_error)
    }

    async fn delete(&self, key: &str) -> Result<(), ServerError> {
        self.store.delete(key).await.map_err(nats_error)
    }
}

/// Concrete async-nats object-store client used by `ConnectedService::store`.
#[derive(Clone)]
pub struct NatsStoreResourceClient {
    store: async_nats::jetstream::object_store::ObjectStore,
}

impl fmt::Debug for NatsStoreResourceClient {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("NatsStoreResourceClient")
            .finish_non_exhaustive()
    }
}

impl StoreResourceClient for NatsStoreResourceClient {
    async fn read(&self, key: &str) -> Result<Option<Bytes>, ServerError> {
        let mut object = match self.store.get(key).await {
            Ok(object) => object,
            Err(error) if error.kind() == GetErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(nats_error(error)),
        };
        let mut bytes = Vec::new();
        object.read_to_end(&mut bytes).await.map_err(nats_error)?;
        Ok(Some(bytes.into()))
    }

    async fn write(&self, key: &str, value: Bytes) -> Result<(), ServerError> {
        let mut reader = Cursor::new(value);
        self.store
            .put(key, &mut reader)
            .await
            .map(|_| ())
            .map_err(nats_error)
    }

    async fn list(&self) -> Result<Vec<String>, ServerError> {
        let objects = self.store.list().await.map_err(nats_error)?;
        objects
            .map(|object| object.map(|info| info.name).map_err(nats_error))
            .try_collect()
            .await
    }

    async fn delete(&self, key: &str) -> Result<(), ServerError> {
        self.store.delete(key).await.map_err(nats_error)
    }
}

impl ResourceRuntimeClient for async_nats::Client {
    type Kv = NatsKvResourceClient;
    type Store = NatsStoreResourceClient;

    async fn open_kv(&self, binding: &KvResourceBinding) -> Result<Self::Kv, ServerError> {
        let context = async_nats::jetstream::new(self.clone());
        let store = context
            .get_key_value(binding.bucket.clone())
            .await
            .map_err(nats_error)?;
        Ok(NatsKvResourceClient { store })
    }

    async fn open_store(&self, binding: &StoreResourceBinding) -> Result<Self::Store, ServerError> {
        let context = async_nats::jetstream::new(self.clone());
        let store = context
            .get_object_store(&binding.name)
            .await
            .map_err(nats_error)?;
        Ok(NatsStoreResourceClient { store })
    }
}

pub(crate) fn validate_kv_binding(
    service_name: &str,
    resource_name: &str,
    binding: &KvResourceBinding,
) -> Result<(), ServerError> {
    if binding.bucket.is_empty() {
        return Err(invalid_binding(
            service_name,
            "kv",
            resource_name,
            "bucket name is empty",
        ));
    }
    if !is_valid_nats_resource_name(&binding.bucket) {
        return Err(invalid_binding(
            service_name,
            "kv",
            resource_name,
            "bucket name must contain only ASCII letters, digits, underscores, and hyphens",
        ));
    }
    if binding.history < 1 {
        return Err(invalid_binding(
            service_name,
            "kv",
            resource_name,
            "history must be greater than zero",
        ));
    }
    if matches!(binding.max_value_bytes, Some(max_bytes) if max_bytes < 0) {
        return Err(invalid_binding(
            service_name,
            "kv",
            resource_name,
            "max_value_bytes must not be negative",
        ));
    }
    if binding.ttl_ms < 0 {
        return Err(invalid_binding(
            service_name,
            "kv",
            resource_name,
            "ttl_ms must not be negative",
        ));
    }
    Ok(())
}

pub(crate) fn validate_store_binding(
    service_name: &str,
    resource_name: &str,
    binding: &StoreResourceBinding,
) -> Result<(), ServerError> {
    if binding.name.is_empty() {
        return Err(invalid_binding(
            service_name,
            "store",
            resource_name,
            "store name is empty",
        ));
    }
    if !is_valid_nats_resource_name(&binding.name) {
        return Err(invalid_binding(
            service_name,
            "store",
            resource_name,
            "store name must contain only ASCII letters, digits, underscores, and hyphens",
        ));
    }
    if matches!(binding.max_object_bytes, Some(max_bytes) if max_bytes < 0) {
        return Err(invalid_binding(
            service_name,
            "store",
            resource_name,
            "max_object_bytes must not be negative",
        ));
    }
    if matches!(binding.max_total_bytes, Some(max_bytes) if max_bytes < 0) {
        return Err(invalid_binding(
            service_name,
            "store",
            resource_name,
            "max_total_bytes must not be negative",
        ));
    }
    if binding.ttl_ms < 0 {
        return Err(invalid_binding(
            service_name,
            "store",
            resource_name,
            "ttl_ms must not be negative",
        ));
    }
    Ok(())
}

fn invalid_binding(
    service_name: &str,
    resource_kind: &str,
    resource_name: &str,
    reason: &str,
) -> ServerError {
    ServerError::InvalidResourceBinding {
        service_name: service_name.to_string(),
        resource_kind: resource_kind.to_string(),
        resource_name: resource_name.to_string(),
        reason: reason.to_string(),
    }
}

fn is_valid_nats_resource_name(value: &str) -> bool {
    value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn nats_error(error: impl fmt::Display) -> ServerError {
    ServerError::Nats(error.to_string())
}

use futures_util::future::BoxFuture;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;

use crate::{RequestContext, ServerError, UploadTransferGrant};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum OperationState {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

impl OperationState {
    /// Return whether this state ends an operation lifecycle.
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            OperationState::Completed | OperationState::Failed | OperationState::Cancelled
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OperationRefData {
    pub id: String,
    pub service: String,
    pub operation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OperationSnapshot<TProgress = Value, TOutput = Value> {
    pub revision: u64,
    pub state: OperationState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<TProgress>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transfer: Option<OperationTransferProgress>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<TOutput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OperationTransferProgress {
    /// Zero-based transfer chunk index.
    pub chunk_index: u64,
    /// Number of bytes carried by this chunk.
    pub chunk_bytes: u64,
    /// Total number of bytes transferred after this chunk.
    pub transferred_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AcceptedOperation<TProgress = Value, TOutput = Value> {
    pub kind: String,
    #[serde(rename = "ref")]
    pub operation_ref: OperationRefData,
    pub snapshot: OperationSnapshot<TProgress, TOutput>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transfer: Option<UploadTransferGrant>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OperationSnapshotFrame<TProgress = Value, TOutput = Value> {
    pub kind: String,
    pub snapshot: OperationSnapshot<TProgress, TOutput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OperationControlRequest {
    pub action: String,
    pub operation_id: String,
}

pub trait OperationDescriptor {
    type Input: DeserializeOwned + Send + 'static;
    type Progress: Serialize + Send + 'static;
    type Output: Serialize + Send + 'static;

    const KEY: &'static str;
    const SUBJECT: &'static str;
    const CANCELABLE: bool;
}

/// Provider-style operation handler for generated service helpers.
pub trait OperationProvider<D>: Send + Sync + 'static
where
    D: OperationDescriptor,
{
    /// Start a new operation instance from the decoded input.
    fn start(
        &self,
        context: RequestContext,
        input: D::Input,
    ) -> BoxFuture<'static, Result<AcceptedOperation<D::Progress, D::Output>, ServerError>>;

    /// Return the current snapshot for an operation id.
    fn get(
        &self,
        context: RequestContext,
        operation_id: String,
    ) -> BoxFuture<'static, Result<OperationSnapshot<D::Progress, D::Output>, ServerError>>;

    /// Wait for a later or terminal snapshot for an operation id.
    fn wait(
        &self,
        context: RequestContext,
        operation_id: String,
    ) -> BoxFuture<'static, Result<OperationSnapshot<D::Progress, D::Output>, ServerError>>;

    /// Cancel an operation id and return the resulting snapshot.
    fn cancel(
        &self,
        context: RequestContext,
        operation_id: String,
    ) -> BoxFuture<'static, Result<OperationSnapshot<D::Progress, D::Output>, ServerError>>;
}

pub fn control_subject(subject: &str) -> String {
    format!("{subject}.control")
}

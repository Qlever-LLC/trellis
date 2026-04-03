use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum OperationState {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
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
    pub output: Option<TOutput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AcceptedOperation<TProgress = Value, TOutput = Value> {
    pub kind: String,
    #[serde(rename = "ref")]
    pub operation_ref: OperationRefData,
    pub snapshot: OperationSnapshot<TProgress, TOutput>,
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

pub fn control_subject(subject: &str) -> String {
    format!("{subject}.control")
}

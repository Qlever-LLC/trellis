use std::future::Future;
use std::marker::PhantomData;

use futures_util::stream::{self, BoxStream};
use futures_util::StreamExt;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};

use crate::TrellisClientError;

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
struct AcceptedEnvelope<TProgress = Value, TOutput = Value> {
    kind: String,
    #[serde(rename = "ref")]
    operation_ref: OperationRefData,
    snapshot: OperationSnapshot<TProgress, TOutput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct SnapshotFrame<TProgress = Value, TOutput = Value> {
    kind: String,
    snapshot: OperationSnapshot<TProgress, TOutput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum OperationEvent<TProgress = Value, TOutput = Value> {
    Accepted {
        snapshot: OperationSnapshot<TProgress, TOutput>,
    },
    Started {
        snapshot: OperationSnapshot<TProgress, TOutput>,
    },
    Progress {
        snapshot: OperationSnapshot<TProgress, TOutput>,
    },
    Completed {
        snapshot: OperationSnapshot<TProgress, TOutput>,
    },
    Failed {
        snapshot: OperationSnapshot<TProgress, TOutput>,
    },
    Cancelled {
        snapshot: OperationSnapshot<TProgress, TOutput>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct EventFrame<TProgress = Value, TOutput = Value> {
    kind: String,
    event: OperationEvent<TProgress, TOutput>,
}

pub trait OperationDescriptor {
    type Input: Serialize;
    type Progress: DeserializeOwned + Send + 'static;
    type Output: DeserializeOwned + Send + 'static;

    const KEY: &'static str;
    const SUBJECT: &'static str;
    const CALLER_CAPABILITIES: &'static [&'static str];
    const READ_CAPABILITIES: &'static [&'static str];
    const CANCEL_CAPABILITIES: &'static [&'static str];
    const CANCELABLE: bool;
}

#[doc(hidden)]
pub trait OperationTransport {
    fn request_json_value<'a>(
        &'a self,
        subject: String,
        body: Value,
    ) -> impl Future<Output = Result<Value, TrellisClientError>> + Send + 'a;

    fn watch_json_value<'a>(
        &'a self,
        subject: String,
        body: Value,
    ) -> impl Future<Output = Result<BoxStream<'a, Result<Value, TrellisClientError>>, TrellisClientError>> + Send + 'a;
}

pub struct OperationInvoker<'a, T, D> {
    transport: &'a T,
    _descriptor: PhantomData<D>,
}

pub struct OperationRef<'a, T, D> {
    transport: &'a T,
    data: OperationRefData,
    _descriptor: PhantomData<D>,
}

fn is_terminal_state(state: &OperationState) -> bool {
    matches!(
        state,
        OperationState::Completed | OperationState::Failed | OperationState::Cancelled
    )
}

impl<'a, T, D> OperationInvoker<'a, T, D> {
    pub fn new(transport: &'a T) -> Self {
        Self {
            transport,
            _descriptor: PhantomData,
        }
    }
}

impl<'a, T, D> OperationInvoker<'a, T, D>
where
    T: OperationTransport,
    D: OperationDescriptor,
    D::Progress: Send,
    D::Output: Send,
{
    pub async fn start(
        &self,
        input: &D::Input,
    ) -> Result<OperationRef<'a, T, D>, TrellisClientError> {
        let body = serde_json::to_value(input)?;
        let response = self
            .transport
            .request_json_value(D::SUBJECT.to_string(), body)
            .await?;
        let accepted: AcceptedEnvelope<D::Progress, D::Output> = serde_json::from_value(response)?;
        if accepted.kind != "accepted" {
            return Err(TrellisClientError::OperationProtocol(format!(
                "expected accepted envelope, got '{}'",
                accepted.kind
            )));
        }
        Ok(OperationRef {
            transport: self.transport,
            data: accepted.operation_ref,
            _descriptor: PhantomData,
        })
    }
}

impl<'a, T, D> OperationRef<'a, T, D> {
    pub fn id(&self) -> &str {
        &self.data.id
    }

    pub fn service(&self) -> &str {
        &self.data.service
    }

    pub fn operation(&self) -> &str {
        &self.data.operation
    }
}

impl<'a, T, D> OperationRef<'a, T, D>
where
    T: OperationTransport,
    D: OperationDescriptor,
{
    pub async fn get(&self) -> Result<OperationSnapshot<D::Progress, D::Output>, TrellisClientError> {
        let body = json!({
            "action": "get",
            "operationId": self.id(),
        });
        let response = self
            .transport
            .request_json_value(control_subject(D::SUBJECT), body)
            .await?;
        let frame: SnapshotFrame<D::Progress, D::Output> = serde_json::from_value(response)?;
        if frame.kind != "snapshot" {
            return Err(TrellisClientError::OperationProtocol(format!(
                "expected snapshot frame, got '{}'",
                frame.kind
            )));
        }
        Ok(frame.snapshot)
    }

    pub async fn wait(
        &self,
    ) -> Result<OperationSnapshot<D::Progress, D::Output>, TrellisClientError> {
        let body = json!({
            "action": "wait",
            "operationId": self.id(),
        });
        let response = self
            .transport
            .request_json_value(control_subject(D::SUBJECT), body)
            .await?;
        let frame: SnapshotFrame<D::Progress, D::Output> = serde_json::from_value(response)?;
        if frame.kind != "snapshot" {
            return Err(TrellisClientError::OperationProtocol(format!(
                "expected snapshot frame, got '{}'",
                frame.kind
            )));
        }
        if !is_terminal_state(&frame.snapshot.state) {
            return Err(TrellisClientError::OperationProtocol(
                "wait returned non-terminal snapshot".to_string(),
            ));
        }
        Ok(frame.snapshot)
    }

    pub async fn cancel(
        &self,
    ) -> Result<OperationSnapshot<D::Progress, D::Output>, TrellisClientError> {
        let body = json!({
            "action": "cancel",
            "operationId": self.id(),
        });
        let response = self
            .transport
            .request_json_value(control_subject(D::SUBJECT), body)
            .await?;
        let frame: SnapshotFrame<D::Progress, D::Output> = serde_json::from_value(response)?;
        if frame.kind != "snapshot" {
            return Err(TrellisClientError::OperationProtocol(format!(
                "expected snapshot frame, got '{}'",
                frame.kind
            )));
        }
        Ok(frame.snapshot)
    }

    pub async fn watch(
        &self,
    ) -> Result<BoxStream<'a, Result<OperationEvent<D::Progress, D::Output>, TrellisClientError>>, TrellisClientError> {
        let control = control_subject(D::SUBJECT);
        let body = json!({
            "action": "watch",
            "operationId": self.id(),
        });
        let response = self
            .transport
            .watch_json_value(control, body)
            .await?;
        Ok(Box::pin(stream::try_unfold((response, false), |(mut response, done)| async move {
            if done {
                return Ok(None);
            }

            loop {
                match response.next().await {
                    Some(frame) => {
                        let event = match frame {
                            Ok(value) => match decode_watch_frame::<D::Progress, D::Output>(value) {
                                Ok(Some(event)) => event,
                                Ok(None) => continue,
                                Err(error) => return Err(error),
                            },
                            Err(error) => return Err(error),
                        };

                        let terminal = is_terminal_event(&event);
                        return Ok(Some((event, (response, terminal))));
                    }
                    None => return Ok(None),
                }
            }
        })))
    }
}

fn decode_watch_frame<TProgress: DeserializeOwned, TOutput: DeserializeOwned>(
    value: Value,
) -> Result<Option<OperationEvent<TProgress, TOutput>>, TrellisClientError> {
    if value.get("kind").and_then(Value::as_str) == Some("keepalive") {
        return Ok(None);
    }

    let kind = value
        .get("kind")
        .and_then(Value::as_str)
        .ok_or_else(|| TrellisClientError::OperationProtocol("expected watch frame kind".to_string()))?;

    match kind {
        "snapshot" => {
            let frame: SnapshotFrame<TProgress, TOutput> = serde_json::from_value(value)?;
            Ok(Some(snapshot_to_event(frame.snapshot)))
        }
        "event" => {
            let frame: EventFrame<TProgress, TOutput> = serde_json::from_value(value)?;
            Ok(Some(frame.event))
        }
        _ => Err(TrellisClientError::OperationProtocol(
            "expected snapshot/event/keepalive frame".to_string(),
        )),
    }
}

fn snapshot_to_event<TProgress, TOutput>(
    snapshot: OperationSnapshot<TProgress, TOutput>,
) -> OperationEvent<TProgress, TOutput> {
    match snapshot.state {
        OperationState::Pending => OperationEvent::Accepted { snapshot },
        OperationState::Running => OperationEvent::Started { snapshot },
        OperationState::Completed => OperationEvent::Completed { snapshot },
        OperationState::Failed => OperationEvent::Failed { snapshot },
        OperationState::Cancelled => OperationEvent::Cancelled { snapshot },
    }
}

fn is_terminal_event<TProgress, TOutput>(event: &OperationEvent<TProgress, TOutput>) -> bool {
    matches!(
        event,
        OperationEvent::Completed { .. }
            | OperationEvent::Failed { .. }
            | OperationEvent::Cancelled { .. }
    )
}

pub fn control_subject(subject: &str) -> String {
    format!("{subject}.control")
}

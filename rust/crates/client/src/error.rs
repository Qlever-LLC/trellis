use serde_json::Value;

fn format_json_value(value: &Value) -> String {
    match value {
        Value::String(value) => value.clone(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::Array(values) => values
            .iter()
            .map(format_json_value)
            .collect::<Vec<_>>()
            .join(","),
        Value::Null => "null".to_string(),
        _ => value.to_string(),
    }
}

fn format_issue(issue: &Value) -> Option<String> {
    let obj = issue.as_object()?;
    let message = obj.get("message")?.as_str()?.trim();
    let path = obj
        .get("path")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim_start_matches('/');

    if path.is_empty() || message.contains(path) {
        Some(message.to_string())
    } else {
        Some(format!("{path}: {message}"))
    }
}

fn format_context(value: &Value) -> Option<String> {
    let obj = value.as_object()?;
    let fields = obj
        .iter()
        .filter(|(_, value)| !value.is_null())
        .map(|(key, value)| format!("{key}={}", format_json_value(value)))
        .collect::<Vec<_>>();
    if fields.is_empty() {
        None
    } else {
        Some(fields.join(", "))
    }
}

fn format_rpc_error_payload(raw: &str) -> String {
    let Ok(value) = serde_json::from_str::<Value>(raw) else {
        return raw.to_string();
    };

    let issues = value
        .get("issues")
        .and_then(Value::as_array)
        .map(|issues| issues.iter().filter_map(format_issue).collect::<Vec<_>>())
        .unwrap_or_default();

    let mut message = if issues.is_empty() {
        value
            .get("message")
            .and_then(Value::as_str)
            .map(|message| {
                message
                    .strip_prefix("Validation failed. ")
                    .unwrap_or(message)
                    .to_string()
            })
            .unwrap_or_else(|| raw.to_string())
    } else {
        issues.join("; ")
    };

    if let Some(context) = value.get("context").and_then(format_context) {
        message.push_str(&format!(" ({context})"));
    }

    message
}

/// Errors returned by the Trellis client runtime.
#[derive(thiserror::Error, Debug)]
pub enum TrellisClientError {
    #[error("invalid base64url: {0}")]
    Base64(#[from] base64::DecodeError),

    #[error("invalid ed25519 seed length: {0} (expected 32)")]
    InvalidSeedLen(usize),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("nats error: {0}")]
    Nats(#[from] async_nats::Error),

    #[error("nats connect error: {0}")]
    NatsConnect(String),

    #[error("nats request error: {0}")]
    NatsRequest(String),

    #[error("request timeout")]
    Timeout,

    #[error("invalid json: {0}")]
    Json(#[from] serde_json::Error),

    #[error("rpc returned error: {}", format_rpc_error_payload(.0))]
    RpcError(String),

    #[error("operation protocol error: {0}")]
    OperationProtocol(String),

    #[error("transfer protocol error: {0}")]
    TransferProtocol(String),
}

#[cfg(test)]
mod tests {
    use super::format_rpc_error_payload;

    #[test]
    fn formats_validation_error_payload_human_readably() {
        let raw = r#"{"context":{"profileId":"demoo"},"issues":[{"message":"service profile not found","path":"/profileId"}],"message":"Validation failed. /profileId: service profile not found.","type":"ValidationError"}"#;
        assert_eq!(
            format_rpc_error_payload(raw),
            "profileId: service profile not found (profileId=demoo)"
        );
    }

    #[test]
    fn leaves_non_json_payloads_unchanged() {
        assert_eq!(format_rpc_error_payload("plain error"), "plain error");
    }
}

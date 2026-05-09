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

fn format_bootstrap_http_payload(raw: &str) -> String {
    let Ok(value) = serde_json::from_str::<Value>(raw) else {
        return raw.to_string();
    };

    let reason = value.get("reason").and_then(Value::as_str);
    let message = value
        .get("message")
        .and_then(Value::as_str)
        .or(reason)
        .unwrap_or(raw);

    let mut formatted = match reason {
        Some(reason) if message != reason => format!("{reason}: {message}"),
        _ => message.to_string(),
    };

    if let Some(object) = value.as_object() {
        let context = object
            .iter()
            .filter(|(key, value)| {
                key.as_str() != "reason" && key.as_str() != "message" && !value.is_null()
            })
            .map(|(key, value)| format!("{key}={}", format_json_value(value)))
            .collect::<Vec<_>>();
        if !context.is_empty() {
            formatted.push_str(&format!(" ({})", context.join(", ")));
        }
    }

    formatted
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

    #[error("service bootstrap failed with HTTP {status}: {}", format_bootstrap_http_payload(.body))]
    BootstrapHttp { status: u16, body: String },

    #[error("service bootstrap error: {0}")]
    Bootstrap(String),

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
    use super::{format_bootstrap_http_payload, format_rpc_error_payload};

    #[test]
    fn formats_validation_error_payload_human_readably() {
        let raw = r#"{"context":{"deploymentId":"demo"},"issues":[{"message":"service deployment not found","path":"/deploymentId"}],"message":"Validation failed. /deploymentId: service deployment not found.","type":"ValidationError"}"#;
        assert_eq!(
            format_rpc_error_payload(raw),
            "deploymentId: service deployment not found (deploymentId=demo)"
        );
    }

    #[test]
    fn leaves_non_json_payloads_unchanged() {
        assert_eq!(format_rpc_error_payload("plain error"), "plain error");
    }

    #[test]
    fn formats_bootstrap_http_failure_payload_human_readably() {
        let raw = r#"{"contractDigest":"digest-new","contractId":"trellis.jobs@v1","deploymentId":"svc/jobs","instanceId":"svc_1","message":"Service deployment 'svc/jobs' envelope does not cover contract 'trellis.jobs@v1' digest 'digest-new'. An expansion request was created.","reason":"envelope_expansion_required","requestId":"req_1"}"#;

        assert_eq!(
            format_bootstrap_http_payload(raw),
            "envelope_expansion_required: Service deployment 'svc/jobs' envelope does not cover contract 'trellis.jobs@v1' digest 'digest-new'. An expansion request was created. (contractDigest=digest-new, contractId=trellis.jobs@v1, deploymentId=svc/jobs, instanceId=svc_1, requestId=req_1)"
        );
    }

    #[test]
    fn bootstrap_http_failure_falls_back_to_reason() {
        assert_eq!(
            format_bootstrap_http_payload(r#"{"reason":"invalid_signature"}"#),
            "invalid_signature"
        );
    }

    #[test]
    fn bootstrap_http_error_display_uses_formatted_payload() {
        let error = super::TrellisClientError::BootstrapHttp {
            status: 409,
            body: r#"{"reason":"service_contract_mismatch","message":"Apply the contract first."}"#
                .to_string(),
        };

        assert_eq!(
            error.to_string(),
            "service bootstrap failed with HTTP 409: service_contract_mismatch: Apply the contract first."
        );
    }
}

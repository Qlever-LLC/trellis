use serde::{Deserialize, Serialize};

/// One health check entry in a generic service health response.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HealthCheck {
    pub name: String,
    pub status: String,
    #[serde(rename = "latencyMs")]
    pub latency_ms: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Generic health response payload for contract-specific health handlers.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HealthReport {
    pub service: String,
    pub status: String,
    pub timestamp: String,
    pub checks: Vec<HealthCheck>,
}

impl HealthReport {
    /// Build a default healthy report with no checks.
    pub fn healthy(service: impl Into<String>, timestamp: impl Into<String>) -> Self {
        Self {
            service: service.into(),
            status: "ok".to_string(),
            timestamp: timestamp.into(),
            checks: Vec::new(),
        }
    }
}

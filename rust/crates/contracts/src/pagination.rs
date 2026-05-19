use serde::{Deserialize, Serialize};

/// Bounded pagination request used by public Trellis list APIs.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PageRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<u64>,
    pub limit: u64,
}

/// Bounded pagination response used by public Trellis list APIs.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PageResponse<TEntry> {
    pub entries: Vec<TEntry>,
    pub count: u64,
    pub offset: u64,
    pub limit: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<u64>,
}

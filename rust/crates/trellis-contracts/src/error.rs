use std::path::PathBuf;

/// Errors returned while loading, validating, or packing Trellis contracts.
#[derive(thiserror::Error, Debug)]
pub enum ContractsError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("non-canonical number in manifest: {0}")]
    NonCanonicalNumber(String),

    #[error("failed to compile {kind} schema: {message}")]
    SchemaCompile { kind: &'static str, message: String },

    #[error("invalid {kind}:\n{details}")]
    SchemaValidation { kind: &'static str, details: String },

    #[error("schema $id '{schema_id}' differs across manifests (found in {path})")]
    DuplicateSchemaId { schema_id: String, path: PathBuf },

    #[error("contract id '{id}' appears multiple times with different digests ({existing_digest} vs {new_digest})")]
    DuplicateContractId {
        id: String,
        existing_digest: String,
        new_digest: String,
    },

    #[error("subject '{subject}' is declared by both '{first_contract}' and '{second_contract}'")]
    SubjectCollision {
        subject: String,
        first_contract: String,
        second_contract: String,
    },
}

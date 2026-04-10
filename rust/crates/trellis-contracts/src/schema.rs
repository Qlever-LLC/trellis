use jsonschema::Draft;
use serde_json::Value;

use crate::ContractsError;

const CONTRACT_SCHEMA_JSON: &str = include_str!("../schemas/trellis.contract.v1.schema.json");
const CATALOG_SCHEMA_JSON: &str = include_str!("../schemas/trellis.catalog.v1.schema.json");

/// Validate a contract manifest JSON value.
pub fn validate_manifest(value: &Value) -> Result<(), ContractsError> {
    validate_value_against_schema("contract", CONTRACT_SCHEMA_JSON, value)
}

/// Validate a catalog JSON value.
pub fn validate_catalog(value: &Value) -> Result<(), ContractsError> {
    validate_value_against_schema("catalog", CATALOG_SCHEMA_JSON, value)
}

pub(crate) fn walk_schemas_by_id(value: &Value) -> Vec<(&String, &Value)> {
    let mut found = Vec::new();
    walk_schemas_by_id_inner(value, &mut found);
    found
}

fn validate_value_against_schema(
    kind: &'static str,
    schema_json: &str,
    value: &Value,
) -> Result<(), ContractsError> {
    let schema: Value = serde_json::from_str(schema_json)?;
    let validator = jsonschema::options()
        .with_draft(Draft::Draft201909)
        .build(&schema)
        .map_err(|error| ContractsError::SchemaCompile {
            kind,
            message: error.to_string(),
        })?;

    let errors = validator
        .iter_errors(value)
        .map(|error| {
            let instance_path = error.instance_path().to_string();
            if instance_path.is_empty() {
                error.to_string()
            } else {
                format!("{instance_path}: {error}")
            }
        })
        .collect::<Vec<_>>();

    if errors.is_empty() {
        Ok(())
    } else {
        Err(ContractsError::SchemaValidation {
            kind,
            details: errors.join("\n"),
        })
    }
}

fn walk_schemas_by_id_inner<'a>(value: &'a Value, found: &mut Vec<(&'a String, &'a Value)>) {
    match value {
        Value::Object(map) => {
            if let Some(Value::String(id)) = map.get("$id") {
                found.push((id, value));
            }
            for child in map.values() {
                walk_schemas_by_id_inner(child, found);
            }
        }
        Value::Array(values) => {
            for child in values {
                walk_schemas_by_id_inner(child, found);
            }
        }
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {}
    }
}

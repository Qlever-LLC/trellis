use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::{
    canonicalize_json, sha256_base64url, validate_manifest, ContractManifest, ContractsError,
    LoadedManifest, CONTRACT_FORMAT_V1,
};

/// Load an arbitrary JSON value from disk.
pub fn load_json_value(path: impl AsRef<Path>) -> Result<Value, ContractsError> {
    let path = path.as_ref();
    Ok(serde_json::from_str(&fs::read_to_string(path)?)?)
}

/// Parse and validate one contract manifest JSON value.
pub fn parse_manifest(value: Value) -> Result<ContractManifest, ContractsError> {
    validate_manifest(&value)?;
    let manifest: ContractManifest = serde_json::from_value(value)?;
    validate_schema_refs(&manifest)?;
    Ok(manifest)
}

/// Load, validate, canonicalize, and digest one manifest file.
pub fn load_manifest(path: impl AsRef<Path>) -> Result<LoadedManifest, ContractsError> {
    let path = path.as_ref();
    let value = load_json_value(path)?;
    let manifest = parse_manifest(value.clone())?;
    let canonical = canonicalize_json(&value)?;
    let digest = sha256_base64url(&canonicalize_json(&contract_digest_projection(&value))?);

    Ok(LoadedManifest {
        path: path.to_path_buf(),
        value,
        manifest,
        canonical,
        digest,
    })
}

fn object(value: Option<&Value>) -> Option<&serde_json::Map<String, Value>> {
    value.and_then(Value::as_object)
}

fn array(value: Option<&Value>) -> Option<&Vec<Value>> {
    value.and_then(Value::as_array)
}

fn schema_ref(value: Option<&Value>) -> Option<String> {
    object(value)
        .and_then(|value| value.get("schema"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

fn collect_schema_ref(reachable: &mut std::collections::BTreeSet<String>, value: Option<&Value>) {
    if let Some(schema) = schema_ref(value) {
        reachable.insert(schema);
    }
}

fn collect_reachable_schema_names(contract: &Value) -> std::collections::BTreeSet<String> {
    let mut reachable = std::collections::BTreeSet::new();

    for store in object(contract.get("state"))
        .map(|value| value.values())
        .into_iter()
        .flatten()
    {
        collect_schema_ref(
            &mut reachable,
            object(Some(store)).and_then(|value| value.get("schema")),
        );
        for accepted in object(object(Some(store)).and_then(|value| value.get("acceptedVersions")))
            .map(|value| value.values())
            .into_iter()
            .flatten()
        {
            collect_schema_ref(&mut reachable, Some(accepted));
        }
    }

    for method in object(contract.get("rpc"))
        .map(|value| value.values())
        .into_iter()
        .flatten()
    {
        let method = object(Some(method));
        collect_schema_ref(&mut reachable, method.and_then(|value| value.get("input")));
        collect_schema_ref(&mut reachable, method.and_then(|value| value.get("output")));
        for error in array(method.and_then(|value| value.get("errors")))
            .into_iter()
            .flatten()
        {
            let Some(error_type) = object(Some(error))
                .and_then(|value| value.get("type"))
                .and_then(Value::as_str)
            else {
                continue;
            };
            let declaration = object(contract.get("errors"))
                .and_then(|errors| {
                    errors.values().find(|declaration| {
                        object(Some(declaration))
                            .and_then(|value| value.get("type"))
                            .and_then(Value::as_str)
                            == Some(error_type)
                    })
                })
                .and_then(|value| object(Some(value)));
            collect_schema_ref(
                &mut reachable,
                declaration.and_then(|value| value.get("schema")),
            );
        }
    }

    for operation in object(contract.get("operations"))
        .map(|value| value.values())
        .into_iter()
        .flatten()
    {
        let operation = object(Some(operation));
        collect_schema_ref(
            &mut reachable,
            operation.and_then(|value| value.get("input")),
        );
        collect_schema_ref(
            &mut reachable,
            operation.and_then(|value| value.get("progress")),
        );
        collect_schema_ref(
            &mut reachable,
            operation.and_then(|value| value.get("output")),
        );
    }

    for event in object(contract.get("events"))
        .map(|value| value.values())
        .into_iter()
        .flatten()
    {
        collect_schema_ref(
            &mut reachable,
            object(Some(event)).and_then(|value| value.get("event")),
        );
    }

    for job in object(contract.get("jobs"))
        .map(|value| value.values())
        .into_iter()
        .flatten()
    {
        let job = object(Some(job));
        collect_schema_ref(&mut reachable, job.and_then(|value| value.get("payload")));
        collect_schema_ref(&mut reachable, job.and_then(|value| value.get("result")));
    }

    for resource in object(contract.get("resources"))
        .and_then(|value| object(value.get("kv")))
        .map(|value| value.values())
        .into_iter()
        .flatten()
    {
        collect_schema_ref(
            &mut reachable,
            object(Some(resource)).and_then(|value| value.get("schema")),
        );
    }

    reachable
}

fn sorted_unique_strings(value: &Value) -> Option<Value> {
    let values = value.as_array()?;
    let mut unique = std::collections::BTreeSet::new();
    for value in values {
        unique.insert(value.as_str()?.to_string());
    }
    Some(Value::Array(
        unique.into_iter().map(Value::String).collect(),
    ))
}

fn insert_sorted_list(
    target: &mut serde_json::Map<String, Value>,
    key: &str,
    source: Option<&Value>,
) {
    if let Some(sorted) = source.and_then(sorted_unique_strings) {
        target.insert(key.to_string(), sorted);
    }
}

fn project_reachable_schemas(contract: &Value) -> Option<Value> {
    let reachable = collect_reachable_schema_names(contract);
    let schemas = object(contract.get("schemas"))?;
    if reachable.is_empty() {
        return None;
    }
    let projected = schemas
        .iter()
        .filter(|(name, _)| reachable.contains(*name))
        .map(|(name, schema)| (name.clone(), schema.clone()))
        .collect::<serde_json::Map<_, _>>();
    (!projected.is_empty()).then_some(Value::Object(projected))
}

fn project_rpc_declared_errors(contract: &Value) -> Option<Value> {
    let errors = object(contract.get("errors"))?;
    let mut declared = std::collections::BTreeSet::new();
    for method in object(contract.get("rpc"))
        .map(|value| value.values())
        .into_iter()
        .flatten()
    {
        for error in array(object(Some(method)).and_then(|value| value.get("errors")))
            .into_iter()
            .flatten()
        {
            if let Some(error_type) = object(Some(error))
                .and_then(|value| value.get("type"))
                .and_then(Value::as_str)
            {
                declared.insert(error_type.to_string());
            }
        }
    }
    let projected = errors
        .iter()
        .filter(|(_, error)| {
            object(Some(error))
                .and_then(|value| value.get("type"))
                .and_then(Value::as_str)
                .is_some_and(|error_type| declared.contains(error_type))
        })
        .map(|(name, error)| (name.clone(), error.clone()))
        .collect::<serde_json::Map<_, _>>();
    (!projected.is_empty()).then_some(Value::Object(projected))
}

fn project_resources(resources: Option<&Value>) -> Option<Value> {
    let resources = object(resources)?;
    let mut projected = serde_json::Map::new();
    if let Some(kv) = resources.get("kv") {
        projected.insert("kv".to_string(), kv.clone());
    }
    if let Some(store) = resources.get("store") {
        projected.insert("store".to_string(), store.clone());
    }
    (!projected.is_empty()).then_some(Value::Object(projected))
}

fn project_uses(uses: Option<&Value>) -> Option<Value> {
    let uses = object(uses)?;
    let mut projected_uses = serde_json::Map::new();
    for (alias, use_ref) in uses {
        let Some(use_ref) = use_ref.as_object() else {
            continue;
        };
        let mut projected = serde_json::Map::new();
        if let Some(contract) = use_ref.get("contract") {
            projected.insert("contract".to_string(), contract.clone());
        }
        if let Some(call) = object(use_ref.get("rpc")).and_then(|value| value.get("call")) {
            let mut rpc = serde_json::Map::new();
            insert_sorted_list(&mut rpc, "call", Some(call));
            if !rpc.is_empty() {
                projected.insert("rpc".to_string(), Value::Object(rpc));
            }
        }
        if let Some(call) = object(use_ref.get("operations")).and_then(|value| value.get("call")) {
            let mut operations = serde_json::Map::new();
            insert_sorted_list(&mut operations, "call", Some(call));
            if !operations.is_empty() {
                projected.insert("operations".to_string(), Value::Object(operations));
            }
        }
        let events = object(use_ref.get("events"));
        let mut projected_events = serde_json::Map::new();
        insert_sorted_list(
            &mut projected_events,
            "publish",
            events.and_then(|value| value.get("publish")),
        );
        insert_sorted_list(
            &mut projected_events,
            "subscribe",
            events.and_then(|value| value.get("subscribe")),
        );
        if !projected_events.is_empty() {
            projected.insert("events".to_string(), Value::Object(projected_events));
        }
        projected_uses.insert(alias.clone(), Value::Object(projected));
    }
    Some(Value::Object(projected_uses))
}

fn project_capabilities(capabilities: Option<&Value>, keys: &[&str]) -> Option<Value> {
    let capabilities = object(capabilities)?;
    let mut projected = serde_json::Map::new();
    for key in keys {
        insert_sorted_list(&mut projected, key, capabilities.get(*key));
    }
    (!projected.is_empty()).then_some(Value::Object(projected))
}

fn project_rpc(rpc: Option<&Value>) -> Option<Value> {
    let rpc = object(rpc)?;
    let mut projected_rpc = serde_json::Map::new();
    for (name, method) in rpc {
        let Some(method_object) = method.as_object() else {
            continue;
        };
        let mut projected = method_object.clone();
        if let Some(capabilities) =
            project_capabilities(method_object.get("capabilities"), &["call"])
        {
            projected.insert("capabilities".to_string(), capabilities);
        }
        if let Some(errors) = array(method_object.get("errors")) {
            let sorted = sorted_unique_strings(&Value::Array(
                errors
                    .iter()
                    .filter_map(|error| {
                        object(Some(error))
                            .and_then(|value| value.get("type"))
                            .cloned()
                    })
                    .collect(),
            ));
            if let Some(Value::Array(types)) = sorted {
                projected.insert(
                    "errors".to_string(),
                    Value::Array(
                        types
                            .into_iter()
                            .map(|error_type| {
                                let mut error = serde_json::Map::new();
                                error.insert("type".to_string(), error_type);
                                Value::Object(error)
                            })
                            .collect(),
                    ),
                );
            }
        }
        projected_rpc.insert(name.clone(), Value::Object(projected));
    }
    Some(Value::Object(projected_rpc))
}

fn project_operations(operations: Option<&Value>) -> Option<Value> {
    let operations = object(operations)?;
    let mut projected_operations = serde_json::Map::new();
    for (name, operation) in operations {
        let Some(operation_object) = operation.as_object() else {
            continue;
        };
        let mut projected = operation_object.clone();
        if let Some(capabilities) = project_capabilities(
            operation_object.get("capabilities"),
            &["call", "read", "cancel"],
        ) {
            projected.insert("capabilities".to_string(), capabilities);
        }
        projected_operations.insert(name.clone(), Value::Object(projected));
    }
    Some(Value::Object(projected_operations))
}

fn project_events(events: Option<&Value>) -> Option<Value> {
    let events = object(events)?;
    let mut projected_events = serde_json::Map::new();
    for (name, event) in events {
        let Some(event_object) = event.as_object() else {
            continue;
        };
        let mut projected = event_object.clone();
        if let Some(capabilities) =
            project_capabilities(event_object.get("capabilities"), &["publish", "subscribe"])
        {
            projected.insert("capabilities".to_string(), capabilities);
        }
        projected_events.insert(name.clone(), Value::Object(projected));
    }
    Some(Value::Object(projected_events))
}

fn insert_if_present(target: &mut serde_json::Map<String, Value>, key: &str, value: Option<Value>) {
    if let Some(value) = value {
        target.insert(key.to_string(), value);
    }
}

fn contract_digest_projection(contract: &Value) -> Value {
    let mut projected = serde_json::Map::new();
    for key in ["format", "id", "kind"] {
        if let Some(value) = contract.get(key) {
            projected.insert(key.to_string(), value.clone());
        }
    }
    insert_if_present(
        &mut projected,
        "schemas",
        project_reachable_schemas(contract),
    );
    if let Some(state) = contract.get("state") {
        projected.insert("state".to_string(), state.clone());
    }
    insert_if_present(&mut projected, "uses", project_uses(contract.get("uses")));
    insert_if_present(&mut projected, "rpc", project_rpc(contract.get("rpc")));
    insert_if_present(
        &mut projected,
        "operations",
        project_operations(contract.get("operations")),
    );
    insert_if_present(
        &mut projected,
        "events",
        project_events(contract.get("events")),
    );
    insert_if_present(
        &mut projected,
        "errors",
        project_rpc_declared_errors(contract),
    );
    if let Some(jobs) = contract.get("jobs") {
        projected.insert("jobs".to_string(), jobs.clone());
    }
    insert_if_present(
        &mut projected,
        "resources",
        project_resources(contract.get("resources")),
    );
    Value::Object(projected)
}

/// Collect contract manifest candidates from one directory.
pub fn manifest_paths_in_dir(dir: impl AsRef<Path>) -> Result<Vec<PathBuf>, ContractsError> {
    let mut paths = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if !(entry.file_type()?.is_file() && is_manifest_candidate_path(&path)) {
            continue;
        }

        let value = load_json_value(&path)?;
        if value
            .get("format")
            .and_then(Value::as_str)
            .is_some_and(|format| format == CONTRACT_FORMAT_V1)
        {
            paths.push(path);
        }
    }
    paths.sort();
    Ok(paths)
}

fn is_manifest_candidate_path(path: &Path) -> bool {
    path.extension().is_some_and(|ext| ext == "json")
        && path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .is_some_and(|stem| stem.contains('@'))
}

fn validate_schema_refs(manifest: &ContractManifest) -> Result<(), ContractsError> {
    for (name, rpc) in &manifest.rpc {
        assert_schema_ref_exists(manifest, &rpc.input.schema, &format!("rpc '{name}' input"))?;
        assert_schema_ref_exists(
            manifest,
            &rpc.output.schema,
            &format!("rpc '{name}' output"),
        )?;
    }

    for (name, operation) in &manifest.operations {
        assert_schema_ref_exists(
            manifest,
            &operation.input.schema,
            &format!("operation '{name}' input"),
        )?;
        if let Some(progress) = &operation.progress {
            assert_schema_ref_exists(
                manifest,
                &progress.schema,
                &format!("operation '{name}' progress"),
            )?;
        }
        if let Some(output) = &operation.output {
            assert_schema_ref_exists(
                manifest,
                &output.schema,
                &format!("operation '{name}' output"),
            )?;
        }
    }

    for (name, event) in &manifest.events {
        assert_schema_ref_exists(manifest, &event.event.schema, &format!("event '{name}'"))?;
    }

    for (name, error) in &manifest.errors {
        if let Some(schema) = &error.schema {
            assert_schema_ref_exists(manifest, &schema.schema, &format!("error '{name}'"))?;
        }
    }

    for (queue_type, queue) in &manifest.jobs {
        assert_schema_ref_exists(
            manifest,
            &queue.payload.schema,
            &format!("jobs queue '{queue_type}' payload"),
        )?;
        if let Some(result) = &queue.result {
            assert_schema_ref_exists(
                manifest,
                &result.schema,
                &format!("jobs queue '{queue_type}' result"),
            )?;
        }
    }

    for (alias, kv) in &manifest.resources.kv {
        assert_schema_ref_exists(
            manifest,
            &kv.schema.schema,
            &format!("resources.kv.{alias}"),
        )?;
    }

    Ok(())
}

fn assert_schema_ref_exists(
    manifest: &ContractManifest,
    schema_name: &str,
    context: &str,
) -> Result<(), ContractsError> {
    if manifest.schemas.contains_key(schema_name) {
        Ok(())
    } else {
        Err(ContractsError::SchemaValidation {
            kind: "contract",
            details: format!("{context}: unknown schema '{schema_name}'"),
        })
    }
}

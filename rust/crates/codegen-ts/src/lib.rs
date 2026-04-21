//! TypeScript SDK generation from canonical Trellis contract manifests.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;
use trellis_contracts::{load_manifest, LoadedManifest};

/// Errors returned while generating a TypeScript SDK package.
#[derive(thiserror::Error, Debug)]
pub enum CodegenTsError {
    #[error("contracts error: {0}")]
    Contracts(#[from] trellis_contracts::ContractsError),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("missing manifest path file name")]
    MissingManifestFileName,

    #[error("missing runtime repo root for local runtime source")]
    MissingRuntimeRepoRoot,

    #[error("could not find a Deno config under runtime repo root")]
    MissingRuntimeConfig,
}

/// Options for generating one TypeScript SDK package.
#[derive(Debug, Clone)]
pub struct GenerateTsSdkOpts {
    pub manifest_path: PathBuf,
    pub out_dir: PathBuf,
    pub package_name: String,
    pub package_version: String,
    pub runtime_deps: TsRuntimeDeps,
}

/// Runtime dependency configuration for generated TypeScript SDKs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TsRuntimeDeps {
    pub source: TsRuntimeSource,
    pub version: String,
    pub repo_root: Option<PathBuf>,
}

/// Where generated SDKs should resolve Trellis runtime packages from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TsRuntimeSource {
    Registry,
    Local,
}

/// Generate a TypeScript SDK package for one manifest.
pub fn generate_ts_sdk(opts: &GenerateTsSdkOpts) -> Result<(), CodegenTsError> {
    let loaded = load_manifest(&opts.manifest_path)?;
    fs::create_dir_all(&opts.out_dir)?;

    write_if_changed(
        &opts.out_dir.join("deno.json"),
        &format!("{}\n", serde_json::to_string_pretty(&deno_json(opts)?)?),
    )?;
    write_if_changed(
        &opts.out_dir.join("contract.ts"),
        &render_contract_ts(opts, &loaded),
    )?;
    write_if_changed(
        &opts.out_dir.join("types.ts"),
        &render_types_ts(opts, &loaded),
    )?;
    write_if_changed(
        &opts.out_dir.join("schemas.ts"),
        &render_schemas_ts(opts, &loaded),
    )?;
    write_if_changed(&opts.out_dir.join("api.ts"), &render_api_ts(opts, &loaded))?;
    write_if_changed(&opts.out_dir.join("mod.ts"), &render_mod_ts(opts))?;

    fs::create_dir_all(opts.out_dir.join("scripts"))?;
    write_if_changed(
        &opts.out_dir.join("scripts").join("build_npm.ts"),
        &render_build_npm_ts(opts, &loaded),
    )?;
    write_if_changed(
        &opts.out_dir.join("README.md"),
        &render_readme(opts, &loaded),
    )?;

    Ok(())
}

fn deno_json(opts: &GenerateTsSdkOpts) -> Result<serde_json::Map<String, Value>, CodegenTsError> {
    let mut root = serde_json::Map::new();
    let extends = resolved_extends(opts)?;

    if let Some(extends) = &extends {
        root.insert("extends".to_string(), Value::String(extends.clone()));
    }
    root.insert("name".to_string(), Value::String(opts.package_name.clone()));
    root.insert(
        "version".to_string(),
        Value::String(opts.package_version.clone()),
    );
    root.insert(
        "exports".to_string(),
        serde_json::json!({
            ".": "./mod.ts",
            "./api": "./api.ts",
            "./types": "./types.ts",
            "./schemas": "./schemas.ts",
            "./contract": "./contract.ts"
        }),
    );
    root.insert(
        "tasks".to_string(),
        serde_json::json!({
            "build:npm": "deno run -A scripts/build_npm.ts"
        }),
    );
    if extends.is_none() {
        root.insert(
            "imports".to_string(),
            serde_json::json!({
                "@qlever-llc/trellis": format!("jsr:@qlever-llc/trellis@^{}", opts.runtime_deps.version)
            }),
        );
    }
    root.insert(
        "compilerOptions".to_string(),
        serde_json::json!({
            "strict": true,
            "verbatimModuleSyntax": true
        }),
    );

    Ok(root)
}

fn render_contract_ts(opts: &GenerateTsSdkOpts, loaded: &LoadedManifest) -> String {
    let module_export = sdk_module_export_name(&opts.package_name);
    let source_reference =
        manifest_source_reference(&opts.manifest_path, opts.runtime_deps.repo_root.as_deref());
    let trellis_import = trellis_runtime_import(opts);
    let trellis_contracts_import = trellis_contracts_import(opts);
    let is_trellis_auth = loaded.manifest.id == "trellis.auth@v1";
    let contract_jobs_type = render_contract_jobs_type(loaded);
    let has_contract_jobs = contract_jobs_type.is_some();
    let sdk_contract_module_type = if has_contract_jobs {
        "SdkContractModule<typeof CONTRACT_ID, typeof API.owned, ContractJobs>"
    } else {
        "SdkContractModule<typeof CONTRACT_ID, typeof API.owned>"
    };
    let import_line = if is_trellis_auth {
        format!(
            "import type {{ ContractDependencyUse, SdkContractModule, TrellisContractV1, UseSpec }} from {};",
            js_string(&trellis_import)
        )
    } else {
        format!(
            "import type {{ SdkContractModule, TrellisContractV1, UseSpec }} from {};",
            js_string(&trellis_import)
        )
    };

    let mut lines = vec![
        format!("// Generated from {}", escape_js_string(&source_reference)),
        import_line,
        "import { API } from \"./api.ts\";".to_string(),
        String::new(),
        "const CONTRACT_MODULE_METADATA = Symbol.for(\"@qlever-llc/trellis/contracts/contract-module\");".to_string(),
        String::new(),
        format!("export const CONTRACT_ID = {} as const;", js_string(&loaded.manifest.id)),
        format!("export const CONTRACT_DIGEST = {} as const;", js_string(&loaded.digest)),
        format!("export const CONTRACT = {} as TrellisContractV1;", loaded.canonical),
        String::new(),
        "function assertSelectedKeysExist(".to_string(),
        "  kind: \"rpc\" | \"operations\" | \"events\" | \"subjects\",".to_string(),
        "  keys: readonly string[] | undefined,".to_string(),
        "  api: Record<string, unknown>,".to_string(),
        ") {".to_string(),
        "  if (!keys) {".to_string(),
        "    return;".to_string(),
        "  }".to_string(),
        String::new(),
        "  for (const key of keys) {".to_string(),
        "    if (!Object.hasOwn(api, key)) {".to_string(),
        "      throw new Error(`Contract '${CONTRACT_ID}' does not expose ${kind} key '${key}'`);".to_string(),
        "    }".to_string(),
        "  }".to_string(),
        "}".to_string(),
        String::new(),
        "function assertValidUseSpec(spec: UseSpec<typeof API.owned>) {".to_string(),
        "  assertSelectedKeysExist(\"rpc\", spec.rpc?.call, API.owned.rpc);".to_string(),
        "  assertSelectedKeysExist(\"operations\", spec.operations?.call, API.owned.operations);".to_string(),
        "  assertSelectedKeysExist(\"events\", spec.events?.publish, API.owned.events);".to_string(),
        "  assertSelectedKeysExist(\"events\", spec.events?.subscribe, API.owned.events);".to_string(),
        "  assertSelectedKeysExist(\"subjects\", spec.subjects?.publish, API.owned.subjects);".to_string(),
        "  assertSelectedKeysExist(\"subjects\", spec.subjects?.subscribe, API.owned.subjects);".to_string(),
        "}".to_string(),
    ];

    if has_contract_jobs {
        lines.insert(
            2,
            format!(
                "import {{ CONTRACT_JOBS_METADATA, type ContractJobsMetadata }} from {};",
                js_string(&trellis_contracts_import)
            ),
        );
    }

    if let Some(contract_jobs_type) = contract_jobs_type {
        lines.extend([
            String::new(),
            contract_jobs_type,
            String::new(),
            "function defineContractJobsMetadata<TJobs extends ContractJobsMetadata>(".to_string(),
            "  jobs: ContractJobsMetadata,".to_string(),
            "): TJobs {".to_string(),
            "  return jobs as TJobs;".to_string(),
            "}".to_string(),
            String::new(),
            "const CONTRACT_JOBS = defineContractJobsMetadata<ContractJobs>({".to_string(),
        ]);
        lines.extend(render_contract_jobs_value(loaded));
        lines.push("});".to_string());
    }

    if is_trellis_auth {
        lines.extend([
            String::new(),
            "const DEFAULT_AUTH_RPC_CALL = [".to_string(),
            "  \"Auth.Me\",".to_string(),
            "  \"Auth.Logout\",".to_string(),
            "] as const;".to_string(),
            String::new(),
            "type AuthOwnedApi = typeof API.owned;".to_string(),
            "type AuthUseSpec = UseSpec<AuthOwnedApi>;".to_string(),
            "type DefaultAuthRpcCall = typeof DEFAULT_AUTH_RPC_CALL;".to_string(),
            "type WithDefaultAuthRpcCall<TSpec extends AuthUseSpec | undefined> =".to_string(),
            "  TSpec extends { rpc?: { call?: infer TCall extends readonly string[] } }"
                .to_string(),
            "    ? readonly [...DefaultAuthRpcCall, ...TCall]".to_string(),
            "    : DefaultAuthRpcCall;".to_string(),
            "type WithDefaultAuthUseSpec<TSpec extends AuthUseSpec | undefined> =".to_string(),
            "  (TSpec extends AuthUseSpec ? Omit<TSpec, \"rpc\"> : {}) & {".to_string(),
            "    rpc: {".to_string(),
            "      call: WithDefaultAuthRpcCall<TSpec>;".to_string(),
            "    };".to_string(),
            "  };".to_string(),
            "type AuthUseDefaultsFn = <".to_string(),
            "  const TSpec extends AuthUseSpec | undefined = undefined,".to_string(),
            ">(spec?: TSpec) => ContractDependencyUse<".to_string(),
            "  typeof CONTRACT_ID,".to_string(),
            "  AuthOwnedApi,".to_string(),
            "  WithDefaultAuthUseSpec<TSpec>".to_string(),
            ">;".to_string(),
            format!("type AuthModule = {sdk_contract_module_type} & {{"),
            "  useDefaults: AuthUseDefaultsFn;".to_string(),
            "};".to_string(),
            String::new(),
            "function mergeAuthUseDefaults(spec?: AuthUseSpec): AuthUseSpec {".to_string(),
            "  const rpcCall = [...DEFAULT_AUTH_RPC_CALL];".to_string(),
            "  for (const key of spec?.rpc?.call ?? []) {".to_string(),
            "    if (!rpcCall.includes(key as (typeof rpcCall)[number])) {".to_string(),
            "      rpcCall.push(key as (typeof rpcCall)[number]);".to_string(),
            "    }".to_string(),
            "  }".to_string(),
            String::new(),
            "  return {".to_string(),
            "    ...spec,".to_string(),
            "    rpc: {".to_string(),
            "      ...spec?.rpc,".to_string(),
            "      call: rpcCall,".to_string(),
            "    },".to_string(),
            "  };".to_string(),
            "}".to_string(),
            String::new(),
            format!("export const {}: AuthModule = {{", module_export),
        ]);
    } else {
        lines.extend([
            String::new(),
            format!(
                "export const {}: {} = {{",
                module_export, sdk_contract_module_type
            ),
        ]);
    }

    let mut contract_fields = vec![
        "  CONTRACT_ID,".to_string(),
        "  CONTRACT_DIGEST,".to_string(),
        "  CONTRACT,".to_string(),
        "  API,".to_string(),
    ];
    if has_contract_jobs {
        contract_fields.push("  [CONTRACT_JOBS_METADATA]: CONTRACT_JOBS,".to_string());
    }
    contract_fields.extend([
        "  use: ((spec: UseSpec<typeof API.owned>) => {".to_string(),
        "    assertValidUseSpec(spec);".to_string(),
        String::new(),
        "    const dependencyUse = {".to_string(),
        "      contract: CONTRACT_ID,".to_string(),
        "      ...(spec.rpc?.call ? { rpc: { call: [...spec.rpc.call] } } : {}),".to_string(),
        "      ...(spec.operations?.call ? { operations: { call: [...spec.operations.call] } } : {}),".to_string(),
        "      ...((spec.events?.publish || spec.events?.subscribe)".to_string(),
        "        ? {".to_string(),
        "          events: {".to_string(),
        "            ...(spec.events.publish ? { publish: [...spec.events.publish] } : {}),".to_string(),
        "            ...(spec.events.subscribe ? { subscribe: [...spec.events.subscribe] } : {}),".to_string(),
        "          },".to_string(),
        "        }".to_string(),
        "        : {}),".to_string(),
        "      ...((spec.subjects?.publish || spec.subjects?.subscribe)".to_string(),
        "        ? {".to_string(),
        "          subjects: {".to_string(),
        "            ...(spec.subjects.publish ? { publish: [...spec.subjects.publish] } : {}),".to_string(),
        "            ...(spec.subjects.subscribe ? { subscribe: [...spec.subjects.subscribe] } : {}),".to_string(),
        "          },".to_string(),
        "        }".to_string(),
        "        : {}),".to_string(),
        "    };".to_string(),
        String::new(),
        "    Object.defineProperty(dependencyUse, CONTRACT_MODULE_METADATA, {".to_string(),
        format!("      value: {},", module_export),
        "      enumerable: false,".to_string(),
        "    });".to_string(),
        String::new(),
        "    return dependencyUse;".to_string(),
        "  }),".to_string(),
    ]);
    lines.extend(contract_fields);

    if is_trellis_auth {
        lines.extend([
            "  useDefaults: ((spec?: AuthUseSpec) => {".to_string(),
            format!(
                "    return {}.use(mergeAuthUseDefaults(spec));",
                module_export
            ),
            "  }) as AuthUseDefaultsFn,".to_string(),
            "};".to_string(),
            String::new(),
            format!("export const use = {}.use;", module_export),
            format!("export const useDefaults = {}.useDefaults;", module_export),
        ]);
    } else {
        lines.extend([
            "};".to_string(),
            String::new(),
            format!("export const use = {}.use;", module_export),
        ]);
    }

    format!(
        "{}
",
        lines.join(
            "
"
        )
    )
}

fn top_level_contract_jobs<'a>(
    loaded: &'a LoadedManifest,
) -> Option<&'a serde_json::Map<String, Value>> {
    loaded.value.get("jobs")?.as_object()
}

fn render_contract_jobs_type(loaded: &LoadedManifest) -> Option<String> {
    let jobs = top_level_contract_jobs(loaded)?;

    if jobs.is_empty() {
        return None;
    }

    let mut lines = vec!["type ContractJobs = {".to_string()];

    for (queue_type, queue) in jobs {
        let queue = queue
            .as_object()
            .expect("contract jobs queue must be an object");
        let payload_schema = queue
            .get("payload")
            .and_then(Value::as_object)
            .and_then(|payload| payload.get("schema"))
            .and_then(Value::as_str)
            .expect("contract jobs queue payload must include a schema ref");
        let payload = schema_to_ts(resolve_schema_ref(loaded, payload_schema));
        let result = queue
            .get("result")
            .and_then(Value::as_object)
            .and_then(|result| result.get("schema"))
            .and_then(Value::as_str)
            .map(|schema_name| schema_to_ts(resolve_schema_ref(loaded, schema_name)))
            .unwrap_or_else(|| "unknown".to_string());

        lines.push(format!("  {}: {{", js_string(queue_type)));
        lines.push(format!("    payload: {payload};"));
        lines.push(format!("    result: {result};"));
        lines.push("  };".to_string());
    }

    lines.push("};".to_string());
    Some(lines.join("\n"))
}

fn render_contract_jobs_value(loaded: &LoadedManifest) -> Vec<String> {
    let Some(jobs) = top_level_contract_jobs(loaded) else {
        return Vec::new();
    };

    jobs.keys()
        .map(|queue_type| {
            format!(
                "  {}: {{ payload: undefined, result: undefined }},",
                js_string(queue_type)
            )
        })
        .collect()
}

fn render_types_ts(opts: &GenerateTsSdkOpts, loaded: &LoadedManifest) -> String {
    let source_reference =
        manifest_source_reference(&opts.manifest_path, opts.runtime_deps.repo_root.as_deref());
    let trellis_import = trellis_runtime_import(opts);
    let mut lines = vec![format!(
        "// Generated from {}",
        escape_js_string(&source_reference)
    )];

    if !loaded.manifest.rpc.is_empty() {
        lines.extend([
            format!(
                "import type {{ RpcHandlerFn }} from {};",
                js_string(&trellis_import)
            ),
            "import { API } from \"./api.ts\";".to_string(),
            String::new(),
        ]);
    }

    if !loaded.manifest.errors.is_empty() {
        lines.extend([
            format!(
                "import {{ TrellisError, type TransportErrorData }} from {};",
                js_string(&trellis_import)
            ),
            "import { SCHEMAS } from \"./schemas.ts\";".to_string(),
            String::new(),
        ]);
    }

    lines.extend([
        format!(
            "export const CONTRACT_ID = {} as const;",
            js_string(&loaded.manifest.id)
        ),
        format!(
            "export const CONTRACT_DIGEST = {} as const;",
            js_string(&loaded.digest)
        ),
        String::new(),
    ]);

    for (key, rpc) in &loaded.manifest.rpc {
        let base = key_to_pascal(key);
        lines.push(format!(
            "export type {base}Input = {};",
            schema_to_ts(resolve_schema_ref(loaded, &rpc.input.schema))
        ));
        lines.push(format!(
            "export type {base}Output = {};",
            schema_to_ts(resolve_schema_ref(loaded, &rpc.output.schema))
        ));
        lines.push(String::new());
    }

    for (key, operation) in &loaded.manifest.operations {
        let base = key_to_pascal(key);
        lines.push(format!(
            "export type {base}Input = {};",
            schema_to_ts(resolve_schema_ref(loaded, &operation.input.schema))
        ));
        if let Some(progress) = &operation.progress {
            lines.push(format!(
                "export type {base}Progress = {};",
                schema_to_ts(resolve_schema_ref(loaded, &progress.schema))
            ));
        }
        if let Some(output) = &operation.output {
            lines.push(format!(
                "export type {base}Output = {};",
                schema_to_ts(resolve_schema_ref(loaded, &output.schema))
            ));
        }
        lines.push(String::new());
    }

    for (key, event) in &loaded.manifest.events {
        let base = key_to_pascal(key);
        lines.push(format!(
            "export type {base}Event = {};",
            schema_to_ts(resolve_schema_ref(loaded, &event.event.schema))
        ));
        lines.push(String::new());
    }

    for (key, subject) in &loaded.manifest.subjects {
        if let Some(message) = &subject.message {
            let base = key_to_pascal(key);
            lines.push(format!(
                "export type {base}Message = {};",
                schema_to_ts(resolve_schema_ref(loaded, &message.schema))
            ));
            lines.push(String::new());
        }
    }

    for (key, error) in &loaded.manifest.errors {
        let base = key_to_pascal(&error.error_type);
        let data_type = format!("{base}Data");
        let ts_type = error
            .schema
            .as_ref()
            .map(|schema| schema_to_ts(resolve_schema_ref(loaded, &schema.schema)))
            .unwrap_or_else(|| "TransportErrorData".to_string());
        lines.push(format!("export type {data_type} = {ts_type};"));
        lines.push(format!(
            "export class {base} extends TrellisError<{data_type}> {{"
        ));
        if let Some(_schema) = &error.schema {
            lines.push(format!(
                "  static readonly schema = SCHEMAS.errors[{}].schema;",
                js_string(key)
            ));
        }
        lines.push(format!(
            "  override readonly name = {} as const;",
            js_string(&error.error_type)
        ));
        lines.push(format!("  readonly data: {data_type};"));
        lines.push(String::new());
        lines.push(format!("  constructor(data: {data_type}) {{"));
        lines.push("    super(data.message, {".to_string());
        lines.push("      id: data.id,".to_string());
        lines.push(
            "      ...(data.context !== undefined ? { context: data.context } : {}),".to_string(),
        );
        lines.push("    });".to_string());
        lines.push("    this.data = data;".to_string());
        lines.push("  }".to_string());
        lines.push(String::new());
        lines.push(format!(
            "  static fromSerializable(data: {data_type}): {base} {{"
        ));
        lines.push(format!("    return new {base}(data);"));
        lines.push("  }".to_string());
        lines.push(String::new());
        lines.push(format!("  override toSerializable(): {data_type} {{"));
        lines.push("    return this.data;".to_string());
        lines.push("  }".to_string());
        lines.push("}".to_string());
        lines.push(String::new());
    }

    lines.push("export interface RpcMap {".to_string());
    for key in loaded.manifest.rpc.keys() {
        let base = key_to_pascal(key);
        lines.push(format!(
            "  {}: {{ input: {base}Input; output: {base}Output; }};",
            js_string(key)
        ));
    }
    lines.push("}".to_string());
    lines.push(String::new());

    for key in loaded.manifest.rpc.keys() {
        let base = key_to_pascal(key);
        lines.push(format!(
            "export type {base}Handler = RpcHandlerFn<typeof API.owned, {}>;",
            js_string(key)
        ));
    }
    if !loaded.manifest.rpc.is_empty() {
        lines.push(String::new());
    }

    lines.push("export interface EventMap {".to_string());
    for key in loaded.manifest.events.keys() {
        let base = key_to_pascal(key);
        lines.push(format!("  {}: {{ event: {base}Event; }};", js_string(key)));
    }
    lines.push("}".to_string());
    lines.push(String::new());

    lines.push("export interface SubjectMap {".to_string());
    for (key, subject) in &loaded.manifest.subjects {
        let message_type = if subject.message.is_some() {
            format!("{}Message", key_to_pascal(key))
        } else {
            "unknown".to_string()
        };
        lines.push(format!(
            "  {}: {{ message: {message_type}; }};",
            js_string(key)
        ));
    }
    lines.push("}".to_string());
    lines.push(String::new());

    format!(
        "{}
",
        lines.join(
            "
"
        )
    )
}

fn render_schemas_ts(opts: &GenerateTsSdkOpts, loaded: &LoadedManifest) -> String {
    let source_reference =
        manifest_source_reference(&opts.manifest_path, opts.runtime_deps.repo_root.as_deref());
    let mut lines = vec![
        format!("// Generated from {}", escape_js_string(&source_reference)),
        "export const SCHEMAS = {".to_string(),
        "  schemas: {".to_string(),
    ];
    for (key, schema) in &loaded.manifest.schemas {
        lines.push(format!(
            "    {}: {} as const,",
            js_string(key),
            serde_json::to_string(schema).unwrap()
        ));
    }
    lines.extend(["  },".to_string(), "  errors: {".to_string()]);
    for (key, error) in &loaded.manifest.errors {
        lines.push(format!("    {}: {{", js_string(key)));
        if let Some(schema) = &error.schema {
            lines.push(format!(
                "      schema: {} as const,",
                serde_json::to_string(resolve_schema_ref(loaded, &schema.schema)).unwrap()
            ));
        }
        lines.push("    },".to_string());
    }
    lines.extend(["  },".to_string(), "  rpc: {".to_string()]);
    for (key, rpc) in &loaded.manifest.rpc {
        lines.push(format!("    {}: {{", js_string(key)));
        lines.push(format!(
            "      input: {} as const,",
            serde_json::to_string(resolve_schema_ref(loaded, &rpc.input.schema)).unwrap()
        ));
        lines.push(format!(
            "      output: {} as const,",
            serde_json::to_string(resolve_schema_ref(loaded, &rpc.output.schema)).unwrap()
        ));
        lines.push("    },".to_string());
    }
    lines.push("  },".to_string());
    lines.push("  operations: {".to_string());
    for (key, operation) in &loaded.manifest.operations {
        lines.push(format!("    {}: {{", js_string(key)));
        lines.push(format!(
            "      input: {} as const,",
            serde_json::to_string(resolve_schema_ref(loaded, &operation.input.schema)).unwrap()
        ));
        if let Some(progress) = &operation.progress {
            lines.push(format!(
                "      progress: {} as const,",
                serde_json::to_string(resolve_schema_ref(loaded, &progress.schema)).unwrap()
            ));
        }
        if let Some(output) = &operation.output {
            lines.push(format!(
                "      output: {} as const,",
                serde_json::to_string(resolve_schema_ref(loaded, &output.schema)).unwrap()
            ));
        }
        lines.push("    },".to_string());
    }
    lines.push("  },".to_string());
    lines.push("  events: {".to_string());
    for (key, event) in &loaded.manifest.events {
        lines.push(format!("    {}: {{", js_string(key)));
        lines.push(format!(
            "      event: {} as const,",
            serde_json::to_string(resolve_schema_ref(loaded, &event.event.schema)).unwrap()
        ));
        lines.push("    },".to_string());
    }
    lines.push("  },".to_string());
    lines.push("  subjects: {".to_string());
    for (key, subject) in &loaded.manifest.subjects {
        lines.push(format!("    {}: {{", js_string(key)));
        if let Some(message) = &subject.message {
            lines.push(format!(
                "      schema: {} as const,",
                serde_json::to_string(resolve_schema_ref(loaded, &message.schema)).unwrap()
            ));
        }
        lines.push("    },".to_string());
    }
    lines.push("  },".to_string());
    lines.push("} as const;".to_string());
    lines.push(String::new());

    format!(
        "{}
",
        lines.join(
            "
"
        )
    )
}

fn render_api_ts(opts: &GenerateTsSdkOpts, loaded: &LoadedManifest) -> String {
    let source_reference =
        manifest_source_reference(&opts.manifest_path, opts.runtime_deps.repo_root.as_deref());
    let trellis_contracts_import = trellis_contracts_import(opts);
    let mut lines = vec![
        format!("// Generated from {}", escape_js_string(&source_reference)),
        format!(
            "import type {{ TrellisAPI }} from {};",
            js_string(&trellis_contracts_import)
        ),
        format!(
            "import {{ schema }} from {};",
            js_string(&trellis_contracts_import)
        ),
        "import * as Types from \"./types.ts\";".to_string(),
        "import { SCHEMAS } from \"./schemas.ts\";".to_string(),
        String::new(),
        "export const OWNED_API = {".to_string(),
        "  rpc: {".to_string(),
    ];

    for (key, rpc) in &loaded.manifest.rpc {
        let base = key_to_pascal(key);
        lines.push(format!("    {}: {{", js_string(key)));
        lines.push(format!("      subject: {},", js_string(&rpc.subject)));
        lines.push(format!(
            "      input: schema<Types.{base}Input>(SCHEMAS.rpc[{}].input),",
            js_string(key)
        ));
        lines.push(format!(
            "      output: schema<Types.{base}Output>(SCHEMAS.rpc[{}].output),",
            js_string(key)
        ));
        let capabilities = rpc
            .capabilities
            .as_ref()
            .and_then(|caps| caps.call.clone())
            .unwrap_or_default();
        lines.push(format!(
            "      callerCapabilities: {},",
            serde_json::to_string(&capabilities).unwrap()
        ));
        if let Some(errors) = &rpc.errors {
            if !errors.is_empty() {
                let error_types = errors
                    .iter()
                    .map(|error| error.error_type.clone())
                    .collect::<Vec<_>>();
                lines.push(format!(
                    "      errors: {} as const,",
                    serde_json::to_string(&error_types).unwrap()
                ));
                lines.push(format!(
                    "      declaredErrorTypes: {} as const,",
                    serde_json::to_string(&error_types).unwrap()
                ));
            }
        }
        let local_runtime_errors = rpc
            .errors
            .as_ref()
            .map(|values| {
                values
                    .iter()
                    .filter_map(|value| {
                        loaded
                            .manifest
                            .errors
                            .iter()
                            .find(|(_, decl)| decl.error_type == value.error_type)
                            .map(|(name, decl)| (name, decl))
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        if !local_runtime_errors.is_empty() {
            lines.push("      runtimeErrors: [".to_string());
            for (error_name, error_decl) in local_runtime_errors {
                let base = key_to_pascal(&error_decl.error_type);
                lines.push("        {".to_string());
                lines.push(format!(
                    "          type: {},",
                    js_string(&error_decl.error_type)
                ));
                if error_decl.schema.is_some() {
                    lines.push(format!(
                        "          schema: schema<Types.{base}Data>(SCHEMAS.errors[{}].schema),",
                        js_string(error_name)
                    ));
                }
                lines.push(format!(
                    "          fromSerializable: Types.{base}.fromSerializable,"
                ));
                lines.push("        },".to_string());
            }
            lines.push("      ] as const,".to_string());
        }
        lines.push("    },".to_string());
    }

    lines.push("  },".to_string());
    lines.push("  operations: {".to_string());
    for (key, operation) in &loaded.manifest.operations {
        let base = key_to_pascal(key);
        lines.push(format!("    {}: {{", js_string(key)));
        lines.push(format!("      subject: {},", js_string(&operation.subject)));
        lines.push(format!(
            "      input: schema<Types.{base}Input>(SCHEMAS.operations[{}].input),",
            js_string(key)
        ));
        if operation.progress.is_some() {
            lines.push(format!(
                "      progress: schema<Types.{base}Progress>(SCHEMAS.operations[{}].progress),",
                js_string(key)
            ));
        }
        if operation.output.is_some() {
            lines.push(format!(
                "      output: schema<Types.{base}Output>(SCHEMAS.operations[{}].output),",
                js_string(key)
            ));
        }
        if let Some(transfer) = &operation.transfer {
            lines.push("      transfer: {".to_string());
            lines.push(format!("        store: {},", js_string(&transfer.store)));
            lines.push(format!("        key: {},", js_string(&transfer.key)));
            if let Some(content_type) = &transfer.content_type {
                lines.push(format!("        contentType: {},", js_string(content_type)));
            }
            if let Some(metadata) = &transfer.metadata {
                lines.push(format!("        metadata: {},", js_string(metadata)));
            }
            if let Some(expires_in_ms) = transfer.expires_in_ms {
                lines.push(format!("        expiresInMs: {expires_in_ms},"));
            }
            if let Some(max_bytes) = transfer.max_bytes {
                lines.push(format!("        maxBytes: {max_bytes},"));
            }
            lines.push("      },".to_string());
        }
        let caller = operation
            .capabilities
            .as_ref()
            .and_then(|caps| caps.call.clone())
            .unwrap_or_default();
        let read = operation
            .capabilities
            .as_ref()
            .and_then(|caps| caps.read.clone())
            .unwrap_or_default();
        let cancel = operation
            .capabilities
            .as_ref()
            .and_then(|caps| caps.cancel.clone())
            .unwrap_or_default();
        lines.push(format!(
            "      callerCapabilities: {},",
            serde_json::to_string(&caller).unwrap()
        ));
        lines.push(format!(
            "      readCapabilities: {},",
            serde_json::to_string(&read).unwrap()
        ));
        lines.push(format!(
            "      cancelCapabilities: {},",
            serde_json::to_string(&cancel).unwrap()
        ));
        if let Some(cancelable) = operation.cancel {
            lines.push(format!(
                "      cancel: {},",
                if cancelable { "true" } else { "false" }
            ));
        }
        lines.push("    },".to_string());
    }

    lines.push("  },".to_string());
    lines.push("  events: {".to_string());
    for (key, event) in &loaded.manifest.events {
        let base = key_to_pascal(key);
        lines.push(format!("    {}: {{", js_string(key)));
        lines.push(format!("      subject: {},", js_string(&event.subject)));
        if let Some(params) = &event.params {
            if !params.is_empty() {
                lines.push(format!(
                    "      params: {} as const,",
                    serde_json::to_string(params).unwrap()
                ));
            }
        }
        lines.push(format!(
            "      event: schema<Types.{base}Event>(SCHEMAS.events[{}].event),",
            js_string(key)
        ));
        let publish = event
            .capabilities
            .as_ref()
            .and_then(|caps| caps.publish.clone())
            .unwrap_or_default();
        let subscribe = event
            .capabilities
            .as_ref()
            .and_then(|caps| caps.subscribe.clone())
            .unwrap_or_default();
        lines.push(format!(
            "      publishCapabilities: {},",
            serde_json::to_string(&publish).unwrap()
        ));
        lines.push(format!(
            "      subscribeCapabilities: {},",
            serde_json::to_string(&subscribe).unwrap()
        ));
        lines.push("    },".to_string());
    }

    lines.push("  },".to_string());
    lines.push("  subjects: {".to_string());
    for (key, subject) in &loaded.manifest.subjects {
        let base = key_to_pascal(key);
        lines.push(format!("    {}: {{", js_string(key)));
        lines.push(format!("      subject: {},", js_string(&subject.subject)));
        if subject.message.is_some() {
            lines.push(format!(
                "      schema: schema<Types.{base}Message>(SCHEMAS.subjects[{}].schema),",
                js_string(key)
            ));
        }
        let publish = subject
            .capabilities
            .as_ref()
            .and_then(|caps| caps.publish.clone())
            .unwrap_or_default();
        let subscribe = subject
            .capabilities
            .as_ref()
            .and_then(|caps| caps.subscribe.clone())
            .unwrap_or_default();
        lines.push(format!(
            "      publishCapabilities: {},",
            serde_json::to_string(&publish).unwrap()
        ));
        lines.push(format!(
            "      subscribeCapabilities: {},",
            serde_json::to_string(&subscribe).unwrap()
        ));
        lines.push("    },".to_string());
    }
    lines.push("  },".to_string());
    lines.push("} satisfies TrellisAPI;".to_string());
    lines.push(String::new());
    lines.push(
        "const EMPTY_API = { rpc: {}, operations: {}, events: {}, subjects: {} } as const satisfies TrellisAPI;"
            .to_string(),
    );
    lines.push(String::new());
    lines.push("export const API = {".to_string());
    lines.push("  owned: OWNED_API,".to_string());
    lines.push("  used: EMPTY_API,".to_string());
    lines.push("  trellis: OWNED_API,".to_string());
    lines.push("} as const;".to_string());
    lines.push(String::new());
    lines.push("export type OwnedApi = typeof API.owned;".to_string());
    lines.push("export type Api = typeof API.trellis;".to_string());
    lines.push("export type ApiViews = typeof API;".to_string());
    lines.push(String::new());

    format!(
        "{}
",
        lines.join(
            "
"
        )
    )
}

fn render_build_npm_ts(opts: &GenerateTsSdkOpts, loaded: &LoadedManifest) -> String {
    let source_reference =
        manifest_source_reference(&opts.manifest_path, opts.runtime_deps.repo_root.as_deref());
    let trellis_dependency = match opts.runtime_deps.source {
        TsRuntimeSource::Registry => format!("^{}", opts.runtime_deps.version),
        TsRuntimeSource::Local => opts
            .runtime_deps
            .repo_root
            .as_ref()
            .map(|repo_root| {
                format!(
                    "file:{}",
                    relative_path_string(&opts.out_dir, &repo_root.join("js/packages/trellis/npm"))
                )
            })
            .unwrap_or_else(|| format!("^{}", opts.runtime_deps.version)),
    };
    let publish_trellis_dependency = format!("^{}", opts.runtime_deps.version);

    format!(
        "// Generated from {}\nimport {{ build, emptyDir }} from \"jsr:@deno/dnt@^0.41.3\";\n\nawait emptyDir(new URL(\"../npm\", import.meta.url));\n\nawait build({{\n  entryPoints: [\"./mod.ts\"],\n  outDir: \"./npm\",\n  shims: {{\n    deno: true,\n  }},\n  test: false,\n  typeCheck: false,\n  package: {{\n    name: {},\n    version: {},\n    description: \"Generated Trellis SDK for contract {}\",\n    license: \"Apache-2.0\",\n    homepage: \"https://github.com/Qlever-LLC/trellis#readme\",\n    bugs: {{\n      url: \"https://github.com/Qlever-LLC/trellis/issues\",\n    }},\n    repository: {{\n      type: \"git\",\n      url: \"https://github.com/Qlever-LLC/trellis\",\n    }},\n    publishConfig: {{\n      access: \"public\",\n    }},\n    dependencies: {{\n      \"@qlever-llc/trellis\": {},\n    }},\n  }},\n}});\n\nconst packageJsonPath = new URL(\"../npm/package.json\", import.meta.url);\nconst packageJson = JSON.parse(await Deno.readTextFile(packageJsonPath));\npackageJson.dependencies = {{\n  ...(packageJson.dependencies ?? {{}}),\n  \"@qlever-llc/trellis\": {},\n}};\nawait Deno.writeTextFile(packageJsonPath, `${{JSON.stringify(packageJson, null, 2)}}\n`);\n",
        escape_js_string(&source_reference),
        js_string(&opts.package_name),
        js_string(&opts.package_version),
        escape_js_string(&loaded.manifest.id),
        js_string(&trellis_dependency),
        js_string(&publish_trellis_dependency),
    )
}

fn resolved_extends(opts: &GenerateTsSdkOpts) -> Result<Option<String>, CodegenTsError> {
    match opts.runtime_deps.source {
        TsRuntimeSource::Registry => Ok(None),
        TsRuntimeSource::Local => {
            let repo_root = opts
                .runtime_deps
                .repo_root
                .as_ref()
                .ok_or(CodegenTsError::MissingRuntimeRepoRoot)?;
            let repo_root = repo_root.canonicalize()?;
            let runtime_config = runtime_config_path(&repo_root)?;
            let out_dir = opts
                .out_dir
                .canonicalize()
                .unwrap_or_else(|_| opts.out_dir.clone());
            Ok(Some(relative_path_string(&out_dir, &runtime_config)))
        }
    }
}

fn trellis_runtime_import(opts: &GenerateTsSdkOpts) -> String {
    match opts.runtime_deps.source {
        TsRuntimeSource::Registry => "@qlever-llc/trellis".to_string(),
        TsRuntimeSource::Local => local_runtime_import_path(opts, "js/packages/trellis/index.ts"),
    }
}

fn trellis_contracts_import(opts: &GenerateTsSdkOpts) -> String {
    match opts.runtime_deps.source {
        TsRuntimeSource::Registry => "@qlever-llc/trellis/contracts".to_string(),
        TsRuntimeSource::Local => local_runtime_import_path(opts, "js/packages/trellis/contracts.ts"),
    }
}

fn local_runtime_import_path(opts: &GenerateTsSdkOpts, relative_target: &str) -> String {
    opts.runtime_deps
        .repo_root
        .as_ref()
        .map(|repo_root| relative_path_string(&opts.out_dir, &repo_root.join(relative_target)))
        .unwrap_or_else(|| relative_target.to_string())
}

fn runtime_config_path(repo_root: &Path) -> Result<PathBuf, CodegenTsError> {
    let js_deno = repo_root.join("js/deno.json");
    if js_deno.exists() {
        return Ok(js_deno);
    }

    let root_deno = repo_root.join("deno.json");
    if root_deno.exists() {
        return Ok(root_deno);
    }

    Err(CodegenTsError::MissingRuntimeConfig)
}

fn relative_path_string(from_dir: &Path, to_path: &Path) -> String {
    let from_components = from_dir.components().collect::<Vec<_>>();
    let to_components = to_path.components().collect::<Vec<_>>();
    let common_len = from_components
        .iter()
        .zip(&to_components)
        .take_while(|(left, right)| left == right)
        .count();

    let mut relative = PathBuf::new();
    for _ in common_len..from_components.len() {
        relative.push("..");
    }
    for component in &to_components[common_len..] {
        relative.push(component.as_os_str());
    }
    normalize_relative_path_string(relative.to_string_lossy().replace('\\', "/"))
}

fn manifest_source_reference(manifest_path: &Path, repo_root: Option<&Path>) -> String {
    let manifest_path = manifest_path
        .canonicalize()
        .unwrap_or_else(|_| manifest_path.to_path_buf());

    if let Some(repo_root) = repo_root {
        let repo_root = repo_root
            .canonicalize()
            .unwrap_or_else(|_| repo_root.to_path_buf());
        if let Ok(relative) = manifest_path.strip_prefix(&repo_root) {
            return normalize_relative_path_string(relative.to_string_lossy().replace('\\', "/"));
        }
    }

    normalize_relative_path_string(manifest_path.to_string_lossy().replace('\\', "/"))
}

fn normalize_relative_path_string(path: String) -> String {
    if path.is_empty() || path.starts_with("../") || path.starts_with("./") || path.starts_with('/')
    {
        return path;
    }
    format!("./{path}")
}

fn render_readme(opts: &GenerateTsSdkOpts, loaded: &LoadedManifest) -> String {
    let module_export = sdk_module_export_name(&opts.package_name);
    let use_example = example_use_block(&module_export, loaded);
    let import_specifier = sdk_readme_import_specifier(&opts.package_name);
    format!(
        "# {}\n\nGenerated Trellis SDK for contract `{}`.\n\n## Usage\n\n```ts\nimport {{ defineContract }} from \"@qlever-llc/trellis\";\nimport {{ {} }} from \"{}\";\n\nconst app = defineContract({{\n  id: \"example.app@v1\",\n  displayName: \"Example App\",\n  description: \"User-facing app for the example deployment.\",\n  kind: \"app\",\n  uses: {{\n{}\n  }},\n}});\n\nconst client = app.createClient(nc, authSession);\n```\n\n## Contents\n\n- `{}`: generated contract module with `CONTRACT_ID`, `CONTRACT_DIGEST`, `CONTRACT`, `API`, and `use(...)`\n- `API`: nested contract API views with `API.owned`, `API.used`, and `API.trellis`\n- `types.ts`: TypeScript types derived from JSON Schemas\n- `schemas.ts`: Raw JSON Schemas (as `as const` objects)\n- `contract.ts`: embedded contract metadata and typed `use(...)` helper\n",
        opts.package_name, loaded.manifest.id, module_export, import_specifier, use_example, module_export
    )
}

fn write_if_changed(path: &Path, contents: &str) -> Result<(), CodegenTsError> {
    if fs::read_to_string(path).ok().as_deref() == Some(contents) {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, contents)?;
    Ok(())
}

fn js_string(value: &str) -> String {
    serde_json::to_string(value).expect("js string")
}

fn escape_js_string(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('`', "\\`")
        .replace('$', "\\$")
}

fn resolve_schema_ref<'a>(loaded: &'a LoadedManifest, schema_name: &str) -> &'a Value {
    loaded
        .manifest
        .schemas
        .get(schema_name)
        .unwrap_or_else(|| panic!("missing schema '{schema_name}' in manifest"))
}

#[cfg(test)]
mod path_tests {
    use super::{manifest_source_reference, relative_path_string};
    use std::path::Path;

    #[test]
    fn manifest_source_reference_uses_repo_relative_path() {
        assert_eq!(
            manifest_source_reference(
                Path::new("/repo/generated/contracts/manifests/trellis.core@v1.json"),
                Some(Path::new("/repo")),
            ),
            "./generated/contracts/manifests/trellis.core@v1.json"
        );
    }

    #[test]
    fn relative_path_string_is_normalized_without_dot_segments() {
        assert_eq!(
            relative_path_string(
                Path::new("/repo/generated/js/sdks/trellis-core"),
                Path::new("/repo/js/packages/contracts/npm"),
            ),
            "../../../../js/packages/contracts/npm"
        );
    }
}

fn key_to_pascal(value: &str) -> String {
    value
        .split('.')
        .map(to_pascal_case_token)
        .collect::<Vec<_>>()
        .join("")
}

fn sdk_module_export_name(package_name: &str) -> String {
    let trimmed = package_name
        .strip_prefix("@qlever-llc/trellis-sdk-")
        .unwrap_or(package_name);
    kebab_to_camel(trimmed)
}

fn sdk_readme_import_specifier(package_name: &str) -> String {
    if let Some(trimmed) = package_name.strip_prefix("@qlever-llc/trellis-sdk-") {
        format!("@qlever-llc/trellis-sdk/{trimmed}")
    } else {
        package_name.to_string()
    }
}

fn kebab_to_camel(value: &str) -> String {
    let mut out = String::new();
    let mut uppercase_next = false;

    for ch in value.chars() {
        if ch == '-' {
            uppercase_next = true;
            continue;
        }

        if out.is_empty() {
            out.push(ch.to_ascii_lowercase());
            uppercase_next = false;
            continue;
        }

        if uppercase_next {
            out.push(ch.to_ascii_uppercase());
            uppercase_next = false;
        } else {
            out.push(ch);
        }
    }

    out
}

fn example_use_block(module_export: &str, loaded: &LoadedManifest) -> String {
    if let Some(key) = loaded.manifest.rpc.keys().next() {
        return format!(
            "    dependency: {}.use({{\n      rpc: {{ call: [{}] }},\n    }}),",
            module_export,
            js_string(key),
        );
    }

    if let Some(key) = loaded.manifest.events.keys().next() {
        return format!(
            "    dependency: {}.use({{\n      events: {{ subscribe: [{}] }},\n    }}),",
            module_export,
            js_string(key),
        );
    }

    if let Some(key) = loaded.manifest.subjects.keys().next() {
        return format!(
            "    dependency: {}.use({{\n      subjects: {{ subscribe: [{}] }},\n    }}),",
            module_export,
            js_string(key),
        );
    }

    format!("    dependency: {}.use({{}}),", module_export)
}

fn to_pascal_case_token(value: &str) -> String {
    value
        .split(|ch: char| !ch.is_ascii_alphanumeric())
        .filter(|segment| !segment.is_empty())
        .map(|segment| {
            let mut chars = segment.chars();
            match chars.next() {
                Some(first) => first.to_ascii_uppercase().to_string() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<String>()
}

fn schema_to_ts(schema: &Value) -> String {
    match schema {
        Value::Bool(true) => "unknown".to_string(),
        Value::Bool(false) => "never".to_string(),
        Value::Object(object) => {
            if let Some(value) = object.get("const") {
                return serde_json::to_string(value).unwrap_or_else(|_| "unknown".to_string());
            }

            if let Some(Value::Array(values)) = object.get("enum") {
                if !values.is_empty() {
                    return values
                        .iter()
                        .map(|value| {
                            serde_json::to_string(value).unwrap_or_else(|_| "unknown".to_string())
                        })
                        .collect::<Vec<_>>()
                        .join(" | ");
                }
            }

            for (key, operator) in [("allOf", "&"), ("oneOf", "|"), ("anyOf", "|")] {
                if let Some(Value::Array(values)) = object.get(key) {
                    if !values.is_empty() {
                        return format!(
                            "({})",
                            values
                                .iter()
                                .map(schema_to_ts)
                                .collect::<Vec<_>>()
                                .join(&format!(" {operator} "))
                        );
                    }
                }
            }

            if let Some(Value::Array(types)) = object.get("type") {
                if !types.is_empty() {
                    return format!(
                        "({})",
                        types
                            .iter()
                            .map(|value| match value {
                                Value::String(type_name) => {
                                    let mut clone = object.clone();
                                    clone.insert(
                                        "type".to_string(),
                                        Value::String(type_name.clone()),
                                    );
                                    schema_to_ts(&Value::Object(clone))
                                }
                                _ => "unknown".to_string(),
                            })
                            .collect::<Vec<_>>()
                            .join(" | ")
                    );
                }
            }

            match object.get("type").and_then(Value::as_str) {
                Some("string") => "string".to_string(),
                Some("number") | Some("integer") => "number".to_string(),
                Some("boolean") => "boolean".to_string(),
                Some("null") => "null".to_string(),
                Some("array") => render_array_ts(object),
                Some("object") => render_object_ts(object),
                _ => {
                    if object.contains_key("properties") {
                        render_object_ts(object)
                    } else {
                        "unknown".to_string()
                    }
                }
            }
        }
        Value::Null | Value::Number(_) | Value::String(_) | Value::Array(_) => {
            "unknown".to_string()
        }
    }
}

fn render_array_ts(object: &serde_json::Map<String, Value>) -> String {
    match object.get("items") {
        Some(Value::Array(values)) => format!(
            "[{}]",
            values
                .iter()
                .map(schema_to_ts)
                .collect::<Vec<_>>()
                .join(", ")
        ),
        Some(value) => format!("Array<{}>", schema_to_ts(value)),
        None => "unknown[]".to_string(),
    }
}

fn render_object_ts(object: &serde_json::Map<String, Value>) -> String {
    let required = object
        .get("required")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let mut lines = Vec::new();
    if let Some(Value::Object(properties)) = object.get("properties") {
        for (key, value) in properties {
            let optional = if required.iter().any(|required_key| required_key == key) {
                ""
            } else {
                "?"
            };
            let safe_key = if is_safe_js_ident(key) {
                key.clone()
            } else {
                js_string(key)
            };
            lines.push(format!("{safe_key}{optional}: {};", schema_to_ts(value)));
        }
    }

    if let Some(Value::Object(pattern_properties)) = object.get("patternProperties") {
        if pattern_properties.len() == 1 {
            let value = pattern_properties
                .values()
                .next()
                .expect("single pattern property value");
            lines.push(format!("[k: string]: {};", schema_to_ts(value)));
        }
    }

    match object.get("additionalProperties") {
        Some(Value::Bool(true)) => lines.push("[k: string]: unknown;".to_string()),
        Some(value @ Value::Object(_)) => {
            lines.push(format!("[k: string]: {};", schema_to_ts(value)));
        }
        _ => {}
    }

    format!("{{ {} }}", lines.join(" "))
}

fn is_safe_js_ident(value: &str) -> bool {
    let mut chars = value.chars();
    match chars.next() {
        Some(first) if first == '_' || first == '$' || first.is_ascii_alphabetic() => {}
        _ => return false,
    }
    chars.all(|ch| ch == '_' || ch == '$' || ch.is_ascii_alphanumeric())
}

fn render_mod_ts(opts: &GenerateTsSdkOpts) -> String {
    let module_export = sdk_module_export_name(&opts.package_name);
    let use_exports = if module_export == "auth" {
        "CONTRACT, CONTRACT_DIGEST, CONTRACT_ID, use, useDefaults, auth".to_string()
    } else {
        format!(
            "CONTRACT, CONTRACT_DIGEST, CONTRACT_ID, use, {}",
            module_export
        )
    };
    format!(
        "export {{ API, OWNED_API }} from \"./api.ts\";\nexport type {{ Api, ApiViews, OwnedApi }} from \"./api.ts\";\nexport * from \"./types.ts\";\nexport {{ SCHEMAS }} from \"./schemas.ts\";\nexport {{ {} }} from \"./contract.ts\";\n",
        use_exports,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("trellis-codegen-ts-{label}-{nanos}"))
    }

    fn sample_opts_and_loaded(
        package_name: &str,
        contract_id: &str,
    ) -> (GenerateTsSdkOpts, LoadedManifest, PathBuf) {
        let root = unique_temp_dir("manifest");
        fs::create_dir_all(&root).unwrap();
        let manifest_path = root.join("contract.json");
        fs::write(
            &manifest_path,
            serde_json::to_string(&json!({
                "format": "trellis.contract.v1",
                "id": contract_id,
                "displayName": "Example Contract",
                "description": "Example contract for SDK generation tests.",
                "kind": "service",
                "schemas": {
                    "PingInput": {
                        "type": "object",
                        "properties": {},
                        "additionalProperties": false
                    },
                    "PingOutput": {
                        "type": "object",
                        "properties": {
                            "ok": { "type": "boolean" }
                        },
                        "required": ["ok"],
                        "additionalProperties": false
                    },
                    "ProcessInput": {
                        "type": "object",
                        "properties": {
                            "amount": { "type": "number" }
                        },
                        "required": ["amount"],
                        "additionalProperties": false
                    },
                    "ProcessProgress": {
                        "type": "object",
                        "properties": {
                            "step": { "type": "string" }
                        },
                        "required": ["step"],
                        "additionalProperties": false
                    },
                    "ProcessOutput": {
                        "type": "object",
                        "properties": {
                            "ok": { "type": "boolean" }
                        },
                        "required": ["ok"],
                        "additionalProperties": false
                    }
                },
                "rpc": {
                    "Example.Ping": {
                        "version": "v1",
                        "subject": "rpc.v1.Example.Ping",
                        "input": { "schema": "PingInput" },
                        "output": { "schema": "PingOutput" }
                    }
                },
                "operations": {
                    "Example.Process": {
                        "version": "v1",
                        "subject": "operations.v1.Example.Process",
                        "input": { "schema": "ProcessInput" },
                        "progress": { "schema": "ProcessProgress" },
                        "output": { "schema": "ProcessOutput" },
                        "capabilities": {
                            "call": ["service"],
                            "read": ["service"],
                            "cancel": ["service"]
                        },
                        "cancel": true
                    }
                },
                "events": {},
                "subjects": {}
            }))
            .unwrap(),
        )
        .unwrap();

        let opts = GenerateTsSdkOpts {
            manifest_path: manifest_path.clone(),
            out_dir: root.join("out"),
            package_name: package_name.to_string(),
            package_version: "0.4.0".to_string(),
            runtime_deps: TsRuntimeDeps {
                source: TsRuntimeSource::Registry,
                version: "0.4.0".to_string(),
                repo_root: None,
            },
        };
        let loaded = load_manifest(&manifest_path).unwrap();
        (opts, loaded, root)
    }

    #[test]
    fn registry_mode_emits_jsr_imports() {
        let deno = deno_json(&GenerateTsSdkOpts {
            manifest_path: PathBuf::from("generated/contracts/manifests/trellis.core@v1.json"),
            out_dir: PathBuf::from("generated/js/sdks/trellis-core"),
            package_name: "@qlever-llc/trellis-sdk-core".to_string(),
            package_version: "0.4.0".to_string(),
            runtime_deps: TsRuntimeDeps {
                source: TsRuntimeSource::Registry,
                version: "0.2.3".to_string(),
                repo_root: None,
            },
        })
        .unwrap();

        let imports = deno.get("imports").and_then(Value::as_object).unwrap();
        assert_eq!(
            imports.get("@qlever-llc/trellis").unwrap(),
            "jsr:@qlever-llc/trellis@^0.2.3"
        );
        assert_eq!(imports.len(), 1);
        assert!(deno.get("extends").is_none());
    }

    #[test]
    fn local_mode_derives_extends_from_repo_root() {
        let repo_root = unique_temp_dir("repo-root");
        let out_dir = repo_root.join("generated/js/sdks/auth");
        fs::create_dir_all(repo_root.join("js")).unwrap();
        fs::create_dir_all(&out_dir).unwrap();
        fs::write(repo_root.join("js/deno.json"), "{}\n").unwrap();

        let deno = deno_json(&GenerateTsSdkOpts {
            manifest_path: repo_root.join("generated/contracts/manifests/trellis.auth@v1.json"),
            out_dir: out_dir.clone(),
            package_name: "@qlever-llc/trellis-sdk-auth".to_string(),
            package_version: "0.4.0".to_string(),
            runtime_deps: TsRuntimeDeps {
                source: TsRuntimeSource::Local,
                version: "0.4.0".to_string(),
                repo_root: Some(repo_root.clone()),
            },
        })
        .unwrap();

        assert_eq!(
            deno.get("extends").and_then(Value::as_str),
            Some("../../../../js/deno.json")
        );
        assert!(deno.get("imports").is_none());

        fs::remove_dir_all(repo_root).unwrap();
    }

    #[test]
    fn local_mode_emits_relative_runtime_imports() {
        let repo_root = unique_temp_dir("repo-root-local-imports");
        let out_dir = repo_root.join("workspaces/demo/generated/js/sdks/auth");
        fs::create_dir_all(repo_root.join("js/packages/trellis")).unwrap();
        fs::create_dir_all(&out_dir).unwrap();
        fs::write(repo_root.join("js/deno.json"), "{}\n").unwrap();

        let (mut opts, loaded, root) =
            sample_opts_and_loaded("@qlever-llc/trellis-sdk-auth", "trellis.auth@v1");
        opts.out_dir = out_dir.clone();
        opts.runtime_deps = TsRuntimeDeps {
            source: TsRuntimeSource::Local,
            version: "0.4.0".to_string(),
            repo_root: Some(repo_root.clone()),
        };

        let api = render_api_ts(&opts, &loaded);
        let contract = render_contract_ts(&opts, &loaded);
        let types = render_types_ts(&opts, &loaded);

        assert!(api.contains("../../../../../../js/packages/trellis/contracts.ts"));
        assert!(contract.contains("../../../../../../js/packages/trellis/index.ts"));
        assert!(types.contains("../../../../../../js/packages/trellis/index.ts"));

        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(repo_root).unwrap();
    }

    #[test]
    fn generated_api_uses_contract_api_views_shape() {
        let (opts, loaded, root) =
            sample_opts_and_loaded("@qlever-llc/trellis-sdk-auth", "trellis.auth@v1");
        let api = render_api_ts(&opts, &loaded);

        assert!(api.contains("import type { TrellisAPI } from \"@qlever-llc/trellis/contracts\";"));
        assert!(api.contains("import { schema } from \"@qlever-llc/trellis/contracts\";"));
        assert!(api.contains("export const OWNED_API = {"));
        assert!(api.contains("export const API = {"));
        assert!(api.contains("owned: OWNED_API"));
        assert!(api.contains("used: EMPTY_API"));
        assert!(api.contains("trellis: OWNED_API"));
        assert!(api.contains("operations: {"));
        assert!(api.contains("\"Example.Process\": {"));
        assert!(api.contains("callerCapabilities: [\"service\"]"));
        assert!(api.contains("readCapabilities: [\"service\"]"));
        assert!(api.contains("cancelCapabilities: [\"service\"]"));
        assert!(api.contains("cancel: true"));
        assert!(api.contains("export type Api = typeof API.trellis;"));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn generated_contract_emits_named_module_and_typed_use_helper() {
        let (opts, loaded, root) =
            sample_opts_and_loaded("@qlever-llc/trellis-sdk-core", "trellis.core@v1");
        let contract = render_contract_ts(&opts, &loaded);
        let mod_ts = render_mod_ts(&opts);
        let types = render_types_ts(&opts, &loaded);
        let build_npm = render_build_npm_ts(&opts, &loaded);

        assert!(contract.contains(
            "import type { SdkContractModule, TrellisContractV1, UseSpec } from \"@qlever-llc/trellis\";"
        ));
        assert!(contract.contains(
            "export const core: SdkContractModule<typeof CONTRACT_ID, typeof API.owned> = {"
        ));
        assert!(contract.contains("export const use = core.use;"));
        assert!(contract.contains("spec.operations?.call"));
        assert!(contract.contains("does not expose ${kind} key '${key}'"));
        assert!(mod_ts.contains(
            "export { CONTRACT, CONTRACT_DIGEST, CONTRACT_ID, use, core } from \"./contract.ts\";"
        ));
        assert!(types.contains("import type { RpcHandlerFn } from \"@qlever-llc/trellis\";"));
        assert!(types.contains(
            "export type ExamplePingHandler = RpcHandlerFn<typeof API.owned, \"Example.Ping\">;"
        ));
        assert!(build_npm.contains("\"@qlever-llc/trellis\": \"^0.4.0\""));
        assert!(!build_npm.contains("@qlever-llc/trellis/contracts/contract-module"));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn generated_auth_sdk_emits_use_defaults_helper() {
        let (opts, loaded, root) =
            sample_opts_and_loaded("@qlever-llc/trellis-sdk-auth", "trellis.auth@v1");
        let contract = render_contract_ts(&opts, &loaded);
        let mod_ts = render_mod_ts(&opts);

        assert!(contract.contains(
            "import type { ContractDependencyUse, SdkContractModule, TrellisContractV1, UseSpec } from \"@qlever-llc/trellis\";"
        ));
        assert!(contract.contains("const DEFAULT_AUTH_RPC_CALL = ["));
        assert!(contract.contains(
            "type AuthModule = SdkContractModule<typeof CONTRACT_ID, typeof API.owned> & {"
        ));
        assert!(contract.contains("useDefaults: AuthUseDefaultsFn;"));
        assert!(contract.contains("export const useDefaults = auth.useDefaults;"));
        assert!(mod_ts.contains(
            "export { CONTRACT, CONTRACT_DIGEST, CONTRACT_ID, use, useDefaults, auth } from \"./contract.ts\";"
        ));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn generated_contract_emits_jobs_metadata_type_for_top_level_jobs() {
        let root = unique_temp_dir("jobs-contract");
        fs::create_dir_all(&root).unwrap();
        let manifest_path = root.join("contract.json");
        fs::write(
            &manifest_path,
            serde_json::to_string(&json!({
                "format": "trellis.contract.v1",
                "id": "trellis.jobs-demo@v1",
                "displayName": "Jobs Demo",
                "description": "Contract with top-level jobs.",
                "kind": "service",
                "schemas": {
                    "PingInput": {
                        "type": "object",
                        "properties": {},
                        "additionalProperties": false
                    },
                    "PingOutput": {
                        "type": "object",
                        "properties": {
                            "ok": { "type": "boolean" }
                        },
                        "required": ["ok"],
                        "additionalProperties": false
                    },
                    "JobPayload": {
                        "type": "object",
                        "properties": {
                            "id": { "type": "string" }
                        },
                        "required": ["id"],
                        "additionalProperties": false
                    },
                    "JobResult": {
                        "type": "object",
                        "properties": {
                            "ok": { "type": "boolean" }
                        },
                        "required": ["ok"],
                        "additionalProperties": false
                    }
                },
                "rpc": {
                    "Example.Ping": {
                        "version": "v1",
                        "subject": "rpc.v1.Example.Ping",
                        "input": { "schema": "PingInput" },
                        "output": { "schema": "PingOutput" }
                    }
                },
                "operations": {},
                "events": {},
                "subjects": {},
                "jobs": {
                    "exampleJob": {
                        "payload": { "schema": "JobPayload" },
                        "result": { "schema": "JobResult" }
                    },
                    "fireAndForget": {
                        "payload": { "schema": "JobPayload" }
                    }
                }
            }))
            .unwrap(),
        )
        .unwrap();

        let opts = GenerateTsSdkOpts {
            manifest_path: manifest_path.clone(),
            out_dir: root.join("out"),
            package_name: "@qlever-llc/trellis-sdk-jobs-demo".to_string(),
            package_version: "0.4.0".to_string(),
            runtime_deps: TsRuntimeDeps {
                source: TsRuntimeSource::Registry,
                version: "0.4.0".to_string(),
                repo_root: None,
            },
        };
        let loaded = load_manifest(&manifest_path).unwrap();
        let contract = render_contract_ts(&opts, &loaded);

        assert!(contract.contains("type ContractJobs = {"));
        assert!(contract.contains("\"exampleJob\": {"));
        assert!(contract.contains("payload: { id: string; };"));
        assert!(contract.contains("result: { ok: boolean; };"));
        assert!(contract.contains("\"fireAndForget\": {"));
        assert!(contract.contains("result: unknown;"));
        assert!(contract.contains(
            "export const jobsDemo: SdkContractModule<typeof CONTRACT_ID, typeof API.owned, ContractJobs> = {"
        ));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn generated_contract_emits_top_level_jobs_metadata() {
        let root = unique_temp_dir("generated-sdk-jobs-metadata");
        fs::create_dir_all(&root).unwrap();
        let manifest_path = root.join("contract.json");
        let manifest = serde_json::from_str::<Value>(
            r#"{
                "format": "trellis.contract.v1",
                "id": "example.jobs@v1",
                "displayName": "Jobs Example",
                "description": "Contract with first-class jobs.",
                "kind": "service",
                "schemas": {
                    "PingInput": {
                        "type": "object",
                        "properties": {},
                        "additionalProperties": false
                    },
                    "PingOutput": {
                        "type": "object",
                        "properties": {
                            "ok": { "type": "boolean" }
                        },
                        "required": ["ok"],
                        "additionalProperties": false
                    },
                    "EmailPayload": {
                        "type": "object",
                        "properties": {
                            "address": { "type": "string" }
                        },
                        "required": ["address"],
                        "additionalProperties": false
                    },
                    "EmailResult": {
                        "type": "object",
                        "properties": {
                            "delivered": { "type": "boolean" }
                        },
                        "required": ["delivered"],
                        "additionalProperties": false
                    }
                },
                "rpc": {
                    "Example.Ping": {
                        "version": "v1",
                        "subject": "rpc.v1.Example.Ping",
                        "input": { "schema": "PingInput" },
                        "output": { "schema": "PingOutput" }
                    }
                },
                "jobs": {
                    "sendEmail": {
                        "payload": { "schema": "EmailPayload" },
                        "result": { "schema": "EmailResult" }
                    }
                },
                "events": {},
                "subjects": {}
            }"#,
        )
        .unwrap();
        fs::write(&manifest_path, serde_json::to_string(&manifest).unwrap()).unwrap();

        let opts = GenerateTsSdkOpts {
            manifest_path: manifest_path.clone(),
            out_dir: root.join("out"),
            package_name: "@qlever-llc/trellis-sdk-example-jobs".to_string(),
            package_version: "0.4.0".to_string(),
            runtime_deps: TsRuntimeDeps {
                source: TsRuntimeSource::Registry,
                version: "0.4.0".to_string(),
                repo_root: None,
            },
        };
        let loaded = load_manifest(&manifest_path).unwrap();

        let contract = render_contract_ts(&opts, &loaded);

        assert!(contract.contains(
            "import { CONTRACT_JOBS_METADATA, type ContractJobsMetadata } from \"@qlever-llc/trellis/contracts\";"
        ));
        assert!(contract.contains(
            "export const exampleJobs: SdkContractModule<typeof CONTRACT_ID, typeof API.owned, ContractJobs> = {"
        ));
        assert!(contract.contains("type ContractJobs = {"));
        assert!(contract.contains("\"sendEmail\": {"));
        assert!(contract.contains("payload: { address: string; };"));
        assert!(contract.contains("result: { delivered: boolean; };"));
        assert!(
            contract.contains("const CONTRACT_JOBS = defineContractJobsMetadata<ContractJobs>({")
        );
        assert!(contract.contains("  \"sendEmail\": { payload: undefined, result: undefined },"));
        assert!(contract.contains("  [CONTRACT_JOBS_METADATA]: CONTRACT_JOBS,"));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn generated_types_emit_typed_pattern_properties() {
        let root = unique_temp_dir("typed-pattern-properties");
        fs::create_dir_all(&root).unwrap();
        let manifest_path = root.join("contract.json");
        let manifest = serde_json::from_str::<Value>(
            r#"{
                "format": "trellis.contract.v1",
                "id": "trellis.core@v1",
                "displayName": "Trellis Core",
                "description": "Core contract.",
                "kind": "service",
                "schemas": {
                    "BindingsGetInput": {
                        "type": "object",
                        "properties": {},
                        "required": [],
                        "additionalProperties": false
                    },
                    "BindingsGetOutput": {
                        "type": "object",
                        "properties": {
                            "binding": {
                                "type": "object",
                                "required": ["resources"],
                                "additionalProperties": false,
                                "properties": {
                                    "resources": {
                                        "type": "object",
                                        "required": ["streams"],
                                        "additionalProperties": false,
                                        "properties": {
                                            "streams": {
                                                "type": "object",
                                                "patternProperties": {
                                                    "^.*$": {
                                                        "type": "object",
                                                        "required": ["name", "sources"],
                                                        "additionalProperties": false,
                                                        "properties": {
                                                            "name": { "type": "string" },
                                                            "sources": {
                                                                "type": "array",
                                                                "items": {
                                                                    "type": "object",
                                                                    "required": ["fromAlias", "streamName"],
                                                                    "additionalProperties": false,
                                                                    "properties": {
                                                                        "fromAlias": { "type": "string" },
                                                                        "streamName": { "type": "string" }
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    }
                                                },
                                                "additionalProperties": false
                                            }
                                        }
                                    }
                                }
                            }
                        },
                        "required": ["binding"],
                        "additionalProperties": false
                    }
                },
                "rpc": {
                    "Trellis.Bindings.Get": {
                        "version": "v1",
                        "subject": "rpc.v1.Trellis.Bindings.Get",
                        "input": { "schema": "BindingsGetInput" },
                        "output": { "schema": "BindingsGetOutput" }
                    }
                },
                "events": {},
                "subjects": {}
            }"#,
        )
        .unwrap();
        fs::write(&manifest_path, serde_json::to_string(&manifest).unwrap()).unwrap();

        let opts = GenerateTsSdkOpts {
            manifest_path: manifest_path.clone(),
            out_dir: root.join("out"),
            package_name: "@qlever-llc/trellis-sdk-core".to_string(),
            package_version: "0.4.0".to_string(),
            runtime_deps: TsRuntimeDeps {
                source: TsRuntimeSource::Registry,
                version: "0.4.0".to_string(),
                repo_root: None,
            },
        };
        let loaded = load_manifest(&manifest_path).unwrap();

        let rendered = render_types_ts(&opts, &loaded);

        assert!(rendered.contains(
            "streams: { [k: string]: { name: string; sources: Array<{ fromAlias: string; streamName: string; }>; }; };"
        ));
        assert!(!rendered.contains("streams: {  }"));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn generated_readme_uses_contract_first_example() {
        let (opts, loaded, root) =
            sample_opts_and_loaded("@qlever-llc/trellis-sdk-activity", "trellis.activity@v1");
        let readme = render_readme(&opts, &loaded);

        assert!(readme.contains("import { defineContract } from \"@qlever-llc/trellis\";"));
        assert!(readme.contains("import { activity } from \"@qlever-llc/trellis-sdk/activity\";"));
        assert!(readme.contains("displayName: \"Example App\""));
        assert!(readme.contains("description: \"User-facing app for the example deployment.\""));
        assert!(readme.contains("kind: \"app\""));
        assert!(readme.contains("dependency: activity.use({"));
        assert!(readme.contains("const client = app.createClient(nc, authSession);"));
        assert!(!readme.contains("mergeApis"));
        assert!(!readme.contains("createClient(nc, auth, [api] as const)"));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn generated_sdk_emits_local_error_classes_and_runtime_descriptors() {
        let root = unique_temp_dir("generated-sdk-local-errors");
        fs::create_dir_all(&root).unwrap();
        let manifest_path = root.join("contract.json");
        let manifest = serde_json::from_str::<Value>(
            r#"{
                "format": "trellis.contract.v1",
                "id": "example.local-errors@v1",
                "displayName": "Local Errors",
                "description": "Local error sdk test.",
                "kind": "service",
                "schemas": {
                    "Empty": {
                        "type": "object",
                        "properties": {},
                        "required": [],
                        "additionalProperties": false
                    },
                    "NotFoundErrorData": {
                        "type": "object",
                        "required": ["id", "type", "message", "resource"],
                        "additionalProperties": false,
                        "properties": {
                            "id": { "type": "string" },
                            "type": { "const": "NotFoundError" },
                            "message": { "type": "string" },
                            "resource": { "type": "string" }
                        }
                    }
                },
                "errors": {
                    "WorkspaceMissing": {
                        "type": "NotFoundError",
                        "schema": { "schema": "NotFoundErrorData" }
                    }
                },
                "rpc": {
                    "Example.Get": {
                        "version": "v1",
                        "subject": "rpc.v1.Example.Get",
                        "input": { "schema": "Empty" },
                        "output": { "schema": "Empty" },
                        "errors": [
                            { "type": "NotFoundError" },
                            { "type": "UnexpectedError" }
                        ]
                    }
                },
                "events": {},
                "subjects": {}
            }"#,
        )
        .unwrap();
        fs::write(&manifest_path, serde_json::to_string(&manifest).unwrap()).unwrap();

        let opts = GenerateTsSdkOpts {
            manifest_path: manifest_path.clone(),
            out_dir: root.join("out"),
            package_name: "@qlever-llc/trellis-sdk-local-errors".to_string(),
            package_version: "0.4.0".to_string(),
            runtime_deps: TsRuntimeDeps {
                source: TsRuntimeSource::Registry,
                version: "0.4.0".to_string(),
                repo_root: None,
            },
        };
        let loaded = load_manifest(&manifest_path).unwrap();

        let types = render_types_ts(&opts, &loaded);
        let schemas = render_schemas_ts(&opts, &loaded);
        let api = render_api_ts(&opts, &loaded);

        assert!(types.contains(
            "import { TrellisError, type TransportErrorData } from \"@qlever-llc/trellis\";"
        ));
        assert!(types.contains("export type NotFoundErrorData = {"));
        assert!(types.contains("type: \"NotFoundError\";"));
        assert!(types.contains("resource: string;"));
        assert!(
            types.contains("export class NotFoundError extends TrellisError<NotFoundErrorData>")
        );
        assert!(
            types.contains("static readonly schema = SCHEMAS.errors[\"WorkspaceMissing\"].schema;")
        );
        assert!(types.contains("static fromSerializable(data: NotFoundErrorData): NotFoundError"));
        assert!(schemas.contains("errors: {"));
        assert!(schemas.contains("\"WorkspaceMissing\": {"));
        assert!(api.contains("runtimeErrors: ["));
        assert!(api.contains("type: \"NotFoundError\""));
        assert!(api.contains(
            "schema: schema<Types.NotFoundErrorData>(SCHEMAS.errors[\"WorkspaceMissing\"].schema)"
        ));
        assert!(api.contains("fromSerializable: Types.NotFoundError.fromSerializable"));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn generated_types_emit_operation_types() {
        let (opts, loaded, root) =
            sample_opts_and_loaded("@qlever-llc/trellis-sdk-core", "trellis.core@v1");
        let types = render_types_ts(&opts, &loaded);

        assert!(types.contains("export type ExampleProcessInput = { amount: number; };"));
        assert!(types.contains("export type ExampleProcessProgress = { step: string; };"));
        assert!(types.contains("export type ExampleProcessOutput = { ok: boolean; };"));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn generated_schemas_include_operations() {
        let (opts, loaded, root) =
            sample_opts_and_loaded("@qlever-llc/trellis-sdk-core", "trellis.core@v1");
        let schemas = render_schemas_ts(&opts, &loaded);

        assert!(schemas.contains("operations: {"));
        assert!(schemas.contains("\"Example.Process\": {"));
        assert!(schemas.contains("progress: {"));

        fs::remove_dir_all(root).unwrap();
    }
}

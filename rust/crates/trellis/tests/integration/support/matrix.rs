use std::collections::BTreeSet;
use std::fmt;
use std::fs;
use std::path::PathBuf;

use serde::de;
use serde::Deserialize;

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct ClientTestMatrix {
    pub(crate) cases: Vec<MatrixCase>,
}

impl ClientTestMatrix {
    pub(crate) fn case_by_id(&self, id: &str) -> Option<&MatrixCase> {
        self.cases.iter().find(|case_entry| case_entry.id == id)
    }
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct ServiceTestMatrix {
    pub(crate) cases: Vec<ServiceMatrixCase>,
}

impl ServiceTestMatrix {
    pub(crate) fn case_by_id(&self, id: &str) -> Option<&ServiceMatrixCase> {
        self.cases.iter().find(|case_entry| case_entry.id == id)
    }
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct ServiceMatrixCase {
    pub(crate) id: String,
    pub(crate) fixture: String,
    pub(crate) title: String,
    pub(crate) coverage: Vec<String>,
    pub(crate) description: String,
    pub(crate) scenario: Scenario,
    pub(crate) implementations: ServiceMatrixImplementations,
    pub(crate) completion: MatrixCompletion,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct ServiceMatrixImplementations {
    pub(crate) rust: Option<RustMatrixImplementation>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct RustMatrixImplementation {
    pub(crate) module: String,
    pub(crate) function: String,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) enum CompletionStatus {
    Implemented,
    Required,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct MatrixCompletion {
    pub(crate) rust: CompletionStatus,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct MatrixCase {
    pub(crate) id: String,
    pub(crate) fixture: String,
    pub(crate) title: String,
    pub(crate) coverage: Vec<String>,
    pub(crate) description: String,
    pub(crate) scenario: Scenario,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct Scenario {
    pub(crate) participants: Vec<ScenarioParticipant>,
    pub(crate) given: Vec<String>,
    pub(crate) when: Vec<String>,
    pub(crate) then: Vec<String>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct ScenarioParticipant {
    pub(crate) name: String,
    pub(crate) kind: ScenarioParticipantKind,
    pub(crate) contract: String,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) enum ScenarioParticipantKind {
    App,
    Service,
    Device,
    Admin,
    ControlPlane,
}

impl fmt::Display for ScenarioParticipantKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ScenarioParticipantKind::App => write!(f, "app"),
            ScenarioParticipantKind::Service => write!(f, "service"),
            ScenarioParticipantKind::Device => write!(f, "device"),
            ScenarioParticipantKind::Admin => write!(f, "admin"),
            ScenarioParticipantKind::ControlPlane => write!(f, "control-plane"),
        }
    }
}

impl<'de> Deserialize<'de> for ScenarioParticipantKind {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        match s.as_str() {
            "app" => Ok(ScenarioParticipantKind::App),
            "service" => Ok(ScenarioParticipantKind::Service),
            "device" => Ok(ScenarioParticipantKind::Device),
            "admin" => Ok(ScenarioParticipantKind::Admin),
            "control-plane" => Ok(ScenarioParticipantKind::ControlPlane),
            other => Err(de::Error::custom(format!(
                "invalid participant kind: {other}, expected one of: app, service, device, admin, control-plane"
            ))),
        }
    }
}

impl<'de> Deserialize<'de> for CompletionStatus {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        match s.as_str() {
            "implemented" => Ok(CompletionStatus::Implemented),
            "required" => Ok(CompletionStatus::Required),
            other => Err(de::Error::custom(format!(
                "invalid completion status: {other}, expected implemented or required"
            ))),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawTestMatrix {
    cases: Vec<RawMatrixCase>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawMatrixCase {
    kind: MatrixCaseKind,
    id: String,
    fixture: String,
    title: String,
    coverage: Vec<String>,
    description: String,
    scenario: RawScenario,
    #[serde(default)]
    implementations: Option<RawServiceMatrixImplementations>,
    #[serde(default)]
    completion: Option<RawMatrixCompletion>,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum MatrixCaseKind {
    Client,
    Service,
}

impl fmt::Display for MatrixCaseKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            MatrixCaseKind::Client => write!(f, "client"),
            MatrixCaseKind::Service => write!(f, "service"),
        }
    }
}

#[derive(Debug)]
struct RawServiceMatrixCase {
    id: String,
    fixture: String,
    title: String,
    coverage: Vec<String>,
    description: String,
    scenario: RawScenario,
    implementations: RawServiceMatrixImplementations,
    completion: RawMatrixCompletion,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawServiceMatrixImplementations {
    typescript: RawTypeScriptMatrixImplementation,
    #[serde(default)]
    rust: Option<RawRustMatrixImplementation>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawTypeScriptMatrixImplementation {
    file: String,
    #[serde(rename = "testName")]
    test_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawRustMatrixImplementation {
    module: String,
    function: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawMatrixCompletion {
    typescript: CompletionStatus,
    rust: CompletionStatus,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawScenario {
    participants: Vec<RawScenarioParticipant>,
    given: Vec<String>,
    when: Vec<String>,
    then: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawScenarioParticipant {
    name: String,
    kind: ScenarioParticipantKind,
    contract: String,
}

pub(crate) fn load_client_test_matrix() -> Result<ClientTestMatrix, String> {
    let path = test_matrix_path()?;
    let contents = fs::read_to_string(&path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    let raw: RawTestMatrix = serde_json::from_str(&contents)
        .map_err(|error| format!("failed to parse {}: {error}", path.display()))?;
    validate_matrix(raw)
}

pub(crate) fn load_service_test_matrix() -> Result<ServiceTestMatrix, String> {
    let path = test_matrix_path()?;
    let contents = fs::read_to_string(&path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    let raw: RawTestMatrix = serde_json::from_str(&contents)
        .map_err(|error| format!("failed to parse {}: {error}", path.display()))?;
    validate_service_matrix(raw)
}

pub(crate) fn matrix_case_ids(matrix: &ClientTestMatrix) -> Vec<String> {
    let mut ids = matrix
        .cases
        .iter()
        .map(|case_entry| case_entry.id.clone())
        .collect::<Vec<_>>();
    ids.sort();
    ids
}

pub(crate) fn repo_root() -> Result<PathBuf, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    for ancestor in manifest_dir.ancestors() {
        if ancestor.join("integration/test-matrix.json").exists()
            && ancestor.join("rust/Cargo.toml").exists()
            && ancestor.join("js/deno.json").exists()
        {
            return Ok(ancestor.to_path_buf());
        }
    }
    Err(format!(
        "failed to resolve repository root from {}",
        manifest_dir.display()
    ))
}

fn test_matrix_path() -> Result<PathBuf, String> {
    Ok(repo_root()?.join("integration/test-matrix.json"))
}

fn validate_matrix(raw: RawTestMatrix) -> Result<ClientTestMatrix, String> {
    let mut seen_ids = BTreeSet::new();
    let mut duplicate_ids = BTreeSet::new();
    let mut cases = Vec::with_capacity(raw.cases.len());
    let mut errors = Vec::new();

    for (index, raw_case) in raw
        .cases
        .into_iter()
        .filter(|case_entry| case_entry.kind == MatrixCaseKind::Client)
        .enumerate()
    {
        let context = format!("matrix case {}", index + 1);
        if !seen_ids.insert(raw_case.id.clone()) {
            duplicate_ids.insert(raw_case.id.clone());
        }
        validate_non_empty(&raw_case.id, &format!("{context} id"), &mut errors);
        validate_non_empty(
            &raw_case.fixture,
            &format!("{context} fixture"),
            &mut errors,
        );
        validate_non_empty(&raw_case.title, &format!("{context} title"), &mut errors);
        validate_non_empty(
            &raw_case.description,
            &format!("{context} description"),
            &mut errors,
        );
        for (coverage_index, coverage) in raw_case.coverage.iter().enumerate() {
            validate_non_empty(
                coverage,
                &format!("{context} coverage {}", coverage_index + 1),
                &mut errors,
            );
        }

        let scenario = parse_scenario(raw_case.scenario, &context, &mut errors);

        let expected_prefix = format!("{}.", raw_case.fixture);
        if !raw_case.id.starts_with(&expected_prefix) {
            errors.push(format!(
                "{context} id {} must start with fixture prefix {expected_prefix}",
                raw_case.id
            ));
        }
        cases.push(MatrixCase {
            id: raw_case.id,
            fixture: raw_case.fixture,
            title: raw_case.title,
            coverage: raw_case.coverage,
            description: raw_case.description,
            scenario,
        });
    }

    if !duplicate_ids.is_empty() {
        errors.push(format!(
            "client integration matrix has duplicate case ids: {}",
            duplicate_ids.into_iter().collect::<Vec<_>>().join(", ")
        ));
    }
    if !errors.is_empty() {
        return Err(errors.join("\n"));
    }

    Ok(ClientTestMatrix { cases })
}

fn validate_service_matrix(raw: RawTestMatrix) -> Result<ServiceTestMatrix, String> {
    let mut seen_ids = BTreeSet::new();
    let mut duplicate_ids = BTreeSet::new();
    let mut cases = Vec::with_capacity(raw.cases.len());
    let mut errors = Vec::new();

    for (index, raw_case) in raw
        .cases
        .into_iter()
        .filter(|case_entry| case_entry.kind == MatrixCaseKind::Service)
        .map(service_matrix_case)
        .enumerate()
    {
        let context = format!("service matrix case {}", index + 1);
        let Some(raw_case) = raw_case else {
            errors.push(format!(
                "{context} kind service requires implementations and completion"
            ));
            continue;
        };
        if !seen_ids.insert(raw_case.id.clone()) {
            duplicate_ids.insert(raw_case.id.clone());
        }
        validate_non_empty(&raw_case.id, &format!("{context} id"), &mut errors);
        validate_non_empty(
            &raw_case.fixture,
            &format!("{context} fixture"),
            &mut errors,
        );
        validate_non_empty(&raw_case.title, &format!("{context} title"), &mut errors);
        validate_non_empty(
            &raw_case.description,
            &format!("{context} description"),
            &mut errors,
        );
        for (coverage_index, coverage) in raw_case.coverage.iter().enumerate() {
            validate_non_empty(
                coverage,
                &format!("{context} coverage {}", coverage_index + 1),
                &mut errors,
            );
        }
        validate_non_empty(
            &raw_case.implementations.typescript.file,
            &format!("{context} implementations.typescript file"),
            &mut errors,
        );
        validate_non_empty(
            &raw_case.implementations.typescript.test_name,
            &format!("{context} implementations.typescript testName"),
            &mut errors,
        );

        let rust = raw_case.implementations.rust.map(|implementation| {
            validate_non_empty(
                &implementation.module,
                &format!("{context} implementations.rust module"),
                &mut errors,
            );
            validate_non_empty(
                &implementation.function,
                &format!("{context} implementations.rust function"),
                &mut errors,
            );
            RustMatrixImplementation {
                module: implementation.module,
                function: implementation.function,
            }
        });
        if raw_case.completion.typescript != CompletionStatus::Implemented {
            errors.push(format!(
                "{context} completion.typescript must be implemented"
            ));
        }
        if raw_case.completion.rust == CompletionStatus::Implemented && rust.is_none() {
            errors.push(format!(
                "{context} completion.rust is implemented but implementations.rust is missing"
            ));
        }
        if raw_case.completion.rust == CompletionStatus::Required && rust.is_some() {
            errors.push(format!(
                "{context} completion.rust is required and must not include implementations.rust"
            ));
        }

        let scenario = parse_scenario(raw_case.scenario, &context, &mut errors);
        let expected_prefix = format!("{}.", raw_case.fixture);
        if !raw_case.id.starts_with(&expected_prefix) {
            errors.push(format!(
                "{context} id {} must start with fixture prefix {expected_prefix}",
                raw_case.id
            ));
        }
        cases.push(ServiceMatrixCase {
            id: raw_case.id,
            fixture: raw_case.fixture,
            title: raw_case.title,
            coverage: raw_case.coverage,
            description: raw_case.description,
            scenario,
            implementations: ServiceMatrixImplementations { rust },
            completion: MatrixCompletion {
                rust: raw_case.completion.rust,
            },
        });
    }

    if !duplicate_ids.is_empty() {
        errors.push(format!(
            "service integration matrix has duplicate case ids: {}",
            duplicate_ids.into_iter().collect::<Vec<_>>().join(", ")
        ));
    }
    if !errors.is_empty() {
        return Err(errors.join("\n"));
    }

    Ok(ServiceTestMatrix { cases })
}

fn service_matrix_case(raw: RawMatrixCase) -> Option<RawServiceMatrixCase> {
    Some(RawServiceMatrixCase {
        id: raw.id,
        fixture: raw.fixture,
        title: raw.title,
        coverage: raw.coverage,
        description: raw.description,
        scenario: raw.scenario,
        implementations: raw.implementations?,
        completion: raw.completion?,
    })
}

fn parse_scenario(raw: RawScenario, context: &str, errors: &mut Vec<String>) -> Scenario {
    if raw.participants.is_empty() {
        errors.push(format!(
            "{context} scenario participants must be a non-empty array"
        ));
    }
    for (i, participant) in raw.participants.iter().enumerate() {
        let pctx = format!("{context} scenario participant {}", i + 1);
        validate_non_empty(&participant.name, &format!("{pctx} name"), errors);
        validate_non_empty(&participant.contract, &format!("{pctx} contract"), errors);
    }

    validate_non_empty_strings(&raw.given, &format!("{context} scenario given"), errors);
    validate_non_empty_strings(&raw.when, &format!("{context} scenario when"), errors);
    validate_non_empty_strings(&raw.then, &format!("{context} scenario then"), errors);

    let participants: Vec<ScenarioParticipant> = raw
        .participants
        .into_iter()
        .map(|p| ScenarioParticipant {
            name: p.name,
            kind: p.kind,
            contract: p.contract,
        })
        .collect();

    Scenario {
        participants,
        given: raw.given,
        when: raw.when,
        then: raw.then,
    }
}

fn validate_non_empty(value: &str, context: &str, errors: &mut Vec<String>) {
    if value.trim().is_empty() {
        errors.push(format!("{context} must be a non-empty string"));
    }
}

fn validate_non_empty_strings(values: &[String], context: &str, errors: &mut Vec<String>) {
    if values.is_empty() {
        errors.push(format!("{context} must be a non-empty array"));
    }
    for (i, entry) in values.iter().enumerate() {
        validate_non_empty(entry, &format!("{context} {}", i + 1), errors);
    }
}

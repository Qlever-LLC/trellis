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
}

impl fmt::Display for ScenarioParticipantKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ScenarioParticipantKind::App => write!(f, "app"),
            ScenarioParticipantKind::Service => write!(f, "service"),
            ScenarioParticipantKind::Device => write!(f, "device"),
            ScenarioParticipantKind::Admin => write!(f, "admin"),
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
            other => Err(de::Error::custom(format!(
                "invalid participant kind: {other}, expected one of: app, service, device, admin"
            ))),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawClientTestMatrix {
    cases: Vec<RawMatrixCase>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawMatrixCase {
    id: String,
    fixture: String,
    title: String,
    coverage: Vec<String>,
    description: String,
    scenario: RawScenario,
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
    let path = client_test_matrix_path()?;
    let contents = fs::read_to_string(&path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    let raw: RawClientTestMatrix = serde_json::from_str(&contents)
        .map_err(|error| format!("failed to parse {}: {error}", path.display()))?;
    validate_matrix(raw)
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
        if ancestor
            .join("integration/client-test-matrix.json")
            .exists()
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

fn client_test_matrix_path() -> Result<PathBuf, String> {
    Ok(repo_root()?.join("integration/client-test-matrix.json"))
}

fn validate_matrix(raw: RawClientTestMatrix) -> Result<ClientTestMatrix, String> {
    let mut seen_ids = BTreeSet::new();
    let mut duplicate_ids = BTreeSet::new();
    let mut cases = Vec::with_capacity(raw.cases.len());
    let mut errors = Vec::new();

    for (index, raw_case) in raw.cases.into_iter().enumerate() {
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

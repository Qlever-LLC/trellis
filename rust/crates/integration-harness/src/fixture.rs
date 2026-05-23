use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use miette::{miette, IntoDiagnostic, Result, WrapErr};
use serde_json::json;

use crate::cli::{ReportFormat, RunArgs};

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct Fixture {
    pub(crate) id: &'static str,
    pub(crate) title: &'static str,
    pub(crate) runner_id: &'static str,
    pub(crate) runner_title: &'static str,
    pub(crate) language: Option<&'static str>,
    pub(crate) parity_group: Option<&'static str>,
    pub(crate) coverage_ids: &'static [&'static str],
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct FixtureRunReport {
    pub(crate) id: &'static str,
    pub(crate) title: &'static str,
    pub(crate) selected_fixture_ids: Vec<&'static str>,
    pub(crate) cases: usize,
}

impl FixtureRunReport {
    pub(crate) fn new(
        fixture: &Fixture,
        cases: usize,
        selected_fixture_ids: Vec<&'static str>,
    ) -> Self {
        Self {
            id: fixture.runner_id,
            title: fixture.runner_title,
            selected_fixture_ids,
            cases,
        }
    }
}

pub(crate) fn integration_fixtures() -> Vec<Fixture> {
    vec![
        fixture(
            "admin-api",
            "Direct primary admin/public API fixture",
            &[
                "full-stack-auth-callout",
                "primary-admin-public-api-flow",
                "built-in-rpc-matrix",
                "auth-protocol-matrix",
                "observability-trace-matrix",
            ],
        ),
        fixture(
            "device-activation",
            "Device activation fixture",
            &[
                "device-activation-end-to-end",
                "auth-protocol-matrix",
                "observability-trace-matrix",
            ],
        ),
        language_fixture(
            "rpc:rust",
            "Rust RPC fixture",
            "rpc",
            "Rust/TypeScript RPC fixture",
            "rust",
            "rpc",
            &[
                "cross-runtime-rpc",
                "auth-protocol-matrix",
                "observability-trace-matrix",
            ],
        ),
        language_fixture(
            "rpc:typescript",
            "TypeScript RPC fixture",
            "rpc",
            "Rust/TypeScript RPC fixture",
            "typescript",
            "rpc",
            &[
                "cross-runtime-rpc",
                "auth-protocol-matrix",
                "observability-trace-matrix",
            ],
        ),
        language_fixture(
            "service-approval:rust",
            "Rust service startup approval fixture",
            "service-approval",
            "Service startup approval fixture",
            "rust",
            "service-approval",
            &[
                "service-envelope-approval-flow",
                "cross-runtime-rpc",
                "observability-trace-matrix",
            ],
        ),
        language_fixture(
            "service-approval:typescript",
            "TypeScript service startup approval fixture",
            "service-approval",
            "Service startup approval fixture",
            "typescript",
            "service-approval",
            &[
                "service-envelope-approval-flow",
                "cross-runtime-rpc",
                "observability-trace-matrix",
            ],
        ),
        fixture(
            "app-identity-approval",
            "App identity-envelope approval fixture",
            &[
                "app-identity-envelope-approval",
                "auth-protocol-matrix",
                "observability-trace-matrix",
            ],
        ),
        fixture(
            "optional-uses",
            "Optional uses dependency fixture",
            &[
                "optional-uses-dependency-closure",
                "capability-permission-matrix",
                "auth-protocol-matrix",
            ],
        ),
        language_fixture(
            "operations:rust",
            "Rust operations fixture",
            "operations",
            "Rust/TypeScript operations fixture",
            "rust",
            "operations",
            &[
                "cross-runtime-operations",
                "capability-permission-matrix",
                "observability-trace-matrix",
            ],
        ),
        language_fixture(
            "operations:typescript",
            "TypeScript operations fixture",
            "operations",
            "Rust/TypeScript operations fixture",
            "typescript",
            "operations",
            &[
                "cross-runtime-operations",
                "capability-permission-matrix",
                "observability-trace-matrix",
            ],
        ),
        language_fixture(
            "events:rust",
            "Rust events fixture",
            "events",
            "Rust/TypeScript events fixture",
            "rust",
            "events",
            &["cross-runtime-events", "observability-trace-matrix"],
        ),
        language_fixture(
            "events:typescript",
            "TypeScript events fixture",
            "events",
            "Rust/TypeScript events fixture",
            "typescript",
            "events",
            &["cross-runtime-events", "observability-trace-matrix"],
        ),
        fixture(
            "health",
            "Rust health heartbeat fixture",
            &["health-heartbeat-event", "observability-trace-matrix"],
        ),
        language_fixture(
            "state:rust",
            "Rust state fixture",
            "state",
            "Rust/TypeScript state fixture",
            "rust",
            "state",
            &["state-parity", "observability-trace-matrix"],
        ),
        language_fixture(
            "state:typescript",
            "TypeScript state fixture",
            "state",
            "Rust/TypeScript state fixture",
            "typescript",
            "state",
            &["state-parity", "observability-trace-matrix"],
        ),
        language_fixture(
            "transfer:rust",
            "Rust transfer fixture",
            "transfer",
            "Rust/TypeScript transfer fixture",
            "rust",
            "transfer",
            &[
                "transfer-parity",
                "auth-protocol-matrix",
                "observability-trace-matrix",
            ],
        ),
        language_fixture(
            "transfer:typescript",
            "TypeScript transfer fixture",
            "transfer",
            "Rust/TypeScript transfer fixture",
            "typescript",
            "transfer",
            &[
                "transfer-parity",
                "auth-protocol-matrix",
                "observability-trace-matrix",
            ],
        ),
        language_fixture(
            "feeds:rust",
            "Rust feeds fixture",
            "feeds",
            "Rust/TypeScript feeds fixture",
            "rust",
            "feeds",
            &["feeds-parity", "observability-trace-matrix"],
        ),
        language_fixture(
            "feeds:typescript",
            "TypeScript feeds fixture",
            "feeds",
            "Rust/TypeScript feeds fixture",
            "typescript",
            "feeds",
            &["feeds-parity", "observability-trace-matrix"],
        ),
        language_fixture(
            "resources:rust",
            "Rust resources fixture",
            "resources",
            "Rust/TypeScript resources fixture",
            "rust",
            "resources",
            &[
                "resources-service-bound-parity",
                "cross-runtime-rpc",
                "observability-trace-matrix",
            ],
        ),
        language_fixture(
            "resources:typescript",
            "TypeScript resources fixture",
            "resources",
            "Rust/TypeScript resources fixture",
            "typescript",
            "resources",
            &[
                "resources-service-bound-parity",
                "cross-runtime-rpc",
                "observability-trace-matrix",
            ],
        ),
        fixture(
            "jobs",
            "Rust Jobs public API and service-local parity fixture",
            &[
                "jobs-public-api",
                "jobs-service-local-parity",
                "observability-trace-matrix",
            ],
        ),
        fixture(
            "catalog-repair",
            "Active catalog repair fixture",
            &["active-catalog-repair", "built-in-rpc-matrix"],
        ),
        fixture(
            "catalog-repair-restart",
            "Active catalog repair restart persistence check",
            &["active-catalog-repair"],
        ),
        fixture(
            "password-change",
            "Password change fixture",
            &["built-in-rpc-matrix", "primary-admin-public-api-flow"],
        ),
    ]
}

fn fixture(
    id: &'static str,
    title: &'static str,
    coverage_ids: &'static [&'static str],
) -> Fixture {
    Fixture {
        id,
        title,
        runner_id: id,
        runner_title: title,
        language: None,
        parity_group: None,
        coverage_ids,
    }
}

fn language_fixture(
    id: &'static str,
    title: &'static str,
    runner_id: &'static str,
    runner_title: &'static str,
    language: &'static str,
    parity_group: &'static str,
    coverage_ids: &'static [&'static str],
) -> Fixture {
    Fixture {
        id,
        title,
        runner_id,
        runner_title,
        language: Some(language),
        parity_group: Some(parity_group),
        coverage_ids,
    }
}
pub(crate) fn print_fixtures(fixtures: &[Fixture]) {
    if fixtures.is_empty() {
        eprintln!("integration fixtures: none");
        return;
    }

    eprintln!("integration fixtures:");
    for fixture in fixtures {
        eprintln!("- {}: {}", fixture.id, fixture.title);
        if let Some(language) = fixture.language {
            eprintln!("  language: {language}");
            eprintln!("  runner: {}", fixture.runner_id);
        }
        if let Some(parity_group) = fixture.parity_group {
            eprintln!("  parity group: {parity_group}");
        }
        eprintln!("  coverage: {}", fixture.coverage_ids.join(", "));
    }
}

pub(crate) fn print_fixture_run_reports(reports: &[FixtureRunReport]) {
    if reports.is_empty() {
        eprintln!("integration fixture results: none");
        return;
    }

    eprintln!("integration fixture results:");
    for report in reports {
        eprintln!(
            "- {}: {} ({} case(s); selected: {})",
            report.id,
            report.title,
            report.cases,
            report.selected_fixture_ids.join(", ")
        );
    }
}

pub(crate) fn write_fixture_reports(format: ReportFormat, reports: &[FixtureRunReport]) {
    match format {
        ReportFormat::Human => print_fixture_run_reports(reports),
        ReportFormat::Json => println!("{}", fixture_reports_json(reports)),
    }
}

pub(crate) fn write_fixture_junit(path: &Path, reports: &[FixtureRunReport]) -> Result<()> {
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent)
            .into_diagnostic()
            .wrap_err_with(|| {
                format!(
                    "failed to create JUnit output directory {}",
                    parent.display()
                )
            })?;
    }
    fs::write(path, fixture_reports_junit(reports))
        .into_diagnostic()
        .wrap_err_with(|| format!("failed to write JUnit report {}", path.display()))
}

fn fixture_reports_json(reports: &[FixtureRunReport]) -> serde_json::Value {
    json!({
        "fixtures": reports.iter().map(|report| json!({
            "id": report.id,
            "title": report.title,
            "selectedFixtureIds": report.selected_fixture_ids,
            "cases": report.cases,
        })).collect::<Vec<_>>(),
        "totalCases": reports.iter().map(|report| report.cases).sum::<usize>(),
    })
}

fn fixture_reports_junit(reports: &[FixtureRunReport]) -> String {
    let total_cases: usize = reports.iter().map(|report| report.cases).sum();
    let mut xml = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<testsuite name=\"trellis-integration\" tests=\"{}\" failures=\"0\" errors=\"0\">\n",
        total_cases
    );
    for report in reports {
        for case_index in 0..report.cases {
            xml.push_str(&format!(
                "  <testcase classname=\"{}\" name=\"case-{}\"/>\n",
                xml_escape(report.id),
                case_index + 1
            ));
        }
        if report.cases == 0 {
            xml.push_str(&format!(
                "  <testcase classname=\"{}\" name=\"{}\"/>\n",
                xml_escape(report.id),
                xml_escape(report.title)
            ));
        }
    }
    xml.push_str("</testsuite>\n");
    xml
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

pub(crate) fn select_run_fixtures(run_args: &RunArgs) -> Result<Vec<Fixture>> {
    validate_run_filters(run_args)?;

    let fixtures = integration_fixtures();
    if run_args.fixtures.is_empty() && run_args.coverage.is_empty() {
        return Ok(fixtures);
    }

    let fixture_filter: BTreeSet<_> = run_args.fixtures.iter().map(String::as_str).collect();
    let coverage_filter: BTreeSet<_> = run_args.coverage.iter().map(String::as_str).collect();
    let mut selected_parity_groups = BTreeSet::new();
    for fixture in &fixtures {
        let matches_fixture =
            fixture_filter.contains(fixture.id) || fixture_filter.contains(fixture.runner_id);
        let matches_coverage = fixture
            .coverage_ids
            .iter()
            .any(|coverage_id| coverage_filter.contains(coverage_id));
        if matches_fixture || matches_coverage {
            if let Some(parity_group) = fixture.parity_group {
                selected_parity_groups.insert(parity_group);
            }
        }
    }

    let mut selected = Vec::new();
    for fixture in fixtures {
        let matches_fixture =
            fixture_filter.contains(fixture.id) || fixture_filter.contains(fixture.runner_id);
        let matches_coverage = fixture
            .coverage_ids
            .iter()
            .any(|coverage_id| coverage_filter.contains(coverage_id));
        let matches_parity_group = fixture
            .parity_group
            .is_some_and(|parity_group| selected_parity_groups.contains(parity_group));
        if matches_fixture || matches_coverage || matches_parity_group {
            selected.push(fixture);
        }
    }

    let has_catalog_repair = selected
        .iter()
        .any(|fixture| fixture.id == "catalog-repair");
    let has_catalog_repair_restart = selected
        .iter()
        .any(|fixture| fixture.id == "catalog-repair-restart");
    if has_catalog_repair_restart && !has_catalog_repair {
        let catalog_repair = integration_fixtures()
            .into_iter()
            .find(|fixture| fixture.id == "catalog-repair")
            .ok_or_else(|| miette!("catalog-repair dependency is not registered"))?;
        let restart_index = selected
            .iter()
            .position(|fixture| fixture.id == "catalog-repair-restart")
            .ok_or_else(|| miette!("catalog-repair-restart fixture was not selected"))?;
        selected.insert(restart_index, catalog_repair);
    } else if has_catalog_repair && !has_catalog_repair_restart {
        let catalog_repair_restart = integration_fixtures()
            .into_iter()
            .find(|fixture| fixture.id == "catalog-repair-restart")
            .ok_or_else(|| miette!("catalog-repair-restart dependency is not registered"))?;
        let catalog_repair_index = selected
            .iter()
            .position(|fixture| fixture.id == "catalog-repair")
            .ok_or_else(|| miette!("catalog-repair fixture was not selected"))?;
        selected.insert(catalog_repair_index + 1, catalog_repair_restart);
    }

    Ok(selected)
}

fn validate_run_filters(run_args: &RunArgs) -> Result<()> {
    if !run_args.fixtures.is_empty() {
        let valid_fixture_ids = fixture_ids();
        for id in &run_args.fixtures {
            if !valid_fixture_ids.contains(id.as_str()) {
                return Err(miette!("unknown integration fixture id `{id}`"));
            }
        }
    }

    if !run_args.coverage.is_empty() {
        let valid_coverage_ids = fixture_coverage_ids();
        for id in &run_args.coverage {
            if !valid_coverage_ids.contains(id.as_str()) {
                return Err(miette!("unknown integration coverage id `{id}`"));
            }
        }
    }

    Ok(())
}

pub(crate) fn fixture_ids() -> BTreeSet<&'static str> {
    integration_fixtures()
        .into_iter()
        .flat_map(|fixture| [fixture.id, fixture.runner_id])
        .collect()
}

pub(crate) fn fixture_coverage_ids() -> BTreeSet<&'static str> {
    integration_fixtures()
        .into_iter()
        .flat_map(|fixture| fixture.coverage_ids.iter().copied())
        .collect()
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, BTreeSet};

    use super::{
        fixture_coverage_ids, fixture_ids, fixture_reports_json, fixture_reports_junit,
        integration_fixtures, select_run_fixtures, FixtureRunReport,
    };
    use crate::cli::RunArgs;
    use crate::report::required_integration_coverage;

    #[test]
    fn fixture_registry_matches_manual_run_order() {
        let ids: Vec<_> = integration_fixtures()
            .into_iter()
            .map(|fixture| fixture.id)
            .collect();

        assert_eq!(
            ids,
            [
                "admin-api",
                "device-activation",
                "rpc:rust",
                "rpc:typescript",
                "service-approval:rust",
                "service-approval:typescript",
                "app-identity-approval",
                "optional-uses",
                "operations:rust",
                "operations:typescript",
                "events:rust",
                "events:typescript",
                "health",
                "state:rust",
                "state:typescript",
                "transfer:rust",
                "transfer:typescript",
                "feeds:rust",
                "feeds:typescript",
                "resources:rust",
                "resources:typescript",
                "jobs",
                "catalog-repair",
                "catalog-repair-restart",
                "password-change",
            ]
        );
    }

    #[test]
    fn every_required_coverage_id_has_a_fixture_claiming_it() {
        let fixture_coverage = fixture_coverage_ids();
        let missing: Vec<_> = required_integration_coverage()
            .into_iter()
            .map(|coverage| coverage.id())
            .filter(|id| !fixture_coverage.contains(id))
            .collect();

        assert!(
            missing.is_empty(),
            "required coverage ids missing fixture claims: {missing:?}"
        );
    }

    #[test]
    fn fixture_ids_are_unique() {
        let fixtures = integration_fixtures();
        let ids: BTreeSet<_> = fixtures.iter().map(|fixture| fixture.id).collect();
        assert_eq!(ids.len(), fixtures.len());
    }

    #[test]
    fn fixture_runner_ids_are_valid_selection_aliases() {
        assert!(fixture_ids().contains("rpc"));
        assert!(fixture_ids().contains("rpc:rust"));
        assert!(fixture_ids().contains("rpc:typescript"));
    }

    #[test]
    fn parity_groups_have_rust_and_typescript_counterparts() {
        let mut languages_by_group: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
        let mut coverage_by_group: BTreeMap<&str, BTreeSet<Vec<&str>>> = BTreeMap::new();
        for fixture in integration_fixtures() {
            if let Some(parity_group) = fixture.parity_group {
                let language = fixture
                    .language
                    .expect("parity fixture should declare a language");
                languages_by_group
                    .entry(parity_group)
                    .or_default()
                    .insert(language);
                coverage_by_group
                    .entry(parity_group)
                    .or_default()
                    .insert(fixture.coverage_ids.to_vec());
            }
        }

        for (parity_group, languages) in languages_by_group {
            assert_eq!(
                languages,
                BTreeSet::from(["rust", "typescript"]),
                "parity group {parity_group} is missing a counterpart"
            );
        }

        for (parity_group, coverage_sets) in coverage_by_group {
            assert_eq!(
                coverage_sets.len(),
                1,
                "parity group {parity_group} has mismatched coverage claims"
            );
        }
    }

    #[test]
    fn selects_all_fixtures_without_filters() {
        let selected = select_run_fixtures(&RunArgs::default()).expect("selection should succeed");
        let selected_ids: Vec<_> = selected.into_iter().map(|fixture| fixture.id).collect();
        let all_ids: Vec<_> = integration_fixtures()
            .into_iter()
            .map(|fixture| fixture.id)
            .collect();

        assert_eq!(selected_ids, all_ids);
    }

    #[test]
    fn selects_fixture_ids_in_registry_order() {
        let run_args = RunArgs {
            fixtures: vec!["jobs".to_string(), "rpc".to_string()],
            ..RunArgs::default()
        };

        let selected = select_run_fixtures(&run_args).expect("selection should succeed");
        let selected_ids: Vec<_> = selected.into_iter().map(|fixture| fixture.id).collect();

        assert_eq!(selected_ids, vec!["rpc:rust", "rpc:typescript", "jobs"]);
    }

    #[test]
    fn selecting_one_parity_fixture_selects_its_counterpart() {
        let run_args = RunArgs {
            fixtures: vec!["operations:typescript".to_string()],
            ..RunArgs::default()
        };

        let selected = select_run_fixtures(&run_args).expect("selection should succeed");
        let selected_ids: Vec<_> = selected.into_iter().map(|fixture| fixture.id).collect();

        assert_eq!(
            selected_ids,
            vec!["operations:rust", "operations:typescript"]
        );
    }

    #[test]
    fn selects_coverage_ids_in_registry_order() {
        let run_args = RunArgs {
            coverage: vec![
                "jobs-public-api".to_string(),
                "cross-runtime-events".to_string(),
            ],
            ..RunArgs::default()
        };

        let selected = select_run_fixtures(&run_args).expect("selection should succeed");
        let selected_ids: Vec<_> = selected.into_iter().map(|fixture| fixture.id).collect();

        assert_eq!(
            selected_ids,
            vec!["events:rust", "events:typescript", "jobs"]
        );
    }

    #[test]
    fn combines_fixture_and_coverage_filters_without_duplicates() {
        let run_args = RunArgs {
            fixtures: vec!["jobs".to_string()],
            coverage: vec!["cross-runtime-rpc".to_string()],
            ..RunArgs::default()
        };

        let selected = select_run_fixtures(&run_args).expect("selection should succeed");
        let selected_ids: Vec<_> = selected.into_iter().map(|fixture| fixture.id).collect();

        assert_eq!(
            selected_ids,
            vec![
                "rpc:rust",
                "rpc:typescript",
                "service-approval:rust",
                "service-approval:typescript",
                "resources:rust",
                "resources:typescript",
                "jobs"
            ]
        );
    }

    #[test]
    fn adds_catalog_repair_dependency_for_restart_fixture() {
        let run_args = RunArgs {
            fixtures: vec!["catalog-repair-restart".to_string()],
            ..RunArgs::default()
        };

        let selected = select_run_fixtures(&run_args).expect("selection should succeed");
        let selected_ids: Vec<_> = selected.into_iter().map(|fixture| fixture.id).collect();

        assert_eq!(
            selected_ids,
            vec!["catalog-repair", "catalog-repair-restart"]
        );
    }

    #[test]
    fn adds_catalog_repair_restart_when_catalog_repair_is_selected() {
        let run_args = RunArgs {
            fixtures: vec!["catalog-repair".to_string()],
            ..RunArgs::default()
        };

        let selected = select_run_fixtures(&run_args).expect("selection should succeed");
        let selected_ids: Vec<_> = selected.into_iter().map(|fixture| fixture.id).collect();

        assert_eq!(
            selected_ids,
            vec!["catalog-repair", "catalog-repair-restart"]
        );
    }

    #[test]
    fn rejects_unknown_fixture_filter() {
        let run_args = RunArgs {
            fixtures: vec!["missing".to_string()],
            ..RunArgs::default()
        };

        let error = select_run_fixtures(&run_args).expect_err("selection should fail");

        assert!(error.to_string().contains("unknown integration fixture id"));
    }

    #[test]
    fn rejects_unknown_coverage_filter() {
        let run_args = RunArgs {
            coverage: vec!["missing".to_string()],
            ..RunArgs::default()
        };

        let error = select_run_fixtures(&run_args).expect_err("selection should fail");

        assert!(error
            .to_string()
            .contains("unknown integration coverage id"));
    }

    #[test]
    fn fixture_reports_json_includes_totals() {
        let reports = vec![FixtureRunReport {
            id: "rpc",
            title: "RPC",
            selected_fixture_ids: vec!["rpc:rust", "rpc:typescript"],
            cases: 2,
        }];

        let value = fixture_reports_json(&reports);

        assert_eq!(value["totalCases"], 2);
        assert_eq!(value["fixtures"][0]["id"], "rpc");
        assert_eq!(value["fixtures"][0]["selectedFixtureIds"][0], "rpc:rust");
    }

    #[test]
    fn fixture_reports_junit_escapes_fixture_names() {
        let reports = vec![FixtureRunReport {
            id: "rpc<&",
            title: "RPC",
            selected_fixture_ids: vec!["rpc:rust"],
            cases: 1,
        }];

        let xml = fixture_reports_junit(&reports);

        assert!(xml.contains("tests=\"1\""));
        assert!(xml.contains("classname=\"rpc&lt;&amp;\""));
    }
}

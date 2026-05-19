use miette::{miette, IntoDiagnostic, Result};

use crate::admin::run_admin_api_fixture;
use crate::browser::{complete_admin_bootstrap, complete_local_login, BrowserContainer};
use crate::cli::IntegrationArgs;
use crate::container::IntegrationWorkdir;
use crate::device_activation::run_device_activation_fixture;
use crate::events::run_events_fixture;
use crate::feeds::run_feeds_fixture;
use crate::health::run_health_fixture;
use crate::jobs::run_jobs_fixture;
use crate::nats::{
    assert_jobs_shared_streams, ensure_event_stream, ensure_jobs_shared_streams, NatsContainer,
};
use crate::operations::run_operations_fixture;
use crate::optional_uses::run_optional_uses_fixture;
use crate::portal::build_login_portal;
use crate::process::{CommandSpec, ProcessRunner};
use crate::report::{
    known_integration_failures, print_known_failures, print_required_coverage,
    required_integration_coverage, KnownFailure, RequiredCoverage,
};
use crate::resources::run_resources_fixture;
use crate::rpc::{reauth_contract, run_rpc_fixture};
use crate::runtime::{extract_bootstrap_url_from_log, reserve_local_port, TrellisRuntime};
use crate::service_approval::run_service_approval_fixture;
use crate::state::run_state_fixture;
use crate::transfer::run_transfer_fixture;
use serde_json::to_string;
use trellis_contracts::{use_contract, ContractKind, ContractManifestBuilder};
use trellis_local_bootstrap::{
    generate_local_trellis_bootstrap, ContainerRuntime, LocalTrellisBootstrapOptions,
};

pub(crate) fn admin_setup_contract_json() -> Result<String> {
    let manifest = ContractManifestBuilder::new(
        "trellis.integration-agent@v1",
        "Trellis Integration Agent",
        "Verify delegated Rust agent login and admin-managed integration fixtures.",
        ContractKind::Agent,
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call([
            "Auth.Capabilities.List",
            "Auth.CapabilityGroups.Delete",
            "Auth.CapabilityGroups.Get",
            "Auth.CapabilityGroups.List",
            "Auth.CapabilityGroups.Put",
            "Auth.Connections.List",
            "Auth.Deployments.Create",
            "Auth.Deployments.Disable",
            "Auth.Deployments.Enable",
            "Auth.Deployments.List",
            "Auth.Envelopes.Expand",
            "Auth.Envelopes.Get",
            "Auth.Envelopes.List",
            "Auth.EnvelopeExpansions.Approve",
            "Auth.EnvelopeExpansions.List",
            "Auth.Health",
            "Auth.Identities.Grants.List",
            "Auth.Identities.List",
            "Auth.Devices.List",
            "Auth.Devices.Provision",
            "Auth.Portals.List",
            "Auth.Portals.LoginRoutes.List",
            "Auth.Portals.LoginSettings.Get",
            "Auth.ServiceInstances.List",
            "Auth.ServiceInstances.Provision",
            "Auth.Sessions.List",
            "Auth.Sessions.Logout",
            "Auth.Sessions.Me",
            "Auth.UserIdentities.List",
            "Auth.Users.Get",
            "Auth.Users.List",
            "Auth.Users.Update",
        ]),
    )
    .use_ref(
        "core",
        use_contract("trellis.core@v1").with_rpc_call([
            "Trellis.Catalog",
            "Trellis.Contract.Get",
            "Trellis.Surface.Status",
        ]),
    )
    .build()
    .map_err(|error| miette!("failed to build integration admin setup contract: {error}"))?;

    to_string(&manifest)
        .map_err(|error| miette!("failed to serialize integration admin setup contract: {error}"))
}

/// Run the Trellis integration harness using the supplied prepare workflow hook.
pub fn run(args: IntegrationArgs, prepare: impl FnOnce() -> Result<()>) -> Result<()> {
    let runner = IntegrationRunner::new(args);
    runner.run(prepare)
}

#[derive(Debug)]
struct IntegrationRunner {
    args: IntegrationArgs,
    process_runner: ProcessRunner,
}

impl IntegrationRunner {
    fn new(args: IntegrationArgs) -> Self {
        Self {
            args,
            process_runner: ProcessRunner,
        }
    }

    fn run(&self, prepare: impl FnOnce() -> Result<()>) -> Result<()> {
        let runtime = tokio::runtime::Runtime::new()
            .map_err(|error| miette!("failed to create integration async runtime: {error}"))?;
        runtime.block_on(self.run_async(prepare))
    }

    async fn run_async(&self, prepare: impl FnOnce() -> Result<()>) -> Result<()> {
        let known_failures = known_integration_failures();
        let required_coverage = required_integration_coverage();
        self.report_inventory(&known_failures, &required_coverage)?;
        if self.args.list_known_failures || self.args.list_required_coverage {
            return Ok(());
        }

        if self.args.skip_prepare {
            eprintln!("integration preflight: skipping prepare workflow");
        } else {
            prepare()?;
        }
        let workdir = IntegrationWorkdir::create(self.args.keep_workdir)?;
        let container_runtime_name = self.detect_container_runtime()?;
        eprintln!(
            "integration preflight: using {container_runtime_name} for rootless NATS/Trellis stack containers"
        );
        eprintln!(
            "integration preflight: temporary workdir {}",
            workdir.path().display()
        );
        if workdir.keep() {
            eprintln!("integration preflight: preserving temporary workdir");
        }
        let trellis_port = reserve_local_port()?;
        let browser = BrowserContainer::start(&self.process_runner, container_runtime_name).await?;
        let browser_trellis_origin = browser.trellis_origin(trellis_port);
        eprintln!(
            "integration preflight: browser WebDriver {}",
            browser.webdriver_url()
        );
        eprintln!("integration preflight: browser Trellis origin {browser_trellis_origin}");
        let mut bootstrap_options = LocalTrellisBootstrapOptions::new(workdir.path());
        bootstrap_options.container_runtime = container_runtime(container_runtime_name)?;
        bootstrap_options.trellis_port = trellis_port;
        bootstrap_options.public_origin = browser_trellis_origin.clone();
        bootstrap_options.force = true;
        let manifest = generate_local_trellis_bootstrap(&bootstrap_options)
            .map_err(|error| miette!("failed to generate local Trellis bootstrap: {error}"))?;
        let nats_manifest_path = workdir.path().join(&manifest.paths.nats_manifest);
        let nats_dir = nats_manifest_path
            .parent()
            .ok_or_else(|| miette!("bootstrap NATS manifest path has no parent"))?;

        let nats = NatsContainer::start(
            &self.process_runner,
            container_runtime_name,
            &workdir,
            nats_dir,
        )?;
        eprintln!("integration preflight: NATS server {}", nats.server_url());
        eprintln!(
            "integration preflight: NATS websocket {}",
            nats.websocket_url()
        );
        let trellis_creds = manifest
            .nats
            .paths
            .creds
            .get("trellisService")
            .ok_or_else(|| miette!("local NATS manifest is missing trellisService creds"))?;
        ensure_event_stream(&nats.server_url(), &nats_dir.join(trellis_creds)).await?;
        ensure_jobs_shared_streams(&nats.server_url(), &nats_dir.join(trellis_creds)).await?;
        let portal = build_login_portal(&self.process_runner, &workdir, &browser_trellis_origin)?;
        eprintln!(
            "integration preflight: portal build {}",
            portal.build_dir().display()
        );
        let trellis_runtime = TrellisRuntime::start(
            &workdir,
            &manifest,
            bootstrap_options,
            &nats.server_url(),
            &nats.websocket_url(),
            portal.build_dir(),
        )?;
        eprintln!(
            "integration preflight: Trellis runtime {}",
            trellis_runtime.public_url()
        );
        let bootstrap_url = std::fs::read_to_string(trellis_runtime.stdout_log())
            .map_err(|error| miette!("failed to read Trellis stdout log: {error}"))
            .and_then(|log| extract_bootstrap_url_from_log(&log))?;
        eprintln!("integration preflight: completing admin bootstrap through portal");
        let driver = browser.driver().await?;
        let admin_result = complete_admin_bootstrap(
            &driver,
            &bootstrap_url,
            "admin",
            "trellis-admin-password",
            "Trellis Admin",
            "admin@example.test",
        )
        .await;
        let quit_result = driver
            .quit()
            .await
            .map_err(|error| miette!("failed to stop WebDriver session: {error}"));
        admin_result?;
        quit_result?;
        eprintln!("integration preflight: admin bootstrap completed through portal");

        let host_trellis_origin = format!("http://127.0.0.1:{trellis_port}");
        eprintln!("integration preflight: starting delegated Rust agent login");
        let admin_setup_contract_json = admin_setup_contract_json()?;
        let challenge = trellis_auth::start_agent_login(&trellis_auth::StartAgentLoginOpts {
            trellis_url: &host_trellis_origin,
            contract_json: &admin_setup_contract_json,
        })
        .await
        .into_diagnostic()?;
        let login_url = challenge.login_url().to_string();
        let driver = browser.driver().await?;
        let login_result =
            complete_local_login(&driver, &login_url, "admin", "trellis-admin-password").await;
        let quit_result = driver
            .quit()
            .await
            .map_err(|error| miette!("failed to stop WebDriver session: {error}"));
        login_result?;
        quit_result?;
        let outcome = challenge
            .complete(&host_trellis_origin)
            .await
            .into_diagnostic()?;
        if outcome.user.identity.subject != "admin" {
            return Err(miette!(
                "delegated Rust agent login returned non-admin identity `{}`",
                outcome.user.identity.subject
            ));
        }
        eprintln!(
            "integration preflight: delegated Rust agent login returned admin userId={}",
            outcome.user.user_id
        );
        eprintln!("integration preflight: running direct primary admin/public API fixture");
        let admin_api_passing_cases =
            run_admin_api_fixture(&host_trellis_origin, &outcome, &browser).await?;
        eprintln!("integration preflight: direct primary admin/public API fixture passed");
        eprintln!("integration preflight: running device activation fixture");
        let device_activation_passing_cases =
            run_device_activation_fixture(&host_trellis_origin, &outcome, &browser).await?;
        eprintln!("integration preflight: device activation fixture passed");
        let restored_outcome = reauth_contract(
            &outcome.state,
            &admin_setup_contract_json,
            &host_trellis_origin,
            &browser,
        )
        .await?;
        eprintln!("integration preflight: running Rust RPC fixture");
        let rpc_passing_cases =
            run_rpc_fixture(&host_trellis_origin, &restored_outcome, &browser).await?;
        eprintln!("integration preflight: Rust/TypeScript RPC fixture passed");
        eprintln!("integration preflight: running service startup approval fixture");
        let service_approval_passing_cases =
            run_service_approval_fixture(&host_trellis_origin, &restored_outcome, &browser).await?;
        eprintln!("integration preflight: service startup approval fixture passed");
        eprintln!("integration preflight: running optional uses dependency fixture");
        let optional_uses_passing_cases =
            run_optional_uses_fixture(&host_trellis_origin, &restored_outcome, &browser).await?;
        eprintln!("integration preflight: optional uses dependency fixture passed");
        eprintln!("integration preflight: running Rust/TypeScript operations fixture");
        let operations_passing_cases =
            run_operations_fixture(&host_trellis_origin, &restored_outcome, &browser).await?;
        eprintln!("integration preflight: Rust/TypeScript operations fixture passed");
        eprintln!("integration preflight: running Rust/TypeScript events fixture");
        let events_passing_cases =
            run_events_fixture(&host_trellis_origin, &restored_outcome, &browser).await?;
        eprintln!("integration preflight: Rust/TypeScript events fixture passed");
        eprintln!("integration preflight: running Rust health heartbeat fixture");
        let health_passing_cases =
            run_health_fixture(&host_trellis_origin, &restored_outcome, &browser).await?;
        eprintln!("integration preflight: Rust health heartbeat fixture passed");
        eprintln!("integration preflight: running Rust/TypeScript state fixture");
        let state_passing_cases =
            run_state_fixture(&host_trellis_origin, &restored_outcome, &browser).await?;
        eprintln!("integration preflight: Rust/TypeScript state fixture passed");
        eprintln!("integration preflight: running Rust/TypeScript transfer fixture");
        let transfer_passing_cases =
            run_transfer_fixture(&host_trellis_origin, &restored_outcome, &browser).await?;
        eprintln!("integration preflight: Rust/TypeScript transfer fixture passed");
        eprintln!("integration preflight: running Rust/TypeScript feeds fixture");
        let feeds_passing_cases =
            run_feeds_fixture(&host_trellis_origin, &restored_outcome, &browser).await?;
        eprintln!("integration preflight: Rust/TypeScript feeds fixture passed");
        eprintln!("integration preflight: running Rust/TypeScript resources fixture");
        let resources_passing_cases =
            run_resources_fixture(&host_trellis_origin, &restored_outcome, &browser).await?;
        eprintln!("integration preflight: Rust/TypeScript resources fixture passed");
        eprintln!("integration preflight: running Rust Jobs public API fixture");
        let jobs_passing_cases =
            run_jobs_fixture(&host_trellis_origin, &restored_outcome, &browser).await?;
        eprintln!("integration preflight: Rust Jobs public API fixture passed");
        assert_jobs_shared_streams(&nats.server_url(), &nats_dir.join(trellis_creds)).await?;
        eprintln!("integration preflight: shared Jobs streams are present");
        let passing_cases = admin_api_passing_cases
            + device_activation_passing_cases
            + rpc_passing_cases
            + service_approval_passing_cases
            + optional_uses_passing_cases
            + operations_passing_cases
            + events_passing_cases
            + health_passing_cases
            + state_passing_cases
            + transfer_passing_cases
            + feeds_passing_cases
            + resources_passing_cases
            + jobs_passing_cases;
        print_required_coverage(&required_coverage);
        print_known_failures(&known_failures);
        eprintln!(
            "integration result: {} passing case(s), {} required coverage area(s), {} known failing case(s)",
            passing_cases,
            required_coverage.len(),
            known_failures.len()
        );

        Ok(())
    }

    fn report_inventory(
        &self,
        known_failures: &[KnownFailure],
        required_coverage: &[RequiredCoverage],
    ) -> Result<()> {
        if self.args.list_known_failures {
            print_known_failures(known_failures);
            return Ok(());
        }
        if self.args.list_required_coverage {
            print_required_coverage(required_coverage);
            return Ok(());
        }

        if self.args.strict_known_failures && !known_failures.is_empty() {
            print_known_failures(known_failures);
            return Err(miette!(
                "integration suite has {} known failing case(s)",
                known_failures.len()
            ));
        }

        Ok(())
    }

    fn detect_container_runtime(&self) -> Result<&'static str> {
        for runtime in ["podman", "docker"] {
            let spec = CommandSpec::new(runtime).arg("--version");
            match self.process_runner.status(&spec) {
                Ok(status) if status.success() => return Ok(runtime),
                Ok(_) | Err(_) => {}
            }
        }

        Err(miette!(
            "integration requires podman or docker; local nats-server is intentionally not used"
        ))
    }
}

fn container_runtime(runtime: &str) -> Result<ContainerRuntime> {
    match runtime {
        "podman" => Ok(ContainerRuntime::Podman),
        "docker" => Ok(ContainerRuntime::Docker),
        other => Err(miette!("unsupported container runtime `{other}`")),
    }
}

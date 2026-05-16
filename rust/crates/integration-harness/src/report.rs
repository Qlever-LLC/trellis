#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct RequiredCoverage {
    id: &'static str,
    title: &'static str,
    expectation: &'static str,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct KnownFailure {
    id: &'static str,
    title: &'static str,
    reason: &'static str,
}

pub(crate) fn known_integration_failures() -> Vec<KnownFailure> {
    vec![]
}

pub(crate) fn required_integration_coverage() -> Vec<RequiredCoverage> {
    vec![
        RequiredCoverage {
            id: "full-stack-auth-callout",
            title: "Real NATS auth-callout stack",
            expectation: "The suite must start NATS plus the Trellis runtime and connect participants through sentinel credentials, auth_token proofs, and scoped JWTs instead of fake Auth.Requests.Validate responders.",
        },
        RequiredCoverage {
            id: "cross-runtime-rpc",
            title: "RPC parity across TS and Rust services and clients",
            expectation: "Rust client, TS client, Rust service, and TS service must pass all four RPC caller/provider combinations through generated SDKs or public runtime APIs.",
        },
        RequiredCoverage {
            id: "cross-runtime-operations",
            title: "Operation parity across TS and Rust services and clients",
            expectation: "Both runtimes must support operation start, progress, watch, wait, and cancel symmetrically; missing support in either runtime is a Trellis bug.",
        },
        RequiredCoverage {
            id: "cross-runtime-events",
            title: "Event publish/subscribe authorization parity",
            expectation: "Both runtimes must publish and subscribe to contract events with positive and denied authorization cases.",
        },
        RequiredCoverage {
            id: "health-heartbeat-event",
            title: "Generated health heartbeat event coverage",
            expectation: "The suite must publish and subscribe to trellis.health@v1 Health.Heartbeat with generated Rust SDK types through the real NATS auth-callout stack and include an authorization denial.",
        },
        RequiredCoverage {
            id: "state-parity",
            title: "State API parity for TS and Rust clients",
            expectation: "Both clients must exercise value and map state get, put, delete, list, revision checks, TTL behavior, and authorization denials against the Trellis runtime.",
        },
        RequiredCoverage {
            id: "transfer-parity",
            title: "Transfer parity across TS and Rust services and clients",
            expectation: "Both runtimes must support upload, download, operation transfer, grant validation, and transfer-subject authorization.",
        },
        RequiredCoverage {
            id: "feeds-parity",
            title: "Feed parity across TS and Rust services and clients",
            expectation: "Both runtimes must pass request/reply stream setup, ready frames, typed feed events, disconnect handling, and authorization checks.",
        },
        RequiredCoverage {
            id: "jobs-public-api",
            title: "Jobs public API coverage against real service",
            expectation: "The suite must start the Rust trellis-service-jobs host against live harness NATS and exercise every generated trellis-sdk-jobs public RPC with positive, denied, and invalid-state cases.",
        },
        RequiredCoverage {
            id: "jobs-service-local-parity",
            title: "Service-local Jobs API coverage across TS and Rust",
            expectation: "The suite must exercise Rust JobManager and TypeScript service.jobs create/handle APIs through live Trellis auth, NATS, shared Jobs infrastructure, and generated Jobs admin verification.",
        },
        RequiredCoverage {
            id: "primary-admin-public-api-flow",
            title: "Primary admin/public API setup flow",
            expectation: "The suite must drive public/admin APIs for bootstrap, login/session setup, deployment creation, envelope expansion, service provisioning, and real authenticated calls without direct database seeding.",
        },
        RequiredCoverage {
            id: "service-envelope-approval-flow",
            title: "Service startup envelope approval flow",
            expectation: "The suite must start Rust and TypeScript services before envelope coverage exists, verify pending expansion requests through public/admin APIs, approve them, and then prove all four Rust/TypeScript RPC caller/provider combinations connect through the approved envelope.",
        },
    ]
}

pub(crate) fn print_required_coverage(required_coverage: &[RequiredCoverage]) {
    if required_coverage.is_empty() {
        eprintln!("integration required coverage: none");
        return;
    }

    eprintln!("integration required coverage:");
    for coverage in required_coverage {
        eprintln!("- {}: {}", coverage.id, coverage.title);
        eprintln!("  expectation: {}", coverage.expectation);
    }
}

pub(crate) fn print_known_failures(known_failures: &[KnownFailure]) {
    if known_failures.is_empty() {
        eprintln!("integration known failures: none");
        return;
    }

    eprintln!("integration known failures (XFAIL):");
    for failure in known_failures {
        eprintln!("- {}: {}", failure.id, failure.title);
        eprintln!("  reason: {}", failure.reason);
    }
}

#[cfg(test)]
mod tests {
    use super::{known_integration_failures, required_integration_coverage};

    #[test]
    fn required_integration_coverage_makes_parity_requirements_visible() {
        let ids: Vec<_> = required_integration_coverage()
            .into_iter()
            .map(|coverage| coverage.id)
            .collect();
        assert!(ids.contains(&"full-stack-auth-callout"));
        assert!(ids.contains(&"cross-runtime-rpc"));
        assert!(ids.contains(&"cross-runtime-operations"));
        assert!(ids.contains(&"cross-runtime-events"));
        assert!(ids.contains(&"health-heartbeat-event"));
        assert!(ids.contains(&"state-parity"));
        assert!(ids.contains(&"transfer-parity"));
        assert!(ids.contains(&"feeds-parity"));
        assert!(ids.contains(&"jobs-public-api"));
        assert!(ids.contains(&"jobs-service-local-parity"));
        assert!(ids.contains(&"primary-admin-public-api-flow"));
        assert!(ids.contains(&"service-envelope-approval-flow"));
    }

    #[test]
    fn known_integration_failures_are_actual_xfails_not_coverage_categories() {
        let ids: Vec<_> = known_integration_failures()
            .into_iter()
            .map(|failure| failure.id)
            .collect();
        assert!(ids.is_empty());
    }
}

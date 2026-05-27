#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct RequiredCoverage {
    id: &'static str,
    title: &'static str,
    expectation: &'static str,
}

#[cfg(test)]
impl RequiredCoverage {
    pub(crate) fn id(&self) -> &'static str {
        self.id
    }
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
            id: "resources-service-bound-parity",
            title: "Service-bound store and KV resource parity across TS and Rust",
            expectation: "Rust and TypeScript service providers must exercise live service-bound store and KV handles after public/admin provisioning, and Rust plus TypeScript clients must call both providers.",
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
            id: "built-in-rpc-matrix",
            title: "Built-in Trellis RPC matrix",
            expectation: "The suite must exercise built-in Trellis auth and core RPCs through generated SDK clients against the live runtime, including health, capabilities, users, identities, sessions, connections, portals, deployments, envelopes, provisioning, catalog, contract, and surface-status calls.",
        },
        RequiredCoverage {
            id: "auth-protocol-matrix",
            title: "Auth protocol validation matrix",
            expectation: "The suite must exercise Auth.Requests.Validate and end-to-end authenticated NATS request handling for valid proofs, unknown sessions, invalid signatures, undeclared subjects, missing capabilities, missing proofs, reply-inbox mismatch, stale transport after rebind, service availability failures, and transfer-subject denials.",
        },
        RequiredCoverage {
            id: "device-activation-end-to-end",
            title: "Known-device activation end-to-end flow",
            expectation: "The suite must provision a known device, resolve activation through public/admin APIs, wait for signed activation connect info, connect as the device, and prove undeclared access is denied.",
        },
        RequiredCoverage {
            id: "service-envelope-approval-flow",
            title: "Service startup envelope approval flow",
            expectation: "The suite must start Rust and TypeScript services before envelope coverage exists, verify pending expansion requests through public/admin APIs, approve them, and then prove all four Rust/TypeScript RPC caller/provider combinations connect through the approved envelope.",
        },
        RequiredCoverage {
            id: "app-identity-envelope-approval",
            title: "App identity-envelope approval flow",
            expectation: "The suite must start an app-originated login flow with an app contract, approve access through the real portal, bind and connect as a user app, verify the approved surface works, verify an unapproved surface is denied, and prove bind remains approval_required before approval, for stale broader app evidence, and after revocation.",
        },
        RequiredCoverage {
            id: "optional-uses-dependency-closure",
            title: "Optional uses and dependency closure",
            expectation: "The suite must prove optional uses grant no authority while missing, required dependencies fail closed while unknown, approved known required closures authenticate through active offers or latest approved dependency fallbacks, envelope-compatible old digests can reconnect after same-id updates, and cyclic required closures can activate after both sides are approved.",
        },
        RequiredCoverage {
            id: "capability-permission-matrix",
            title: "Capability and permission derivation matrix",
            expectation: "The suite must prove live auth-callout permission derivation for caller-visible capabilities, including operation call/read/cancel access and stale grant denial after capability changes.",
        },
        RequiredCoverage {
            id: "active-catalog-repair",
            title: "Envelope authority and strict replacement rejection",
            expectation: "The suite must expand deployment envelopes through public bootstrap APIs, reject incompatible same-contract replacement for an existing strict service instance, prove the current envelope-authorized digest remains callable, and verify restart does not require active catalog issues for runtime authority.",
        },
        RequiredCoverage {
            id: "observability-trace-matrix",
            title: "Observability and trace propagation matrix",
            expectation: "The suite must prove request correlation and trace propagation across RPC, operations, events, feeds, transfer, jobs, and auth/admin control-plane calls through live NATS/auth-callout.",
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
        assert!(ids.contains(&"resources-service-bound-parity"));
        assert!(ids.contains(&"jobs-public-api"));
        assert!(ids.contains(&"jobs-service-local-parity"));
        assert!(ids.contains(&"primary-admin-public-api-flow"));
        assert!(ids.contains(&"built-in-rpc-matrix"));
        assert!(ids.contains(&"auth-protocol-matrix"));
        assert!(ids.contains(&"device-activation-end-to-end"));
        assert!(ids.contains(&"service-envelope-approval-flow"));
        assert!(ids.contains(&"app-identity-envelope-approval"));
        assert!(ids.contains(&"optional-uses-dependency-closure"));
        assert!(ids.contains(&"capability-permission-matrix"));
        assert!(ids.contains(&"active-catalog-repair"));
        assert!(ids.contains(&"observability-trace-matrix"));
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

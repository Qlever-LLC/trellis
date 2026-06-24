use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tokio::task::JoinHandle;
use trellis_rs::client::{
    RpcDescriptor, ServiceConnectWithContractOptions, TrellisClient, TrellisClientError,
};
use trellis_rs::sdk::auth::types::{
    AuthDeploymentAuthorityAcceptMigrationRequest, AuthDeploymentAuthorityAcceptUpdateRequest,
    AuthDeploymentAuthorityPlansListRequest, AuthDeploymentAuthorityRejectRequest,
    AuthServiceInstancesProvisionRequest,
};
use trellis_rs::service::{ConnectedServiceRuntime, KvResourceClient};

use crate::support::assertions::assert_case_registered;

const SERVICE_CONTRACT_ID: &str = "trellis.integration.authority-plan.service@v1";
const RESOURCE_SERVICE_CONTRACT_ID: &str = "trellis.integration.authority-plan.resource-service@v1";
const STRICT_DEPLOYMENT: &str = "authority-plan-strict";
const MUTABLE_DEPLOYMENT: &str = "authority-plan-mutable";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct PingInput {
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct PingOutput {
    message: String,
    variant: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct AddedPingOutput {
    message: String,
    variant: String,
    added: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct IncompatiblePingInput {
    count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct IncompatiblePingOutput {
    count: i64,
    variant: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct ResourcePingInput {
    key: String,
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct ResourcePingOutput {
    key: String,
    message: String,
    history: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct ResourceRecord {
    message: String,
}

struct BasePingRpc;

impl trellis_rs::client::RpcDescriptor for BasePingRpc {
    type Input = PingInput;
    type Output = PingOutput;

    const KEY: &'static str = "Plan.Ping";
    const SUBJECT: &'static str = "rpc.v1.Integration.AuthorityPlan.Plan.Ping";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["ping"];
    const ERRORS: &'static [&'static str] = &[];
    const INPUT_SCHEMA_JSON: &'static str =
        r#"{"type":"object","required":["message"],"properties":{"message":{"type":"string"}}}"#;
    const OUTPUT_SCHEMA_JSON: &'static str = r#"{"type":"object","required":["message","variant"],"properties":{"message":{"type":"string"},"variant":{"type":"string"}}}"#;
}

struct AddedPingRpc;

impl trellis_rs::client::RpcDescriptor for AddedPingRpc {
    type Input = PingInput;
    type Output = AddedPingOutput;

    const KEY: &'static str = "Plan.AddedPing";
    const SUBJECT: &'static str = "rpc.v1.Integration.AuthorityPlan.Plan.AddedPing";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["addedPing"];
    const ERRORS: &'static [&'static str] = &[];
    const INPUT_SCHEMA_JSON: &'static str = BasePingRpc::INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str = r#"{"type":"object","required":["message","variant","added"],"properties":{"message":{"type":"string"},"variant":{"type":"string"},"added":{"type":"boolean"}}}"#;
}

struct IncompatiblePingRpc;

impl trellis_rs::client::RpcDescriptor for IncompatiblePingRpc {
    type Input = IncompatiblePingInput;
    type Output = IncompatiblePingOutput;

    const KEY: &'static str = "Plan.Ping";
    const SUBJECT: &'static str = "rpc.v1.Integration.AuthorityPlan.Plan.Ping";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["ping"];
    const ERRORS: &'static [&'static str] = &[];
    const INPUT_SCHEMA_JSON: &'static str =
        r#"{"type":"object","required":["count"],"properties":{"count":{"type":"integer"}}}"#;
    const OUTPUT_SCHEMA_JSON: &'static str = r#"{"type":"object","required":["count","variant"],"properties":{"count":{"type":"integer"},"variant":{"type":"string"}}}"#;
}

struct ResourcePingRpc;

impl trellis_rs::client::RpcDescriptor for ResourcePingRpc {
    type Input = ResourcePingInput;
    type Output = ResourcePingOutput;

    const KEY: &'static str = "Plan.ResourcePing";
    const SUBJECT: &'static str = "rpc.v1.Integration.AuthorityPlan.Plan.ResourcePing";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &[];
    const INPUT_SCHEMA_JSON: &'static str = r#"{"type":"object","required":["key","message"],"properties":{"key":{"type":"string"},"message":{"type":"string"}}}"#;
    const OUTPUT_SCHEMA_JSON: &'static str = r#"{"type":"object","required":["key","message","history"],"properties":{"key":{"type":"string"},"message":{"type":"string"},"history":{"type":"integer"}}}"#;
}

struct AuthorityPlanContract;

#[derive(Clone, Debug, PartialEq, Eq)]
struct AuthorityPlanEntry {
    plan_id: String,
    deployment_id: String,
    classification: String,
    state: Option<String>,
    decision_reason: Option<String>,
    contract_digest: String,
}

struct AbortOnDrop<T> {
    handle: Option<JoinHandle<T>>,
}

impl<T> AbortOnDrop<T> {
    fn new(handle: JoinHandle<T>) -> Self {
        Self {
            handle: Some(handle),
        }
    }

    async fn abort_and_wait(mut self) {
        if let Some(handle) = self.handle.take() {
            handle.abort();
            let _ = handle.await;
        }
    }
}

impl<T> Drop for AbortOnDrop<T> {
    fn drop(&mut self) {
        if let Some(handle) = &self.handle {
            handle.abort();
        }
    }
}

#[tokio::test]
async fn authority_plan_preapproved_contract_connects() {
    assert_case_registered(
        "authority-plan.preapproved-contract-connects",
        "authority-plan",
        "authority_plan",
    );

    let (runtime, bootstrap_url, mut admin) = start_runtime().await;
    let base_contract = service_contract("base");
    admin
        .create_deployment(&bootstrap_url, Some(STRICT_DEPLOYMENT), Some(false))
        .await
        .expect("create strict deployment");
    admin
        .approve_contract(&bootstrap_url, &base_contract, Some(STRICT_DEPLOYMENT), &[])
        .await
        .expect("approve base contract");
    let service_key = provision_instance_only(&mut admin, &bootstrap_url, STRICT_DEPLOYMENT).await;

    let mut service = connect_service(
        runtime.trellis_url(),
        "authority-plan-base-service",
        SERVICE_CONTRACT_ID,
        &base_contract,
        &service_key.seed,
    )
    .await;
    service.register_rpc::<BasePingRpc, _, _>(|_context, input| async move {
        Ok(PingOutput {
            message: input.message,
            variant: "base".to_string(),
        })
    });
    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));

    let client = admin
        .connect_client(&bootstrap_url, &base_client_contract())
        .await
        .expect("connect base client");
    let output = call_base_ping_with_retry(&client, "preapproved").await;
    assert_eq!(
        output,
        PingOutput {
            message: "preapproved".to_string(),
            variant: "base".to_string(),
        }
    );
    assert!(
        list_plans(
            &mut admin,
            &bootstrap_url,
            STRICT_DEPLOYMENT,
            Some("pending"),
            None
        )
        .await
        .is_empty(),
        "pre-approved service left pending authority plans"
    );

    service_task.abort_and_wait().await;
}

#[tokio::test]
async fn authority_plan_presented_update_is_pending_at_connect() {
    assert_case_registered(
        "authority-plan.presented-update-is-pending-at-connect",
        "authority-plan",
        "authority_plan",
    );

    let (runtime, bootstrap_url, mut admin) = start_runtime().await;
    let base_contract = service_contract("base");
    let additive_contract = service_contract("additive");
    approve_base(
        &mut admin,
        &bootstrap_url,
        &base_contract,
        STRICT_DEPLOYMENT,
        false,
    )
    .await;
    let service_key = provision_instance_only(&mut admin, &bootstrap_url, STRICT_DEPLOYMENT).await;

    let mut connect_handle = spawn_service_connect(
        runtime.trellis_url(),
        "authority-plan-additive-service",
        SERVICE_CONTRACT_ID,
        additive_contract.clone(),
        service_key.seed,
    );
    expect_connect_pending(&mut connect_handle).await;

    let plan = wait_for_plan(
        &mut admin,
        &bootstrap_url,
        STRICT_DEPLOYMENT,
        "pending",
        "update",
        additive_contract.digest(),
    )
    .await;
    assert_eq!(plan.classification, "update");

    connect_handle.abort();
    let _ = connect_handle.await;
}

#[tokio::test]
async fn authority_plan_presented_update_approved_then_connects() {
    assert_case_registered(
        "authority-plan.presented-update-approved-then-connects",
        "authority-plan",
        "authority_plan",
    );

    let (runtime, bootstrap_url, mut admin) = start_runtime().await;
    let base_contract = service_contract("base");
    let additive_contract = service_contract("additive");
    approve_base(
        &mut admin,
        &bootstrap_url,
        &base_contract,
        STRICT_DEPLOYMENT,
        false,
    )
    .await;
    let service_key = provision_instance_only(&mut admin, &bootstrap_url, STRICT_DEPLOYMENT).await;

    let mut connect_handle = spawn_service_connect(
        runtime.trellis_url(),
        "authority-plan-additive-service",
        SERVICE_CONTRACT_ID,
        additive_contract.clone(),
        service_key.seed,
    );
    let plan = wait_for_plan(
        &mut admin,
        &bootstrap_url,
        STRICT_DEPLOYMENT,
        "pending",
        "update",
        additive_contract.digest(),
    )
    .await;
    accept_plan(&mut admin, &bootstrap_url, &plan).await;
    admin
        .wait_ready(&bootstrap_url, STRICT_DEPLOYMENT)
        .await
        .expect("deployment authority ready after accepting update");

    let mut service = connect_handle
        .await
        .expect("service connect task panicked")
        .expect("service connects after accepted update");
    let accepted = wait_for_plan(
        &mut admin,
        &bootstrap_url,
        STRICT_DEPLOYMENT,
        "accepted",
        "update",
        additive_contract.digest(),
    )
    .await;
    assert_eq!(accepted.plan_id, plan.plan_id);

    service.register_rpc::<AddedPingRpc, _, _>(|_context, input| async move {
        Ok(AddedPingOutput {
            message: input.message,
            variant: "additive".to_string(),
            added: true,
        })
    });
    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));

    let client = admin
        .connect_client(&bootstrap_url, &additive_client_contract())
        .await
        .expect("connect additive client");
    let output = client
        .call::<AddedPingRpc>(&PingInput {
            message: "approved".to_string(),
        })
        .await
        .expect("call added ping");
    assert_eq!(
        output,
        AddedPingOutput {
            message: "approved".to_string(),
            variant: "additive".to_string(),
            added: true,
        }
    );

    service_task.abort_and_wait().await;
}

#[tokio::test]
async fn authority_plan_presented_update_rejected_stays_blocked() {
    assert_case_registered(
        "authority-plan.presented-update-rejected-stays-blocked",
        "authority-plan",
        "authority_plan",
    );

    let (runtime, bootstrap_url, mut admin) = start_runtime().await;
    let base_contract = service_contract("base");
    let additive_contract = service_contract("additive");
    approve_base(
        &mut admin,
        &bootstrap_url,
        &base_contract,
        STRICT_DEPLOYMENT,
        false,
    )
    .await;
    let base_key = provision_instance_only(&mut admin, &bootstrap_url, STRICT_DEPLOYMENT).await;
    let mut base_service = connect_service(
        runtime.trellis_url(),
        "authority-plan-base-service",
        SERVICE_CONTRACT_ID,
        &base_contract,
        &base_key.seed,
    )
    .await;
    base_service.register_rpc::<BasePingRpc, _, _>(|_context, input| async move {
        Ok(PingOutput {
            message: input.message,
            variant: "base".to_string(),
        })
    });
    let base_task = AbortOnDrop::new(tokio::spawn(async move { base_service.run().await }));

    let update_key = provision_instance_only(&mut admin, &bootstrap_url, STRICT_DEPLOYMENT).await;
    let mut connect_handle = spawn_service_connect(
        runtime.trellis_url(),
        "authority-plan-additive-service",
        SERVICE_CONTRACT_ID,
        additive_contract.clone(),
        update_key.seed,
    );
    let plan = wait_for_plan(
        &mut admin,
        &bootstrap_url,
        STRICT_DEPLOYMENT,
        "pending",
        "update",
        additive_contract.digest(),
    )
    .await;
    let rejected = reject_plan(&mut admin, &bootstrap_url, &plan, "integration rejection").await;
    assert_eq!(
        rejected.decision_reason.as_deref(),
        Some("integration rejection")
    );
    expect_connect_pending(&mut connect_handle).await;

    let client = admin
        .connect_client(&bootstrap_url, &base_client_contract())
        .await
        .expect("connect base client");
    let output = call_base_ping_with_retry(&client, "after-reject").await;
    assert_eq!(output.variant, "base");

    connect_handle.abort();
    let _ = connect_handle.await;
    base_task.abort_and_wait().await;
}

#[tokio::test]
async fn authority_plan_incompatible_migration_approved_replaces_contract() {
    assert_case_registered(
        "authority-plan.incompatible-migration-approved-replaces-contract",
        "authority-plan",
        "authority_plan",
    );

    let (runtime, bootstrap_url, mut admin) = start_runtime().await;
    let base_contract = service_contract("base");
    let incompatible_contract = service_contract("incompatible");
    approve_base(
        &mut admin,
        &bootstrap_url,
        &base_contract,
        STRICT_DEPLOYMENT,
        false,
    )
    .await;
    let base_key = provision_instance_only(&mut admin, &bootstrap_url, STRICT_DEPLOYMENT).await;
    let mut base_service = connect_service(
        runtime.trellis_url(),
        "authority-plan-base-service",
        SERVICE_CONTRACT_ID,
        &base_contract,
        &base_key.seed,
    )
    .await;
    base_service.register_rpc::<BasePingRpc, _, _>(|_context, input| async move {
        Ok(PingOutput {
            message: input.message,
            variant: "base".to_string(),
        })
    });
    let base_task = AbortOnDrop::new(tokio::spawn(async move { base_service.run().await }));
    let client = admin
        .connect_client(&bootstrap_url, &base_client_contract())
        .await
        .expect("connect base client");
    assert_eq!(
        call_base_ping_with_retry(&client, "before").await.variant,
        "base"
    );
    base_task.abort_and_wait().await;

    let replacement_key =
        provision_instance_only(&mut admin, &bootstrap_url, STRICT_DEPLOYMENT).await;
    let mut connect_handle = spawn_service_connect(
        runtime.trellis_url(),
        "authority-plan-replacement-service",
        SERVICE_CONTRACT_ID,
        incompatible_contract.clone(),
        replacement_key.seed,
    );
    let plan = wait_for_plan(
        &mut admin,
        &bootstrap_url,
        STRICT_DEPLOYMENT,
        "pending",
        "migration",
        incompatible_contract.digest(),
    )
    .await;
    accept_plan(&mut admin, &bootstrap_url, &plan).await;
    admin
        .wait_ready(&bootstrap_url, STRICT_DEPLOYMENT)
        .await
        .expect("deployment authority ready after accepting migration");
    let mut replacement = connect_handle
        .await
        .expect("replacement connect task panicked")
        .expect("replacement connects after migration approval");
    replacement.register_rpc::<IncompatiblePingRpc, _, _>(|_context, input| async move {
        Ok(IncompatiblePingOutput {
            count: input.count,
            variant: "incompatible".to_string(),
        })
    });
    let replacement_task = AbortOnDrop::new(tokio::spawn(async move { replacement.run().await }));
    let replacement_client = admin
        .connect_client(&bootstrap_url, &incompatible_client_contract())
        .await
        .expect("connect incompatible client");
    let output = replacement_client
        .call::<IncompatiblePingRpc>(&IncompatiblePingInput { count: 7 })
        .await
        .expect("call incompatible ping");
    assert_eq!(output.variant, "incompatible");
    assert_eq!(output.count, 7);

    replacement_task.abort_and_wait().await;
}

#[tokio::test]
async fn authority_plan_incompatible_migration_rejected_keeps_old_contract() {
    assert_case_registered(
        "authority-plan.incompatible-migration-rejected-keeps-old-contract",
        "authority-plan",
        "authority_plan",
    );

    let (runtime, bootstrap_url, mut admin) = start_runtime().await;
    let base_contract = service_contract("base");
    let incompatible_contract = service_contract("incompatible");
    approve_base(
        &mut admin,
        &bootstrap_url,
        &base_contract,
        STRICT_DEPLOYMENT,
        false,
    )
    .await;
    let base_key = provision_instance_only(&mut admin, &bootstrap_url, STRICT_DEPLOYMENT).await;
    let mut base_service = connect_service(
        runtime.trellis_url(),
        "authority-plan-base-service",
        SERVICE_CONTRACT_ID,
        &base_contract,
        &base_key.seed,
    )
    .await;
    base_service.register_rpc::<BasePingRpc, _, _>(|_context, input| async move {
        Ok(PingOutput {
            message: input.message,
            variant: "base".to_string(),
        })
    });
    let base_task = AbortOnDrop::new(tokio::spawn(async move { base_service.run().await }));

    let replacement_key =
        provision_instance_only(&mut admin, &bootstrap_url, STRICT_DEPLOYMENT).await;
    let mut connect_handle = spawn_service_connect(
        runtime.trellis_url(),
        "authority-plan-replacement-service",
        SERVICE_CONTRACT_ID,
        incompatible_contract.clone(),
        replacement_key.seed,
    );
    let plan = wait_for_plan(
        &mut admin,
        &bootstrap_url,
        STRICT_DEPLOYMENT,
        "pending",
        "migration",
        incompatible_contract.digest(),
    )
    .await;
    reject_plan(&mut admin, &bootstrap_url, &plan, "migration rejected").await;
    expect_connect_pending(&mut connect_handle).await;

    let client = admin
        .connect_client(&bootstrap_url, &base_client_contract())
        .await
        .expect("connect base client");
    assert_eq!(
        call_base_ping_with_retry(&client, "still-base")
            .await
            .variant,
        "base"
    );

    connect_handle.abort();
    let _ = connect_handle.await;
    base_task.abort_and_wait().await;
}

#[tokio::test]
async fn authority_plan_compatible_replacement_auto_allowed_strict() {
    assert_case_registered(
        "authority-plan.compatible-replacement-auto-allowed-strict",
        "authority-plan",
        "authority_plan",
    );

    let (runtime, bootstrap_url, mut admin) = start_runtime().await;
    let base_contract = service_contract("base");
    let metadata_contract = service_contract("metadata");
    approve_base(
        &mut admin,
        &bootstrap_url,
        &base_contract,
        STRICT_DEPLOYMENT,
        false,
    )
    .await;
    let service_key = provision_instance_only(&mut admin, &bootstrap_url, STRICT_DEPLOYMENT).await;
    let mut service = connect_service(
        runtime.trellis_url(),
        "authority-plan-metadata-service",
        SERVICE_CONTRACT_ID,
        &metadata_contract,
        &service_key.seed,
    )
    .await;
    service.register_rpc::<BasePingRpc, _, _>(|_context, input| async move {
        Ok(PingOutput {
            message: input.message,
            variant: "metadata".to_string(),
        })
    });
    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));
    let client = admin
        .connect_client(&bootstrap_url, &base_client_contract())
        .await
        .expect("connect base client");
    assert_eq!(
        call_base_ping_with_retry(&client, "metadata").await.variant,
        "metadata"
    );
    assert!(
        list_plans(
            &mut admin,
            &bootstrap_url,
            STRICT_DEPLOYMENT,
            Some("pending"),
            None
        )
        .await
        .is_empty(),
        "compatible metadata replacement left a pending plan"
    );
    service_task.abort_and_wait().await;
}

#[tokio::test]
async fn authority_plan_mutable_dev_auto_accepts_incompatible_migration() {
    assert_case_registered(
        "authority-plan.mutable-dev-auto-accepts-incompatible-migration",
        "authority-plan",
        "authority_plan",
    );

    let (runtime, bootstrap_url, mut admin) = start_runtime().await;
    let base_contract = service_contract("base");
    let incompatible_contract = service_contract("incompatible");
    approve_base(
        &mut admin,
        &bootstrap_url,
        &base_contract,
        MUTABLE_DEPLOYMENT,
        true,
    )
    .await;
    let base_key = provision_instance_only(&mut admin, &bootstrap_url, MUTABLE_DEPLOYMENT).await;
    let mut base_service = connect_service(
        runtime.trellis_url(),
        "authority-plan-mutable-base-service",
        SERVICE_CONTRACT_ID,
        &base_contract,
        &base_key.seed,
    )
    .await;
    base_service.register_rpc::<BasePingRpc, _, _>(|_context, input| async move {
        Ok(PingOutput {
            message: input.message,
            variant: "base".to_string(),
        })
    });
    let base_task = AbortOnDrop::new(tokio::spawn(async move { base_service.run().await }));
    let base_client = admin
        .connect_client(&bootstrap_url, &base_client_contract())
        .await
        .expect("connect mutable base client");
    assert_eq!(
        call_base_ping_with_retry(&base_client, "mutable-before")
            .await
            .variant,
        "base"
    );
    base_task.abort_and_wait().await;

    let replacement_key =
        provision_instance_only(&mut admin, &bootstrap_url, MUTABLE_DEPLOYMENT).await;
    let mut service = connect_service(
        runtime.trellis_url(),
        "authority-plan-mutable-replacement-service",
        SERVICE_CONTRACT_ID,
        &incompatible_contract,
        &replacement_key.seed,
    )
    .await;
    let accepted = wait_for_plan(
        &mut admin,
        &bootstrap_url,
        MUTABLE_DEPLOYMENT,
        "accepted",
        "migration",
        incompatible_contract.digest(),
    )
    .await;
    assert_eq!(accepted.classification, "migration");
    service.register_rpc::<IncompatiblePingRpc, _, _>(|_context, input| async move {
        Ok(IncompatiblePingOutput {
            count: input.count,
            variant: "mutable-incompatible".to_string(),
        })
    });
    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));
    let client = admin
        .connect_client(&bootstrap_url, &incompatible_client_contract())
        .await
        .expect("connect incompatible client");
    assert_eq!(
        client
            .call::<IncompatiblePingRpc>(&IncompatiblePingInput { count: 3 })
            .await
            .expect("call mutable incompatible ping")
            .variant,
        "mutable-incompatible"
    );
    service_task.abort_and_wait().await;
}

#[tokio::test]
async fn authority_plan_mutable_dev_rejected_explicit_update_still_blocks() {
    assert_case_registered(
        "authority-plan.mutable-dev-rejected-explicit-update-still-blocks",
        "authority-plan",
        "authority_plan",
    );

    let (runtime, bootstrap_url, mut admin) = start_runtime().await;
    let base_contract = service_contract("base");
    let additive_contract = service_contract("additive");
    approve_base(
        &mut admin,
        &bootstrap_url,
        &base_contract,
        MUTABLE_DEPLOYMENT,
        true,
    )
    .await;
    let service_key = provision_instance_only(&mut admin, &bootstrap_url, MUTABLE_DEPLOYMENT).await;
    let mut connect_handle = spawn_service_connect(
        runtime.trellis_url(),
        "authority-plan-mutable-additive-service",
        SERVICE_CONTRACT_ID,
        additive_contract.clone(),
        service_key.seed,
    );
    let plan = wait_for_plan(
        &mut admin,
        &bootstrap_url,
        MUTABLE_DEPLOYMENT,
        "pending",
        "update",
        additive_contract.digest(),
    )
    .await;
    reject_plan(&mut admin, &bootstrap_url, &plan, "mutable update rejected").await;
    wait_for_plan(
        &mut admin,
        &bootstrap_url,
        MUTABLE_DEPLOYMENT,
        "rejected",
        "update",
        additive_contract.digest(),
    )
    .await;
    expect_connect_pending(&mut connect_handle).await;
    connect_handle.abort();
    let _ = connect_handle.await;
}

#[tokio::test]
async fn authority_plan_resource_change_migration_approved_and_bound() {
    assert_case_registered(
        "authority-plan.resource-change-migration-approved-and-bound",
        "authority-plan",
        "authority_plan",
    );

    let (runtime, bootstrap_url, mut admin) = start_runtime().await;
    let base_contract = resource_service_contract(1);
    let changed_contract = resource_service_contract(2);
    approve_base(
        &mut admin,
        &bootstrap_url,
        &base_contract,
        STRICT_DEPLOYMENT,
        false,
    )
    .await;
    let service_key = provision_instance_only(&mut admin, &bootstrap_url, STRICT_DEPLOYMENT).await;
    let mut connect_handle = spawn_service_connect(
        runtime.trellis_url(),
        "authority-plan-resource-service",
        RESOURCE_SERVICE_CONTRACT_ID,
        changed_contract.clone(),
        service_key.seed,
    );
    let plan = wait_for_plan(
        &mut admin,
        &bootstrap_url,
        STRICT_DEPLOYMENT,
        "pending",
        "migration",
        changed_contract.digest(),
    )
    .await;
    accept_plan(&mut admin, &bootstrap_url, &plan).await;
    admin
        .wait_ready(&bootstrap_url, STRICT_DEPLOYMENT)
        .await
        .expect("deployment authority ready after resource migration");
    let mut service = connect_handle
        .await
        .expect("resource service connect task panicked")
        .expect("resource service connects after migration approval");
    assert_eq!(service.resources().kv["records"].history, 2);
    service.register_rpc::<ResourcePingRpc, _, _>(|context, input| async move {
        let kv = context.handle().kv_client("records").await?;
        let record = ResourceRecord {
            message: input.message.clone(),
        };
        kv.put(
            &input.key,
            bytes::Bytes::from(
                serde_json::to_vec(&record).map_err(trellis_rs::service::ServerError::Json)?,
            ),
        )
        .await?;
        let stored = kv
            .get(&input.key)
            .await?
            .expect("resource migration KV record exists");
        let stored: ResourceRecord =
            serde_json::from_slice(&stored).map_err(trellis_rs::service::ServerError::Json)?;
        Ok(ResourcePingOutput {
            key: input.key,
            message: stored.message,
            history: 2,
        })
    });
    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));
    let client = admin
        .connect_client(&bootstrap_url, &resource_client_contract())
        .await
        .expect("connect resource client");
    let output = client
        .call::<ResourcePingRpc>(&ResourcePingInput {
            key: "authority-plan-resource-key".to_string(),
            message: "resource-bound".to_string(),
        })
        .await
        .expect("call resource ping");
    assert_eq!(output.history, 2);
    assert_eq!(output.message, "resource-bound");
    service_task.abort_and_wait().await;
}

async fn start_runtime() -> (
    trellis_test::TrellisTestRuntime,
    String,
    trellis_test::TrellisTestAdmin,
) {
    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();
    admin
        .connect_admin(&bootstrap_url)
        .await
        .expect("connect admin client");
    (runtime, bootstrap_url, admin)
}

async fn approve_base(
    admin: &mut trellis_test::TrellisTestAdmin,
    bootstrap_url: &str,
    contract: &trellis_test::TrellisTestContract,
    deployment: &str,
    mutable_dev: bool,
) {
    admin
        .create_deployment(bootstrap_url, Some(deployment), Some(mutable_dev))
        .await
        .expect("create deployment");
    admin
        .approve_contract(bootstrap_url, contract, Some(deployment), &[])
        .await
        .expect("approve base contract");
}

async fn provision_instance_only(
    admin: &mut trellis_test::TrellisTestAdmin,
    bootstrap_url: &str,
    deployment: &str,
) -> trellis_test::TrellisTestServiceKey {
    let seed = trellis_rs::auth::generate_session_keypair().0;
    let auth_material = trellis_rs::client::SessionAuth::from_seed_base64url(&seed)
        .expect("build session auth from seed");
    let admin_client = admin
        .connect_admin(bootstrap_url)
        .await
        .expect("get admin client");
    let auth = trellis_rs::sdk::auth::AuthClient::new(admin_client);
    auth.rpc()
        .auth()
        .service_instances_provision(&AuthServiceInstancesProvisionRequest {
            deployment_id: deployment.to_string(),
            instance_key: auth_material.session_key.clone(),
        })
        .await
        .expect("provision service instance key");
    trellis_test::TrellisTestServiceKey {
        seed,
        session_key: auth_material.session_key,
    }
}

fn spawn_service_connect(
    trellis_url: &str,
    name: &str,
    contract_id: &str,
    contract: trellis_test::TrellisTestContract,
    seed: String,
) -> JoinHandle<
    Result<
        ConnectedServiceRuntime<AuthorityPlanContract>,
        trellis_rs::service::ServiceRuntimeError,
    >,
> {
    let trellis_url = trellis_url.to_string();
    let name = name.to_string();
    let contract_id = contract_id.to_string();
    let contract_digest = contract.digest().to_string();
    let contract_json = serde_json::to_string(contract.manifest()).expect("serialize contract");
    tokio::spawn(async move {
        let client =
            TrellisClient::connect_service_with_contract(ServiceConnectWithContractOptions {
                trellis_url: &trellis_url,
                contract_id: &contract_id,
                contract_digest: &contract_digest,
                contract_json: &contract_json,
                session_key_seed_base64url: &seed,
                timeout_ms: trellis_rs::service::DEFAULT_TIMEOUT_MS,
                retry_delay_ms: trellis_rs::service::DEFAULT_RETRY_DELAY_MS,
                authority_pending_timeout_ms:
                    trellis_rs::service::DEFAULT_AUTHORITY_PENDING_TIMEOUT_MS,
            })
            .await?;
        ConnectedServiceRuntime::<AuthorityPlanContract>::from_connected_client(
            name,
            Arc::new(client),
        )
    })
}

async fn connect_service(
    trellis_url: &str,
    name: &str,
    contract_id: &str,
    contract: &trellis_test::TrellisTestContract,
    seed: &str,
) -> ConnectedServiceRuntime<AuthorityPlanContract> {
    spawn_service_connect(
        trellis_url,
        name,
        contract_id,
        contract.clone(),
        seed.to_string(),
    )
    .await
    .expect("service connect task panicked")
    .expect("connect service")
}

async fn expect_connect_pending(
    handle: &mut JoinHandle<
        Result<
            ConnectedServiceRuntime<AuthorityPlanContract>,
            trellis_rs::service::ServiceRuntimeError,
        >,
    >,
) {
    match tokio::time::timeout(Duration::from_millis(750), handle).await {
        Err(_) => {}
        Ok(Ok(Ok(_))) => panic!("service connected while authority plan should block it"),
        Ok(Ok(Err(error))) => panic!("service connect failed while expected pending: {error}"),
        Ok(Err(error)) => panic!("service connect task panicked while expected pending: {error}"),
    }
}

async fn list_plans(
    admin: &mut trellis_test::TrellisTestAdmin,
    bootstrap_url: &str,
    deployment: &str,
    state: Option<&str>,
    classification: Option<&str>,
) -> Vec<AuthorityPlanEntry> {
    let client = admin
        .connect_admin(bootstrap_url)
        .await
        .expect("get admin client");
    let auth = trellis_rs::sdk::auth::AuthClient::new(client);
    auth.rpc()
        .auth()
        .deployment_authority_plans_list(&AuthDeploymentAuthorityPlansListRequest {
            deployment_id: Some(deployment.to_string()),
            state: state.map(ToOwned::to_owned),
            classification: classification.map(ToOwned::to_owned),
            kind: None,
            limit: 50,
            offset: None,
        })
        .await
        .expect("list authority plans")
        .entries
        .into_iter()
        .map(parse_plan_entry)
        .collect()
}

async fn wait_for_plan(
    admin: &mut trellis_test::TrellisTestAdmin,
    bootstrap_url: &str,
    deployment: &str,
    state: &str,
    classification: &str,
    digest: &str,
) -> AuthorityPlanEntry {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if let Some(plan) = list_plans(
            admin,
            bootstrap_url,
            deployment,
            Some(state),
            Some(classification),
        )
        .await
        .into_iter()
        .find(|plan| plan.contract_digest == digest)
        {
            return plan;
        }
        if Instant::now() >= deadline {
            panic!(
                "timed out waiting for {state} {classification} authority plan for digest {digest}"
            );
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn accept_plan(
    admin: &mut trellis_test::TrellisTestAdmin,
    bootstrap_url: &str,
    plan: &AuthorityPlanEntry,
) {
    let client = admin
        .connect_admin(bootstrap_url)
        .await
        .expect("get admin client");
    let auth = trellis_rs::sdk::auth::AuthClient::new(client);
    if plan.classification == "update" {
        auth.rpc()
            .auth()
            .deployment_authority_accept_update(&AuthDeploymentAuthorityAcceptUpdateRequest {
                plan_id: plan.plan_id.clone(),
                expected_desired_version: None,
            })
            .await
            .expect("accept update plan");
    } else {
        auth.rpc()
            .auth()
            .deployment_authority_accept_migration(&AuthDeploymentAuthorityAcceptMigrationRequest {
                plan_id: plan.plan_id.clone(),
                expected_desired_version: None,
                acknowledgement: "Accepted by Rust authority-plan integration test.".to_string(),
            })
            .await
            .expect("accept migration plan");
    }
    admin
        .reconcile(bootstrap_url, &plan.deployment_id)
        .await
        .expect("reconcile deployment authority");
}

async fn reject_plan(
    admin: &mut trellis_test::TrellisTestAdmin,
    bootstrap_url: &str,
    plan: &AuthorityPlanEntry,
    reason: &str,
) -> AuthorityPlanEntry {
    let client = admin
        .connect_admin(bootstrap_url)
        .await
        .expect("get admin client");
    let auth = trellis_rs::sdk::auth::AuthClient::new(client);
    let rejected = auth
        .rpc()
        .auth()
        .deployment_authority_reject(&AuthDeploymentAuthorityRejectRequest {
            plan_id: plan.plan_id.clone(),
            reason: Some(reason.to_string()),
        })
        .await
        .expect("reject authority plan");
    assert!(
        rejected.success,
        "authority plan reject did not report success"
    );
    wait_for_plan(
        admin,
        bootstrap_url,
        &plan.deployment_id,
        "rejected",
        &plan.classification,
        &plan.contract_digest,
    )
    .await
}

fn parse_plan_entry(value: Value) -> AuthorityPlanEntry {
    let proposal = value
        .get("proposal")
        .and_then(Value::as_object)
        .expect("authority plan proposal object");
    AuthorityPlanEntry {
        plan_id: value
            .get("planId")
            .and_then(Value::as_str)
            .expect("planId")
            .to_string(),
        deployment_id: value
            .get("deploymentId")
            .and_then(Value::as_str)
            .expect("deploymentId")
            .to_string(),
        classification: value
            .get("classification")
            .and_then(Value::as_str)
            .expect("classification")
            .to_string(),
        state: value
            .get("state")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        decision_reason: value
            .get("decisionReason")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        contract_digest: proposal
            .get("contractDigest")
            .and_then(Value::as_str)
            .expect("proposal.contractDigest")
            .to_string(),
    }
}

async fn call_base_ping_with_retry(client: &TrellisClient, message: &str) -> PingOutput {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match client
            .call::<BasePingRpc>(&PingInput {
                message: message.to_string(),
            })
            .await
        {
            Ok(output) => return output,
            Err(error)
                if is_retryable_service_startup_error(&error) && Instant::now() < deadline =>
            {
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            Err(error) => panic!("call live Plan.Ping RPC: {error}"),
        }
    }
}

fn is_retryable_service_startup_error(error: &TrellisClientError) -> bool {
    match error {
        TrellisClientError::NatsRequest(message) => {
            message.contains("no responders") || message.contains("NoResponders")
        }
        TrellisClientError::Timeout => true,
        _ => false,
    }
}

fn service_contract(variant: &str) -> trellis_test::TrellisTestContract {
    let (display_name, description, schemas, rpc) = match variant {
        "base" => (
            "Authority Plan Service",
            "Base authority-plan service contract.",
            base_schemas(),
            json!({
                "Plan.Ping": rpc_shape(BasePingRpc::SUBJECT, "PingInput", "PingOutput", &["ping"]),
            }),
        ),
        "metadata" => (
            "Authority Plan Service Metadata Refresh",
            "Metadata-only authority-plan service contract refresh.",
            base_schemas(),
            json!({
                "Plan.Ping": rpc_shape(BasePingRpc::SUBJECT, "PingInput", "PingOutput", &["ping"]),
            }),
        ),
        "additive" => (
            "Authority Plan Service Additive",
            "Additive authority-plan service contract update.",
            base_schemas(),
            json!({
                "Plan.Ping": rpc_shape(BasePingRpc::SUBJECT, "PingInput", "PingOutput", &["ping"]),
                "Plan.AddedPing": rpc_shape(AddedPingRpc::SUBJECT, "PingInput", "AddedPingOutput", &["addedPing"]),
            }),
        ),
        "incompatible" => (
            "Authority Plan Service Incompatible",
            "Incompatible authority-plan service contract migration.",
            incompatible_schemas(),
            json!({
                "Plan.Ping": rpc_shape(BasePingRpc::SUBJECT, "IncompatiblePingInput", "IncompatiblePingOutput", &["ping"]),
            }),
        ),
        other => panic!("unknown authority-plan service contract variant {other}"),
    };
    let mut manifest = Map::new();
    manifest.insert("format".to_string(), json!("trellis.contract.v1"));
    manifest.insert("id".to_string(), json!(SERVICE_CONTRACT_ID));
    manifest.insert("displayName".to_string(), json!(display_name));
    manifest.insert("description".to_string(), json!(description));
    manifest.insert("kind".to_string(), json!("service"));
    manifest.insert(
        "capabilities".to_string(),
        json!({
            "ping": { "displayName": "Ping authority-plan service", "description": "Call authority-plan ping RPC." },
            "addedPing": { "displayName": "Call added ping", "description": "Call the additive authority-plan ping RPC." }
        }),
    );
    manifest.insert("schemas".to_string(), schemas);
    if variant == "additive" {
        manifest.insert(
            "resources".to_string(),
            json!({
                "kv": {
                    "additiveRecords": {
                        "purpose": "Store additive authority-plan update records.",
                        "schema": { "schema": "ResourceRecord" },
                        "required": true,
                        "history": 1,
                        "ttlMs": 0
                    }
                }
            }),
        );
    }
    manifest.insert("rpc".to_string(), rpc);
    trellis_test::TrellisTestContract::from_manifest_value(Value::Object(manifest))
        .expect("build authority-plan service contract")
}

fn resource_service_contract(history: i64) -> trellis_test::TrellisTestContract {
    trellis_test::TrellisTestContract::from_manifest_value(json!({
        "format": "trellis.contract.v1",
        "id": RESOURCE_SERVICE_CONTRACT_ID,
        "displayName": if history == 1 { "Authority Plan Resource Service" } else { "Authority Plan Resource Service Changed" },
        "description": "Resource authority-plan service contract.",
        "kind": "service",
        "schemas": resource_schemas(),
        "resources": {
            "kv": {
                "records": {
                    "purpose": "Store authority-plan resource records.",
                    "schema": { "schema": "ResourceRecord" },
                    "required": true,
                    "history": history,
                    "ttlMs": 0
                }
            }
        },
        "rpc": {
            "Plan.ResourcePing": rpc_shape(ResourcePingRpc::SUBJECT, "ResourcePingInput", "ResourcePingOutput", &[]),
        }
    }))
    .expect("build authority-plan resource service contract")
}

fn base_schemas() -> Value {
    let mut schemas = match resource_schemas() {
        Value::Object(map) => map,
        _ => unreachable!(),
    };
    schemas.insert(
        "PingInput".to_string(),
        json!({"type":"object","required":["message"],"properties":{"message":{"type":"string"}}}),
    );
    schemas.insert(
        "PingOutput".to_string(),
        json!({"type":"object","required":["message","variant"],"properties":{"message":{"type":"string"},"variant":{"type":"string"}}}),
    );
    schemas.insert(
        "AddedPingOutput".to_string(),
        json!({"type":"object","required":["message","variant","added"],"properties":{"message":{"type":"string"},"variant":{"type":"string"},"added":{"type":"boolean"}}}),
    );
    Value::Object(schemas)
}

fn incompatible_schemas() -> Value {
    json!({
        "IncompatiblePingInput": {"type":"object","required":["count"],"properties":{"count":{"type":"integer"}}},
        "IncompatiblePingOutput": {"type":"object","required":["count","variant"],"properties":{"count":{"type":"integer"},"variant":{"type":"string"}}}
    })
}

fn resource_schemas() -> Value {
    json!({
        "ResourcePingInput": {"type":"object","required":["key","message"],"properties":{"key":{"type":"string"},"message":{"type":"string"}}},
        "ResourcePingOutput": {"type":"object","required":["key","message","history"],"properties":{"key":{"type":"string"},"message":{"type":"string"},"history":{"type":"integer"}}},
        "ResourceRecord": {"type":"object","required":["message"],"properties":{"message":{"type":"string"}}}
    })
}

fn rpc_shape(subject: &str, input: &str, output: &str, capabilities: &[&str]) -> Value {
    json!({
        "version": "v1",
        "subject": subject,
        "input": { "schema": input },
        "output": { "schema": output },
        "capabilities": { "call": capabilities },
        "errors": []
    })
}

fn base_client_contract() -> trellis_test::TrellisTestContract {
    client_contract(
        "trellis.integration.authority-plan.base-client@v1",
        SERVICE_CONTRACT_ID,
        &["Plan.Ping"],
    )
}

fn additive_client_contract() -> trellis_test::TrellisTestContract {
    client_contract(
        "trellis.integration.authority-plan.additive-client@v1",
        SERVICE_CONTRACT_ID,
        &["Plan.Ping", "Plan.AddedPing"],
    )
}

fn incompatible_client_contract() -> trellis_test::TrellisTestContract {
    client_contract(
        "trellis.integration.authority-plan.incompatible-client@v1",
        SERVICE_CONTRACT_ID,
        &["Plan.Ping"],
    )
}

fn resource_client_contract() -> trellis_test::TrellisTestContract {
    client_contract(
        "trellis.integration.authority-plan.resource-client@v1",
        RESOURCE_SERVICE_CONTRACT_ID,
        &["Plan.ResourcePing"],
    )
}

fn client_contract(
    id: &str,
    service_contract_id: &str,
    rpc_calls: &[&str],
) -> trellis_test::TrellisTestContract {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        id,
        "Authority Plan Client",
        "App/client participant for the authority-plan integration fixture.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "planService",
        trellis_rs::contracts::use_contract(service_contract_id)
            .with_rpc_call(rpc_calls.iter().copied()),
    )
    .build()
    .expect("build authority-plan client contract manifest");
    trellis_test::TrellisTestContract::from_manifest_value(
        serde_json::to_value(manifest).expect("serialize client contract manifest"),
    )
    .expect("build authority-plan client contract")
}

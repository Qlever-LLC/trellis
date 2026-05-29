use miette::{miette, IntoDiagnostic, Result};
use serde_json::Value;
use trellis::sdk::auth::client::AuthClient as SdkAuthClient;
use trellis::sdk::auth::types::{
    AuthDeploymentAuthorityAcceptMigrationRequest, AuthDeploymentAuthorityAcceptUpdateRequest,
    AuthDeploymentAuthorityPlanRequest, AuthDeploymentAuthorityReconcileRequest,
};

use crate::rpc::contract_json_object;

pub(crate) async fn plan_deployment_authority(
    auth_client: &SdkAuthClient<'_>,
    deployment_id: &str,
    contract_json: &str,
    contract_digest: &str,
) -> Result<Value> {
    Ok(auth_client
        .rpc()
        .auth()
        .deployment_authority_plan(&AuthDeploymentAuthorityPlanRequest {
            contract: contract_json_object(contract_json)?,
            deployment_id: deployment_id.to_string(),
            expected_digest: contract_digest.to_string(),
        })
        .await
        .into_diagnostic()?
        .plan)
}

pub(crate) async fn accept_deployment_authority_plan(
    auth_client: &SdkAuthClient<'_>,
    plan: &Value,
    reason: &str,
) -> Result<()> {
    let plan_id = plan_string(plan, "planId")?;
    let deployment_id = plan_string(plan, "deploymentId")?;
    let classification = plan_string(plan, "classification")?;
    match classification.as_str() {
        "update" => {
            auth_client
                .rpc()
                .auth()
                .deployment_authority_accept_update(&AuthDeploymentAuthorityAcceptUpdateRequest {
                    plan_id,
                    expected_desired_version: None,
                })
                .await
                .into_diagnostic()?;
        }
        "migration" => {
            auth_client
                .rpc()
                .auth()
                .deployment_authority_accept_migration(
                    &AuthDeploymentAuthorityAcceptMigrationRequest {
                        plan_id,
                        expected_desired_version: None,
                        acknowledgement: reason.to_string(),
                    },
                )
                .await
                .into_diagnostic()?;
        }
        other => {
            return Err(miette!(
                "unknown deployment authority plan classification `{other}`"
            ))
        }
    }
    auth_client
        .rpc()
        .auth()
        .deployment_authority_reconcile(&AuthDeploymentAuthorityReconcileRequest {
            deployment_id,
            desired_version: None,
        })
        .await
        .into_diagnostic()?;
    Ok(())
}

pub(crate) async fn plan_accept_reconcile_deployment_authority(
    auth_client: &SdkAuthClient<'_>,
    deployment_id: &str,
    contract_json: &str,
    contract_digest: &str,
    reason: &str,
) -> Result<Value> {
    let plan =
        plan_deployment_authority(auth_client, deployment_id, contract_json, contract_digest)
            .await?;
    accept_deployment_authority_plan(auth_client, &plan, reason).await?;
    Ok(plan)
}

pub(crate) fn plan_string(plan: &Value, key: &str) -> Result<String> {
    plan.get(key)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .ok_or_else(|| miette!("deployment authority plan missing string field `{key}`"))
}

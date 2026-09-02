use serde_json::json;

use super::fixtures::{digest, profile_for, NOW};
use crate::platform::auth::application::repository::{
    AccountCreation, AccountRepository, DeploymentProfileCreation, DeploymentProfileMutation,
    DeploymentRepository, IdempotentOutcome, OutboxRepository, UserAccountMutation,
};
use crate::platform::auth::{
    AuthorizationStateError, DeploymentProfileRecord, DeploymentProfileState,
    IdempotencyResultRecord, LocalCredentialRecord, PostCommitActionKind, PostCommitActionRecord,
    PrincipalKind, PrincipalRecord, PrincipalState, ProviderIdentityLink, SqliteAuthorizationStore,
    UserProfileRecord,
};

pub(super) async fn exercise_accounts(
    store: SqliteAuthorizationStore,
) -> Result<(), Box<dyn std::error::Error>> {
    let proof = |byte: u8, purpose: &str| IdempotencyResultRecord {
        scope_key: digest(byte),
        purpose: purpose.to_owned(),
        signer_id: "signer_companion".to_owned(),
        request_id: format!("request_{byte}"),
        request_digest: digest(byte + 1),
        result: json!({ "request": byte }),
        created_at: NOW,
        expires_at: NOW + 1_000,
    };
    let action = |byte: u8, event: &str| PostCommitActionRecord {
        predecessor_action_id: None,
        action_id: digest(byte),
        kind: PostCommitActionKind::Event,
        payload: json!({ "event": event }),
        created_at: NOW,
        attempts: 0,
        next_attempt_at: NOW,
        claimed_until: None,
        last_error: None,
    };
    let deployment_principal = PrincipalRecord {
        principal_id: "dep_profile".to_owned(),
        kind: PrincipalKind::Service,
        state: PrincipalState::Active,
        created_at: NOW,
        updated_at: NOW,
        version: 1,
        disabled_at: None,
        revoked_at: None,
    };
    let mut deployment_profile = DeploymentProfileRecord {
        deployment_id: deployment_principal.principal_id.clone(),
        kind: PrincipalKind::Service,
        display_name: "Profile Service".to_owned(),
        participant_id: None,
        portal_id: None,
        requires_device_delegation: false,
        review_mode: None,
        expires_at: None,
        state: DeploymentProfileState::Active,
        created_at: NOW,
        updated_at: NOW,
        version: 1,
    };
    assert!(matches!(
        store
            .create_deployment_profile(DeploymentProfileCreation {
                principal: deployment_principal,
                profile: deployment_profile.clone(),
                idempotency: proof(90, "deployment.create"),
                actions: Vec::new(),
            })
            .await?,
        IdempotentOutcome::Applied(_)
    ));
    assert_eq!(
        store.list_deployment_profiles().await?,
        vec![deployment_profile.clone()]
    );
    deployment_profile.state = DeploymentProfileState::Disabled;
    deployment_profile.updated_at += 1;
    deployment_profile.version += 1;
    store
        .put_deployment_profile(DeploymentProfileMutation {
            profile: deployment_profile.clone(),
            expected_version: 1,
            idempotency: proof(92, "deployment.disable"),
            actions: Vec::new(),
        })
        .await?;
    assert_eq!(
        store
            .get_deployment_profile("dep_profile")
            .await?
            .map(|value| value.state),
        Some(DeploymentProfileState::Disabled)
    );
    let user = PrincipalRecord {
        principal_id: "usr_companion".to_owned(),
        kind: PrincipalKind::User,
        state: PrincipalState::Active,
        created_at: NOW,
        updated_at: NOW,
        version: 1,
        disabled_at: None,
        revoked_at: None,
    };
    let profile = UserProfileRecord {
        principal_id: user.principal_id.clone(),
        display_name: Some("Companion User".to_owned()),
        email: Some("user@example.com".to_owned()),
        image_url: None,
        created_at: NOW,
        updated_at: NOW,
        version: 1,
    };
    let credential = LocalCredentialRecord {
        principal_id: user.principal_id.clone(),
        normalized_username: "companion".to_owned(),
        password_hash: "argon2id-hash".to_owned(),
        hash_profile: 1,
        failed_attempts: 0,
        locked_until: None,
        password_changed_at: NOW,
        updated_at: NOW,
        version: 1,
    };
    let identity = ProviderIdentityLink {
        provider: "local".to_owned(),
        provider_subject: "companion".to_owned(),
        principal_id: user.principal_id.clone(),
        linked_at: NOW,
        last_seen_at: NOW,
    };
    let account_action = action(20, "account.created");
    let account_creation = AccountCreation {
        principal: user.clone(),
        profile: profile.clone(),
        credential: Some(credential.clone()),
        identity: Some(identity.clone()),
        idempotency: proof(20, "account.create"),
        actions: vec![account_action.clone()],
    };
    assert_eq!(
        store.create_user_account(account_creation.clone()).await?,
        IdempotentOutcome::Applied(profile.clone())
    );
    let mut replayed_account = account_creation.clone();
    replayed_account.profile.version = 99;
    replayed_account.actions[0].payload = json!({ "different": true });
    assert_eq!(
        store.create_user_account(replayed_account).await?,
        IdempotentOutcome::Replayed(account_creation.idempotency.result.clone())
    );
    let mut mismatched_account = account_creation.clone();
    mismatched_account.idempotency.request_digest = digest(99);
    assert_eq!(
        store.create_user_account(mismatched_account).await,
        Err(AuthorizationStateError::StorageConflict)
    );
    assert_eq!(
        store.get_user_profile(&user.principal_id).await?,
        Some(profile.clone())
    );
    assert_eq!(
        store.get_local_credential(&user.principal_id).await?,
        Some(credential.clone())
    );
    assert_eq!(
        store
            .get_provider_identity(&identity.provider, &identity.provider_subject)
            .await?,
        Some(identity)
    );

    let mut conflicting_user = user.clone();
    conflicting_user.principal_id = "usr_rolled_back".to_owned();
    let mut conflicting_profile = profile_for(&conflicting_user.principal_id);
    conflicting_profile.display_name = Some("Rolled Back".to_owned());
    let mut conflicting_credential = credential.clone();
    conflicting_credential.principal_id = conflicting_user.principal_id.clone();
    conflicting_credential.normalized_username = "rolled-back".to_owned();
    let conflicting_identity = ProviderIdentityLink {
        provider: "local".to_owned(),
        provider_subject: "rolled-back".to_owned(),
        principal_id: conflicting_user.principal_id.clone(),
        linked_at: NOW,
        last_seen_at: NOW,
    };
    let account_rollback_proof = proof(22, "account.create");
    assert_eq!(
        store
            .create_user_account(AccountCreation {
                principal: conflicting_user.clone(),
                profile: conflicting_profile,
                credential: Some(conflicting_credential),
                identity: Some(conflicting_identity),
                idempotency: account_rollback_proof.clone(),
                actions: vec![PostCommitActionRecord {
                    payload: json!({ "different": true }),
                    ..account_action.clone()
                }],
            })
            .await,
        Err(AuthorizationStateError::StorageConflict)
    );
    assert_eq!(
        store.get_principal(&conflicting_user.principal_id).await?,
        None
    );
    assert!(store
        .get_idempotency_result(
            &account_rollback_proof.purpose,
            &account_rollback_proof.signer_id,
            &account_rollback_proof.request_id,
        )
        .await?
        .is_none());

    let managed_user = PrincipalRecord {
        principal_id: "usr_account_a".to_owned(),
        ..user.clone()
    };
    let managed_profile = UserProfileRecord {
        principal_id: managed_user.principal_id.clone(),
        display_name: None,
        email: None,
        image_url: None,
        created_at: NOW,
        updated_at: NOW,
        version: 1,
    };
    assert_eq!(
        store
            .create_user_account(AccountCreation {
                principal: managed_user.clone(),
                profile: managed_profile.clone(),
                credential: None,
                identity: None,
                idempotency: proof(100, "account.create-managed"),
                actions: Vec::new(),
            })
            .await?,
        IdempotentOutcome::Applied(managed_profile.clone())
    );
    assert_eq!(
        store.get_user_account(&managed_user.principal_id).await?,
        Some((managed_user.clone(), managed_profile.clone()))
    );
    assert_eq!(
        store
            .get_local_credential(&managed_user.principal_id)
            .await?,
        None
    );
    let managed_user_b = PrincipalRecord {
        principal_id: "usr_account_b".to_owned(),
        ..user.clone()
    };
    let managed_profile_b = UserProfileRecord {
        principal_id: managed_user_b.principal_id.clone(),
        ..managed_profile.clone()
    };
    store
        .create_user_account(AccountCreation {
            principal: managed_user_b.clone(),
            profile: managed_profile_b.clone(),
            credential: None,
            identity: None,
            idempotency: proof(102, "account.create-managed"),
            actions: Vec::new(),
        })
        .await?;
    assert_eq!(
        store.list_user_accounts(None, 2).await?,
        vec![
            (managed_user.clone(), managed_profile.clone()),
            (managed_user_b.clone(), managed_profile_b.clone()),
        ]
    );
    assert_eq!(
        store
            .list_user_accounts(Some(&managed_user.principal_id), 2)
            .await?,
        vec![
            (managed_user_b, managed_profile_b),
            (user.clone(), profile.clone()),
        ]
    );

    let account_update_action = action(100, "account.updated");
    let mut disabled_user = managed_user.clone();
    disabled_user.state = PrincipalState::Disabled;
    disabled_user.updated_at = NOW + 5;
    disabled_user.version = 2;
    let mut updated_profile = managed_profile.clone();
    updated_profile.email = Some("managed@example.com".to_owned());
    updated_profile.updated_at = NOW + 5;
    updated_profile.version = 2;
    let account_update = UserAccountMutation {
        principal: disabled_user,
        profile: updated_profile,
        expected_version: 1,
        allow_admin_target: true,
        idempotency: proof(104, "account.update"),
        actions: vec![account_update_action.clone()],
    };
    let (mut disabled_user, updated_profile) =
        match store.update_user_account(account_update.clone()).await? {
            IdempotentOutcome::Applied(account) => account,
            IdempotentOutcome::Replayed(_) => unreachable!(),
        };
    assert_eq!(disabled_user.disabled_at, Some(NOW + 5));
    let persisted_disabled_account = (disabled_user.clone(), updated_profile.clone());
    let mut malformed_replay = account_update.clone();
    malformed_replay.principal.version = 99;
    malformed_replay.actions[0].payload = json!({ "different": true });
    assert_eq!(
        store.update_user_account(malformed_replay).await?,
        IdempotentOutcome::Replayed(account_update.idempotency.result.clone())
    );

    disabled_user.state = PrincipalState::Active;
    disabled_user.updated_at = NOW + 6;
    disabled_user.version = 3;
    let mut rollback_profile = updated_profile.clone();
    rollback_profile.display_name = Some("Should Roll Back".to_owned());
    rollback_profile.updated_at = NOW + 6;
    rollback_profile.version = 3;
    let account_update_rollback_proof = proof(106, "account.update");
    assert_eq!(
        store
            .update_user_account(UserAccountMutation {
                principal: disabled_user,
                profile: rollback_profile,
                expected_version: 2,
                allow_admin_target: true,
                idempotency: account_update_rollback_proof.clone(),
                actions: vec![PostCommitActionRecord {
                    payload: json!({ "different": true }),
                    ..account_update_action
                }],
            })
            .await,
        Err(AuthorizationStateError::StorageConflict)
    );
    assert_eq!(
        store.get_user_account(&managed_user.principal_id).await?,
        Some(persisted_disabled_account)
    );
    assert!(store
        .get_idempotency_result(
            &account_update_rollback_proof.purpose,
            &account_update_rollback_proof.signer_id,
            &account_update_rollback_proof.request_id,
        )
        .await?
        .is_none());
    Ok(())
}

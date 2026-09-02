use serde_json::json;
use trellis_protocol::ParticipantKind;

use super::fixtures::{digest, participant_fixture_for, profile_for, session_public_key, NOW};
use crate::platform::auth::application::repository::{
    AccountFlowCreation, AccountRepository, FirstAdminCompletion, IdempotentOutcome,
    IdentityLinkCompletion, OutboxRepository, PasswordChange, PasswordResetCompletion,
    ProviderIdentityUnlink, SessionCreation, SessionRepository,
};
use crate::platform::auth::{
    AccountFlowKind, AccountFlowRecord, AccountFlowState, AuthService, AuthServiceConfig,
    AuthorityDecision, AuthorityRepository, AuthorityState, AuthorizationStateError,
    DesiredAuthorityRecord, FirstAdminAuthorityTarget, FirstAdminRegistration,
    IdempotencyResultRecord, IdentityAuthorityRecord, LocalCredentialRecord, NewSession,
    PostCommitActionKind, PostCommitActionRecord, PrincipalKind, PrincipalRecord, PrincipalState,
    ProviderIdentityLink, SessionRecord, SessionState, SqliteAuthorizationStore,
};

pub(super) async fn exercise_account_flows(
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
    let user = store
        .get_principal("usr_companion")
        .await?
        .ok_or("companion user missing")?;
    let credential = store
        .get_local_credential(&user.principal_id)
        .await?
        .ok_or("companion credential missing")?;

    let app_fixture = participant_fixture_for(ParticipantKind::App, "example.admin")?;
    store
        .put_participant_binding(app_fixture.binding.clone())
        .await?;
    let old_first_admin = AccountFlowRecord {
        flow_id: "flow_first_admin_old".to_owned(),
        kind: AccountFlowKind::AdminAccount,
        token_hash: digest(30),
        target_principal_id: None,
        target_provider_id: None,
        return_location: None,
        payload: json!({}),
        state: AccountFlowState::Pending,
        created_at: NOW,
        expires_at: NOW + 100,
        consumed_at: None,
        version: 1,
    };
    assert_eq!(
        store
            .replace_admin_account_flow(old_first_admin.clone(), NOW, false)
            .await?,
        Some(old_first_admin.clone())
    );
    let mut duplicate_first_admin = old_first_admin.clone();
    duplicate_first_admin.flow_id = "flow_first_admin".to_owned();
    duplicate_first_admin.token_hash = digest(31);
    assert_eq!(
        store
            .replace_admin_account_flow(duplicate_first_admin, NOW + 1, false)
            .await?
            .ok_or("pending first-admin flow missing")?,
        old_first_admin
    );
    let first_admin_flow = old_first_admin.clone();
    let admin = PrincipalRecord {
        principal_id: "usr_first_admin".to_owned(),
        kind: PrincipalKind::User,
        state: PrincipalState::Active,
        created_at: NOW + 1,
        updated_at: NOW + 1,
        version: 1,
        disabled_at: None,
        revoked_at: None,
    };
    let admin_profile = profile_for(&admin.principal_id);
    let admin_identity = ProviderIdentityLink {
        provider: "oidc-admin".to_owned(),
        provider_subject: "subject-first-admin".to_owned(),
        principal_id: admin.principal_id.clone(),
        linked_at: NOW + 1,
        last_seen_at: NOW + 1,
    };
    let admin_authority = IdentityAuthorityRecord {
        authority_id: "authority_first_admin".to_owned(),
        principal_id: admin.principal_id.clone(),
        participant_id: app_fixture.binding.participant_id.clone(),
        participant_artifact_digest: app_fixture.binding.artifact_digest.clone(),
        accepted_needs_digest: app_fixture.binding.needs_digest.clone(),
        desired_grant_set: app_fixture.required_grants.clone(),
        desired_capabilities: vec!["example.manage".to_owned()],
        state: AuthorityState::Accepted,
        version: 1,
        created_at: NOW + 1,
        updated_at: NOW + 1,
        expires_at: None,
        decision: Some(AuthorityDecision {
            decided_at: NOW + 1,
            decided_by: "bootstrap".to_owned(),
            reason: None,
        }),
    };
    let first_admin_action = action(60, "first-admin.created");
    let first_admin_proof = proof(40, "first-admin.complete");
    assert!(matches!(
        store
            .complete_first_admin(FirstAdminCompletion {
                token_hash: first_admin_flow.token_hash.clone(),
                expected_flow_version: 1,
                principal: admin.clone(),
                profile: admin_profile,
                credential: None,
                identity: admin_identity,
                authority: admin_authority,
                consumed_at: NOW + 2,
                idempotency: first_admin_proof.clone(),
                actions: vec![first_admin_action.clone()],
            })
            .await?,
        IdempotentOutcome::Applied(_)
    ));
    let mut blocked_flow = first_admin_flow.clone();
    blocked_flow.flow_id = "flow_first_admin_blocked".to_owned();
    blocked_flow.token_hash = digest(32);
    assert_eq!(
        store
            .replace_admin_account_flow(blocked_flow, NOW + 2, false)
            .await?,
        None
    );

    let replacement_password_flow = AccountFlowRecord {
        flow_id: "flow_initial_password".to_owned(),
        kind: AccountFlowKind::PasswordReset,
        token_hash: digest(247),
        target_principal_id: Some(admin.principal_id.clone()),
        target_provider_id: None,
        return_location: None,
        payload: json!({}),
        state: AccountFlowState::Pending,
        created_at: NOW,
        expires_at: NOW + 100,
        consumed_at: None,
        version: 1,
    };
    store
        .create_account_flow(AccountFlowCreation {
            flow: replacement_password_flow.clone(),
            idempotency: proof(249, "account-flow.create"),
            actions: Vec::new(),
        })
        .await?;
    let initial_credential = LocalCredentialRecord {
        principal_id: admin.principal_id.clone(),
        normalized_username: "first-admin-local".to_owned(),
        password_hash: "initial-password-hash".to_owned(),
        hash_profile: 1,
        failed_attempts: 0,
        locked_until: None,
        password_changed_at: NOW + 3,
        updated_at: NOW + 3,
        version: 1,
    };
    let initial_identity = ProviderIdentityLink {
        provider: "local".to_owned(),
        provider_subject: initial_credential.normalized_username.clone(),
        principal_id: admin.principal_id.clone(),
        linked_at: NOW + 3,
        last_seen_at: NOW + 3,
    };
    assert!(matches!(
        store
            .complete_password_reset(PasswordResetCompletion {
                token_hash: replacement_password_flow.token_hash,
                expected_flow_version: 1,
                flow_kind: AccountFlowKind::PasswordReset,
                requester_principal_id: None,
                admin_target: false,
                expected_credential_version: None,
                replacement: initial_credential.clone(),
                identity: Some(initial_identity.clone()),
                authority: None,
                profile: None,
                expected_authority_version: None,
                consumed_at: NOW + 3,
                idempotency: proof(250, "password-reset.complete"),
                actions: Vec::new(),
            })
            .await?,
        IdempotentOutcome::Applied(_)
    ));
    assert_eq!(
        store.get_local_credential(&admin.principal_id).await?,
        Some(initial_credential)
    );
    assert_eq!(
        store
            .get_provider_identity("local", "first-admin-local")
            .await?,
        Some(initial_identity)
    );

    let service = AuthService::new(store.clone(), AuthServiceConfig::default())?;
    let authority_target = FirstAdminAuthorityTarget {
        participant_id: app_fixture.binding.participant_id.clone(),
        participant_artifact_digest: app_fixture.binding.artifact_digest.clone(),
        participant_needs_digest: app_fixture.binding.needs_digest.clone(),
    };
    let reset = service
        .rotate_admin_account_flow("https://auth.example/base", &authority_target, NOW + 4)
        .await?
        .expect("admin reset flow");
    let reset_url = url::Url::parse(reset.bootstrap_url.as_deref().expect("admin reset URL"))?;
    let reset_token = reset_url
        .query_pairs()
        .find_map(|(key, value)| (key == "adminAccountToken").then(|| value.into_owned()))
        .expect("admin reset token");
    service
        .complete_first_admin(FirstAdminRegistration {
            token: reset_token,
            expected_flow_version: 1,
            username: "renamed-admin".to_owned(),
            password: "replacement password".to_owned(),
            display_name: Some("Renamed Administrator".to_owned()),
            email: Some("renamed@example.test".to_owned()),
            image_url: None,
            participant_id: authority_target.participant_id.clone(),
            participant_artifact_digest: authority_target.participant_artifact_digest.clone(),
            participant_needs_digest: authority_target.participant_needs_digest.clone(),
            grant_set: app_fixture.required_grants.clone(),
            capabilities: vec![
                "trellis.auth::admin".to_owned(),
                "trellis.auth::capabilities.delegate".to_owned(),
            ],
            authority_expires_at: None,
            completed_at: NOW + 5,
            idempotency: proof(251, "admin-account.complete"),
            actions: Vec::new(),
        })
        .await?;
    assert!(matches!(
        service
            .authenticate_local("renamed-admin", "replacement password", NOW + 6)
            .await?,
        crate::platform::auth::LocalAuthentication::Authenticated { principal }
            if principal.principal_id == admin.principal_id
    ));
    assert_eq!(
        service
            .authenticate_local("first-admin-local", "initial-password-hash", NOW + 6)
            .await?,
        crate::platform::auth::LocalAuthentication::Denied
    );
    let updated_profile = store
        .get_user_profile(&admin.principal_id)
        .await?
        .expect("updated administrator profile");
    assert_eq!(
        updated_profile.display_name.as_deref(),
        Some("Renamed Administrator")
    );
    assert_eq!(
        updated_profile.email.as_deref(),
        Some("renamed@example.test")
    );

    let password_flow = AccountFlowRecord {
        flow_id: "flow_password".to_owned(),
        kind: AccountFlowKind::PasswordReset,
        token_hash: digest(33),
        target_principal_id: Some(user.principal_id.clone()),
        target_provider_id: None,
        return_location: Some("/account".to_owned()),
        payload: json!({ "immutable": true }),
        state: AccountFlowState::Pending,
        created_at: NOW,
        expires_at: NOW + 100,
        consumed_at: None,
        version: 1,
    };
    store
        .create_account_flow(AccountFlowCreation {
            flow: password_flow.clone(),
            idempotency: proof(34, "account-flow.create"),
            actions: Vec::new(),
        })
        .await?;
    let replacement = LocalCredentialRecord {
        password_hash: "replacement-hash".to_owned(),
        password_changed_at: NOW + 3,
        updated_at: NOW + 3,
        version: 2,
        ..credential.clone()
    };
    let password_proof = proof(42, "password-reset.complete");
    let password_action = action(61, "password.changed");
    let mut password_kick = action(98, "sessions.kick");
    password_kick.kind = PostCommitActionKind::Kick;
    let mut conflicting_action = first_admin_action.clone();
    conflicting_action.payload = json!({ "different": true });
    assert_eq!(
        store
            .complete_password_reset(PasswordResetCompletion {
                token_hash: password_flow.token_hash.clone(),
                expected_flow_version: 1,
                flow_kind: AccountFlowKind::PasswordReset,
                requester_principal_id: None,
                admin_target: false,
                expected_credential_version: Some(1),
                replacement: replacement.clone(),
                identity: None,
                authority: None,
                profile: None,
                expected_authority_version: None,
                consumed_at: NOW + 3,
                idempotency: password_proof.clone(),
                actions: vec![conflicting_action, password_kick.clone()],
            })
            .await,
        Err(AuthorizationStateError::StorageConflict)
    );
    assert_eq!(
        store.get_local_credential(&user.principal_id).await?,
        Some(credential.clone())
    );
    assert_eq!(
        store
            .get_account_flow_by_hash(&password_flow.token_hash)
            .await?
            .ok_or("password flow missing")?
            .state,
        AccountFlowState::Pending
    );
    assert!(store
        .get_idempotency_result(
            &password_proof.purpose,
            &password_proof.signer_id,
            &password_proof.request_id,
        )
        .await?
        .is_none());
    let password_command = PasswordResetCompletion {
        token_hash: password_flow.token_hash.clone(),
        expected_flow_version: 1,
        flow_kind: AccountFlowKind::PasswordReset,
        requester_principal_id: None,
        admin_target: false,
        expected_credential_version: Some(1),
        replacement: replacement.clone(),
        identity: None,
        authority: None,
        profile: None,
        expected_authority_version: None,
        consumed_at: NOW + 3,
        idempotency: password_proof.clone(),
        actions: vec![password_action.clone(), password_kick],
    };
    assert!(matches!(
        store
            .complete_password_reset(password_command.clone())
            .await?,
        IdempotentOutcome::Applied(_)
    ));
    assert_eq!(
        store
            .get_local_credential_by_username(&credential.normalized_username)
            .await?,
        Some(replacement.clone())
    );
    let mut replay_command = password_command;
    replay_command.replacement.version = 99;
    replay_command.actions = vec![PostCommitActionRecord {
        payload: json!({ "different": true }),
        ..password_action.clone()
    }];
    assert_eq!(
        store.complete_password_reset(replay_command).await?,
        IdempotentOutcome::Replayed(password_proof.result.clone())
    );
    assert_eq!(
        store.get_local_credential(&user.principal_id).await?,
        Some(replacement)
    );
    let mut mismatched_proof = password_proof.clone();
    mismatched_proof.request_digest = digest(99);
    let mut mismatch_command = PasswordResetCompletion {
        token_hash: password_flow.token_hash,
        expected_flow_version: 2,
        flow_kind: AccountFlowKind::PasswordReset,
        requester_principal_id: None,
        admin_target: false,
        expected_credential_version: Some(2),
        replacement: credential.clone(),
        identity: None,
        authority: None,
        profile: None,
        expected_authority_version: None,
        consumed_at: NOW + 4,
        idempotency: mismatched_proof,
        actions: Vec::new(),
    };
    mismatch_command.replacement.version = 3;
    assert_eq!(
        store.complete_password_reset(mismatch_command).await,
        Err(AuthorizationStateError::StorageConflict)
    );

    let identity_flow = AccountFlowRecord {
        flow_id: "flow_identity".to_owned(),
        kind: AccountFlowKind::IdentityLink,
        token_hash: digest(34),
        target_principal_id: Some(user.principal_id.clone()),
        target_provider_id: Some("github".to_owned()),
        return_location: None,
        payload: json!({}),
        state: AccountFlowState::Pending,
        created_at: NOW,
        expires_at: NOW + 100,
        consumed_at: None,
        version: 1,
    };
    store
        .create_account_flow(AccountFlowCreation {
            flow: identity_flow.clone(),
            idempotency: proof(36, "account-flow.create"),
            actions: Vec::new(),
        })
        .await?;
    let linked_identity = ProviderIdentityLink {
        provider: "github".to_owned(),
        provider_subject: "companion-gh".to_owned(),
        principal_id: user.principal_id.clone(),
        linked_at: NOW + 4,
        last_seen_at: NOW + 4,
    };
    assert!(matches!(
        store
            .complete_identity_link(IdentityLinkCompletion {
                token_hash: identity_flow.token_hash,
                expected_flow_version: 1,
                identity: linked_identity.clone(),
                credential: None,
                consumed_at: NOW + 4,
                idempotency: proof(44, "identity-link.complete"),
                actions: Vec::new(),
            })
            .await?,
        IdempotentOutcome::Applied(_)
    ));
    assert_eq!(
        store
            .get_provider_identity(&linked_identity.provider, &linked_identity.provider_subject)
            .await?,
        Some(linked_identity)
    );
    assert_eq!(
        store
            .list_provider_identities(&user.principal_id)
            .await?
            .len(),
        2
    );
    let mut unlink_idempotency = proof(45, "identity.unlink");
    unlink_idempotency.result = json!({ "unlinked": true });
    assert_eq!(
        store
            .unlink_provider_identity(ProviderIdentityUnlink {
                provider: "github".to_owned(),
                provider_subject: "companion-gh".to_owned(),
                principal_id: user.principal_id.clone(),
                idempotency: unlink_idempotency.clone(),
                actions: Vec::new(),
            })
            .await?,
        IdempotentOutcome::Applied(true)
    );
    assert_eq!(
        store
            .unlink_provider_identity(ProviderIdentityUnlink {
                provider: "github".to_owned(),
                provider_subject: "companion-gh".to_owned(),
                principal_id: user.principal_id.clone(),
                idempotency: unlink_idempotency,
                actions: Vec::new(),
            })
            .await?,
        IdempotentOutcome::Replayed(json!({ "unlinked": true }))
    );

    let user_fixture = participant_fixture_for(ParticipantKind::App, "example.user")?;
    store
        .put_participant_binding(user_fixture.binding.clone())
        .await?;
    let authority = IdentityAuthorityRecord {
        authority_id: "ida_password_change".to_owned(),
        principal_id: user.principal_id.clone(),
        participant_id: user_fixture.binding.participant_id.clone(),
        participant_artifact_digest: user_fixture.binding.artifact_digest.clone(),
        accepted_needs_digest: user_fixture.binding.needs_digest.clone(),
        desired_grant_set: user_fixture.required_grants.clone(),
        desired_capabilities: Vec::new(),
        state: AuthorityState::Accepted,
        version: 1,
        created_at: NOW,
        updated_at: NOW,
        expires_at: None,
        decision: Some(AuthorityDecision {
            decided_at: NOW,
            decided_by: "admin".to_owned(),
            reason: None,
        }),
    };
    let current_session = SessionRecord::from_new(NewSession {
        session_id: "ses_password_current".to_owned(),
        principal_id: user.principal_id.clone(),
        principal_kind: PrincipalKind::User,
        participant_id: user_fixture.binding.participant_id.clone(),
        participant_kind: ParticipantKind::App,
        participant_artifact_digest: user_fixture.binding.artifact_digest.clone(),
        participant_needs_digest: user_fixture.binding.needs_digest.clone(),
        session_public_key: session_public_key(61),
        inbox_prefix: "_INBOX.password.current".to_owned(),
        created_at: NOW,
        expires_at: Some(NOW + 1_000),
    })?;
    let sibling_session = SessionRecord::from_new(NewSession {
        session_id: "ses_password_sibling".to_owned(),
        session_public_key: session_public_key(62),
        inbox_prefix: "_INBOX.password.sibling".to_owned(),
        ..NewSession {
            session_id: current_session.session_id.clone(),
            principal_id: current_session.principal_id.clone(),
            principal_kind: current_session.principal_kind,
            participant_id: current_session.participant_id.clone(),
            participant_kind: current_session.participant_kind,
            participant_artifact_digest: current_session.participant_artifact_digest.clone(),
            participant_needs_digest: current_session.participant_needs_digest.clone(),
            session_public_key: current_session.session_public_key.clone(),
            inbox_prefix: current_session.inbox_prefix.clone(),
            created_at: current_session.created_at,
            expires_at: current_session.expires_at,
        }
    })?;
    store
        .create_session(SessionCreation {
            session: current_session.clone(),
            previous_session: None,
            desired_authority: Some(DesiredAuthorityRecord::Identity(authority)),
            runtime_binding: None,
            idempotency: proof(201, "password.session.current"),
            actions: Vec::new(),
        })
        .await
        .map_err(|error| format!("create current password session: {error}"))?;
    store
        .create_session(SessionCreation {
            session: sibling_session.clone(),
            previous_session: None,
            desired_authority: None,
            runtime_binding: None,
            idempotency: proof(202, "password.session.sibling"),
            actions: Vec::new(),
        })
        .await
        .map_err(|error| format!("create sibling password session: {error}"))?;
    let credential = store
        .get_local_credential(&user.principal_id)
        .await?
        .ok_or("local credential missing")?;
    let replacement = LocalCredentialRecord {
        version: credential.version + 1,
        password_changed_at: NOW + 6,
        updated_at: NOW + 6,
        ..credential.clone()
    };
    assert_eq!(
        store
            .change_password(PasswordChange {
                principal_id: user.principal_id.clone(),
                current_session_id: current_session.session_id.clone(),
                credential: replacement,
                expected_version: credential.version,
                changed_at: NOW + 6,
                idempotency: proof(203, "password.change"),
                actions: Vec::new(),
            })
            .await
            .map_err(|error| format!("change password: {error}"))?,
        IdempotentOutcome::Applied(1)
    );
    assert_eq!(
        store
            .get_session(&sibling_session.session_id)
            .await?
            .map(|session| session.state),
        Some(SessionState::Revoked)
    );
    Ok(())
}

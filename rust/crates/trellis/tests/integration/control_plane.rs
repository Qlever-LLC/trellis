use std::{
    collections::BTreeMap,
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use bytes::Bytes;
use futures_util::{FutureExt, Stream, StreamExt};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::task::JoinHandle;
use trellis_rs::client::{
    EventDescriptor, OutboxDispatchResult, OutboxStore, RpcDescriptor, ServiceConnectOptions,
    ServiceConnectWithContractOptions, TrellisClient,
};
use trellis_rs::sdk::auth::types::{
    AuthConnectionsKickRequest, AuthConnectionsListRequest, AuthDeploymentAuthorityPlanRequest,
    AuthDeploymentsCreateRequest, AuthDeploymentsDisableRequest, AuthDeploymentsEnableRequest,
    AuthDeploymentsListRequest, AuthDeploymentsRemoveRequest, AuthDevicesDisableRequest,
    AuthDevicesEnableRequest, AuthDevicesListRequest, AuthDevicesProvisionRequest,
    AuthDevicesRemoveRequest, AuthServiceInstancesDisableRequest,
    AuthServiceInstancesEnableRequest, AuthServiceInstancesListRequest,
    AuthServiceInstancesProvisionRequest, AuthServiceInstancesRemoveRequest,
    AuthSessionsListRequest, AuthUsersCreateRequest, AuthUsersListRequest,
    AuthUsersPasswordChangeRequest, AuthUsersPasswordResetCreateRequest,
};
use trellis_rs::service::{
    ConnectedServiceRuntime, GeneratedServiceContract, KvResourceClient, StoreResourceClient,
};

use crate::support::assertions::assert_service_case_registered;

const ADMIN_BOOTSTRAP_PROBE_CONTRACT_ID: &str =
    "trellis.integration.control-plane.admin-bootstrap-probe@v1";
const PASSWORD_RESET_CHANGE_CONTRACT_ID: &str =
    "trellis.integration.control-plane.password-reset-change-client@v1";
const HTTP_ROUTE_PROBE_CONTRACT_ID: &str =
    "trellis.integration.control-plane.http-route-security-probe@v1";
const BOOTSTRAP_UNBOUND_CASE_ID: &str = "control-plane.bootstrap-requires-auth-for-unbound-client";
const BOOTSTRAP_UNKNOWN_DIGEST_CASE_ID: &str =
    "control-plane.bootstrap-rejects-unknown-contract-digest";
const BOOTSTRAP_UNKNOWN_DIGEST_CLIENT_ID: &str =
    "trellis.integration.control-plane.bootstrap-unknown-digest-client@v1";
const BOOTSTRAP_NON_CLIENT_CASE_ID: &str = "control-plane.bootstrap-rejects-non-client-contract";
const BOOTSTRAP_NON_CLIENT_APP_ID: &str =
    "trellis.integration.control-plane.bootstrap-non-client-contract-client@v1";
const BOOTSTRAP_NON_CLIENT_SERVICE_ID: &str =
    "trellis.integration.control-plane.bootstrap-non-client-contract-service@v1";
const BOOTSTRAP_NON_CLIENT_DEVICE_ADMIN_ID: &str =
    "trellis.integration.control-plane.bootstrap-non-client-contract-device-admin@v1";
const BOOTSTRAP_NON_CLIENT_DEVICE_ID: &str =
    "trellis.integration.control-plane.bootstrap-non-client-contract-device@v1";
const BOOTSTRAP_EXACT_DIGEST_CASE_ID: &str =
    "control-plane.bootstrap-selects-exact-session-contract-digest";
const BOOTSTRAP_EXACT_DIGEST_CLIENT_ID: &str =
    "trellis.integration.control-plane.bootstrap-exact-digest-client.control-plane-bootstrap-selects-exact-session-contract-digest@v1";
const BOOTSTRAP_INACTIVE_USER_CASE_ID: &str =
    "control-plane.bootstrap-deletes-session-for-inactive-user";
const BOOTSTRAP_INACTIVE_USER_CLIENT_ID: &str =
    "trellis.integration.control-plane.bootstrap-inactive-user-client.control-plane-bootstrap-deletes-session-for-inactive-user@v1";
const BOOTSTRAP_MISSING_USER_CASE_ID: &str =
    "control-plane.bootstrap-deletes-session-for-missing-user-projection";
const BOOTSTRAP_MISSING_USER_CLIENT_ID: &str =
    "trellis.integration.control-plane.bootstrap-missing-user-client.control-plane-bootstrap-deletes-session-for-missing-user-projection@v1";
const BOOTSTRAP_INSUFFICIENT_USER_CASE_ID: &str =
    "control-plane.bootstrap-deletes-session-for-insufficient-user-capabilities";
const BOOTSTRAP_INSUFFICIENT_USER_CLIENT_ID: &str =
    "trellis.integration.control-plane.bootstrap-insufficient-user-client.control-plane-bootstrap-deletes-session-for-insufficient-user-capabilities@v1";
const BOOTSTRAP_STALE_PROOF_CASE_ID: &str =
    "control-plane.bootstrap-reports-server-time-for-stale-proof";
const BOOTSTRAP_STALE_PROOF_CLIENT_ID: &str =
    "trellis.integration.control-plane.bootstrap-stale-proof-client.control-plane-bootstrap-reports-server-time-for-stale-proof@v1";
const BOOTSTRAP_INVALID_SIGNATURE_CASE_ID: &str =
    "control-plane.bootstrap-rejects-invalid-signature";
const BOOTSTRAP_INVALID_SIGNATURE_CLIENT_ID: &str =
    "trellis.integration.control-plane.bootstrap-invalid-signature-client.control-plane-bootstrap-rejects-invalid-signature@v1";
const BOOTSTRAP_KNOWN_INACTIVE_CASE_ID: &str =
    "control-plane.bootstrap-allows-known-inactive-app-digest";
const BOOTSTRAP_KNOWN_INACTIVE_CLIENT_ID: &str =
    "trellis.integration.control-plane.bootstrap-known-inactive-client.control-plane-bootstrap-allows-known-inactive-app-digest@v1";
const SESSION_LOGOUT_DELETE_CASE_ID: &str =
    "control-plane.session-logout-deletes-session-and-denies-reuse";
const SESSION_LOGOUT_KICK_CASE_ID: &str = "control-plane.session-logout-kicks-runtime-access";
const SESSION_LOGOUT_PROVIDER_CASE_ID: &str =
    "control-plane.session-logout-uses-provider-logout-redirect";
const SESSION_LOGOUT_RETURN_TO_CASE_ID: &str = "control-plane.session-logout-validates-return-to";
const SESSIONS_RESTART_CASE_ID: &str = "control-plane.sessions-survive-control-plane-restart";
const SESSIONS_RESTART_CLIENT_ID: &str =
    "trellis.integration.control-plane.sessions-survive-control-plane-restart.client@v1";
const STATE_RESTART_CASE_ID: &str = "control-plane.state-persists-across-control-plane-restart";
const STATE_RESTART_CLIENT_ID: &str =
    "trellis.integration.control-plane.state-persists-across-control-plane-restart.client@v1";
const STATE_RESTART_DRAFT_PREFIX: &str = "restart/state-persists-across-control-plane-restart";
const STATE_RESTART_DRAFT_KEY: &str = "state-draft";
const RESOURCES_RESTART_CASE_ID: &str = "control-plane.resources-survive-control-plane-restart";
const RESOURCES_RESTART_SERVICE_ID: &str =
    "trellis.integration.control-plane.resources-restart-service@v1";
const RESOURCES_RESTART_SERVICE_NAME: &str = "resources-restart-service";
const RESOURCES_RESTART_KV_KEY: &str = "restart.resources.kv";
const RESOURCES_RESTART_STORE_KEY: &str = "restart/resources/store";
const OUTBOX_RESTART_CASE_ID: &str = "control-plane.outbox-dispatches-after-control-plane-restart";
const OUTBOX_RESTART_SERVICE_ID: &str =
    "trellis.integration.control-plane.outbox-restart-service@v1";
const OUTBOX_RESTART_CLIENT_ID: &str = "trellis.integration.control-plane.outbox-restart-client@v1";
const OUTBOX_RESTART_SERVICE_NAME: &str = "outbox-restart-service";
const OUTBOX_RESTART_RPC_SUBJECT: &str =
    "rpc.v1.integration.control-plane.outbox-restart.Documents.Queue";
const OUTBOX_RESTART_EVENT_SUBJECT: &str =
    "events.v1.integration.control-plane.outbox-restart.Document.Queued";
const CATALOG_RESTART_CASE_ID: &str = "control-plane.catalog-active-contracts-survive-restart";
const CATALOG_RESTART_SERVICE_ID: &str =
    "trellis.integration.control-plane.catalog-active-contracts-survive-restart.service@v1";
const CATALOG_RESTART_CLIENT_ID: &str =
    "trellis.integration.control-plane.catalog-active-contracts-survive-restart.client@v1";
const CATALOG_RESTART_RPC_SUBJECT: &str =
    "rpc.v1.integration.control-plane.catalog-active-contracts-survive-restart.CatalogRestart.Ping";
const CATALOG_RESTART_CAPABILITY: &str =
    "trellis.integration.control-plane.catalog-active-contracts-survive-restart::ping";
const CATALOG_DEPENDENCY_CASE_ID: &str =
    "control-plane.catalog-dependency-issue-resolved-by-provider";
const CATALOG_DEPENDENCY_PROVIDER_ID: &str =
    "trellis.integration.control-plane.catalog-dependency-provider@v1";
const CATALOG_DEPENDENCY_CLIENT_ID: &str =
    "trellis.integration.control-plane.catalog-dependency-client@v1";
const CATALOG_DEPENDENCY_RPC_SUBJECT: &str =
    "rpc.v1.integration.control-plane.catalog-dependency-provider.CatalogDependency.Ping";
const CATALOG_DEPENDENCY_CAPABILITY: &str =
    "trellis.integration.control-plane.catalog-dependency-provider::ping";
const CATALOG_DEPENDENCY_PROVIDER_NAME: &str = "catalog-dependency-provider";
const CATALOG_DEPENDENCY_SHAPE_DEPLOYMENT: &str = "catalog-dependency-shape-only";
const CATALOG_FORCE_REPLACE_CASE_ID: &str =
    "control-plane.catalog-force-replace-resolves-catalog-issue";
const CATALOG_FORCE_REPLACE_SERVICE_ID: &str =
    "trellis.integration.control-plane.catalog-force-replace-service.control-plane-catalog-force-replace-resolves-catalog-issue@v1";
const CATALOG_FORCE_REPLACE_ADMIN_CLIENT_ID: &str =
    "trellis.integration.control-plane.catalog-force-replace-admin-client.control-plane-catalog-force-replace-resolves-catalog-issue@v1";
const CATALOG_FORCE_REPLACE_RPC_SUBJECT: &str =
    "rpc.v1.integration.control-plane.catalog-force-replace.control-plane-catalog-force-replace-resolves-catalog-issue.CatalogForce.Ping";
const CATALOG_FORCE_REPLACE_BASE_DEPLOYMENT: &str =
    "catalog-force-replace-base-deployment-control-plane-catalog-force-replace-resolves-catalog-issue";
const CATALOG_FORCE_REPLACE_REPLACEMENT_DEPLOYMENT: &str =
    "catalog-force-replace-replacement-deployment-control-plane-catalog-force-replace-resolves-catalog-issue";
const CATALOG_FORCE_REPLACE_BASE_SERVICE_NAME: &str =
    "catalog-force-replace-base-control-plane-catalog-force-replace-resolves-catalog-issue";
const CATALOG_FORCE_REPLACE_REPLACEMENT_SERVICE_NAME: &str =
    "catalog-force-replace-replacement-control-plane-catalog-force-replace-resolves-catalog-issue";
const CATALOG_SURFACE_STATUS_CASE_ID: &str =
    "control-plane.catalog-surface-status-reports-provider-runtime";
const CATALOG_SURFACE_STATUS_PROVIDER_ID: &str =
    "trellis.integration.control-plane.catalog-surface-status-provider.control-plane-catalog-surface-status-reports-provider-runtime@v1";
const CATALOG_SURFACE_STATUS_CLIENT_ID: &str =
    "trellis.integration.control-plane.catalog-surface-status-client.control-plane-catalog-surface-status-reports-provider-runtime@v1";
const CATALOG_SURFACE_STATUS_OBSERVER_ID: &str =
    "trellis.integration.control-plane.catalog-surface-status-observer.control-plane-catalog-surface-status-reports-provider-runtime@v1";
const CATALOG_SURFACE_STATUS_RPC_SUBJECT: &str =
    "rpc.v1.integration.control-plane.catalog-surface-status-provider.control-plane-catalog-surface-status-reports-provider-runtime.CatalogSurfaceStatus.Ping";
const CATALOG_SURFACE_STATUS_CAPABILITY: &str =
    "trellis.integration.control-plane.catalog-surface-status-provider.control-plane-catalog-surface-status-reports-provider-runtime::ping";
const CATALOG_SURFACE_STATUS_PROVIDER_NAME: &str =
    "catalog-surface-status-provider-control-plane-catalog-surface-status-reports-provider-runtime";
const CATALOG_SURFACE_STATUS_OLD_PROVIDER_NAME: &str =
    "catalog-surface-status-old-provider-control-plane-catalog-surface-status-reports-provider-runtime";
const CATALOG_SURFACE_STATUS_SHAPE_DEPLOYMENT: &str =
    "catalog-surface-status-shape-only-control-plane-catalog-surface-status-reports-provider-runtime";
const CATALOG_SURFACE_STATUS_OLD_PROVIDER_DEPLOYMENT: &str =
    "catalog-surface-status-old-provider-control-plane-catalog-surface-status-reports-provider-runtime";
const CATALOG_SURFACE_STATUS_OBSERVER_USERNAME: &str =
    "catalog-surface-status-observer-user-control-plane-catalog-surface-status-reports-provider-runtime";
const CATALOG_SURFACE_STATUS_OBSERVER_PASSWORD: &str =
    "trellis-integration-control-plane-catalog-surface-status-reports-provider-runtime-observer-password-2026";
const ADMIN_SERVICE_DEPLOYMENT_LIFECYCLE_CASE_ID: &str =
    "control-plane.admin-service-deployment-lifecycle";
const ADMIN_SERVICE_DEPLOYMENT_LIFECYCLE_ADMIN_CLIENT_ID: &str =
    "trellis.integration.control-plane.admin-service-deployment-lifecycle-admin@v1";
const ADMIN_SERVICE_DEPLOYMENT_LIFECYCLE_DEPLOYMENT: &str =
    "admin-service-deployment-control-plane-admin-service-deployment-lifecycle";
const ADMIN_SERVICE_DEPLOYMENT_ROLLBACK_CASE_ID: &str =
    "control-plane.admin-service-deployment-rollback-fault";
const ADMIN_SERVICE_DEPLOYMENT_ROLLBACK_ADMIN_CLIENT_ID: &str =
    "trellis.integration.control-plane.admin-service-deployment-rollback-admin.control-plane-admin-service-deployment-rollback-fault@v1";
const ADMIN_SERVICE_DEPLOYMENT_ROLLBACK_DEPLOYMENT: &str =
    "admin-service-rollback-control-plane-admin-service-deployment-rollback-fault";
const ADMIN_DEVICE_DEPLOYMENT_ROLLBACK_CASE_ID: &str =
    "control-plane.admin-device-deployment-rollback-fault";
const ADMIN_DEVICE_DEPLOYMENT_ROLLBACK_ADMIN_CLIENT_ID: &str =
    "trellis.integration.control-plane.admin-device-deployment-rollback-admin.control-plane-admin-device-deployment-rollback-fault@v1";
const ADMIN_DEVICE_DEPLOYMENT_ROLLBACK_DEPLOYMENT: &str =
    "admin-device-rollback-control-plane-admin-device-deployment-rollback-fault";
const ADMIN_DEVICE_DEPLOYMENT_ROLLBACK_PUBLIC_KEY: &str =
    "rollback-device-key-control-plane-admin-device-deployment-rollback-fault";
const ADMIN_DEVICE_DEPLOYMENT_ROLLBACK_ACTIVATION_KEY: &str =
    "rollback-activation-key-control-plane-admin-device-deployment-rollback-fault";
const SERVICE_DEPLOYMENT_VALIDATE_CASE_ID: &str =
    "control-plane.admin-service-deployment-validate-before-persist-kick";
const SERVICE_DEPLOYMENT_VALIDATE_HOOK: &str =
    "auth.admin.serviceDeployments.validateActiveCatalog";
const SERVICE_DEPLOYMENT_REFRESH_HOOK: &str =
    "auth.admin.serviceDeployments.refreshActiveContracts";
const SERVICE_INSTANCE_REFRESH_HOOK: &str = "auth.admin.serviceInstances.refreshActiveContracts";
const DEVICE_DEPLOYMENT_REFRESH_HOOK: &str = "auth.admin.deviceDeployments.refreshActiveContracts";
const DEVICE_INSTANCE_REFRESH_HOOK: &str = "auth.admin.deviceInstances.refreshActiveContracts";
const PASSWORD_RESET_CHANGE_CASE_ID: &str =
    "control-plane.password-reset-change-invalidates-old-password";
const PASSWORD_RESET_CHANGE_USERNAME: &str = "password-reset-admin-rust";
const PASSWORD_RESET_CHANGE_OLD_PASSWORD: &str =
    "trellis-integration-control-plane-password-reset-rust-old-password-2026";
const PASSWORD_RESET_CHANGE_NEW_PASSWORD: &str =
    "trellis-integration-control-plane-password-reset-rust-new-password-2026";
const CATALOG_RESTART_SERVICE_CONTRACT_JSON: &str = r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.integration.control-plane.catalog-active-contracts-survive-restart.service@v1",
  "displayName": "Trellis Control-Plane Catalog Restart Service",
  "description": "Verifies active service contract state remains usable after control-plane restart.",
  "kind": "service",
  "capabilities": {
    "trellis.integration.control-plane.catalog-active-contracts-survive-restart::ping": {
      "displayName": "Call catalog restart ping",
      "description": "Call the restart persistence probe RPC."
    }
  },
  "schemas": {
    "PingInput": {
      "type": "object",
      "required": ["message"],
      "properties": { "message": { "type": "string" } }
    },
    "PingOutput": {
      "type": "object",
      "required": ["message", "generation"],
      "properties": {
        "message": { "type": "string" },
        "generation": { "type": "number" }
      }
    }
  },
  "rpc": {
    "CatalogRestart.Ping": {
      "version": "v1",
      "subject": "rpc.v1.integration.control-plane.catalog-active-contracts-survive-restart.CatalogRestart.Ping",
      "input": { "schema": "PingInput" },
      "output": { "schema": "PingOutput" },
      "capabilities": {
        "call": ["trellis.integration.control-plane.catalog-active-contracts-survive-restart::ping"]
      },
      "errors": []
    }
  }
}"#;
const CATALOG_DEPENDENCY_PROVIDER_CONTRACT_JSON: &str = r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.integration.control-plane.catalog-dependency-provider@v1",
  "displayName": "Trellis Control-Plane Catalog Dependency Provider",
  "description": "Provides an RPC used to prove catalog dependency availability changes when a provider appears.",
  "kind": "service",
  "capabilities": {
    "trellis.integration.control-plane.catalog-dependency-provider::ping": {
      "displayName": "Call catalog dependency ping",
      "description": "Call the dependency-resolution probe RPC."
    }
  },
  "schemas": {
    "PingInput": {
      "type": "object",
      "required": ["message"],
      "properties": { "message": { "type": "string" } }
    },
    "PingOutput": {
      "type": "object",
      "required": ["message", "servedBy"],
      "properties": {
        "message": { "type": "string" },
        "servedBy": { "type": "string" }
      }
    }
  },
  "rpc": {
    "CatalogDependency.Ping": {
      "version": "v1",
      "subject": "rpc.v1.integration.control-plane.catalog-dependency-provider.CatalogDependency.Ping",
      "input": { "schema": "PingInput" },
      "output": { "schema": "PingOutput" },
      "capabilities": {
        "call": ["trellis.integration.control-plane.catalog-dependency-provider::ping"]
      },
      "errors": []
    }
  }
}"#;
const CATALOG_FORCE_REPLACE_BASE_CONTRACT_JSON: &str = r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.integration.control-plane.catalog-force-replace-service.control-plane-catalog-force-replace-resolves-catalog-issue@v1",
  "displayName": "Trellis Control-Plane Catalog Force Replace Service",
  "description": "Provides the base contract digest for catalog force-replace integration coverage.",
  "kind": "service",
  "schemas": {
    "PingInput": {
      "type": "object",
      "required": ["message"],
      "properties": { "message": { "type": "string" } }
    },
    "PingOutput": {
      "type": "object",
      "required": ["message", "variant"],
      "properties": {
        "message": { "type": "string" },
        "variant": { "const": "base" }
      }
    }
  },
  "rpc": {
    "CatalogForce.Ping": {
      "version": "v1",
      "subject": "rpc.v1.integration.control-plane.catalog-force-replace.control-plane-catalog-force-replace-resolves-catalog-issue.CatalogForce.Ping",
      "input": { "schema": "PingInput" },
      "output": { "schema": "PingOutput" },
      "errors": []
    }
  }
}"#;
const CATALOG_FORCE_REPLACE_REPLACEMENT_CONTRACT_JSON: &str = r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.integration.control-plane.catalog-force-replace-service.control-plane-catalog-force-replace-resolves-catalog-issue@v1",
  "displayName": "Trellis Control-Plane Catalog Force Replace Service",
  "description": "Provides an incompatible replacement digest for catalog force-replace integration coverage.",
  "kind": "service",
  "schemas": {
    "PingInput": {
      "type": "object",
      "required": ["count"],
      "properties": { "count": { "type": "number" } }
    },
    "PingOutput": {
      "type": "object",
      "required": ["count", "variant"],
      "properties": {
        "count": { "type": "number" },
        "variant": { "const": "replacement" }
      }
    }
  },
  "rpc": {
    "CatalogForce.Ping": {
      "version": "v1",
      "subject": "rpc.v1.integration.control-plane.catalog-force-replace.control-plane-catalog-force-replace-resolves-catalog-issue.CatalogForce.Ping",
      "input": { "schema": "PingInput" },
      "output": { "schema": "PingOutput" },
      "errors": []
    }
  }
}"#;
const CATALOG_SURFACE_STATUS_PROVIDER_CONTRACT_JSON: &str = r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.integration.control-plane.catalog-surface-status-provider.control-plane-catalog-surface-status-reports-provider-runtime@v1",
  "displayName": "Trellis Control-Plane Catalog Surface Status Provider",
  "description": "Provides an RPC used to prove Surface.Status reports provider runtime state.",
  "docs": {
    "summary": "Catalog surface status provider.",
    "markdown": "Documents the provider contract used by live catalog tests."
  },
  "kind": "service",
  "capabilities": {
    "trellis.integration.control-plane.catalog-surface-status-provider.control-plane-catalog-surface-status-reports-provider-runtime::ping": {
      "displayName": "Call catalog surface status ping",
      "description": "Call the Surface.Status runtime probe RPC."
    },
    "trellis.integration.control-plane.catalog-surface-status-provider.control-plane-catalog-surface-status-reports-provider-runtime::publishStatus": {
      "displayName": "Publish catalog surface status changes",
      "description": "Publish Surface.Status runtime probe events."
    },
    "trellis.integration.control-plane.catalog-surface-status-provider.control-plane-catalog-surface-status-reports-provider-runtime::readStatusFeed": {
      "displayName": "Read catalog surface status feed",
      "description": "Subscribe to Surface.Status runtime probe feed frames."
    }
  },
  "schemas": {
    "PingInput": {
      "type": "object",
      "required": ["message"],
      "properties": { "message": { "type": "string" } }
    },
    "PingOutput": {
      "type": "object",
      "required": ["message", "servedBy"],
      "properties": {
        "message": { "type": "string" },
        "servedBy": { "type": "string" }
      }
    },
    "Progress": {
      "type": "object",
      "required": ["message"],
      "properties": { "message": { "type": "string" } }
    },
    "PublicValue": {
      "type": "object",
      "properties": {}
    }
  },
  "exports": { "schemas": ["PublicValue"] },
  "rpc": {
    "CatalogSurfaceStatus.Ping": {
      "version": "v1",
      "subject": "rpc.v1.integration.control-plane.catalog-surface-status-provider.control-plane-catalog-surface-status-reports-provider-runtime.CatalogSurfaceStatus.Ping",
      "input": { "schema": "PingInput" },
      "output": { "schema": "PingOutput" },
      "capabilities": {
        "call": ["trellis.integration.control-plane.catalog-surface-status-provider.control-plane-catalog-surface-status-reports-provider-runtime::ping"]
      },
      "errors": [],
      "docs": {
        "summary": "Ping catalog surface status.",
        "markdown": "Returns a live response from the provider runtime."
      }
    }
  },
  "operations": {
    "CatalogSurfaceStatus.Import": {
      "version": "v1",
      "subject": "operations.v1.integration.control-plane.catalog-surface-status-provider.control-plane-catalog-surface-status-reports-provider-runtime.CatalogSurfaceStatus.Import",
      "input": { "schema": "PingInput" },
      "progress": { "schema": "Progress" },
      "output": { "schema": "PingOutput" },
      "capabilities": {
        "call": ["trellis.integration.control-plane.catalog-surface-status-provider.control-plane-catalog-surface-status-reports-provider-runtime::ping"]
      },
      "docs": {
        "markdown": "Imports catalog surface status values asynchronously."
      }
    }
  },
  "events": {
    "CatalogSurfaceStatus.Changed": {
      "version": "v1",
      "subject": "events.v1.integration.control-plane.catalog-surface-status-provider.control-plane-catalog-surface-status-reports-provider-runtime.CatalogSurfaceStatus.Changed",
      "event": { "schema": "PublicValue" },
      "capabilities": {
        "publish": ["trellis.integration.control-plane.catalog-surface-status-provider.control-plane-catalog-surface-status-reports-provider-runtime::publishStatus"]
      },
      "docs": {
        "markdown": "Published when catalog surface status values change."
      }
    }
  },
  "feeds": {
    "CatalogSurfaceStatus.Feed": {
      "version": "v1",
      "subject": "feeds.v1.integration.control-plane.catalog-surface-status-provider.control-plane-catalog-surface-status-reports-provider-runtime.CatalogSurfaceStatus.Feed",
      "input": { "schema": "PingInput" },
      "event": { "schema": "PublicValue" },
      "capabilities": {
        "subscribe": ["trellis.integration.control-plane.catalog-surface-status-provider.control-plane-catalog-surface-status-reports-provider-runtime::readStatusFeed"]
      }
    }
  }
}"#;
const CATALOG_SURFACE_STATUS_OLD_PROVIDER_CONTRACT_JSON: &str = r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.integration.control-plane.catalog-surface-status-provider.control-plane-catalog-surface-status-reports-provider-runtime@v1",
  "displayName": "Trellis Control-Plane Catalog Surface Status Old Provider",
  "description": "Provides an older same-id provider digest without the requested ping surface.",
  "kind": "service",
  "schemas": {
    "PingInput": {
      "type": "object",
      "required": ["message"],
      "properties": { "message": { "type": "string" } }
    },
    "PingOutput": {
      "type": "object",
      "required": ["message", "servedBy"],
      "properties": {
        "message": { "type": "string" },
        "servedBy": { "type": "string" }
      }
    }
  },
  "rpc": {
    "CatalogSurfaceStatus.Legacy": {
      "version": "v1",
      "subject": "rpc.v1.integration.control-plane.catalog-surface-status-provider.control-plane-catalog-surface-status-reports-provider-runtime.CatalogSurfaceStatus.Legacy",
      "input": { "schema": "PingInput" },
      "output": { "schema": "PingOutput" },
      "errors": []
    }
  }
}"#;
const RESOURCES_RESTART_SERVICE_CONTRACT_JSON: &str = r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.integration.control-plane.resources-restart-service@v1",
  "displayName": "Trellis Control-Plane Resources Restart Service",
  "description": "Verifies service-owned resource bindings and backing data remain usable after control-plane restart.",
  "kind": "service",
  "schemas": {
    "ResourceRecord": {
      "type": "object",
      "required": ["message"],
      "properties": { "message": { "type": "string" } }
    }
  },
  "resources": {
    "kv": {
      "records": {
        "purpose": "Store restart-persistence KV records",
        "schema": { "schema": "ResourceRecord" },
        "required": true,
        "history": 1,
        "ttlMs": 0
      }
    },
    "store": {
      "blobs": {
        "purpose": "Store restart-persistence blobs",
        "required": true,
        "ttlMs": 0,
        "maxObjectBytes": 1048576,
        "maxTotalBytes": 4194304
      }
    }
  }
}"#;
const OUTBOX_RESTART_SERVICE_CONTRACT_JSON: &str = r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.integration.control-plane.outbox-restart-service@v1",
  "displayName": "Trellis Control-Plane Outbox Restart Service",
  "description": "Queues SQL outbox events and verifies dispatch after control-plane restart.",
  "kind": "service",
  "capabilities": {
    "readEvents": {
      "displayName": "Read outbox restart events",
      "description": "Subscribe to outbox restart fixture events."
    }
  },
  "schemas": {
    "QueueInput": {
      "type": "object",
      "required": ["documentId"],
      "properties": { "documentId": { "type": "string" } }
    },
    "QueueOutput": {
      "type": "object",
      "required": ["documentId"],
      "properties": { "documentId": { "type": "string" } }
    },
    "DocumentQueued": {
      "type": "object",
      "required": ["documentId"],
      "properties": { "documentId": { "type": "string" } }
    }
  },
  "rpc": {
    "Documents.Queue": {
      "version": "v1",
      "subject": "rpc.v1.integration.control-plane.outbox-restart.Documents.Queue",
      "input": { "schema": "QueueInput" },
      "output": { "schema": "QueueOutput" },
      "capabilities": { "call": [] },
      "errors": []
    }
  },
  "events": {
    "Document.Queued": {
      "version": "v1",
      "subject": "events.v1.integration.control-plane.outbox-restart.Document.Queued",
      "event": { "schema": "DocumentQueued" },
      "capabilities": { "publish": [], "subscribe": ["readEvents"] }
    }
  }
}"#;

struct CatalogRestartServiceContract;

impl GeneratedServiceContract for CatalogRestartServiceContract {
    const CONTRACT_ID: &'static str = CATALOG_RESTART_SERVICE_ID;
    const CONTRACT_DIGEST: &'static str = "";
    const CONTRACT_JSON: &'static str = CATALOG_RESTART_SERVICE_CONTRACT_JSON;
}

type CatalogRestartServiceRuntime = ConnectedServiceRuntime<CatalogRestartServiceContract>;

struct CatalogDependencyProviderContract;

impl GeneratedServiceContract for CatalogDependencyProviderContract {
    const CONTRACT_ID: &'static str = CATALOG_DEPENDENCY_PROVIDER_ID;
    const CONTRACT_DIGEST: &'static str = "";
    const CONTRACT_JSON: &'static str = CATALOG_DEPENDENCY_PROVIDER_CONTRACT_JSON;
}

type CatalogDependencyProviderRuntime = ConnectedServiceRuntime<CatalogDependencyProviderContract>;

struct CatalogForceReplaceBaseContract;

impl GeneratedServiceContract for CatalogForceReplaceBaseContract {
    const CONTRACT_ID: &'static str = CATALOG_FORCE_REPLACE_SERVICE_ID;
    const CONTRACT_DIGEST: &'static str = "";
    const CONTRACT_JSON: &'static str = CATALOG_FORCE_REPLACE_BASE_CONTRACT_JSON;
}

type CatalogForceReplaceBaseRuntime = ConnectedServiceRuntime<CatalogForceReplaceBaseContract>;

struct CatalogForceReplaceReplacementContract;

impl GeneratedServiceContract for CatalogForceReplaceReplacementContract {
    const CONTRACT_ID: &'static str = CATALOG_FORCE_REPLACE_SERVICE_ID;
    const CONTRACT_DIGEST: &'static str = "";
    const CONTRACT_JSON: &'static str = CATALOG_FORCE_REPLACE_REPLACEMENT_CONTRACT_JSON;
}

type CatalogForceReplaceReplacementRuntime =
    ConnectedServiceRuntime<CatalogForceReplaceReplacementContract>;

struct CatalogSurfaceStatusProviderContract;

impl GeneratedServiceContract for CatalogSurfaceStatusProviderContract {
    const CONTRACT_ID: &'static str = CATALOG_SURFACE_STATUS_PROVIDER_ID;
    const CONTRACT_DIGEST: &'static str = "";
    const CONTRACT_JSON: &'static str = CATALOG_SURFACE_STATUS_PROVIDER_CONTRACT_JSON;
}

type CatalogSurfaceStatusProviderRuntime =
    ConnectedServiceRuntime<CatalogSurfaceStatusProviderContract>;

struct ResourcesRestartServiceContract;

impl GeneratedServiceContract for ResourcesRestartServiceContract {
    const CONTRACT_ID: &'static str = RESOURCES_RESTART_SERVICE_ID;
    const CONTRACT_DIGEST: &'static str = "";
    const CONTRACT_JSON: &'static str = RESOURCES_RESTART_SERVICE_CONTRACT_JSON;
}

type ResourcesRestartServiceRuntime = ConnectedServiceRuntime<ResourcesRestartServiceContract>;

struct OutboxRestartServiceContract;

impl GeneratedServiceContract for OutboxRestartServiceContract {
    const CONTRACT_ID: &'static str = OUTBOX_RESTART_SERVICE_ID;
    const CONTRACT_DIGEST: &'static str = "";
    const CONTRACT_JSON: &'static str = OUTBOX_RESTART_SERVICE_CONTRACT_JSON;
}

type OutboxRestartServiceRuntime = ConnectedServiceRuntime<OutboxRestartServiceContract>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct CatalogRestartPingInput {
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct CatalogRestartPingOutput {
    message: String,
    generation: u32,
}

struct CatalogRestartPingRpc;

impl RpcDescriptor for CatalogRestartPingRpc {
    type Input = CatalogRestartPingInput;
    type Output = CatalogRestartPingOutput;

    const KEY: &'static str = "CatalogRestart.Ping";
    const SUBJECT: &'static str = CATALOG_RESTART_RPC_SUBJECT;
    const CALLER_CAPABILITIES: &'static [&'static str] = &[CATALOG_RESTART_CAPABILITY];
    const ERRORS: &'static [&'static str] = &[];
    const INPUT_SCHEMA_JSON: &'static str =
        r#"{"type":"object","required":["message"],"properties":{"message":{"type":"string"}}}"#;
    const OUTPUT_SCHEMA_JSON: &'static str = r#"{"type":"object","required":["message","generation"],"properties":{"message":{"type":"string"},"generation":{"type":"number"}}}"#;
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct CatalogDependencyPingInput {
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct CatalogDependencyPingOutput {
    message: String,
    served_by: String,
}

struct CatalogDependencyPingRpc;

impl RpcDescriptor for CatalogDependencyPingRpc {
    type Input = CatalogDependencyPingInput;
    type Output = CatalogDependencyPingOutput;

    const KEY: &'static str = "CatalogDependency.Ping";
    const SUBJECT: &'static str = CATALOG_DEPENDENCY_RPC_SUBJECT;
    const CALLER_CAPABILITIES: &'static [&'static str] = &[CATALOG_DEPENDENCY_CAPABILITY];
    const ERRORS: &'static [&'static str] = &[];
    const INPUT_SCHEMA_JSON: &'static str =
        r#"{"type":"object","required":["message"],"properties":{"message":{"type":"string"}}}"#;
    const OUTPUT_SCHEMA_JSON: &'static str = r#"{"type":"object","required":["message","servedBy"],"properties":{"message":{"type":"string"},"servedBy":{"type":"string"}}}"#;
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct CatalogForceReplaceBasePingInput {
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct CatalogForceReplaceBasePingOutput {
    message: String,
    variant: String,
}

struct CatalogForceReplaceBasePingRpc;

impl RpcDescriptor for CatalogForceReplaceBasePingRpc {
    type Input = CatalogForceReplaceBasePingInput;
    type Output = CatalogForceReplaceBasePingOutput;

    const KEY: &'static str = "CatalogForce.Ping";
    const SUBJECT: &'static str = CATALOG_FORCE_REPLACE_RPC_SUBJECT;
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &[];
    const INPUT_SCHEMA_JSON: &'static str =
        r#"{"type":"object","required":["message"],"properties":{"message":{"type":"string"}}}"#;
    const OUTPUT_SCHEMA_JSON: &'static str = r#"{"type":"object","required":["message","variant"],"properties":{"message":{"type":"string"},"variant":{"const":"base"}}}"#;
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
struct CatalogForceReplaceReplacementPingInput {
    count: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
struct CatalogForceReplaceReplacementPingOutput {
    count: f64,
    variant: String,
}

struct CatalogForceReplaceReplacementPingRpc;

impl RpcDescriptor for CatalogForceReplaceReplacementPingRpc {
    type Input = CatalogForceReplaceReplacementPingInput;
    type Output = CatalogForceReplaceReplacementPingOutput;

    const KEY: &'static str = "CatalogForce.Ping";
    const SUBJECT: &'static str = CATALOG_FORCE_REPLACE_RPC_SUBJECT;
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &[];
    const INPUT_SCHEMA_JSON: &'static str =
        r#"{"type":"object","required":["count"],"properties":{"count":{"type":"number"}}}"#;
    const OUTPUT_SCHEMA_JSON: &'static str = r#"{"type":"object","required":["count","variant"],"properties":{"count":{"type":"number"},"variant":{"const":"replacement"}}}"#;
}

struct CatalogSurfaceStatusPingRpc;

impl RpcDescriptor for CatalogSurfaceStatusPingRpc {
    type Input = CatalogDependencyPingInput;
    type Output = CatalogDependencyPingOutput;

    const KEY: &'static str = "CatalogSurfaceStatus.Ping";
    const SUBJECT: &'static str = CATALOG_SURFACE_STATUS_RPC_SUBJECT;
    const CALLER_CAPABILITIES: &'static [&'static str] = &[CATALOG_SURFACE_STATUS_CAPABILITY];
    const ERRORS: &'static [&'static str] = &[];
    const INPUT_SCHEMA_JSON: &'static str =
        r#"{"type":"object","required":["message"],"properties":{"message":{"type":"string"}}}"#;
    const OUTPUT_SCHEMA_JSON: &'static str = r#"{"type":"object","required":["message","servedBy"],"properties":{"message":{"type":"string"},"servedBy":{"type":"string"}}}"#;
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct StateRestartPreferences {
    theme: String,
    density: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct StateRestartDraft {
    title: String,
    body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct ResourceRestartRecord {
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct OutboxRestartQueueInput {
    document_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct OutboxRestartQueueOutput {
    document_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct OutboxRestartDocumentQueued {
    document_id: String,
}

struct OutboxRestartQueueRpc;

impl RpcDescriptor for OutboxRestartQueueRpc {
    type Input = OutboxRestartQueueInput;
    type Output = OutboxRestartQueueOutput;

    const KEY: &'static str = "Documents.Queue";
    const SUBJECT: &'static str = OUTBOX_RESTART_RPC_SUBJECT;
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &[];
    const INPUT_SCHEMA_JSON: &'static str = r#"{"type":"object","required":["documentId"],"properties":{"documentId":{"type":"string"}}}"#;
    const OUTPUT_SCHEMA_JSON: &'static str = Self::INPUT_SCHEMA_JSON;
}

struct OutboxRestartQueuedEvent;

impl EventDescriptor for OutboxRestartQueuedEvent {
    type Event = OutboxRestartDocumentQueued;

    const KEY: &'static str = "Document.Queued";
    const SUBJECT: &'static str = OUTBOX_RESTART_EVENT_SUBJECT;
    const PUBLISH_CAPABILITIES: &'static [&'static str] = &[];
    const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &["readEvents"];
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
async fn control_plane_admin_bootstrap_creates_first_local_admin() {
    assert_service_case_registered(
        "control-plane.admin-bootstrap-creates-first-local-admin",
        "control-plane",
        "control_plane",
    );

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();
    let contract = admin_bootstrap_probe_contract().expect("build admin bootstrap probe contract");

    let client = admin
        .connect_client(&bootstrap_url, &contract)
        .await
        .expect("connect live Rust admin bootstrap probe client");
    let auth = trellis_rs::sdk::auth::AuthClient::new(&client);
    let me = auth
        .rpc()
        .auth()
        .sessions_me()
        .await
        .expect("call Auth.Sessions.Me as bootstrap-created admin app");

    assert_admin_app_session(&me);
}

#[tokio::test]
async fn control_plane_password_reset_change_invalidates_old_password() {
    assert_service_case_registered(
        PASSWORD_RESET_CHANGE_CASE_ID,
        "control-plane",
        "control_plane",
    );

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();
    let contract =
        password_reset_change_contract().expect("build password reset change client contract");

    let initial_client = admin
        .connect_client(&bootstrap_url, &contract)
        .await
        .expect("connect live Rust password reset admin client");
    let initial_auth = trellis_rs::sdk::auth::AuthClient::new(&initial_client);
    let created = initial_auth
        .rpc()
        .auth()
        .users_create(&AuthUsersCreateRequest {
            active: Some(true),
            capabilities: None,
            capability_groups: Some(vec!["admin".to_string()]),
            email: Some(format!("{PASSWORD_RESET_CHANGE_USERNAME}@example.test")),
            name: Some("Password Reset Change Admin".to_string()),
            username: Some(PASSWORD_RESET_CHANGE_USERNAME.to_string()),
        })
        .await
        .expect("create local admin user through generated Auth.Users.Create");
    let reset = initial_auth
        .rpc()
        .auth()
        .users_password_reset_create(&AuthUsersPasswordResetCreateRequest {
            expires_in_seconds: None,
            user_id: created.user.user_id.clone(),
        })
        .await
        .expect("create password reset flow through generated Auth.Users.PasswordReset.Create");
    complete_local_password_account_flow(
        runtime.trellis_url(),
        &reset.flow_id,
        PASSWORD_RESET_CHANGE_USERNAME,
        PASSWORD_RESET_CHANGE_OLD_PASSWORD,
    )
    .await
    .expect("complete local-password account flow through public HTTP route");

    let old_password_seed = trellis_rs::auth::generate_session_keypair().0;
    let old_password_client = connect_with_local_password(
        runtime.trellis_url(),
        &contract,
        &old_password_seed,
        PASSWORD_RESET_CHANGE_USERNAME,
        PASSWORD_RESET_CHANGE_OLD_PASSWORD,
    )
    .await
    .expect("connect with reset old password through public local login flow");
    let old_password_auth = trellis_rs::sdk::auth::AuthClient::new(&old_password_client);
    let changed = old_password_auth
        .rpc()
        .auth()
        .users_password_change(&AuthUsersPasswordChangeRequest {
            current_password: PASSWORD_RESET_CHANGE_OLD_PASSWORD.to_string(),
            new_password: PASSWORD_RESET_CHANGE_NEW_PASSWORD.to_string(),
        })
        .await
        .expect("change password through generated Auth.Users.Password.Change");
    assert!(changed.success, "password change should succeed");

    let rejected_seed = trellis_rs::auth::generate_session_keypair().0;
    let rejected = local_password_login_failure(
        runtime.trellis_url(),
        &contract,
        &rejected_seed,
        PASSWORD_RESET_CHANGE_USERNAME,
        PASSWORD_RESET_CHANGE_OLD_PASSWORD,
    )
    .await
    .expect("attempt old-password local login through public HTTP route");
    assert_eq!(rejected.status, 403, "old password body: {}", rejected.body);
    assert!(
        rejected.body.contains("invalid_credentials"),
        "expected invalid_credentials response, got: {}",
        rejected.body
    );

    let new_password_seed = trellis_rs::auth::generate_session_keypair().0;
    let new_password_client = connect_with_local_password(
        runtime.trellis_url(),
        &contract,
        &new_password_seed,
        PASSWORD_RESET_CHANGE_USERNAME,
        PASSWORD_RESET_CHANGE_NEW_PASSWORD,
    )
    .await
    .expect("connect with changed new password through public local login flow");
    let new_password_auth = trellis_rs::sdk::auth::AuthClient::new(&new_password_client);
    let me = new_password_auth
        .rpc()
        .auth()
        .sessions_me()
        .await
        .expect("call Auth.Sessions.Me after new-password login");
    assert_eq!(
        me.user
            .as_object()
            .and_then(|user| user.get("userId"))
            .and_then(Value::as_str),
        Some(created.user.user_id.as_str())
    );
}

#[tokio::test]
async fn control_plane_http_route_security_requires_admin_session() {
    assert_service_case_registered(
        "control-plane.http-route-security-requires-admin-session",
        "control-plane",
        "control_plane",
    );

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();

    let unauthenticated_seed = trellis_rs::auth::generate_session_keypair().0;
    let unauthenticated = fetch_client_bootstrap(runtime.trellis_url(), &unauthenticated_seed)
        .await
        .expect("fetch unauthenticated client bootstrap");
    assert_eq!(unauthenticated.status, 200);
    assert_eq!(
        unauthenticated.body.get("status").and_then(Value::as_str),
        Some("auth_required")
    );

    let admin_session_seed = trellis_rs::auth::generate_session_keypair().0;
    let contract = http_route_probe_contract().expect("build HTTP route probe contract");
    let client = admin
        .connect_client_with_session_seed(&bootstrap_url, &contract, admin_session_seed.clone())
        .await
        .expect("connect live Rust HTTP route probe client");
    let auth = trellis_rs::sdk::auth::AuthClient::new(&client);
    let me = auth
        .rpc()
        .auth()
        .sessions_me()
        .await
        .expect("call Auth.Sessions.Me as HTTP route probe admin app");
    assert_admin_app_session(&me);

    let users = auth
        .rpc()
        .auth()
        .users_list(&AuthUsersListRequest {
            limit: 20,
            offset: None,
        })
        .await
        .expect("call Auth.Users.List as HTTP route probe admin app");
    assert!(
        users.count >= 1,
        "expected at least one bootstrap admin user"
    );

    let authenticated = fetch_client_bootstrap(runtime.trellis_url(), &admin_session_seed)
        .await
        .expect("fetch authenticated client bootstrap");
    assert_eq!(authenticated.status, 200);
    assert_eq!(
        authenticated.body.get("status").and_then(Value::as_str),
        Some("ready")
    );
    assert_eq!(
        authenticated
            .body
            .get("connectInfo")
            .and_then(Value::as_object)
            .and_then(|connect_info| connect_info.get("sessionKey"))
            .and_then(Value::as_str),
        Some(authenticated.session_key.as_str())
    );
    let capabilities = authenticated
        .body
        .get("binding")
        .and_then(Value::as_object)
        .and_then(|binding| binding.get("capabilities"))
        .and_then(Value::as_array)
        .expect("authenticated bootstrap binding should include capabilities");
    assert!(
        capabilities.iter().any(|capability| capability == "admin"),
        "authenticated bootstrap binding should include admin capability"
    );
}

#[tokio::test]
async fn control_plane_bootstrap_requires_auth_for_unbound_client() {
    assert_service_case_registered(BOOTSTRAP_UNBOUND_CASE_ID, "control-plane", "control_plane");

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let seed = trellis_rs::auth::generate_session_keypair().0;
    let response = fetch_client_bootstrap(runtime.trellis_url(), &seed)
        .await
        .expect("fetch unbound client bootstrap");

    assert_eq!(response.status, 200);
    assert_eq!(
        response.body.get("status").and_then(Value::as_str),
        Some("auth_required")
    );
}

#[tokio::test]
async fn control_plane_bootstrap_rejects_unknown_contract_digest() {
    assert_service_case_registered(
        BOOTSTRAP_UNKNOWN_DIGEST_CASE_ID,
        "control-plane",
        "control_plane",
    );

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();
    let contract = bootstrap_unknown_digest_client_contract()
        .expect("build bootstrap unknown digest client contract");
    let (seed, session_key) = trellis_rs::auth::generate_session_keypair();
    let client = admin
        .connect_client_with_session_seed(&bootstrap_url, &contract, seed.clone())
        .await
        .expect("connect live Rust bootstrap unknown digest client");
    drop(client);

    rewrite_session_contract(
        &runtime.control_plane_sqlite(),
        &session_key,
        contract_manifest_str(&contract, "id"),
        "unknown-digest",
        contract_manifest_str(&contract, "displayName"),
        contract_manifest_str(&contract, "description"),
    )
    .expect("rewrite stored session contract digest");

    let response = fetch_client_bootstrap(runtime.trellis_url(), &seed)
        .await
        .expect("fetch bootstrap with unknown digest session");
    assert_eq!(response.status, 200);
    assert_eq!(
        response.body.get("status").and_then(Value::as_str),
        Some("auth_required")
    );
    assert_session_absent(&runtime.control_plane_sqlite(), &session_key);
}

#[tokio::test]
async fn control_plane_bootstrap_rejects_non_client_contract() {
    assert_service_case_registered(
        BOOTSTRAP_NON_CLIENT_CASE_ID,
        "control-plane",
        "control_plane",
    );

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();
    let app_contract =
        bootstrap_non_client_app_contract().expect("build bootstrap non-client app contract");
    let service_contract = bootstrap_non_client_contract(
        BOOTSTRAP_NON_CLIENT_SERVICE_ID,
        "Trellis Bootstrap Non-Client Contract Service",
        "Known service contract used as an invalid app session digest.",
        trellis_rs::contracts::ContractKind::Service,
    )
    .expect("build bootstrap non-client service contract");
    let device_admin_contract = bootstrap_non_client_device_admin_contract()
        .expect("build bootstrap non-client device admin contract");
    let device_contract = bootstrap_non_client_contract(
        BOOTSTRAP_NON_CLIENT_DEVICE_ID,
        "Trellis Bootstrap Non-Client Contract Device",
        "Known device contract used as an invalid app session digest.",
        trellis_rs::contracts::ContractKind::Device,
    )
    .expect("build bootstrap non-client device contract");

    admin
        .approve_contract(&bootstrap_url, &service_contract, None, &[])
        .await
        .expect("approve known service contract");
    approve_bootstrap_non_client_device_contract(
        &mut admin,
        &bootstrap_url,
        &device_admin_contract,
        &device_contract,
    )
    .await;

    assert_bootstrap_rejects_stored_contract(
        &runtime,
        &mut admin,
        &bootstrap_url,
        &app_contract,
        &service_contract,
    )
    .await;
    assert_bootstrap_rejects_stored_contract(
        &runtime,
        &mut admin,
        &bootstrap_url,
        &app_contract,
        &device_contract,
    )
    .await;
}

#[tokio::test]
async fn control_plane_bootstrap_selects_exact_session_contract_digest() {
    assert_service_case_registered(
        BOOTSTRAP_EXACT_DIGEST_CASE_ID,
        "control-plane",
        "control_plane",
    );

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();
    let first_contract = bootstrap_plain_contract(
        BOOTSTRAP_EXACT_DIGEST_CLIENT_ID,
        "Trellis Bootstrap Exact Digest Client",
        "First known client contract revision.",
        trellis_rs::contracts::ContractKind::App,
    )
    .expect("build first exact digest contract");
    let session_contract = bootstrap_auth_sessions_me_contract(
        BOOTSTRAP_EXACT_DIGEST_CLIENT_ID,
        "Trellis Bootstrap Exact Digest Client",
        "Session-bound client contract revision.",
    )
    .expect("build session exact digest contract");

    let first = admin
        .connect_client(&bootstrap_url, &first_contract)
        .await
        .expect("connect first exact digest client");
    drop(first);
    let (seed, _) =
        connect_bootstrap_client_session(&mut admin, &bootstrap_url, &session_contract).await;

    let response = fetch_client_bootstrap(runtime.trellis_url(), &seed)
        .await
        .expect("fetch exact digest bootstrap");
    assert_eq!(response.status, 200);
    assert_eq!(
        response.body.get("status").and_then(Value::as_str),
        Some("ready")
    );
    assert_eq!(
        response
            .body
            .get("connectInfo")
            .and_then(Value::as_object)
            .and_then(|connect_info| connect_info.get("contractDigest"))
            .and_then(Value::as_str),
        Some(session_contract.digest())
    );
    assert_eq!(
        response
            .body
            .get("contract")
            .and_then(Value::as_object)
            .and_then(|contract| contract.get("description"))
            .and_then(Value::as_str),
        Some("Session-bound client contract revision.")
    );
}

#[tokio::test]
async fn control_plane_bootstrap_deletes_session_for_inactive_user() {
    assert_service_case_registered(
        BOOTSTRAP_INACTIVE_USER_CASE_ID,
        "control-plane",
        "control_plane",
    );

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();
    let contract = bootstrap_plain_contract(
        BOOTSTRAP_INACTIVE_USER_CLIENT_ID,
        "Trellis Bootstrap Inactive User Client",
        "Creates a bound app session for inactive-user bootstrap cleanup.",
        trellis_rs::contracts::ContractKind::App,
    )
    .expect("build inactive user bootstrap contract");
    let (seed, session_key) =
        connect_bootstrap_client_session(&mut admin, &bootstrap_url, &contract).await;

    mark_session_user_inactive(&runtime.control_plane_sqlite(), &session_key)
        .expect("mark session user inactive");
    assert_bootstrap_auth_required_and_session_deleted(&runtime, &seed, &session_key).await;
}

#[tokio::test]
async fn control_plane_bootstrap_deletes_session_for_missing_user_projection() {
    assert_service_case_registered(
        BOOTSTRAP_MISSING_USER_CASE_ID,
        "control-plane",
        "control_plane",
    );

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();
    let contract = bootstrap_plain_contract(
        BOOTSTRAP_MISSING_USER_CLIENT_ID,
        "Trellis Bootstrap Missing User Client",
        "Creates a bound app session for missing-user bootstrap cleanup.",
        trellis_rs::contracts::ContractKind::App,
    )
    .expect("build missing user bootstrap contract");
    let (seed, session_key) =
        connect_bootstrap_client_session(&mut admin, &bootstrap_url, &contract).await;

    delete_session_user_projection(&runtime.control_plane_sqlite(), &session_key)
        .expect("delete session user projection");
    assert_bootstrap_auth_required_and_session_deleted(&runtime, &seed, &session_key).await;
}

#[tokio::test]
async fn control_plane_bootstrap_deletes_session_for_insufficient_user_capabilities() {
    assert_service_case_registered(
        BOOTSTRAP_INSUFFICIENT_USER_CASE_ID,
        "control-plane",
        "control_plane",
    );

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();
    let contract = bootstrap_auth_sessions_me_contract(
        BOOTSTRAP_INSUFFICIENT_USER_CLIENT_ID,
        "Trellis Bootstrap Insufficient User Client",
        "Creates a bound app session for insufficient-capability bootstrap cleanup.",
    )
    .expect("build insufficient user bootstrap contract");
    let (seed, session_key) =
        connect_bootstrap_client_session(&mut admin, &bootstrap_url, &contract).await;

    clear_session_user_capabilities(&runtime.control_plane_sqlite(), &session_key)
        .expect("clear session user capabilities");
    assert_bootstrap_auth_required_and_session_deleted(&runtime, &seed, &session_key).await;
}

#[tokio::test]
async fn control_plane_bootstrap_reports_server_time_for_stale_proof() {
    assert_service_case_registered(
        BOOTSTRAP_STALE_PROOF_CASE_ID,
        "control-plane",
        "control_plane",
    );

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();
    let contract = bootstrap_plain_contract(
        BOOTSTRAP_STALE_PROOF_CLIENT_ID,
        "Trellis Bootstrap Stale Proof Client",
        "Creates a bound app session for stale bootstrap proof coverage.",
        trellis_rs::contracts::ContractKind::App,
    )
    .expect("build stale proof bootstrap contract");
    let (seed, _) = connect_bootstrap_client_session(&mut admin, &bootstrap_url, &contract).await;
    let stale_iat = current_iat() - 120;

    let before = current_iat();
    let response = fetch_client_bootstrap_with_iat(runtime.trellis_url(), &seed, stale_iat)
        .await
        .expect("fetch stale bootstrap proof");
    let after = current_iat();

    assert_eq!(response.status, 400);
    assert_eq!(
        response.body.get("reason").and_then(Value::as_str),
        Some("iat_out_of_range")
    );
    let server_now = response
        .body
        .get("serverNow")
        .and_then(Value::as_u64)
        .expect("stale proof response includes serverNow");
    assert!(server_now >= before && server_now <= after + 1);
}

#[tokio::test]
async fn control_plane_bootstrap_rejects_invalid_signature() {
    assert_service_case_registered(
        BOOTSTRAP_INVALID_SIGNATURE_CASE_ID,
        "control-plane",
        "control_plane",
    );

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();
    let contract = bootstrap_plain_contract(
        BOOTSTRAP_INVALID_SIGNATURE_CLIENT_ID,
        "Trellis Bootstrap Invalid Signature Client",
        "Creates a bound app session for invalid bootstrap signature coverage.",
        trellis_rs::contracts::ContractKind::App,
    )
    .expect("build invalid signature bootstrap contract");
    let (seed, _) = connect_bootstrap_client_session(&mut admin, &bootstrap_url, &contract).await;
    let auth = trellis_rs::client::SessionAuth::from_seed_base64url(&seed)
        .expect("build session auth for invalid signature");
    let iat = current_iat();
    let sig = auth.sign_sha256_domain("bootstrap-client", &iat.to_string());

    let response = fetch_client_bootstrap_with_sig(runtime.trellis_url(), &seed, iat + 1, sig)
        .await
        .expect("fetch invalid signature bootstrap");
    assert_eq!(response.status, 400);
    assert_eq!(
        response.body.get("reason").and_then(Value::as_str),
        Some("invalid_signature")
    );
}

#[tokio::test]
async fn control_plane_bootstrap_allows_known_inactive_app_digest() {
    assert_service_case_registered(
        BOOTSTRAP_KNOWN_INACTIVE_CASE_ID,
        "control-plane",
        "control_plane",
    );

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();
    let contract = bootstrap_plain_contract(
        BOOTSTRAP_KNOWN_INACTIVE_CLIENT_ID,
        "Trellis Bootstrap Known Inactive Client",
        "Creates a known user app contract, which is not an active service catalog entry.",
        trellis_rs::contracts::ContractKind::App,
    )
    .expect("build known inactive bootstrap contract");
    let (seed, _) = connect_bootstrap_client_session(&mut admin, &bootstrap_url, &contract).await;

    let response = fetch_client_bootstrap(runtime.trellis_url(), &seed)
        .await
        .expect("fetch known inactive app bootstrap");
    assert_eq!(response.status, 200);
    assert_eq!(
        response.body.get("status").and_then(Value::as_str),
        Some("ready")
    );
    assert_eq!(
        response
            .body
            .get("connectInfo")
            .and_then(Value::as_object)
            .and_then(|connect_info| connect_info.get("contractDigest"))
            .and_then(Value::as_str),
        Some(contract.digest())
    );
}

#[tokio::test]
async fn control_plane_session_logout_deletes_session_and_denies_reuse() {
    assert_service_case_registered(
        SESSION_LOGOUT_DELETE_CASE_ID,
        "control-plane",
        "control_plane",
    );

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();
    let contract =
        sessions_restart_client_contract().expect("build session logout client contract");
    let (seed, session_key) = trellis_rs::auth::generate_session_keypair();
    let client = admin
        .connect_client_with_session_seed(&bootstrap_url, &contract, seed.clone())
        .await
        .expect("connect live Rust session logout client");
    drop(client);

    let response = post_session_logout(
        runtime.trellis_url(),
        &seed,
        SessionLogoutOptions::default(),
    )
    .await
    .expect("post signed HTTP session logout");
    assert_eq!(response.status, 200);
    let body: Value = serde_json::from_str(&response.body).expect("parse logout response JSON");
    assert_eq!(body, json!({ "success": true }));
    assert_session_absent(&runtime.control_plane_sqlite(), &session_key);

    let reuse = fetch_client_bootstrap(runtime.trellis_url(), &seed)
        .await
        .expect("fetch client bootstrap after logout");
    assert_eq!(reuse.status, 200);
    assert_eq!(
        reuse.body.get("status").and_then(Value::as_str),
        Some("auth_required")
    );
}

#[tokio::test]
async fn control_plane_session_logout_kicks_runtime_access() {
    assert_service_case_registered(
        SESSION_LOGOUT_KICK_CASE_ID,
        "control-plane",
        "control_plane",
    );

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();
    let contract = sessions_restart_client_contract().expect("build session logout kick contract");
    let seed = trellis_rs::auth::generate_session_keypair().0;
    let first = admin
        .connect_client_with_session_seed(&bootstrap_url, &contract, seed.clone())
        .await
        .expect("connect first live Rust session logout client");
    let second = admin
        .connect_client_with_session_seed(&bootstrap_url, &contract, seed.clone())
        .await
        .expect("connect second live Rust session logout client");
    let first_auth = trellis_rs::sdk::auth::AuthClient::new(&first);
    let second_auth = trellis_rs::sdk::auth::AuthClient::new(&second);
    first_auth
        .rpc()
        .auth()
        .sessions_me()
        .await
        .expect("first client can call Auth.Sessions.Me before logout");
    second_auth
        .rpc()
        .auth()
        .sessions_me()
        .await
        .expect("second client can call Auth.Sessions.Me before logout");

    let response = post_session_logout(
        runtime.trellis_url(),
        &seed,
        SessionLogoutOptions::default(),
    )
    .await
    .expect("post signed HTTP session logout");
    assert_eq!(response.status, 200);

    wait_for_sessions_me_denied(&first_auth, "first").await;
    wait_for_sessions_me_denied(&second_auth, "second").await;
}

#[tokio::test]
async fn control_plane_session_logout_uses_provider_logout_redirect() {
    assert_service_case_registered(
        SESSION_LOGOUT_PROVIDER_CASE_ID,
        "control-plane",
        "control_plane",
    );

    let mut options = trellis_test::TrellisTestRuntimeOptions::default();
    options.oauth_providers.insert(
        "logout_oidc".to_string(),
        json!({
            "type": "oidc",
            "issuer": "https://idp.example",
            "clientId": "logout-client",
            "clientSecret": "logout-secret",
            "logout": {
                "enabled": true,
                "endpoint": "https://idp.example/logout",
                "mode": "auth0",
                "allowFederated": true
            }
        }),
    );
    let runtime = trellis_test::TrellisTestRuntime::start(options)
        .await
        .expect("start live Trellis test runtime with logout provider");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();
    let contract =
        sessions_restart_client_contract().expect("build session logout client contract");
    let (seed, session_key) = trellis_rs::auth::generate_session_keypair();
    let client = admin
        .connect_client_with_session_seed(&bootstrap_url, &contract, seed.clone())
        .await
        .expect("connect live Rust session logout provider client");
    drop(client);
    rewrite_session_provider(&runtime.control_plane_sqlite(), &session_key, "logout_oidc")
        .expect("rewrite session provider for logout provider coverage");

    let return_to = format!(
        "{}/_trellis/test/signed-out",
        runtime.trellis_url().trim_end_matches('/')
    );
    let response = post_session_logout(
        runtime.trellis_url(),
        &seed,
        SessionLogoutOptions {
            provider_logout: Some(true),
            federated_provider_logout: Some(true),
            return_to: Some(return_to.clone()),
        },
    )
    .await
    .expect("post signed HTTP logout with provider redirect");
    assert_eq!(response.status, 200);
    let body: Value = serde_json::from_str(&response.body).expect("parse provider logout response");
    let mut expected = reqwest::Url::parse("https://idp.example/logout").unwrap();
    expected
        .query_pairs_mut()
        .append_pair("client_id", "logout-client")
        .append_pair("returnTo", &return_to)
        .append_pair("federated", "");
    assert_eq!(
        body,
        json!({ "success": true, "redirectTo": expected.to_string() })
    );
    assert_session_absent(&runtime.control_plane_sqlite(), &session_key);
}

#[tokio::test]
async fn control_plane_session_logout_validates_return_to() {
    assert_service_case_registered(
        SESSION_LOGOUT_RETURN_TO_CASE_ID,
        "control-plane",
        "control_plane",
    );

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();
    let contract =
        sessions_restart_client_contract().expect("build session logout client contract");
    let (seed, session_key) = trellis_rs::auth::generate_session_keypair();
    let client = admin
        .connect_client_with_session_seed(&bootstrap_url, &contract, seed.clone())
        .await
        .expect("connect live Rust session logout returnTo client");
    drop(client);

    let rejected = post_session_logout(
        runtime.trellis_url(),
        &seed,
        SessionLogoutOptions {
            provider_logout: None,
            federated_provider_logout: None,
            return_to: Some("https://evil.example/signed-out".to_string()),
        },
    )
    .await
    .expect("post signed HTTP logout with invalid returnTo");
    assert_eq!(rejected.status, 400);
    let body: Value =
        serde_json::from_str(&rejected.body).expect("parse invalid returnTo response JSON");
    assert_eq!(body, json!({ "error": "invalid_return_to" }));
    assert_session_present(&runtime.control_plane_sqlite(), &session_key);

    let return_to = format!(
        "{}/_trellis/test/signed-out",
        runtime.trellis_url().trim_end_matches('/')
    );
    let accepted = post_session_logout(
        runtime.trellis_url(),
        &seed,
        SessionLogoutOptions {
            provider_logout: None,
            federated_provider_logout: None,
            return_to: Some(return_to.clone()),
        },
    )
    .await
    .expect("post signed HTTP logout with valid returnTo");
    assert_eq!(accepted.status, 200);
    let body: Value =
        serde_json::from_str(&accepted.body).expect("parse valid returnTo response JSON");
    assert_eq!(body, json!({ "success": true, "redirectTo": return_to }));
    assert_session_absent(&runtime.control_plane_sqlite(), &session_key);
}

#[tokio::test]
async fn control_plane_catalog_active_contracts_survive_restart() {
    assert_service_case_registered(CATALOG_RESTART_CASE_ID, "control-plane", "control_plane");

    let mut runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();

    let service_contract = trellis_test::TrellisTestContract::from_manifest_json(
        CATALOG_RESTART_SERVICE_CONTRACT_JSON,
    )
    .expect("build catalog restart service contract");
    let client_contract =
        catalog_restart_client_contract().expect("build catalog restart client contract");
    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision live catalog restart service instance");
    let client_session_seed = trellis_rs::auth::generate_session_keypair().0;

    let service_task = start_catalog_restart_service(
        runtime.trellis_url(),
        &service_contract,
        &service_key,
        1,
        true,
    )
    .await;
    let (client, client_reconnect) = admin
        .connect_client_with_session_seed_reconnectable(
            &bootstrap_url,
            &client_contract,
            client_session_seed,
        )
        .await
        .expect("connect live Rust catalog restart client before restart");
    let before = call_catalog_restart_with_retry(&client, "before").await;
    assert_eq!(
        before,
        CatalogRestartPingOutput {
            message: "before".to_string(),
            generation: 1,
        }
    );
    drop(client);
    service_task.abort_and_wait().await;

    runtime
        .restart_control_plane()
        .await
        .expect("restart only the Trellis control-plane process");

    let service_task = start_catalog_restart_service(
        runtime.trellis_url(),
        &service_contract,
        &service_key,
        2,
        false,
    )
    .await;
    let client = client_reconnect
        .connect_bound_only()
        .await
        .expect("reconnect bound catalog restart client after restart without fresh auth flow");
    let after = call_catalog_restart_with_retry(&client, "after").await;

    service_task.abort_and_wait().await;
    assert_eq!(
        after,
        CatalogRestartPingOutput {
            message: "after".to_string(),
            generation: 2,
        }
    );
}

#[tokio::test]
async fn control_plane_catalog_dependency_issue_resolved_by_provider() {
    assert_service_case_registered(CATALOG_DEPENDENCY_CASE_ID, "control-plane", "control_plane");

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();

    let provider_contract = trellis_test::TrellisTestContract::from_manifest_json(
        CATALOG_DEPENDENCY_PROVIDER_CONTRACT_JSON,
    )
    .expect("build catalog dependency provider contract");
    let client_contract =
        catalog_dependency_client_contract().expect("build catalog dependency client contract");
    admin
        .approve_contract(
            &bootstrap_url,
            &provider_contract,
            Some(CATALOG_DEPENDENCY_SHAPE_DEPLOYMENT),
            &[],
        )
        .await
        .expect("approve provider shape in separate deployment");

    let client = admin
        .connect_client(&bootstrap_url, &client_contract)
        .await
        .expect("connect live Rust catalog dependency client before provider is active");
    assert_catalog_dependency_unavailable(&client).await;

    let service_key = admin
        .provision_service_instance(&bootstrap_url, &provider_contract, None, None)
        .await
        .expect("provision live catalog dependency provider service instance");
    let service_task = start_catalog_dependency_provider_service(
        runtime.trellis_url(),
        &provider_contract,
        &service_key,
    )
    .await;
    let output = call_catalog_dependency_with_retry(&client, "after-provider").await;

    service_task.abort_and_wait().await;
    assert_eq!(
        output,
        CatalogDependencyPingOutput {
            message: "after-provider".to_string(),
            served_by: CATALOG_DEPENDENCY_PROVIDER_NAME.to_string(),
        }
    );
}

#[tokio::test]
async fn control_plane_catalog_force_replace_resolves_catalog_issue() {
    assert_service_case_registered(
        CATALOG_FORCE_REPLACE_CASE_ID,
        "control-plane",
        "control_plane",
    );

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
        .create_deployment(
            &bootstrap_url,
            Some(CATALOG_FORCE_REPLACE_BASE_DEPLOYMENT),
            Some(false),
        )
        .await
        .expect("create strict base deployment");
    admin
        .create_deployment(
            &bootstrap_url,
            Some(CATALOG_FORCE_REPLACE_REPLACEMENT_DEPLOYMENT),
            Some(false),
        )
        .await
        .expect("create strict replacement deployment");

    let base_contract = trellis_test::TrellisTestContract::from_manifest_json(
        CATALOG_FORCE_REPLACE_BASE_CONTRACT_JSON,
    )
    .expect("build catalog force-replace base contract");
    let replacement_contract = trellis_test::TrellisTestContract::from_manifest_json(
        CATALOG_FORCE_REPLACE_REPLACEMENT_CONTRACT_JSON,
    )
    .expect("build catalog force-replace replacement contract");
    let admin_contract = catalog_force_replace_admin_contract()
        .expect("build catalog force-replace admin client contract");
    let base_key = admin
        .provision_service_instance(
            &bootstrap_url,
            &base_contract,
            Some(CATALOG_FORCE_REPLACE_BASE_DEPLOYMENT),
            None,
        )
        .await
        .expect("provision live catalog force-replace base service instance");
    let base_service_task = start_catalog_force_replace_base_service(
        runtime.trellis_url(),
        base_contract.digest(),
        &base_key,
    )
    .await;
    let admin_client = admin
        .connect_client(&bootstrap_url, &admin_contract)
        .await
        .expect("connect live Rust catalog force-replace admin client");

    let replacement_key = admin
        .provision_service_instance(
            &bootstrap_url,
            &replacement_contract,
            Some(CATALOG_FORCE_REPLACE_REPLACEMENT_DEPLOYMENT),
            None,
        )
        .await
        .expect("provision live catalog force-replace replacement service instance");
    let replacement_service_task = start_catalog_force_replace_replacement_service(
        runtime.trellis_url(),
        replacement_contract.digest(),
        &replacement_key,
    )
    .await;
    let core = trellis_rs::sdk::core::CoreClient::new(&admin_client);
    let issue = wait_for_catalog_force_replace_issue(
        &core,
        base_contract.digest(),
        replacement_contract.digest(),
    )
    .await;
    assert_eq!(issue.digest.as_deref(), Some(replacement_contract.digest()));
    assert_eq!(
        issue.effective_digests.as_deref(),
        Some(&[base_contract.digest().to_string()][..])
    );
    assert!(
        issue
            .actions
            .iter()
            .any(|action| action.action == "force-replace"),
        "expected catalog issue to expose the public force-replace action"
    );

    let auth = trellis_rs::sdk::auth::AuthClient::new(&admin_client);
    let resolved = auth
        .rpc()
        .auth()
        .catalog_issues_resolve(
            &trellis_rs::sdk::auth::types::AuthCatalogIssuesResolveRequest {
                issue_id: issue.issue_id.clone(),
                action: "force-replace".to_string(),
            },
        )
        .await
        .expect("resolve catalog force-replace issue through generated Auth RPC");
    assert!(resolved.success);
    assert_eq!(resolved.issue_id, issue.issue_id);
    assert_eq!(resolved.action, "force-replace");

    wait_for_catalog_force_replace_resolved(&core, replacement_contract.digest()).await;

    replacement_service_task.abort_and_wait().await;
    base_service_task.abort_and_wait().await;
}

#[tokio::test]
async fn control_plane_catalog_surface_status_reports_provider_runtime() {
    assert_service_case_registered(
        CATALOG_SURFACE_STATUS_CASE_ID,
        "control-plane",
        "control_plane",
    );

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();

    let provider_contract = trellis_test::TrellisTestContract::from_manifest_json(
        CATALOG_SURFACE_STATUS_PROVIDER_CONTRACT_JSON,
    )
    .expect("build catalog surface status provider contract");
    admin
        .approve_contract(
            &bootstrap_url,
            &provider_contract,
            Some(CATALOG_SURFACE_STATUS_SHAPE_DEPLOYMENT),
            &[],
        )
        .await
        .expect("approve provider shape in separate deployment");

    let client_contract = catalog_surface_status_client_contract()
        .expect("build catalog surface status client contract");
    let observer_contract = catalog_surface_status_observer_contract()
        .expect("build catalog surface status observer contract");
    let client = admin
        .connect_client(&bootstrap_url, &client_contract)
        .await
        .expect("connect live Rust catalog surface status client");
    let core = trellis_rs::sdk::core::CoreClient::new(&client);

    wait_for_catalog_surface_status(
        &core,
        json!({
            "state": "unavailable",
            "reason": "authority_unavailable"
        }),
    )
    .await;
    assert_eq!(
        catalog_surface_status_for(
            &core,
            "missing@v1",
            "rpc",
            "CatalogSurfaceStatus.Ping",
            Some("call")
        )
        .await,
        json!({ "state": "unknown_contract", "contractId": "missing@v1" })
    );
    assert_eq!(
        catalog_surface_status_for(
            &core,
            CATALOG_SURFACE_STATUS_PROVIDER_ID,
            "rpc",
            "CatalogSurfaceStatus.Missing",
            Some("call")
        )
        .await,
        json!({
            "state": "unknown_surface",
            "contractId": CATALOG_SURFACE_STATUS_PROVIDER_ID,
            "kind": "rpc",
            "surface": "CatalogSurfaceStatus.Missing"
        })
    );
    assert_catalog_surface_status_validation_error(
        &core,
        CATALOG_SURFACE_STATUS_PROVIDER_ID,
        "event",
        "CatalogSurfaceStatus.Changed",
        None,
    )
    .await;
    assert_catalog_surface_status_validation_error(
        &core,
        CATALOG_SURFACE_STATUS_PROVIDER_ID,
        "feed",
        "CatalogSurfaceStatus.Feed",
        Some("publish"),
    )
    .await;
    assert_catalog_surface_status_validation_error(
        &core,
        CATALOG_SURFACE_STATUS_PROVIDER_ID,
        "rpc",
        "CatalogSurfaceStatus.Ping",
        Some("subscribe"),
    )
    .await;
    assert_catalog_surface_status_validation_error(
        &core,
        "missing@v1",
        "rpc",
        "CatalogSurfaceStatus.Ping",
        Some("subscribe"),
    )
    .await;
    assert_catalog_surface_status_contract_get(&core, provider_contract.digest()).await;

    let service_key = admin
        .provision_service_instance(&bootstrap_url, &provider_contract, None, None)
        .await
        .expect("provision live catalog surface status provider service instance");
    let service_task = start_catalog_surface_status_provider_service(
        runtime.trellis_url(),
        provider_contract.digest(),
        &service_key,
    )
    .await;
    wait_for_catalog_surface_status(
        &core,
        json!({
            "state": "available",
            "liveImplementer": true,
            "runtime": "live"
        }),
    )
    .await;
    assert_eq!(
        catalog_surface_status_for(
            &core,
            CATALOG_SURFACE_STATUS_PROVIDER_ID,
            "event",
            "CatalogSurfaceStatus.Changed",
            Some("publish")
        )
        .await,
        json!({
            "state": "available",
            "liveImplementer": true,
            "runtime": "live"
        })
    );
    assert_eq!(
        catalog_surface_status_for(
            &core,
            CATALOG_SURFACE_STATUS_PROVIDER_ID,
            "feed",
            "CatalogSurfaceStatus.Feed",
            Some("subscribe")
        )
        .await,
        json!({
            "state": "available",
            "liveImplementer": true,
            "runtime": "live"
        })
    );
    let auth = trellis_rs::sdk::auth::AuthClient::new(&client);
    let observer_user = auth
        .rpc()
        .auth()
        .users_create(&AuthUsersCreateRequest {
            active: Some(true),
            capabilities: Some(vec!["trellis.core::catalog.read".to_string()]),
            capability_groups: Some(vec![]),
            email: Some(format!(
                "{CATALOG_SURFACE_STATUS_OBSERVER_USERNAME}@example.test"
            )),
            name: Some("Catalog Surface Status Observer".to_string()),
            username: Some(CATALOG_SURFACE_STATUS_OBSERVER_USERNAME.to_string()),
        })
        .await
        .expect("create catalog surface status observer user");
    let reset = auth
        .rpc()
        .auth()
        .users_password_reset_create(&AuthUsersPasswordResetCreateRequest {
            expires_in_seconds: None,
            user_id: observer_user.user.user_id,
        })
        .await
        .expect("create catalog surface status observer password reset flow");
    complete_local_password_account_flow(
        runtime.trellis_url(),
        &reset.flow_id,
        CATALOG_SURFACE_STATUS_OBSERVER_USERNAME,
        CATALOG_SURFACE_STATUS_OBSERVER_PASSWORD,
    )
    .await
    .expect("complete catalog surface status observer password flow");
    let observer_seed = trellis_rs::auth::generate_session_keypair().0;
    let observer = connect_with_local_password(
        runtime.trellis_url(),
        &observer_contract,
        &observer_seed,
        CATALOG_SURFACE_STATUS_OBSERVER_USERNAME,
        CATALOG_SURFACE_STATUS_OBSERVER_PASSWORD,
    )
    .await
    .expect("connect catalog surface status observer as non-admin user");
    let observer_core = trellis_rs::sdk::core::CoreClient::new(&observer);
    assert_eq!(
        catalog_surface_status(&observer_core).await,
        json!({
            "state": "unauthorized",
            "missingCapabilities": [CATALOG_SURFACE_STATUS_CAPABILITY]
        })
    );
    assert_eq!(
        call_catalog_surface_status_with_retry(&client, "live").await,
        CatalogDependencyPingOutput {
            message: "live".to_string(),
            served_by: CATALOG_SURFACE_STATUS_PROVIDER_NAME.to_string(),
        }
    );

    let provider_user_nkey = wait_for_auth_connection_user_nkey(&auth, &service_key.session_key)
        .await
        .expect("provider service connection should be listed");
    let kicked = auth
        .rpc()
        .auth()
        .connections_kick(&AuthConnectionsKickRequest {
            user_nkey: provider_user_nkey,
        })
        .await
        .expect("kick provider connection through generated Auth.Connections.Kick");
    assert!(kicked.success, "provider connection kick should succeed");
    service_task.abort_and_wait().await;
    kick_auth_connections_for_session(&auth, &service_key.session_key).await;
    wait_for_catalog_surface_status(
        &core,
        json!({
            "state": "available",
            "liveImplementer": false,
            "runtime": "no_live_implementer"
        }),
    )
    .await;

    let old_provider_contract = trellis_test::TrellisTestContract::from_manifest_json(
        CATALOG_SURFACE_STATUS_OLD_PROVIDER_CONTRACT_JSON,
    )
    .expect("build old catalog surface status provider contract");
    let old_provider_key = admin
        .provision_service_instance(
            &bootstrap_url,
            &old_provider_contract,
            Some(CATALOG_SURFACE_STATUS_OLD_PROVIDER_DEPLOYMENT),
            None,
        )
        .await
        .expect("provision old live catalog surface status provider service instance");
    let _old_provider_client =
        TrellisClient::connect_service_with_contract(ServiceConnectWithContractOptions {
            trellis_url: runtime.trellis_url(),
            contract_id: CATALOG_SURFACE_STATUS_PROVIDER_ID,
            contract_digest: old_provider_contract.digest(),
            contract_json: CATALOG_SURFACE_STATUS_OLD_PROVIDER_CONTRACT_JSON,
            session_key_seed_base64url: &old_provider_key.seed,
            timeout_ms: trellis_rs::service::DEFAULT_TIMEOUT_MS,
            retry_delay_ms: trellis_rs::service::DEFAULT_RETRY_DELAY_MS,
            authority_pending_timeout_ms: trellis_rs::service::DEFAULT_AUTHORITY_PENDING_TIMEOUT_MS,
        })
        .await
        .expect("connect old live catalog surface status provider service");
    wait_for_auth_connection_user_nkey(&auth, &old_provider_key.session_key)
        .await
        .expect("old provider service connection should be listed");
    assert_eq!(
        catalog_surface_status(&core).await,
        json!({
            "state": "available",
            "liveImplementer": false,
            "runtime": "no_live_implementer"
        })
    );

    let unrelated_contract = trellis_test::TrellisTestContract::from_manifest_json(
        CATALOG_DEPENDENCY_PROVIDER_CONTRACT_JSON,
    )
    .expect("build unrelated catalog dependency provider contract");
    let unrelated_key = admin
        .provision_service_instance(&bootstrap_url, &unrelated_contract, None, None)
        .await
        .expect("provision unrelated live service instance");
    let unrelated_service_task = start_catalog_dependency_provider_service(
        runtime.trellis_url(),
        &unrelated_contract,
        &unrelated_key,
    )
    .await;
    wait_for_auth_connection_user_nkey(&auth, &unrelated_key.session_key)
        .await
        .expect("unrelated service connection should be listed");
    assert_eq!(
        catalog_surface_status(&core).await,
        json!({
            "state": "available",
            "liveImplementer": false,
            "runtime": "no_live_implementer"
        })
    );

    let instance_id =
        catalog_surface_status_provider_instance_id(&auth, &service_key.session_key).await;
    auth.rpc()
        .auth()
        .service_instances_disable(&AuthServiceInstancesDisableRequest { instance_id })
        .await
        .expect("disable catalog surface status provider service instance");
    wait_for_catalog_surface_status(
        &core,
        json!({
            "state": "available",
            "liveImplementer": false,
            "runtime": "disabled"
        }),
    )
    .await;

    unrelated_service_task.abort_and_wait().await;
}

#[tokio::test]
async fn control_plane_admin_service_deployment_lifecycle() {
    assert_service_case_registered(
        ADMIN_SERVICE_DEPLOYMENT_LIFECYCLE_CASE_ID,
        "control-plane",
        "control_plane",
    );

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();
    let admin_contract = admin_service_deployment_lifecycle_contract()
        .expect("build service deployment lifecycle admin contract");
    let admin_client = admin
        .connect_client(&bootstrap_url, &admin_contract)
        .await
        .expect("connect live Rust deployment admin client");
    let auth = trellis_rs::sdk::auth::AuthClient::new(&admin_client);

    let created = auth
        .rpc()
        .auth()
        .deployments_create(&AuthDeploymentsCreateRequest(json!({
            "deploymentId": ADMIN_SERVICE_DEPLOYMENT_LIFECYCLE_DEPLOYMENT,
            "kind": "service",
            "namespaces": ["admin", "admin", "ops"],
            "contractCompatibilityMode": "mutable-dev",
        })))
        .await
        .expect("create service deployment through generated Auth RPC");
    assert_eq!(
        deployment_field(&created.deployment, "kind"),
        Some("service")
    );
    assert_eq!(
        deployment_field(&created.deployment, "deploymentId"),
        Some(ADMIN_SERVICE_DEPLOYMENT_LIFECYCLE_DEPLOYMENT)
    );
    assert_eq!(
        created.deployment.get("disabled"),
        Some(&Value::Bool(false))
    );
    assert_eq!(
        created.deployment.get("namespaces"),
        Some(&json!(["admin", "ops"]))
    );
    assert_eq!(
        deployment_field(&created.deployment, "contractCompatibilityMode"),
        Some("mutable-dev")
    );

    let listed = auth
        .rpc()
        .auth()
        .deployments_list(&AuthDeploymentsListRequest {
            kind: Some("service".to_string()),
            disabled: None,
            offset: None,
            limit: 500,
        })
        .await
        .expect("list service deployments through generated Auth RPC");
    assert_eq!(
        listed_deployment(
            &listed.entries,
            ADMIN_SERVICE_DEPLOYMENT_LIFECYCLE_DEPLOYMENT
        )
        .and_then(|entry| entry.get("disabled")),
        Some(&Value::Bool(false))
    );

    let disabled = auth
        .rpc()
        .auth()
        .deployments_disable(&AuthDeploymentsDisableRequest {
            kind: "service".to_string(),
            deployment_id: ADMIN_SERVICE_DEPLOYMENT_LIFECYCLE_DEPLOYMENT.to_string(),
        })
        .await
        .expect("disable service deployment through generated Auth RPC");
    assert_eq!(
        disabled.deployment.get("disabled"),
        Some(&Value::Bool(true))
    );

    let disabled_list = auth
        .rpc()
        .auth()
        .deployments_list(&AuthDeploymentsListRequest {
            kind: Some("service".to_string()),
            disabled: Some(true),
            offset: None,
            limit: 500,
        })
        .await
        .expect("list disabled service deployments through generated Auth RPC");
    assert!(listed_deployment(
        &disabled_list.entries,
        ADMIN_SERVICE_DEPLOYMENT_LIFECYCLE_DEPLOYMENT
    )
    .is_some());

    let enabled = auth
        .rpc()
        .auth()
        .deployments_enable(&AuthDeploymentsEnableRequest {
            kind: "service".to_string(),
            deployment_id: ADMIN_SERVICE_DEPLOYMENT_LIFECYCLE_DEPLOYMENT.to_string(),
        })
        .await
        .expect("enable service deployment through generated Auth RPC");
    assert_eq!(
        enabled.deployment.get("disabled"),
        Some(&Value::Bool(false))
    );

    let removed = auth
        .rpc()
        .auth()
        .deployments_remove(&AuthDeploymentsRemoveRequest {
            kind: "service".to_string(),
            deployment_id: ADMIN_SERVICE_DEPLOYMENT_LIFECYCLE_DEPLOYMENT.to_string(),
            cascade: None,
            purge_unused_contracts: None,
        })
        .await
        .expect("remove service deployment through generated Auth RPC");
    assert!(removed.success);

    let after_remove = auth
        .rpc()
        .auth()
        .deployments_list(&AuthDeploymentsListRequest {
            kind: Some("service".to_string()),
            disabled: None,
            offset: None,
            limit: 500,
        })
        .await
        .expect("list service deployments after removal");
    assert!(listed_deployment(
        &after_remove.entries,
        ADMIN_SERVICE_DEPLOYMENT_LIFECYCLE_DEPLOYMENT
    )
    .is_none());

    let missing_remove = auth
        .rpc()
        .auth()
        .deployments_remove(&AuthDeploymentsRemoveRequest {
            kind: "service".to_string(),
            deployment_id: ADMIN_SERVICE_DEPLOYMENT_LIFECYCLE_DEPLOYMENT.to_string(),
            cascade: None,
            purge_unused_contracts: None,
        })
        .await;
    assert!(missing_remove.is_err());
}

#[tokio::test]
async fn control_plane_admin_service_deployment_rollback_fault() {
    assert_service_case_registered(
        ADMIN_SERVICE_DEPLOYMENT_ROLLBACK_CASE_ID,
        "control-plane",
        "control_plane",
    );

    let mut options = trellis_test::TrellisTestRuntimeOptions::default();
    options.fail_once_hooks = vec![
        "auth.admin.serviceDeployments.createAuthority".to_string(),
        "auth.admin.serviceDeployments.deleteCascadeRecord".to_string(),
    ];
    let runtime = trellis_test::TrellisTestRuntime::start(options)
        .await
        .expect("start live Trellis test runtime with service deployment fault hooks");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();
    let admin_contract = admin_service_deployment_rollback_contract()
        .expect("build service deployment rollback admin contract");
    let admin_client = admin
        .connect_client(&bootstrap_url, &admin_contract)
        .await
        .expect("connect live Rust service deployment rollback admin client");
    let auth = trellis_rs::sdk::auth::AuthClient::new(&admin_client);

    let failed_create = auth
        .rpc()
        .auth()
        .deployments_create(&AuthDeploymentsCreateRequest(json!({
            "deploymentId": ADMIN_SERVICE_DEPLOYMENT_ROLLBACK_DEPLOYMENT,
            "kind": "service",
            "namespaces": ["admin", "rollback"],
            "contractCompatibilityMode": "mutable-dev",
        })))
        .await;
    assert!(failed_create.is_err());
    let after_failed_create = auth
        .rpc()
        .auth()
        .deployments_list(&AuthDeploymentsListRequest {
            kind: Some("service".to_string()),
            disabled: None,
            offset: None,
            limit: 500,
        })
        .await
        .expect("list service deployments after failed create");
    assert!(listed_deployment(
        &after_failed_create.entries,
        ADMIN_SERVICE_DEPLOYMENT_ROLLBACK_DEPLOYMENT
    )
    .is_none());

    auth.rpc()
        .auth()
        .deployments_create(&AuthDeploymentsCreateRequest(json!({
            "deploymentId": ADMIN_SERVICE_DEPLOYMENT_ROLLBACK_DEPLOYMENT,
            "kind": "service",
            "namespaces": ["admin", "rollback"],
            "contractCompatibilityMode": "mutable-dev",
        })))
        .await
        .expect("create service deployment after fail-once hook");
    let service_instance_key = trellis_rs::auth::generate_session_keypair().1;
    let provisioned = auth
        .rpc()
        .auth()
        .service_instances_provision(&AuthServiceInstancesProvisionRequest {
            deployment_id: ADMIN_SERVICE_DEPLOYMENT_ROLLBACK_DEPLOYMENT.to_string(),
            instance_key: service_instance_key,
        })
        .await
        .expect("provision rollback service instance");

    let failed_remove = auth
        .rpc()
        .auth()
        .deployments_remove(&AuthDeploymentsRemoveRequest {
            kind: "service".to_string(),
            deployment_id: ADMIN_SERVICE_DEPLOYMENT_ROLLBACK_DEPLOYMENT.to_string(),
            cascade: Some(true),
            purge_unused_contracts: None,
        })
        .await;
    assert!(failed_remove.is_err());
    let after_failed_remove = auth
        .rpc()
        .auth()
        .deployments_list(&AuthDeploymentsListRequest {
            kind: Some("service".to_string()),
            disabled: None,
            offset: None,
            limit: 500,
        })
        .await
        .expect("list service deployments after failed remove");
    assert!(listed_deployment(
        &after_failed_remove.entries,
        ADMIN_SERVICE_DEPLOYMENT_ROLLBACK_DEPLOYMENT
    )
    .is_some());
    let service_instances = auth
        .rpc()
        .auth()
        .service_instances_list(&AuthServiceInstancesListRequest {
            deployment_id: Some(ADMIN_SERVICE_DEPLOYMENT_ROLLBACK_DEPLOYMENT.to_string()),
            disabled: None,
            limit: 500,
            offset: None,
        })
        .await
        .expect("list service instances after failed remove");
    assert!(service_instances
        .entries
        .iter()
        .any(|entry| entry.instance_id == provisioned.instance.instance_id));

    let removed = auth
        .rpc()
        .auth()
        .deployments_remove(&AuthDeploymentsRemoveRequest {
            kind: "service".to_string(),
            deployment_id: ADMIN_SERVICE_DEPLOYMENT_ROLLBACK_DEPLOYMENT.to_string(),
            cascade: Some(true),
            purge_unused_contracts: None,
        })
        .await
        .expect("retry cascade service deployment remove");
    assert!(removed.success);
    let after_remove = auth
        .rpc()
        .auth()
        .deployments_list(&AuthDeploymentsListRequest {
            kind: Some("service".to_string()),
            disabled: None,
            offset: None,
            limit: 500,
        })
        .await
        .expect("list service deployments after retry remove");
    assert!(listed_deployment(
        &after_remove.entries,
        ADMIN_SERVICE_DEPLOYMENT_ROLLBACK_DEPLOYMENT
    )
    .is_none());
    let service_instances_after_remove = auth
        .rpc()
        .auth()
        .service_instances_list(&AuthServiceInstancesListRequest {
            deployment_id: Some(ADMIN_SERVICE_DEPLOYMENT_ROLLBACK_DEPLOYMENT.to_string()),
            disabled: None,
            limit: 500,
            offset: None,
        })
        .await
        .expect("list service instances after retry remove");
    assert!(!service_instances_after_remove
        .entries
        .iter()
        .any(|entry| entry.instance_id == provisioned.instance.instance_id));
}

#[tokio::test]
async fn control_plane_admin_device_deployment_rollback_fault() {
    assert_service_case_registered(
        ADMIN_DEVICE_DEPLOYMENT_ROLLBACK_CASE_ID,
        "control-plane",
        "control_plane",
    );

    let mut options = trellis_test::TrellisTestRuntimeOptions::default();
    options.fail_once_hooks = vec![
        "auth.admin.deviceDeployments.createAuthority".to_string(),
        "auth.admin.deviceDeployments.deleteCascadeRecord".to_string(),
    ];
    let runtime = trellis_test::TrellisTestRuntime::start(options)
        .await
        .expect("start live Trellis test runtime with device deployment fault hooks");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();
    let admin_contract = admin_device_deployment_rollback_contract()
        .expect("build device deployment rollback admin contract");
    let admin_client = admin
        .connect_client(&bootstrap_url, &admin_contract)
        .await
        .expect("connect live Rust device deployment rollback admin client");
    let auth = trellis_rs::sdk::auth::AuthClient::new(&admin_client);

    let failed_create = auth
        .rpc()
        .auth()
        .deployments_create(&AuthDeploymentsCreateRequest(json!({
            "deploymentId": ADMIN_DEVICE_DEPLOYMENT_ROLLBACK_DEPLOYMENT,
            "kind": "device",
            "reviewMode": "none",
        })))
        .await;
    assert!(failed_create.is_err());
    let after_failed_create = auth
        .rpc()
        .auth()
        .deployments_list(&AuthDeploymentsListRequest {
            kind: Some("device".to_string()),
            disabled: None,
            offset: None,
            limit: 500,
        })
        .await
        .expect("list device deployments after failed create");
    assert!(listed_deployment(
        &after_failed_create.entries,
        ADMIN_DEVICE_DEPLOYMENT_ROLLBACK_DEPLOYMENT
    )
    .is_none());

    auth.rpc()
        .auth()
        .deployments_create(&AuthDeploymentsCreateRequest(json!({
            "deploymentId": ADMIN_DEVICE_DEPLOYMENT_ROLLBACK_DEPLOYMENT,
            "kind": "device",
            "reviewMode": "none",
        })))
        .await
        .expect("create device deployment after fail-once hook");
    let provisioned = auth
        .rpc()
        .auth()
        .devices_provision(&AuthDevicesProvisionRequest {
            deployment_id: ADMIN_DEVICE_DEPLOYMENT_ROLLBACK_DEPLOYMENT.to_string(),
            public_identity_key: ADMIN_DEVICE_DEPLOYMENT_ROLLBACK_PUBLIC_KEY.to_string(),
            activation_key: ADMIN_DEVICE_DEPLOYMENT_ROLLBACK_ACTIVATION_KEY.to_string(),
            metadata: Some(BTreeMap::from([(
                "name".to_string(),
                "rollback-device-control-plane-admin-device-deployment-rollback-fault".to_string(),
            )])),
        })
        .await
        .expect("provision rollback device");

    let failed_remove = auth
        .rpc()
        .auth()
        .deployments_remove(&AuthDeploymentsRemoveRequest {
            kind: "device".to_string(),
            deployment_id: ADMIN_DEVICE_DEPLOYMENT_ROLLBACK_DEPLOYMENT.to_string(),
            cascade: Some(true),
            purge_unused_contracts: None,
        })
        .await;
    assert!(failed_remove.is_err());
    let after_failed_remove = auth
        .rpc()
        .auth()
        .deployments_list(&AuthDeploymentsListRequest {
            kind: Some("device".to_string()),
            disabled: None,
            offset: None,
            limit: 500,
        })
        .await
        .expect("list device deployments after failed remove");
    assert!(listed_deployment(
        &after_failed_remove.entries,
        ADMIN_DEVICE_DEPLOYMENT_ROLLBACK_DEPLOYMENT
    )
    .is_some());
    let devices = auth
        .rpc()
        .auth()
        .devices_list(&AuthDevicesListRequest {
            deployment_id: Some(ADMIN_DEVICE_DEPLOYMENT_ROLLBACK_DEPLOYMENT.to_string()),
            limit: 500,
            offset: None,
            state: None,
        })
        .await
        .expect("list devices after failed remove");
    assert!(devices
        .entries
        .iter()
        .any(|entry| entry.instance_id == provisioned.instance.instance_id));

    let removed = auth
        .rpc()
        .auth()
        .deployments_remove(&AuthDeploymentsRemoveRequest {
            kind: "device".to_string(),
            deployment_id: ADMIN_DEVICE_DEPLOYMENT_ROLLBACK_DEPLOYMENT.to_string(),
            cascade: Some(true),
            purge_unused_contracts: None,
        })
        .await
        .expect("retry cascade device deployment remove");
    assert!(removed.success);
    let after_remove = auth
        .rpc()
        .auth()
        .deployments_list(&AuthDeploymentsListRequest {
            kind: Some("device".to_string()),
            disabled: None,
            offset: None,
            limit: 500,
        })
        .await
        .expect("list device deployments after retry remove");
    assert!(listed_deployment(
        &after_remove.entries,
        ADMIN_DEVICE_DEPLOYMENT_ROLLBACK_DEPLOYMENT
    )
    .is_none());
    let devices_after_remove = auth
        .rpc()
        .auth()
        .devices_list(&AuthDevicesListRequest {
            deployment_id: Some(ADMIN_DEVICE_DEPLOYMENT_ROLLBACK_DEPLOYMENT.to_string()),
            limit: 500,
            offset: None,
            state: None,
        })
        .await
        .expect("list devices after retry remove");
    assert!(!devices_after_remove
        .entries
        .iter()
        .any(|entry| entry.instance_id == provisioned.instance.instance_id));
}

#[tokio::test]
async fn control_plane_admin_service_deployment_validate_before_persist_kick() {
    assert_rust_service_case_registered(SERVICE_DEPLOYMENT_VALIDATE_CASE_ID);

    let mut runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();
    let deployment_id = SERVICE_DEPLOYMENT_VALIDATE_CASE_ID;

    let service_contract = trellis_test::TrellisTestContract::from_manifest_json(
        CATALOG_RESTART_SERVICE_CONTRACT_JSON,
    )
    .expect("build service deployment validation probe contract");
    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, Some(deployment_id), None)
        .await
        .expect("provision live service deployment validation probe");
    let service_task = start_catalog_restart_service(
        runtime.trellis_url(),
        &service_contract,
        &service_key,
        1,
        true,
    )
    .await;

    let client_contract =
        catalog_restart_client_contract().expect("build service deployment validation client");
    let client = admin
        .connect_client(&bootstrap_url, &client_contract)
        .await
        .expect("connect live Rust validation probe client");
    assert_eq!(
        call_catalog_restart_with_retry(&client, "before").await,
        CatalogRestartPingOutput {
            message: "before".to_string(),
            generation: 1,
        }
    );

    let admin_contract = admin_refresh_rollback_contract(
        SERVICE_DEPLOYMENT_VALIDATE_CASE_ID,
        &["Auth.Deployments.Disable", "Auth.Deployments.List"],
    )
    .expect("build service deployment validation admin contract");
    let admin_seed = trellis_rs::auth::generate_session_keypair().0;
    let (admin_client, admin_reconnect) = admin
        .connect_client_with_session_seed_reconnectable(&bootstrap_url, &admin_contract, admin_seed)
        .await
        .expect("connect live Rust service deployment validation admin client");
    drop(admin_client);

    inject_fail_once_hook(&runtime, SERVICE_DEPLOYMENT_VALIDATE_HOOK);
    runtime
        .restart_control_plane()
        .await
        .expect("restart Trellis with service deployment validate hook");
    let admin_client = admin_reconnect
        .connect_bound_only()
        .await
        .expect("reconnect service deployment validation admin client");
    let auth = trellis_rs::sdk::auth::AuthClient::new(&admin_client);
    let auth_rpc = auth.rpc().auth();
    let failed = auth_rpc
        .deployments_disable(&AuthDeploymentsDisableRequest {
            kind: "service".to_string(),
            deployment_id: deployment_id.to_string(),
        })
        .await;

    assert_refresh_hook_failure(failed, SERVICE_DEPLOYMENT_VALIDATE_HOOK);
    assert_eq!(
        deployment_disabled(&auth_rpc, "service", deployment_id).await,
        Some(false)
    );
    assert_eq!(
        call_catalog_restart_with_retry(&client, "after").await,
        CatalogRestartPingOutput {
            message: "after".to_string(),
            generation: 1,
        }
    );

    service_task.abort_and_wait().await;
}

#[tokio::test]
async fn control_plane_admin_service_deployment_disable_refresh_rollback() {
    let case_id = "control-plane.admin-service-deployment-disable-refresh-rollback";
    assert_rust_service_case_registered(case_id);

    let runtime = start_runtime_with_fail_once_hook(SERVICE_DEPLOYMENT_REFRESH_HOOK).await;
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();
    let contract = admin_refresh_rollback_contract(
        case_id,
        &[
            "Auth.Deployments.Create",
            "Auth.Deployments.Disable",
            "Auth.Deployments.List",
        ],
    )
    .expect("build service deployment disable rollback admin contract");
    let admin_client = admin
        .connect_client(&bootstrap_url, &contract)
        .await
        .expect("connect live Rust service deployment disable rollback admin client");
    let auth = trellis_rs::sdk::auth::AuthClient::new(&admin_client);
    let auth_rpc = auth.rpc().auth();
    let deployment_id = case_id;

    create_service_deployment(&auth_rpc, deployment_id).await;
    let failed = auth_rpc
        .deployments_disable(&AuthDeploymentsDisableRequest {
            kind: "service".to_string(),
            deployment_id: deployment_id.to_string(),
        })
        .await;

    assert_refresh_hook_failure(failed, SERVICE_DEPLOYMENT_REFRESH_HOOK);
    assert_eq!(
        deployment_disabled(&auth_rpc, "service", deployment_id).await,
        Some(false)
    );
}

#[tokio::test]
async fn control_plane_admin_service_deployment_enable_refresh_rollback() {
    let case_id = "control-plane.admin-service-deployment-enable-refresh-rollback";
    assert_rust_service_case_registered(case_id);

    let mut runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();
    let contract = admin_refresh_rollback_contract(
        case_id,
        &[
            "Auth.Deployments.Create",
            "Auth.Deployments.Disable",
            "Auth.Deployments.Enable",
            "Auth.Deployments.List",
        ],
    )
    .expect("build service deployment enable rollback admin contract");
    let seed = trellis_rs::auth::generate_session_keypair().0;
    let (admin_client, reconnect) = admin
        .connect_client_with_session_seed_reconnectable(&bootstrap_url, &contract, seed)
        .await
        .expect("connect live Rust service deployment enable rollback admin client");
    let auth = trellis_rs::sdk::auth::AuthClient::new(&admin_client);
    let auth_rpc = auth.rpc().auth();
    let deployment_id = case_id;

    create_service_deployment(&auth_rpc, deployment_id).await;
    auth_rpc
        .deployments_disable(&AuthDeploymentsDisableRequest {
            kind: "service".to_string(),
            deployment_id: deployment_id.to_string(),
        })
        .await
        .expect("disable service deployment before enable rollback test");
    assert_eq!(
        deployment_disabled(&auth_rpc, "service", deployment_id).await,
        Some(true)
    );
    drop(auth_rpc);
    drop(auth);
    drop(admin_client);

    inject_fail_once_hook(&runtime, SERVICE_DEPLOYMENT_REFRESH_HOOK);
    runtime
        .restart_control_plane()
        .await
        .expect("restart Trellis with service deployment refresh hook");
    let admin_client = reconnect
        .connect_bound_only()
        .await
        .expect("reconnect service deployment enable rollback admin client");
    let auth = trellis_rs::sdk::auth::AuthClient::new(&admin_client);
    let auth_rpc = auth.rpc().auth();
    let failed = auth_rpc
        .deployments_enable(&AuthDeploymentsEnableRequest {
            kind: "service".to_string(),
            deployment_id: deployment_id.to_string(),
        })
        .await;

    assert_refresh_hook_failure(failed, SERVICE_DEPLOYMENT_REFRESH_HOOK);
    assert_eq!(
        deployment_disabled(&auth_rpc, "service", deployment_id).await,
        Some(true)
    );
}

#[tokio::test]
async fn control_plane_admin_service_instance_disable_refresh_rollback() {
    let case_id = "control-plane.admin-service-instance-disable-refresh-rollback";
    assert_rust_service_case_registered(case_id);

    let runtime = start_runtime_with_fail_once_hook(SERVICE_INSTANCE_REFRESH_HOOK).await;
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();
    let contract = admin_refresh_rollback_contract(
        case_id,
        &[
            "Auth.Deployments.Create",
            "Auth.ServiceInstances.Provision",
            "Auth.ServiceInstances.Disable",
            "Auth.ServiceInstances.List",
        ],
    )
    .expect("build service instance disable rollback admin contract");
    let admin_client = admin
        .connect_client(&bootstrap_url, &contract)
        .await
        .expect("connect live Rust service instance disable rollback admin client");
    let auth = trellis_rs::sdk::auth::AuthClient::new(&admin_client);
    let auth_rpc = auth.rpc().auth();
    let deployment_id = case_id;

    create_service_deployment(&auth_rpc, deployment_id).await;
    let instance_id = provision_service_instance(&auth_rpc, deployment_id).await;
    let failed = auth_rpc
        .service_instances_disable(&AuthServiceInstancesDisableRequest {
            instance_id: instance_id.clone(),
        })
        .await;

    assert_refresh_hook_failure(failed, SERVICE_INSTANCE_REFRESH_HOOK);
    assert_service_instance_disabled(&auth_rpc, deployment_id, &instance_id, false).await;
}

#[tokio::test]
async fn control_plane_admin_service_instance_enable_refresh_rollback() {
    let case_id = "control-plane.admin-service-instance-enable-refresh-rollback";
    assert_rust_service_case_registered(case_id);

    let mut runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();
    let contract = admin_refresh_rollback_contract(
        case_id,
        &[
            "Auth.Deployments.Create",
            "Auth.ServiceInstances.Provision",
            "Auth.ServiceInstances.Disable",
            "Auth.ServiceInstances.Enable",
            "Auth.ServiceInstances.List",
        ],
    )
    .expect("build service instance enable rollback admin contract");
    let seed = trellis_rs::auth::generate_session_keypair().0;
    let (admin_client, reconnect) = admin
        .connect_client_with_session_seed_reconnectable(&bootstrap_url, &contract, seed)
        .await
        .expect("connect live Rust service instance enable rollback admin client");
    let auth = trellis_rs::sdk::auth::AuthClient::new(&admin_client);
    let auth_rpc = auth.rpc().auth();
    let deployment_id = case_id;

    create_service_deployment(&auth_rpc, deployment_id).await;
    let instance_id = provision_service_instance(&auth_rpc, deployment_id).await;
    auth_rpc
        .service_instances_disable(&AuthServiceInstancesDisableRequest {
            instance_id: instance_id.clone(),
        })
        .await
        .expect("disable service instance before enable rollback test");
    assert_service_instance_disabled(&auth_rpc, deployment_id, &instance_id, true).await;
    drop(auth_rpc);
    drop(auth);
    drop(admin_client);

    inject_fail_once_hook(&runtime, SERVICE_INSTANCE_REFRESH_HOOK);
    runtime
        .restart_control_plane()
        .await
        .expect("restart Trellis with service instance refresh hook");
    let admin_client = reconnect
        .connect_bound_only()
        .await
        .expect("reconnect service instance enable rollback admin client");
    let auth = trellis_rs::sdk::auth::AuthClient::new(&admin_client);
    let auth_rpc = auth.rpc().auth();
    let failed = auth_rpc
        .service_instances_enable(&AuthServiceInstancesEnableRequest {
            instance_id: instance_id.clone(),
        })
        .await;

    assert_refresh_hook_failure(failed, SERVICE_INSTANCE_REFRESH_HOOK);
    assert_service_instance_disabled(&auth_rpc, deployment_id, &instance_id, true).await;
}

#[tokio::test]
async fn control_plane_admin_service_instance_remove_refresh_rollback() {
    let case_id = "control-plane.admin-service-instance-remove-refresh-rollback";
    assert_rust_service_case_registered(case_id);

    let runtime = start_runtime_with_fail_once_hook(SERVICE_INSTANCE_REFRESH_HOOK).await;
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();
    let contract = admin_refresh_rollback_contract(
        case_id,
        &[
            "Auth.Deployments.Create",
            "Auth.ServiceInstances.Provision",
            "Auth.ServiceInstances.Remove",
            "Auth.ServiceInstances.List",
        ],
    )
    .expect("build service instance remove rollback admin contract");
    let admin_client = admin
        .connect_client(&bootstrap_url, &contract)
        .await
        .expect("connect live Rust service instance remove rollback admin client");
    let auth = trellis_rs::sdk::auth::AuthClient::new(&admin_client);
    let auth_rpc = auth.rpc().auth();
    let deployment_id = case_id;

    create_service_deployment(&auth_rpc, deployment_id).await;
    let instance_id = provision_service_instance(&auth_rpc, deployment_id).await;
    let failed = auth_rpc
        .service_instances_remove(&AuthServiceInstancesRemoveRequest {
            instance_id: instance_id.clone(),
        })
        .await;

    assert_refresh_hook_failure(failed, SERVICE_INSTANCE_REFRESH_HOOK);
    assert_service_instance_disabled(&auth_rpc, deployment_id, &instance_id, false).await;
}

#[tokio::test]
async fn control_plane_admin_device_deployment_disable_refresh_rollback() {
    let case_id = "control-plane.admin-device-deployment-disable-refresh-rollback";
    assert_rust_service_case_registered(case_id);

    let runtime = start_runtime_with_fail_once_hook(DEVICE_DEPLOYMENT_REFRESH_HOOK).await;
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();
    let contract = admin_refresh_rollback_contract(
        case_id,
        &[
            "Auth.Deployments.Create",
            "Auth.Deployments.Disable",
            "Auth.Deployments.List",
        ],
    )
    .expect("build device deployment disable rollback admin contract");
    let admin_client = admin
        .connect_client(&bootstrap_url, &contract)
        .await
        .expect("connect live Rust device deployment disable rollback admin client");
    let auth = trellis_rs::sdk::auth::AuthClient::new(&admin_client);
    let auth_rpc = auth.rpc().auth();
    let deployment_id = case_id;

    create_device_deployment(&auth_rpc, deployment_id).await;
    let failed = auth_rpc
        .deployments_disable(&AuthDeploymentsDisableRequest {
            kind: "device".to_string(),
            deployment_id: deployment_id.to_string(),
        })
        .await;

    assert_refresh_hook_failure(failed, DEVICE_DEPLOYMENT_REFRESH_HOOK);
    assert_eq!(
        deployment_disabled(&auth_rpc, "device", deployment_id).await,
        Some(false)
    );
}

#[tokio::test]
async fn control_plane_admin_device_deployment_enable_refresh_rollback() {
    let case_id = "control-plane.admin-device-deployment-enable-refresh-rollback";
    assert_rust_service_case_registered(case_id);

    let mut runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();
    let contract = admin_refresh_rollback_contract(
        case_id,
        &[
            "Auth.Deployments.Create",
            "Auth.Deployments.Disable",
            "Auth.Deployments.Enable",
            "Auth.Deployments.List",
        ],
    )
    .expect("build device deployment enable rollback admin contract");
    let seed = trellis_rs::auth::generate_session_keypair().0;
    let (admin_client, reconnect) = admin
        .connect_client_with_session_seed_reconnectable(&bootstrap_url, &contract, seed)
        .await
        .expect("connect live Rust device deployment enable rollback admin client");
    let auth = trellis_rs::sdk::auth::AuthClient::new(&admin_client);
    let auth_rpc = auth.rpc().auth();
    let deployment_id = case_id;

    create_device_deployment(&auth_rpc, deployment_id).await;
    auth_rpc
        .deployments_disable(&AuthDeploymentsDisableRequest {
            kind: "device".to_string(),
            deployment_id: deployment_id.to_string(),
        })
        .await
        .expect("disable device deployment before enable rollback test");
    assert_eq!(
        deployment_disabled(&auth_rpc, "device", deployment_id).await,
        Some(true)
    );
    drop(auth_rpc);
    drop(auth);
    drop(admin_client);

    inject_fail_once_hook(&runtime, DEVICE_DEPLOYMENT_REFRESH_HOOK);
    runtime
        .restart_control_plane()
        .await
        .expect("restart Trellis with device deployment refresh hook");
    let admin_client = reconnect
        .connect_bound_only()
        .await
        .expect("reconnect device deployment enable rollback admin client");
    let auth = trellis_rs::sdk::auth::AuthClient::new(&admin_client);
    let auth_rpc = auth.rpc().auth();
    let failed = auth_rpc
        .deployments_enable(&AuthDeploymentsEnableRequest {
            kind: "device".to_string(),
            deployment_id: deployment_id.to_string(),
        })
        .await;

    assert_refresh_hook_failure(failed, DEVICE_DEPLOYMENT_REFRESH_HOOK);
    assert_eq!(
        deployment_disabled(&auth_rpc, "device", deployment_id).await,
        Some(true)
    );
}

#[tokio::test]
async fn control_plane_admin_device_instance_disable_refresh_rollback() {
    let case_id = "control-plane.admin-device-instance-disable-refresh-rollback";
    assert_rust_service_case_registered(case_id);

    let runtime = start_runtime_with_fail_once_hook(DEVICE_INSTANCE_REFRESH_HOOK).await;
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();
    let contract = admin_refresh_rollback_contract(
        case_id,
        &[
            "Auth.Deployments.Create",
            "Auth.Devices.Provision",
            "Auth.Devices.Disable",
            "Auth.Devices.List",
        ],
    )
    .expect("build device instance disable rollback admin contract");
    let admin_client = admin
        .connect_client(&bootstrap_url, &contract)
        .await
        .expect("connect live Rust device instance disable rollback admin client");
    let auth = trellis_rs::sdk::auth::AuthClient::new(&admin_client);
    let auth_rpc = auth.rpc().auth();
    let deployment_id = case_id;

    create_device_deployment(&auth_rpc, deployment_id).await;
    let instance_id = provision_device(&auth_rpc, deployment_id, case_id).await;
    let failed = auth_rpc
        .devices_disable(&AuthDevicesDisableRequest {
            instance_id: instance_id.clone(),
        })
        .await;

    assert_refresh_hook_failure(failed, DEVICE_INSTANCE_REFRESH_HOOK);
    assert_device_state(&auth_rpc, deployment_id, &instance_id, "registered").await;
}

#[tokio::test]
async fn control_plane_admin_device_instance_enable_refresh_rollback() {
    let case_id = "control-plane.admin-device-instance-enable-refresh-rollback";
    assert_rust_service_case_registered(case_id);

    let mut runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();
    let contract = admin_refresh_rollback_contract(
        case_id,
        &[
            "Auth.Deployments.Create",
            "Auth.Devices.Provision",
            "Auth.Devices.Disable",
            "Auth.Devices.Enable",
            "Auth.Devices.List",
        ],
    )
    .expect("build device instance enable rollback admin contract");
    let seed = trellis_rs::auth::generate_session_keypair().0;
    let (admin_client, reconnect) = admin
        .connect_client_with_session_seed_reconnectable(&bootstrap_url, &contract, seed)
        .await
        .expect("connect live Rust device instance enable rollback admin client");
    let auth = trellis_rs::sdk::auth::AuthClient::new(&admin_client);
    let auth_rpc = auth.rpc().auth();
    let deployment_id = case_id;

    create_device_deployment(&auth_rpc, deployment_id).await;
    let instance_id = provision_device(&auth_rpc, deployment_id, case_id).await;
    auth_rpc
        .devices_disable(&AuthDevicesDisableRequest {
            instance_id: instance_id.clone(),
        })
        .await
        .expect("disable device instance before enable rollback test");
    assert_device_state(&auth_rpc, deployment_id, &instance_id, "disabled").await;
    drop(auth_rpc);
    drop(auth);
    drop(admin_client);

    inject_fail_once_hook(&runtime, DEVICE_INSTANCE_REFRESH_HOOK);
    runtime
        .restart_control_plane()
        .await
        .expect("restart Trellis with device instance refresh hook");
    let admin_client = reconnect
        .connect_bound_only()
        .await
        .expect("reconnect device instance enable rollback admin client");
    let auth = trellis_rs::sdk::auth::AuthClient::new(&admin_client);
    let auth_rpc = auth.rpc().auth();
    let failed = auth_rpc
        .devices_enable(&AuthDevicesEnableRequest {
            instance_id: instance_id.clone(),
        })
        .await;

    assert_refresh_hook_failure(failed, DEVICE_INSTANCE_REFRESH_HOOK);
    assert_device_state(&auth_rpc, deployment_id, &instance_id, "disabled").await;
}

#[tokio::test]
async fn control_plane_admin_device_instance_remove_refresh_rollback() {
    let case_id = "control-plane.admin-device-instance-remove-refresh-rollback";
    assert_rust_service_case_registered(case_id);

    let runtime = start_runtime_with_fail_once_hook(DEVICE_INSTANCE_REFRESH_HOOK).await;
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();
    let contract = admin_refresh_rollback_contract(
        case_id,
        &[
            "Auth.Deployments.Create",
            "Auth.Devices.Provision",
            "Auth.Devices.Remove",
            "Auth.Devices.List",
        ],
    )
    .expect("build device instance remove rollback admin contract");
    let admin_client = admin
        .connect_client(&bootstrap_url, &contract)
        .await
        .expect("connect live Rust device instance remove rollback admin client");
    let auth = trellis_rs::sdk::auth::AuthClient::new(&admin_client);
    let auth_rpc = auth.rpc().auth();
    let deployment_id = case_id;

    create_device_deployment(&auth_rpc, deployment_id).await;
    let instance_id = provision_device(&auth_rpc, deployment_id, case_id).await;
    let failed = auth_rpc
        .devices_remove(&AuthDevicesRemoveRequest {
            instance_id: instance_id.clone(),
        })
        .await;

    assert_refresh_hook_failure(failed, DEVICE_INSTANCE_REFRESH_HOOK);
    assert_device_state(&auth_rpc, deployment_id, &instance_id, "registered").await;
}

fn listed_deployment<'a>(entries: &'a [Value], deployment_id: &str) -> Option<&'a Value> {
    entries
        .iter()
        .find(|entry| deployment_field(entry, "deploymentId") == Some(deployment_id))
}

fn deployment_field<'a>(deployment: &'a Value, field: &str) -> Option<&'a str> {
    deployment.get(field).and_then(Value::as_str)
}

async fn start_runtime_with_fail_once_hook(hook: &str) -> trellis_test::TrellisTestRuntime {
    let mut options = trellis_test::TrellisTestRuntimeOptions::default();
    options.fail_once_hooks = vec![hook.to_string()];
    trellis_test::TrellisTestRuntime::start(options)
        .await
        .expect("start live Trellis test runtime with refresh fail-once hook")
}

fn assert_rust_service_case_registered(case_id: &str) {
    assert!(
        crate::support::cases::rust_service_case_by_id(case_id).is_some(),
        "Rust service manifest is missing {case_id}"
    );
}

fn assert_refresh_hook_failure<T, E: std::fmt::Debug>(result: Result<T, E>, hook: &str) {
    match result {
        Ok(_) => panic!("expected refresh hook failure for {hook}"),
        Err(error) => {
            let message = format!("{error:?}");
            assert!(
                message.contains(hook),
                "expected error to include refresh hook {hook}, got {message}"
            );
        }
    }
}

fn inject_fail_once_hook(runtime: &trellis_test::TrellisTestRuntime, hook: &str) {
    let config_path = runtime.workdir().join("trellis/config.jsonc");
    let config = std::fs::read_to_string(&config_path).expect("read Trellis test config");
    let hooks = serde_json::to_string_pretty(&vec![hook]).expect("serialize fail-once hook");
    let updated = config.replacen(
        "  \"oauth\": {",
        &format!("  \"trellisTest\": {{\n    \"failOnce\": {hooks}\n  }},\n  \"oauth\": {{"),
        1,
    );
    assert_ne!(
        updated, config,
        "Trellis test config should contain oauth block"
    );
    std::fs::write(config_path, updated).expect("write Trellis test config with fail-once hook");
}

async fn create_service_deployment(
    auth_rpc: &trellis_rs::sdk::auth::client::AuthRpc<'_>,
    deployment_id: &str,
) {
    auth_rpc
        .deployments_create(&AuthDeploymentsCreateRequest(json!({
            "deploymentId": deployment_id,
            "kind": "service",
            "namespaces": ["admin", "refresh", "rollback"],
            "contractCompatibilityMode": "mutable-dev",
        })))
        .await
        .expect("create service deployment through generated Auth RPC");
}

async fn create_device_deployment(
    auth_rpc: &trellis_rs::sdk::auth::client::AuthRpc<'_>,
    deployment_id: &str,
) {
    auth_rpc
        .deployments_create(&AuthDeploymentsCreateRequest(json!({
            "deploymentId": deployment_id,
            "kind": "device",
            "reviewMode": "none",
        })))
        .await
        .expect("create device deployment through generated Auth RPC");
}

async fn deployment_disabled(
    auth_rpc: &trellis_rs::sdk::auth::client::AuthRpc<'_>,
    kind: &str,
    deployment_id: &str,
) -> Option<bool> {
    let listed = auth_rpc
        .deployments_list(&AuthDeploymentsListRequest {
            kind: Some(kind.to_string()),
            disabled: None,
            offset: None,
            limit: 500,
        })
        .await
        .expect("list deployments through generated Auth RPC");
    listed_deployment(&listed.entries, deployment_id)
        .and_then(|entry| entry.get("disabled"))
        .and_then(Value::as_bool)
}

async fn provision_service_instance(
    auth_rpc: &trellis_rs::sdk::auth::client::AuthRpc<'_>,
    deployment_id: &str,
) -> String {
    auth_rpc
        .service_instances_provision(&AuthServiceInstancesProvisionRequest {
            deployment_id: deployment_id.to_string(),
            instance_key: trellis_rs::auth::generate_session_keypair().1,
        })
        .await
        .expect("provision service instance through generated Auth RPC")
        .instance
        .instance_id
}

async fn assert_service_instance_disabled(
    auth_rpc: &trellis_rs::sdk::auth::client::AuthRpc<'_>,
    deployment_id: &str,
    instance_id: &str,
    expected: bool,
) {
    let listed = auth_rpc
        .service_instances_list(&AuthServiceInstancesListRequest {
            deployment_id: Some(deployment_id.to_string()),
            disabled: None,
            limit: 500,
            offset: None,
        })
        .await
        .expect("list service instances through generated Auth RPC");
    let instance = listed
        .entries
        .iter()
        .find(|entry| entry.instance_id == instance_id)
        .expect("service instance should be listed");
    assert_eq!(instance.disabled, expected);
}

async fn provision_device(
    auth_rpc: &trellis_rs::sdk::auth::client::AuthRpc<'_>,
    deployment_id: &str,
    key_suffix: &str,
) -> String {
    auth_rpc
        .devices_provision(&AuthDevicesProvisionRequest {
            deployment_id: deployment_id.to_string(),
            public_identity_key: format!("device-key-{key_suffix}"),
            activation_key: format!("activation-key-{key_suffix}"),
            metadata: Some(BTreeMap::from([(
                "name".to_string(),
                key_suffix.to_string(),
            )])),
        })
        .await
        .expect("provision device through generated Auth RPC")
        .instance
        .instance_id
}

async fn assert_device_state(
    auth_rpc: &trellis_rs::sdk::auth::client::AuthRpc<'_>,
    deployment_id: &str,
    instance_id: &str,
    expected: &str,
) {
    let listed = auth_rpc
        .devices_list(&AuthDevicesListRequest {
            deployment_id: Some(deployment_id.to_string()),
            limit: 500,
            offset: None,
            state: None,
        })
        .await
        .expect("list devices through generated Auth RPC");
    let instance = listed
        .entries
        .iter()
        .find(|entry| entry.instance_id == instance_id)
        .expect("device instance should be listed");
    assert_eq!(instance.state, expected);
}

#[tokio::test]
async fn control_plane_sessions_survive_control_plane_restart() {
    assert_service_case_registered(SESSIONS_RESTART_CASE_ID, "control-plane", "control_plane");

    let mut runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();

    let contract =
        sessions_restart_client_contract().expect("build sessions restart client contract");
    let client_session_seed = trellis_rs::auth::generate_session_keypair().0;
    let (client, client_reconnect) = admin
        .connect_client_with_session_seed_reconnectable(
            &bootstrap_url,
            &contract,
            client_session_seed,
        )
        .await
        .expect("connect live Rust sessions restart client before restart");
    let session_key = client.auth().session_key.clone();
    let auth = trellis_rs::sdk::auth::AuthClient::new(&client);
    let before_me = auth
        .rpc()
        .auth()
        .sessions_me()
        .await
        .expect("call Auth.Sessions.Me before control-plane restart");
    assert_app_user_session(&before_me);
    let before_user_id = session_user_id(&before_me).expect("session user should have a userId");

    assert_session_listed(
        &auth
            .rpc()
            .auth()
            .sessions_list(&auth_sessions_list_request())
            .await
            .expect("list sessions before control-plane restart"),
        &session_key,
    );
    drop(client);

    runtime
        .restart_control_plane()
        .await
        .expect("restart only the Trellis control-plane process");

    let client = client_reconnect
        .connect_bound_only()
        .await
        .expect("reconnect bound sessions restart client after restart without fresh auth flow");
    let auth = trellis_rs::sdk::auth::AuthClient::new(&client);
    let after_me = auth
        .rpc()
        .auth()
        .sessions_me()
        .await
        .expect("call Auth.Sessions.Me after control-plane restart");

    assert_app_user_session(&after_me);
    assert_eq!(
        session_user_id(&after_me).as_deref(),
        Some(before_user_id.as_str())
    );
    assert_session_listed(
        &auth
            .rpc()
            .auth()
            .sessions_list(&auth_sessions_list_request())
            .await
            .expect("list sessions after control-plane restart"),
        &session_key,
    );
}

#[tokio::test]
async fn control_plane_state_persists_across_control_plane_restart() {
    assert_service_case_registered(STATE_RESTART_CASE_ID, "control-plane", "control_plane");

    let mut runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();

    let contract = state_restart_client_contract().expect("build state restart client contract");
    let client_session_seed = trellis_rs::auth::generate_session_keypair().0;
    let (client, client_reconnect) = admin
        .connect_client_with_session_seed_reconnectable(
            &bootstrap_url,
            &contract,
            client_session_seed,
        )
        .await
        .expect("connect live Rust state restart client before restart");

    let preferences = trellis_rs::client::ValueStateStore::<_, StateRestartPreferences>::new(
        &client,
        "preferences",
    );
    let drafts = trellis_rs::client::MapStateStore::<_, StateRestartDraft>::new(&client, "drafts")
        .prefix(STATE_RESTART_DRAFT_PREFIX);

    let written_preferences = preferences
        .put_with_options(
            &StateRestartPreferences {
                theme: "dark".to_string(),
                density: "comfortable".to_string(),
            },
            &trellis_rs::client::PutStateOptions {
                expected_revision: trellis_rs::client::ExpectedPutRevision::CreateIfAbsent,
                ..Default::default()
            },
        )
        .await
        .expect("write preferences before control-plane restart");
    assert!(written_preferences.applied);
    let written_preferences_entry = current_state_entry(
        written_preferences.entry,
        "expected preferences write to return a current entry",
    );
    assert_eq!(written_preferences_entry.value.theme, "dark");
    assert!(!written_preferences_entry.updated_at.is_empty());

    let written_draft = drafts
        .put_with_options(
            STATE_RESTART_DRAFT_KEY,
            &StateRestartDraft {
                title: "Restart Draft".to_string(),
                body: "from before restart".to_string(),
            },
            &trellis_rs::client::PutStateOptions {
                expected_revision: trellis_rs::client::ExpectedPutRevision::CreateIfAbsent,
                ..Default::default()
            },
        )
        .await
        .expect("write draft before control-plane restart");
    assert!(written_draft.applied);
    let written_draft_entry = current_map_state_entry(
        written_draft.entry,
        "expected draft write to return a current entry",
    );
    assert_eq!(
        written_draft_entry.key,
        format!("{STATE_RESTART_DRAFT_PREFIX}/{STATE_RESTART_DRAFT_KEY}")
    );
    assert!(!written_draft_entry.updated_at.is_empty());
    drop(client);

    runtime
        .restart_control_plane()
        .await
        .expect("restart only the Trellis control-plane process");

    let client = client_reconnect
        .connect_bound_only()
        .await
        .expect("reconnect bound state restart client after restart without fresh auth flow");
    let preferences = trellis_rs::client::ValueStateStore::<_, StateRestartPreferences>::new(
        &client,
        "preferences",
    );
    let drafts = trellis_rs::client::MapStateStore::<_, StateRestartDraft>::new(&client, "drafts")
        .prefix(STATE_RESTART_DRAFT_PREFIX);

    let found_preferences = match preferences
        .get()
        .await
        .expect("read preferences after control-plane restart")
    {
        trellis_rs::client::StateGetResult::Found { entry, .. } => entry,
        other => panic!("expected current preferences after restart, got {other:?}"),
    };
    assert_eq!(
        found_preferences.value,
        StateRestartPreferences {
            theme: "dark".to_string(),
            density: "comfortable".to_string(),
        }
    );
    assert_eq!(
        found_preferences.revision,
        written_preferences_entry.revision
    );
    assert_eq!(
        found_preferences.updated_at,
        written_preferences_entry.updated_at
    );

    let found_draft = match drafts
        .get(STATE_RESTART_DRAFT_KEY)
        .await
        .expect("read draft after control-plane restart")
    {
        trellis_rs::client::StateGetResult::Found { entry, .. } => entry,
        other => panic!("expected current draft after restart, got {other:?}"),
    };
    assert_eq!(
        found_draft.key,
        format!("{STATE_RESTART_DRAFT_PREFIX}/{STATE_RESTART_DRAFT_KEY}")
    );
    assert_eq!(
        found_draft.value,
        StateRestartDraft {
            title: "Restart Draft".to_string(),
            body: "from before restart".to_string(),
        }
    );
    assert_eq!(found_draft.revision, written_draft_entry.revision);
    assert_eq!(found_draft.updated_at, written_draft_entry.updated_at);
}

#[tokio::test]
async fn control_plane_resources_survive_control_plane_restart() {
    assert_service_case_registered(RESOURCES_RESTART_CASE_ID, "control-plane", "control_plane");

    let mut runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();

    let service_contract = trellis_test::TrellisTestContract::from_manifest_json(
        RESOURCES_RESTART_SERVICE_CONTRACT_JSON,
    )
    .expect("build resources restart service contract");
    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision live resources restart service instance");

    let service = connect_resources_restart_service(
        runtime.trellis_url(),
        service_contract.digest(),
        &service_key,
    )
    .await;
    assert_resources_restart_bindings(&service);

    let kv = service
        .kv_client("records")
        .await
        .expect("open fresh records KV client before restart");
    let store = service
        .store_client("blobs")
        .await
        .expect("open fresh blobs store client before restart");
    kv.put(
        RESOURCES_RESTART_KV_KEY,
        Bytes::from(
            serde_json::to_vec(&ResourceRestartRecord {
                message: "before restart".to_string(),
            })
            .expect("serialize resource restart KV record"),
        ),
    )
    .await
    .expect("write records KV value before control-plane restart");
    store
        .write(
            RESOURCES_RESTART_STORE_KEY,
            Bytes::from_static(b"blob before restart"),
        )
        .await
        .expect("write blobs store bytes before control-plane restart");
    drop(store);
    drop(kv);
    drop(service);

    runtime
        .restart_control_plane()
        .await
        .expect("restart only the Trellis control-plane process");

    let service = connect_resources_restart_service(
        runtime.trellis_url(),
        service_contract.digest(),
        &service_key,
    )
    .await;
    assert_resources_restart_bindings(&service);

    let kv = service
        .kv_client("records")
        .await
        .expect("open fresh records KV client after restart");
    let stored_record: ResourceRestartRecord = serde_json::from_slice(
        &kv.get(RESOURCES_RESTART_KV_KEY)
            .await
            .expect("read records KV value after control-plane restart")
            .expect("records KV value should survive control-plane restart"),
    )
    .expect("decode records KV value after control-plane restart");
    assert_eq!(
        stored_record,
        ResourceRestartRecord {
            message: "before restart".to_string(),
        }
    );

    let store = service
        .store_client("blobs")
        .await
        .expect("open fresh blobs store client after restart");
    let stored_bytes = store
        .read(RESOURCES_RESTART_STORE_KEY)
        .await
        .expect("read blobs store bytes after control-plane restart")
        .expect("blobs store bytes should survive control-plane restart");
    assert_eq!(stored_bytes.as_ref(), b"blob before restart");
}

#[tokio::test]
async fn control_plane_outbox_dispatches_after_control_plane_restart() {
    assert_service_case_registered(OUTBOX_RESTART_CASE_ID, "control-plane", "control_plane");

    let mut runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();
    let service_contract =
        trellis_test::TrellisTestContract::from_manifest_json(OUTBOX_RESTART_SERVICE_CONTRACT_JSON)
            .expect("build outbox restart service contract");
    let client_contract =
        outbox_restart_client_contract().expect("build outbox restart client contract");
    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision live outbox restart service instance");
    let db = Arc::new(std::sync::Mutex::new(create_outbox_restart_db()));

    let service_task = start_outbox_restart_service(
        runtime.trellis_url(),
        service_contract.digest(),
        &service_key,
        Arc::clone(&db),
    )
    .await;
    let client_session_seed = trellis_rs::auth::generate_session_keypair().0;
    let (client, client_reconnect) = admin
        .connect_client_with_session_seed_reconnectable(
            &bootstrap_url,
            &client_contract,
            client_session_seed,
        )
        .await
        .expect("connect live Rust outbox restart client before restart");
    let document_id = "rust-outbox-restart-document".to_string();
    let queued = call_outbox_restart_queue_with_retry(&client, &document_id).await;
    assert_eq!(queued.document_id, document_id);
    assert_eq!(
        outbox_restart_row_status(&db, &document_id).await,
        "pending"
    );
    drop(client);
    service_task.abort_and_wait().await;

    runtime
        .restart_control_plane()
        .await
        .expect("restart only the Trellis control-plane process");

    let capture_client = client_reconnect
        .connect_bound_only()
        .await
        .expect("reconnect bound outbox restart client after restart without fresh auth flow");
    let mut capture = capture_client
        .subscribe::<OutboxRestartQueuedEvent>()
        .await
        .expect("subscribe to Document.Queued after restart");
    let service_client = connect_outbox_restart_service_client(
        runtime.trellis_url(),
        service_contract.digest(),
        &service_key,
    )
    .await;
    let dispatch_result = dispatch_outbox_restart_once(&db, &service_client)
        .await
        .expect("dispatch queued outbox event after control-plane restart");
    assert_eq!(
        dispatch_result,
        OutboxDispatchResult::Published {
            id: document_id.clone()
        }
    );
    let captured = wait_for_outbox_restart_queued(&mut capture, &document_id).await;
    assert_eq!(captured.document_id, document_id);
    assert_eq!(
        outbox_restart_row_status(&db, &captured.document_id).await,
        "published"
    );
}

fn admin_bootstrap_probe_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        ADMIN_BOOTSTRAP_PROBE_CONTRACT_ID,
        "Trellis Control-Plane Admin Bootstrap Probe",
        "Verifies first-admin bootstrap yields an authenticated admin session.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "auth",
        trellis_rs::contracts::use_contract(trellis_rs::sdk::auth::CONTRACT_ID)
            .with_rpc_call(["Auth.Users.List"]),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}

fn password_reset_change_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        PASSWORD_RESET_CHANGE_CONTRACT_ID,
        "Trellis Control-Plane Password Reset Change Client",
        "Verifies live local password reset and authenticated password change behavior.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "auth",
        trellis_rs::contracts::use_contract(trellis_rs::sdk::auth::CONTRACT_ID).with_rpc_call([
            "Auth.Sessions.Me",
            "Auth.Users.Create",
            "Auth.Users.Password.Change",
            "Auth.Users.PasswordReset.Create",
        ]),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}

fn http_route_probe_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        HTTP_ROUTE_PROBE_CONTRACT_ID,
        "Trellis Control-Plane HTTP Route Security Probe",
        "Verifies control-plane HTTP bootstrap requires an authenticated admin session.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "auth",
        trellis_rs::contracts::use_contract(trellis_rs::sdk::auth::CONTRACT_ID)
            .with_rpc_call(["Auth.Sessions.Me", "Auth.Users.List"]),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}

fn bootstrap_unknown_digest_client_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    bootstrap_plain_contract(
        BOOTSTRAP_UNKNOWN_DIGEST_CLIENT_ID,
        "Trellis Bootstrap Unknown Digest Client",
        "Creates a bound app session for bootstrap digest cleanup coverage.",
        trellis_rs::contracts::ContractKind::App,
    )
}

fn bootstrap_non_client_app_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    bootstrap_plain_contract(
        BOOTSTRAP_NON_CLIENT_APP_ID,
        "Trellis Bootstrap Non-Client Contract Client",
        "Creates bound app sessions for non-client digest cleanup coverage.",
        trellis_rs::contracts::ContractKind::App,
    )
}

fn bootstrap_auth_sessions_me_contract(
    id: &str,
    display_name: &str,
    description: &str,
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        id,
        display_name,
        description,
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "auth",
        trellis_rs::contracts::use_contract(trellis_rs::sdk::auth::CONTRACT_ID)
            .with_rpc_call(["Auth.Users.List"]),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}

fn bootstrap_non_client_device_admin_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        BOOTSTRAP_NON_CLIENT_DEVICE_ADMIN_ID,
        "Trellis Bootstrap Non-Client Device Admin",
        "Admin app used to make a device contract known for bootstrap rejection coverage.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "auth",
        trellis_rs::contracts::use_contract(trellis_rs::sdk::auth::CONTRACT_ID).with_rpc_call([
            "Auth.Deployments.Create",
            "Auth.DeploymentAuthority.AcceptMigration",
            "Auth.DeploymentAuthority.AcceptUpdate",
            "Auth.DeploymentAuthority.Get",
            "Auth.DeploymentAuthority.Plan",
            "Auth.DeploymentAuthority.Reconcile",
        ]),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}

fn bootstrap_non_client_contract(
    id: &str,
    display_name: &str,
    description: &str,
    kind: trellis_rs::contracts::ContractKind,
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    bootstrap_plain_contract(id, display_name, description, kind)
}

fn bootstrap_plain_contract(
    id: &str,
    display_name: &str,
    description: &str,
    kind: trellis_rs::contracts::ContractKind,
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest =
        trellis_rs::contracts::ContractManifestBuilder::new(id, display_name, description, kind)
            .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}

fn catalog_restart_client_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        CATALOG_RESTART_CLIENT_ID,
        "Trellis Control-Plane Catalog Restart Client",
        "Verifies active app contract authority remains usable after restart.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "catalogRestartService",
        trellis_rs::contracts::use_contract(CATALOG_RESTART_SERVICE_ID)
            .with_rpc_call(["CatalogRestart.Ping"]),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}

fn catalog_dependency_client_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        CATALOG_DEPENDENCY_CLIENT_ID,
        "Trellis Control-Plane Catalog Dependency Client",
        "Requires the catalog dependency provider RPC for dependency-resolution coverage.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "dependencyProvider",
        trellis_rs::contracts::use_contract(CATALOG_DEPENDENCY_PROVIDER_ID)
            .with_rpc_call(["CatalogDependency.Ping"]),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}

fn catalog_force_replace_admin_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        CATALOG_FORCE_REPLACE_ADMIN_CLIENT_ID,
        "Trellis Control-Plane Catalog Force Replace Admin Client",
        "Observes the public catalog and resolves catalog issues through generated admin RPCs.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "core",
        trellis_rs::contracts::use_contract(trellis_rs::sdk::core::CONTRACT_ID)
            .with_rpc_call(["Trellis.Catalog"]),
    )
    .use_ref(
        "auth",
        trellis_rs::contracts::use_contract(trellis_rs::sdk::auth::CONTRACT_ID)
            .with_rpc_call(["Auth.CatalogIssues.Resolve"]),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}

fn catalog_surface_status_client_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        CATALOG_SURFACE_STATUS_CLIENT_ID,
        "Trellis Control-Plane Catalog Surface Status Client",
        "Calls Trellis.Surface.Status and the provider RPC for runtime status coverage.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "core",
        trellis_rs::contracts::use_contract(trellis_rs::sdk::core::CONTRACT_ID)
            .with_rpc_call(["Trellis.Surface.Status", "Trellis.Contract.Get"]),
    )
    .use_ref(
        "auth",
        trellis_rs::contracts::use_contract(trellis_rs::sdk::auth::CONTRACT_ID).with_rpc_call([
            "Auth.Connections.Kick",
            "Auth.Connections.List",
            "Auth.ServiceInstances.Disable",
            "Auth.ServiceInstances.List",
            "Auth.Users.Create",
            "Auth.Users.PasswordReset.Create",
        ]),
    )
    .use_ref(
        "provider",
        trellis_rs::contracts::use_contract(CATALOG_SURFACE_STATUS_PROVIDER_ID)
            .with_rpc_call(["CatalogSurfaceStatus.Ping"])
            .with_event_publish(["CatalogSurfaceStatus.Changed"])
            .with_feed_subscribe(["CatalogSurfaceStatus.Feed"]),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}

fn catalog_surface_status_observer_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        CATALOG_SURFACE_STATUS_OBSERVER_ID,
        "Trellis Control-Plane Catalog Surface Status Observer",
        "Calls Trellis.Surface.Status without provider RPC authority.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "core",
        trellis_rs::contracts::use_contract(trellis_rs::sdk::core::CONTRACT_ID)
            .with_rpc_call(["Trellis.Surface.Status"]),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}

fn admin_service_deployment_lifecycle_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        ADMIN_SERVICE_DEPLOYMENT_LIFECYCLE_ADMIN_CLIENT_ID,
        "Trellis Control-Plane Service Deployment Admin Client",
        "Exercises generated Auth.Deployments admin RPCs through live Trellis.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "auth",
        trellis_rs::contracts::use_contract(trellis_rs::sdk::auth::CONTRACT_ID).with_rpc_call([
            "Auth.Deployments.Create",
            "Auth.Deployments.List",
            "Auth.Deployments.Disable",
            "Auth.Deployments.Enable",
            "Auth.Deployments.Remove",
        ]),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}

fn admin_service_deployment_rollback_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        ADMIN_SERVICE_DEPLOYMENT_ROLLBACK_ADMIN_CLIENT_ID,
        "Trellis Control-Plane Service Deployment Rollback Admin",
        "Exercises generated Auth service deployment rollback RPCs through live Trellis.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "auth",
        trellis_rs::contracts::use_contract(trellis_rs::sdk::auth::CONTRACT_ID).with_rpc_call([
            "Auth.Deployments.Create",
            "Auth.Deployments.List",
            "Auth.Deployments.Remove",
            "Auth.ServiceInstances.List",
            "Auth.ServiceInstances.Provision",
        ]),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}

fn admin_device_deployment_rollback_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        ADMIN_DEVICE_DEPLOYMENT_ROLLBACK_ADMIN_CLIENT_ID,
        "Trellis Control-Plane Device Deployment Rollback Admin",
        "Exercises generated Auth device deployment rollback RPCs through live Trellis.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "auth",
        trellis_rs::contracts::use_contract(trellis_rs::sdk::auth::CONTRACT_ID).with_rpc_call([
            "Auth.Deployments.Create",
            "Auth.Deployments.List",
            "Auth.Deployments.Remove",
            "Auth.Devices.List",
            "Auth.Devices.Provision",
        ]),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}

fn admin_refresh_rollback_contract(
    case_id: &str,
    rpc_calls: &[&str],
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let contract_id = format!("trellis.integration.{case_id}.admin@v1");
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        &contract_id,
        "Trellis Control-Plane Admin Refresh Rollback Client",
        "Exercises generated Auth admin refresh rollback RPCs through live Trellis.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "auth",
        trellis_rs::contracts::use_contract(trellis_rs::sdk::auth::CONTRACT_ID)
            .with_rpc_call(rpc_calls.iter().copied()),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}

fn sessions_restart_client_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        SESSIONS_RESTART_CLIENT_ID,
        "Trellis Control-Plane Sessions Restart Client",
        "Verifies approved app sessions remain authenticated after control-plane restart.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "auth",
        trellis_rs::contracts::use_contract(trellis_rs::sdk::auth::CONTRACT_ID)
            .with_rpc_call(["Auth.Sessions.Me", "Auth.Sessions.List"]),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}

fn state_restart_client_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest =
        trellis_rs::contracts::ContractManifestBuilder::new(
            STATE_RESTART_CLIENT_ID,
            "Trellis Control-Plane State Restart Client",
            "Verifies contract-owned state remains readable after control-plane restart.",
            trellis_rs::contracts::ContractKind::App,
        )
        .schema(
            "Preferences",
            json!({
                "type": "object",
                "required": ["theme", "density"],
                "properties": {
                    "theme": { "type": "string" },
                    "density": { "type": "string" }
                }
            }),
        )
        .schema(
            "Draft",
            json!({
                "type": "object",
                "required": ["title", "body"],
                "properties": {
                    "title": { "type": "string" },
                    "body": { "type": "string" }
                }
            }),
        )
        .use_ref(
            "state",
            trellis_rs::contracts::use_contract(trellis_rs::sdk::state::CONTRACT_ID)
                .with_rpc_call(["State.Get", "State.Put", "State.List"]),
        )
        .state(
            "preferences",
            trellis_rs::contracts::state(
                trellis_rs::contracts::ContractStateKind::Value,
                "Preferences",
            )
            .state_version("preferences.v1"),
        )
        .state(
            "drafts",
            trellis_rs::contracts::state(trellis_rs::contracts::ContractStateKind::Map, "Draft")
                .state_version("drafts.v1"),
        )
        .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}

fn outbox_restart_client_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        OUTBOX_RESTART_CLIENT_ID,
        "Trellis Control-Plane Outbox Restart Client",
        "Queues outbox restart fixture events through generated RPC.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "outboxRestartService",
        trellis_rs::contracts::use_contract(OUTBOX_RESTART_SERVICE_ID)
            .with_rpc_call(["Documents.Queue"])
            .with_event_subscribe(["Document.Queued"]),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}

fn current_state_entry<TValue>(
    entry: Option<trellis_rs::client::StateValue<trellis_rs::client::StateEntry<TValue>>>,
    message: &str,
) -> trellis_rs::client::StateEntry<TValue> {
    match entry {
        Some(trellis_rs::client::StateValue::Current(entry)) => entry,
        _ => panic!("{message}"),
    }
}

fn current_map_state_entry<TValue>(
    entry: Option<
        trellis_rs::client::StateValue<
            trellis_rs::client::MapStateEntry<TValue>,
            trellis_rs::client::MapStateEntry<Value>,
        >,
    >,
    message: &str,
) -> trellis_rs::client::MapStateEntry<TValue> {
    match entry {
        Some(trellis_rs::client::StateValue::Current(entry)) => entry,
        _ => panic!("{message}"),
    }
}

async fn connect_resources_restart_service(
    trellis_url: &str,
    contract_digest: &str,
    service_key: &trellis_test::TrellisTestServiceKey,
) -> ResourcesRestartServiceRuntime {
    ConnectedServiceRuntime::from_connected_client(
        RESOURCES_RESTART_SERVICE_NAME,
        Arc::new(
            TrellisClient::connect_service_with_contract(ServiceConnectWithContractOptions {
                trellis_url,
                contract_id: RESOURCES_RESTART_SERVICE_ID,
                contract_digest,
                contract_json: RESOURCES_RESTART_SERVICE_CONTRACT_JSON,
                session_key_seed_base64url: &service_key.seed,
                timeout_ms: trellis_rs::service::DEFAULT_TIMEOUT_MS,
                retry_delay_ms: trellis_rs::service::DEFAULT_RETRY_DELAY_MS,
                authority_pending_timeout_ms:
                    trellis_rs::service::DEFAULT_AUTHORITY_PENDING_TIMEOUT_MS,
            })
            .await
            .expect("connect live Rust resources restart service"),
        ),
    )
    .expect("build resources restart service runtime")
}

async fn connect_outbox_restart_service_client(
    trellis_url: &str,
    contract_digest: &str,
    service_key: &trellis_test::TrellisTestServiceKey,
) -> TrellisClient {
    TrellisClient::connect_service_with_contract(ServiceConnectWithContractOptions {
        trellis_url,
        contract_id: OUTBOX_RESTART_SERVICE_ID,
        contract_digest,
        contract_json: OUTBOX_RESTART_SERVICE_CONTRACT_JSON,
        session_key_seed_base64url: &service_key.seed,
        timeout_ms: trellis_rs::service::DEFAULT_TIMEOUT_MS,
        retry_delay_ms: trellis_rs::service::DEFAULT_RETRY_DELAY_MS,
        authority_pending_timeout_ms: trellis_rs::service::DEFAULT_AUTHORITY_PENDING_TIMEOUT_MS,
    })
    .await
    .expect("connect live Rust outbox restart service")
}

fn assert_resources_restart_bindings(service: &ResourcesRestartServiceRuntime) {
    let resources = service.resources();
    let records = resources
        .kv
        .get("records")
        .expect("expected kv.records binding");
    assert_eq!(records.history, 1);
    assert_eq!(records.ttl_ms, 0);

    let blobs = resources
        .store
        .get("blobs")
        .expect("expected store.blobs binding");
    assert_eq!(blobs.max_total_bytes, Some(4_194_304));
    assert_eq!(blobs.max_object_bytes, Some(1_048_576));
}

async fn start_catalog_restart_service(
    trellis_url: &str,
    service_contract: &trellis_test::TrellisTestContract,
    service_key: &trellis_test::TrellisTestServiceKey,
    generation: u32,
    present_contract: bool,
) -> AbortOnDrop<Result<(), trellis_rs::service::ServiceRuntimeError>> {
    let trellis_url = trellis_url.to_string();
    let contract_digest = service_contract.digest().to_string();
    let seed = service_key.seed.clone();
    let client = if present_contract {
        TrellisClient::connect_service_with_contract(ServiceConnectWithContractOptions {
            trellis_url: &trellis_url,
            contract_id: CATALOG_RESTART_SERVICE_ID,
            contract_digest: &contract_digest,
            contract_json: CATALOG_RESTART_SERVICE_CONTRACT_JSON,
            session_key_seed_base64url: &seed,
            timeout_ms: trellis_rs::service::DEFAULT_TIMEOUT_MS,
            retry_delay_ms: trellis_rs::service::DEFAULT_RETRY_DELAY_MS,
            authority_pending_timeout_ms: trellis_rs::service::DEFAULT_AUTHORITY_PENDING_TIMEOUT_MS,
        })
        .await
    } else {
        TrellisClient::connect_service(ServiceConnectOptions {
            trellis_url: &trellis_url,
            contract_id: CATALOG_RESTART_SERVICE_ID,
            contract_digest: &contract_digest,
            session_key_seed_base64url: &seed,
            timeout_ms: trellis_rs::service::DEFAULT_TIMEOUT_MS,
        })
        .await
    }
    .expect("connect live Rust catalog restart service");
    let mut service = CatalogRestartServiceRuntime::from_connected_client(
        "catalog-restart-service",
        Arc::new(client),
    )
    .expect("build catalog restart service runtime");

    service.register_rpc::<CatalogRestartPingRpc, _, _>(move |_context, input| async move {
        Ok(CatalogRestartPingOutput {
            message: input.message,
            generation,
        })
    });

    AbortOnDrop::new(tokio::spawn(async move { service.run().await }))
}

async fn start_catalog_dependency_provider_service(
    trellis_url: &str,
    provider_contract: &trellis_test::TrellisTestContract,
    service_key: &trellis_test::TrellisTestServiceKey,
) -> AbortOnDrop<Result<(), trellis_rs::service::ServiceRuntimeError>> {
    let trellis_url = trellis_url.to_string();
    let contract_digest = provider_contract.digest().to_string();
    let seed = service_key.seed.clone();
    let mut service: CatalogDependencyProviderRuntime =
        ConnectedServiceRuntime::from_connected_client(
            CATALOG_DEPENDENCY_PROVIDER_NAME,
            Arc::new(
                TrellisClient::connect_service_with_contract(ServiceConnectWithContractOptions {
                    trellis_url: &trellis_url,
                    contract_id: CATALOG_DEPENDENCY_PROVIDER_ID,
                    contract_digest: &contract_digest,
                    contract_json: CATALOG_DEPENDENCY_PROVIDER_CONTRACT_JSON,
                    session_key_seed_base64url: &seed,
                    timeout_ms: trellis_rs::service::DEFAULT_TIMEOUT_MS,
                    retry_delay_ms: trellis_rs::service::DEFAULT_RETRY_DELAY_MS,
                    authority_pending_timeout_ms:
                        trellis_rs::service::DEFAULT_AUTHORITY_PENDING_TIMEOUT_MS,
                })
                .await
                .expect("connect live Rust catalog dependency provider service"),
            ),
        )
        .expect("build catalog dependency provider service runtime");

    service.register_rpc::<CatalogDependencyPingRpc, _, _>(move |_context, input| async move {
        Ok(CatalogDependencyPingOutput {
            message: input.message,
            served_by: CATALOG_DEPENDENCY_PROVIDER_NAME.to_string(),
        })
    });

    AbortOnDrop::new(tokio::spawn(async move { service.run().await }))
}

async fn start_catalog_force_replace_base_service(
    trellis_url: &str,
    contract_digest: &str,
    service_key: &trellis_test::TrellisTestServiceKey,
) -> AbortOnDrop<Result<(), trellis_rs::service::ServiceRuntimeError>> {
    let trellis_url = trellis_url.to_string();
    let contract_digest = contract_digest.to_string();
    let seed = service_key.seed.clone();
    let mut service: CatalogForceReplaceBaseRuntime =
        ConnectedServiceRuntime::from_connected_client(
            CATALOG_FORCE_REPLACE_BASE_SERVICE_NAME,
            Arc::new(
                TrellisClient::connect_service_with_contract(ServiceConnectWithContractOptions {
                    trellis_url: &trellis_url,
                    contract_id: CATALOG_FORCE_REPLACE_SERVICE_ID,
                    contract_digest: &contract_digest,
                    contract_json: CATALOG_FORCE_REPLACE_BASE_CONTRACT_JSON,
                    session_key_seed_base64url: &seed,
                    timeout_ms: trellis_rs::service::DEFAULT_TIMEOUT_MS,
                    retry_delay_ms: trellis_rs::service::DEFAULT_RETRY_DELAY_MS,
                    authority_pending_timeout_ms:
                        trellis_rs::service::DEFAULT_AUTHORITY_PENDING_TIMEOUT_MS,
                })
                .await
                .expect("connect live Rust catalog force-replace base service"),
            ),
        )
        .expect("build catalog force-replace base service runtime");

    service.register_rpc::<CatalogForceReplaceBasePingRpc, _, _>(
        move |_context, input| async move {
            Ok(CatalogForceReplaceBasePingOutput {
                message: input.message,
                variant: "base".to_string(),
            })
        },
    );

    AbortOnDrop::new(tokio::spawn(async move { service.run().await }))
}

async fn start_catalog_force_replace_replacement_service(
    trellis_url: &str,
    contract_digest: &str,
    service_key: &trellis_test::TrellisTestServiceKey,
) -> AbortOnDrop<Result<(), trellis_rs::service::ServiceRuntimeError>> {
    let trellis_url = trellis_url.to_string();
    let contract_digest = contract_digest.to_string();
    let seed = service_key.seed.clone();
    let mut service: CatalogForceReplaceReplacementRuntime =
        ConnectedServiceRuntime::from_connected_client(
            CATALOG_FORCE_REPLACE_REPLACEMENT_SERVICE_NAME,
            Arc::new(
                TrellisClient::connect_service_with_contract(ServiceConnectWithContractOptions {
                    trellis_url: &trellis_url,
                    contract_id: CATALOG_FORCE_REPLACE_SERVICE_ID,
                    contract_digest: &contract_digest,
                    contract_json: CATALOG_FORCE_REPLACE_REPLACEMENT_CONTRACT_JSON,
                    session_key_seed_base64url: &seed,
                    timeout_ms: trellis_rs::service::DEFAULT_TIMEOUT_MS,
                    retry_delay_ms: trellis_rs::service::DEFAULT_RETRY_DELAY_MS,
                    authority_pending_timeout_ms:
                        trellis_rs::service::DEFAULT_AUTHORITY_PENDING_TIMEOUT_MS,
                })
                .await
                .expect("connect live Rust catalog force-replace replacement service"),
            ),
        )
        .expect("build catalog force-replace replacement service runtime");

    service.register_rpc::<CatalogForceReplaceReplacementPingRpc, _, _>(
        move |_context, input| async move {
            Ok(CatalogForceReplaceReplacementPingOutput {
                count: input.count,
                variant: "replacement".to_string(),
            })
        },
    );

    AbortOnDrop::new(tokio::spawn(async move { service.run().await }))
}

async fn start_catalog_surface_status_provider_service(
    trellis_url: &str,
    contract_digest: &str,
    service_key: &trellis_test::TrellisTestServiceKey,
) -> AbortOnDrop<Result<(), trellis_rs::service::ServiceRuntimeError>> {
    let trellis_url = trellis_url.to_string();
    let contract_digest = contract_digest.to_string();
    let seed = service_key.seed.clone();
    let mut service: CatalogSurfaceStatusProviderRuntime =
        ConnectedServiceRuntime::from_connected_client(
            CATALOG_SURFACE_STATUS_PROVIDER_NAME,
            Arc::new(
                TrellisClient::connect_service_with_contract(ServiceConnectWithContractOptions {
                    trellis_url: &trellis_url,
                    contract_id: CATALOG_SURFACE_STATUS_PROVIDER_ID,
                    contract_digest: &contract_digest,
                    contract_json: CATALOG_SURFACE_STATUS_PROVIDER_CONTRACT_JSON,
                    session_key_seed_base64url: &seed,
                    timeout_ms: trellis_rs::service::DEFAULT_TIMEOUT_MS,
                    retry_delay_ms: trellis_rs::service::DEFAULT_RETRY_DELAY_MS,
                    authority_pending_timeout_ms:
                        trellis_rs::service::DEFAULT_AUTHORITY_PENDING_TIMEOUT_MS,
                })
                .await
                .expect("connect live Rust catalog surface status provider service"),
            ),
        )
        .expect("build catalog surface status provider service runtime");

    service.register_rpc::<CatalogSurfaceStatusPingRpc, _, _>(move |_context, input| async move {
        Ok(CatalogDependencyPingOutput {
            message: input.message,
            served_by: CATALOG_SURFACE_STATUS_PROVIDER_NAME.to_string(),
        })
    });

    AbortOnDrop::new(tokio::spawn(async move { service.run().await }))
}

async fn start_outbox_restart_service(
    trellis_url: &str,
    contract_digest: &str,
    service_key: &trellis_test::TrellisTestServiceKey,
    db: Arc<std::sync::Mutex<Connection>>,
) -> AbortOnDrop<Result<(), trellis_rs::service::ServiceRuntimeError>> {
    let mut service = OutboxRestartServiceRuntime::from_connected_client(
        OUTBOX_RESTART_SERVICE_NAME,
        Arc::new(
            connect_outbox_restart_service_client(trellis_url, contract_digest, service_key).await,
        ),
    )
    .expect("build outbox restart service runtime");

    service.register_rpc::<OutboxRestartQueueRpc, _, _>(move |_context, input| {
        let db = Arc::clone(&db);
        async move {
            let queued = OutboxRestartDocumentQueued {
                document_id: input.document_id.clone(),
            };
            let prepared = trellis_rs::client::prepare_event::<OutboxRestartQueuedEvent>(&queued)
                .map_err(trellis_rs::service::ServerError::Json)?;
            {
                let conn = db.lock().expect("lock outbox restart SQLite database");
                let mut store = trellis_rs::client::SqliteOutboxStore::new(&conn);
                store
                    .enqueue(&input.document_id, &prepared)
                    .now_or_never()
                    .expect("SQLite outbox enqueue should complete synchronously")
            }
            .map_err(outbox_restart_server_error)?;
            Ok(OutboxRestartQueueOutput {
                document_id: input.document_id,
            })
        }
    });

    AbortOnDrop::new(tokio::spawn(async move { service.run().await }))
}

fn create_outbox_restart_db() -> Connection {
    let conn = Connection::open_in_memory().expect("open outbox restart SQLite database");
    trellis_rs::client::SqliteOutboxStore::create_schema(&conn)
        .expect("create outbox restart SQLite schema");
    conn
}

async fn dispatch_outbox_restart_once(
    db: &Arc<std::sync::Mutex<Connection>>,
    service_client: &TrellisClient,
) -> Result<OutboxDispatchResult, trellis_rs::client::EventStoreError> {
    let conn = db.lock().expect("lock outbox restart SQLite database");
    let mut store = trellis_rs::client::SqliteOutboxStore::new(&conn);
    trellis_rs::client::dispatch_outbox_once(&mut store, |event| async move {
        service_client.publish_prepared(&event).await
    })
    .await
}

async fn outbox_restart_row_status(db: &Arc<std::sync::Mutex<Connection>>, id: &str) -> String {
    let conn = db.lock().expect("lock outbox restart SQLite database");
    conn.query_row(
        "SELECT status FROM trellis_outbox_events WHERE id = ?1",
        [id],
        |row| row.get(0),
    )
    .expect("read outbox restart row status")
}

fn outbox_restart_server_error(
    error: trellis_rs::client::EventStoreError,
) -> trellis_rs::service::ServerError {
    trellis_rs::service::ServerError::Nats(format!("outbox restart error: {error}"))
}

async fn call_catalog_restart_with_retry(
    client: &trellis_rs::client::TrellisClient,
    message: &str,
) -> CatalogRestartPingOutput {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match client
            .call::<CatalogRestartPingRpc>(&CatalogRestartPingInput {
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
            Err(error) => panic!("call live CatalogRestart.Ping RPC: {error}"),
        }
    }
}

async fn assert_catalog_dependency_unavailable(client: &trellis_rs::client::TrellisClient) {
    let result = client
        .call::<CatalogDependencyPingRpc>(&CatalogDependencyPingInput {
            message: "before-provider".to_string(),
        })
        .await;
    assert!(
        result.is_err(),
        "expected CatalogDependency.Ping to fail before provider service start"
    );
}

async fn call_catalog_dependency_with_retry(
    client: &trellis_rs::client::TrellisClient,
    message: &str,
) -> CatalogDependencyPingOutput {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        match client
            .call::<CatalogDependencyPingRpc>(&CatalogDependencyPingInput {
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
            Err(error) => panic!("call live CatalogDependency.Ping RPC: {error}"),
        }
    }
}

async fn call_catalog_surface_status_with_retry(
    client: &trellis_rs::client::TrellisClient,
    message: &str,
) -> CatalogDependencyPingOutput {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        match client
            .call::<CatalogSurfaceStatusPingRpc>(&CatalogDependencyPingInput {
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
            Err(error) => panic!("call live CatalogSurfaceStatus.Ping RPC: {error}"),
        }
    }
}

async fn catalog_surface_status(core: &trellis_rs::sdk::core::CoreClient<'_>) -> Value {
    catalog_surface_status_for(
        core,
        CATALOG_SURFACE_STATUS_PROVIDER_ID,
        "rpc",
        "CatalogSurfaceStatus.Ping",
        Some("call"),
    )
    .await
}

async fn catalog_surface_status_for(
    core: &trellis_rs::sdk::core::CoreClient<'_>,
    contract_id: &str,
    kind: &str,
    surface: &str,
    action: Option<&str>,
) -> Value {
    core.rpc()
        .trellis()
        .surface_status(&trellis_rs::sdk::core::types::TrellisSurfaceStatusRequest {
            action: action.map(str::to_string),
            contract_id: contract_id.to_string(),
            kind: kind.to_string(),
            surface: surface.to_string(),
        })
        .await
        .expect("call generated Trellis.Surface.Status")
        .status
}

async fn assert_catalog_surface_status_validation_error(
    core: &trellis_rs::sdk::core::CoreClient<'_>,
    contract_id: &str,
    kind: &str,
    surface: &str,
    action: Option<&str>,
) {
    let result = core
        .rpc()
        .trellis()
        .surface_status(&trellis_rs::sdk::core::types::TrellisSurfaceStatusRequest {
            action: action.map(str::to_string),
            contract_id: contract_id.to_string(),
            kind: kind.to_string(),
            surface: surface.to_string(),
        })
        .await;
    match result {
        Err(trellis_rs::client::TrellisClientError::RpcError(payload)) => {
            let error = payload
                .decode_validation()
                .expect("decode ValidationError payload")
                .expect("expected ValidationError payload");
            assert_eq!(error.error_type, "ValidationError");
        }
        Ok(output) => panic!("expected Surface.Status validation error, got {output:?}"),
        Err(error) => panic!("expected Surface.Status ValidationError, got {error}"),
    }
}

async fn assert_catalog_surface_status_contract_get(
    core: &trellis_rs::sdk::core::CoreClient<'_>,
    digest: &str,
) {
    let contract_get = core
        .rpc()
        .trellis()
        .contract_get(&trellis_rs::sdk::core::types::TrellisContractGetRequest {
            digest: digest.to_string(),
        })
        .await
        .expect("call generated Trellis.Contract.Get");
    assert_eq!(
        contract_get
            .contract
            .exports
            .expect("contract exports should be present")
            .schemas,
        Some(vec!["PublicValue".to_string()])
    );
    let docs = contract_get
        .contract
        .docs
        .expect("contract docs should be present");
    assert_eq!(
        docs.summary.as_deref(),
        Some("Catalog surface status provider.")
    );
    assert_eq!(
        docs.markdown,
        "Documents the provider contract used by live catalog tests."
    );
    assert_eq!(
        surface_docs(
            contract_get.contract.rpc.as_ref(),
            "CatalogSurfaceStatus.Ping"
        )
        .cloned(),
        Some(json!({
            "summary": "Ping catalog surface status.",
            "markdown": "Returns a live response from the provider runtime."
        }))
    );
    assert_eq!(
        surface_docs(
            contract_get.contract.operations.as_ref(),
            "CatalogSurfaceStatus.Import"
        )
        .cloned(),
        Some(json!({
            "markdown": "Imports catalog surface status values asynchronously."
        }))
    );
    assert_eq!(
        surface_docs(
            contract_get.contract.events.as_ref(),
            "CatalogSurfaceStatus.Changed"
        )
        .cloned(),
        Some(json!({
            "markdown": "Published when catalog surface status values change."
        }))
    );
}

fn surface_docs<'a>(
    surfaces: Option<&'a BTreeMap<String, BTreeMap<String, Value>>>,
    name: &str,
) -> Option<&'a Value> {
    surfaces?.get(name)?.get("docs")
}

async fn wait_for_catalog_surface_status(
    core: &trellis_rs::sdk::core::CoreClient<'_>,
    expected: Value,
) {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let status = catalog_surface_status(core).await;
        if status == expected {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for catalog surface status {expected}, got {status}"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn catalog_surface_status_provider_instance_id(
    auth: &trellis_rs::sdk::auth::AuthClient<'_>,
    session_key: &str,
) -> String {
    auth.rpc()
        .auth()
        .service_instances_list(&AuthServiceInstancesListRequest {
            deployment_id: None,
            disabled: None,
            limit: 500,
            offset: None,
        })
        .await
        .expect("list service instances through generated Auth RPC")
        .entries
        .into_iter()
        .find(|entry| entry.instance_key == session_key)
        .expect("catalog surface status provider service instance should be listed")
        .instance_id
}

async fn wait_for_auth_connection_user_nkey(
    auth: &trellis_rs::sdk::auth::AuthClient<'_>,
    session_key: &str,
) -> Option<String> {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if let Some(user_nkey) = auth_connection_user_nkey(auth, session_key).await {
            return Some(user_nkey);
        }
        if Instant::now() >= deadline {
            return None;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn auth_connection_user_nkey(
    auth: &trellis_rs::sdk::auth::AuthClient<'_>,
    session_key: &str,
) -> Option<String> {
    auth_connection_user_nkeys(auth, session_key)
        .await
        .into_iter()
        .next()
}

async fn kick_auth_connections_for_session(
    auth: &trellis_rs::sdk::auth::AuthClient<'_>,
    session_key: &str,
) {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let user_nkeys = auth_connection_user_nkeys(auth, session_key).await;
        if user_nkeys.is_empty() {
            return;
        }
        for user_nkey in user_nkeys {
            auth.rpc()
                .auth()
                .connections_kick(&AuthConnectionsKickRequest { user_nkey })
                .await
                .expect(
                    "kick remaining provider connection through generated Auth.Connections.Kick",
                );
        }
        assert!(
            Instant::now() < deadline,
            "timed out kicking provider service connections"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn auth_connection_user_nkeys(
    auth: &trellis_rs::sdk::auth::AuthClient<'_>,
    session_key: &str,
) -> Vec<String> {
    auth.rpc()
        .auth()
        .connections_list(&AuthConnectionsListRequest {
            limit: 500,
            offset: None,
            session_key: Some(session_key.to_string()),
            user: None,
        })
        .await
        .expect("list live connections through generated Auth.Connections.List")
        .entries
        .into_iter()
        .filter_map(|entry| {
            if entry.get("sessionKey").and_then(Value::as_str) == Some(session_key)
                && entry.get("participantKind").and_then(Value::as_str) == Some("service")
            {
                entry
                    .get("userNkey")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            } else {
                None
            }
        })
        .collect()
}

async fn call_outbox_restart_queue_with_retry(
    client: &trellis_rs::client::TrellisClient,
    document_id: &str,
) -> OutboxRestartQueueOutput {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        match client
            .call::<OutboxRestartQueueRpc>(&OutboxRestartQueueInput {
                document_id: document_id.to_string(),
            })
            .await
        {
            Ok(output) => return output,
            Err(error)
                if is_retryable_service_startup_error(&error) && Instant::now() < deadline =>
            {
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            Err(error) => panic!("call live Documents.Queue RPC: {error}"),
        }
    }
}

async fn wait_for_outbox_restart_queued<S>(
    stream: &mut S,
    document_id: &str,
) -> OutboxRestartDocumentQueued
where
    S: Stream<Item = Result<OutboxRestartDocumentQueued, trellis_rs::client::TrellisClientError>>
        + Unpin,
{
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        match tokio::time::timeout(remaining, stream.next()).await {
            Ok(Some(Ok(event))) if event.document_id == document_id => return event,
            Ok(Some(Ok(_))) => {}
            Ok(Some(Err(error))) => panic!("outbox restart event stream failed: {error}"),
            Ok(None) => panic!("outbox restart event stream ended"),
            Err(_) => panic!("timed out waiting for Document.Queued {document_id}"),
        }
    }
}

async fn wait_for_catalog_force_replace_issue(
    core: &trellis_rs::sdk::core::CoreClient<'_>,
    base_digest: &str,
    replacement_digest: &str,
) -> trellis_rs::sdk::core::types::TrellisCatalogResponseCatalogIssuesItem {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let catalog = core
            .rpc()
            .trellis()
            .catalog()
            .await
            .expect("load catalog while waiting for force-replace issue");
        if let Some(issue) =
            find_catalog_force_replace_issue(&catalog, base_digest, replacement_digest)
        {
            return issue.clone();
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for catalog force-replace issue"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn wait_for_catalog_force_replace_resolved(
    core: &trellis_rs::sdk::core::CoreClient<'_>,
    replacement_digest: &str,
) {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let catalog = core
            .rpc()
            .trellis()
            .catalog()
            .await
            .expect("load catalog while waiting for force-replace resolution");
        let has_issue = catalog
            .catalog
            .issues
            .as_deref()
            .unwrap_or(&[])
            .iter()
            .any(|issue| {
                issue.kind == "incompatible-active-contract"
                    && issue.contract_id.as_deref() == Some(CATALOG_FORCE_REPLACE_SERVICE_ID)
            });
        let replacement_active = catalog.catalog.contracts.iter().any(|contract| {
            contract.id == CATALOG_FORCE_REPLACE_SERVICE_ID && contract.digest == replacement_digest
        });
        if !has_issue && replacement_active {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for catalog force-replace resolution"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

fn find_catalog_force_replace_issue<'a>(
    catalog: &'a trellis_rs::sdk::core::types::TrellisCatalogResponse,
    base_digest: &str,
    replacement_digest: &str,
) -> Option<&'a trellis_rs::sdk::core::types::TrellisCatalogResponseCatalogIssuesItem> {
    catalog
        .catalog
        .issues
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .find(|issue| {
            issue.kind == "incompatible-active-contract"
                && issue.contract_id.as_deref() == Some(CATALOG_FORCE_REPLACE_SERVICE_ID)
                && issue.conflicting_digest.as_deref() == Some(replacement_digest)
                && issue
                    .effective_digests
                    .as_deref()
                    .unwrap_or(&[])
                    .iter()
                    .any(|digest| digest == base_digest)
        })
}

fn is_retryable_service_startup_error(error: &trellis_rs::client::TrellisClientError) -> bool {
    match error {
        trellis_rs::client::TrellisClientError::NatsRequest(message) => {
            message.contains("no responders") || message.contains("NoResponders")
        }
        trellis_rs::client::TrellisClientError::Timeout => true,
        _ => false,
    }
}

fn assert_admin_app_session(me: &trellis_rs::sdk::auth::types::AuthSessionsMeResponse) {
    assert_eq!(me.participant_kind.as_str(), Some("app"));
    let user = me
        .user
        .as_object()
        .expect("Auth.Sessions.Me should return an active user");
    assert_eq!(user.get("active").and_then(Value::as_bool), Some(true));
    let capabilities = user
        .get("capabilities")
        .and_then(Value::as_array)
        .expect("Auth.Sessions.Me user should include capabilities");
    assert!(
        capabilities.iter().any(|capability| capability == "admin"),
        "Auth.Sessions.Me user should include admin capability"
    );
}

fn assert_app_user_session(me: &trellis_rs::sdk::auth::types::AuthSessionsMeResponse) {
    assert_eq!(me.participant_kind.as_str(), Some("app"));
    let user = me
        .user
        .as_object()
        .expect("Auth.Sessions.Me should return an active user");
    assert_eq!(user.get("active").and_then(Value::as_bool), Some(true));
    assert!(
        user.get("capabilities")
            .and_then(Value::as_array)
            .is_some_and(|capabilities| !capabilities.is_empty()),
        "Auth.Sessions.Me user should include capabilities"
    );
}

fn session_user_id(me: &trellis_rs::sdk::auth::types::AuthSessionsMeResponse) -> Option<String> {
    me.user
        .as_object()
        .and_then(|user| user.get("userId"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn auth_sessions_list_request() -> AuthSessionsListRequest {
    AuthSessionsListRequest {
        limit: 100,
        offset: None,
        user: None,
    }
}

fn assert_session_listed(
    sessions: &trellis_rs::sdk::auth::types::AuthSessionsListResponse,
    session_key: &str,
) {
    let session = sessions
        .entries
        .iter()
        .filter_map(Value::as_object)
        .find(|entry| entry.get("sessionKey").and_then(Value::as_str) == Some(session_key))
        .unwrap_or_else(|| panic!("expected Auth.Sessions.List to include {session_key}"));

    assert_eq!(
        session.get("participantKind").and_then(Value::as_str),
        Some("app")
    );
}

async fn assert_bootstrap_rejects_stored_contract(
    runtime: &trellis_test::TrellisTestRuntime,
    admin: &mut trellis_test::TrellisTestAdmin,
    bootstrap_url: &str,
    app_contract: &trellis_test::TrellisTestContract,
    stored_contract: &trellis_test::TrellisTestContract,
) {
    let (seed, session_key) = trellis_rs::auth::generate_session_keypair();
    let client = admin
        .connect_client_with_session_seed(bootstrap_url, app_contract, seed.clone())
        .await
        .expect("connect live Rust bootstrap non-client app session");
    drop(client);

    rewrite_session_contract(
        &runtime.control_plane_sqlite(),
        &session_key,
        contract_manifest_str(stored_contract, "id"),
        stored_contract.digest(),
        contract_manifest_str(stored_contract, "displayName"),
        contract_manifest_str(stored_contract, "description"),
    )
    .expect("rewrite stored session contract digest");

    let response = fetch_client_bootstrap(runtime.trellis_url(), &seed)
        .await
        .expect("fetch bootstrap with non-client digest session");
    assert_eq!(response.status, 200);
    assert_eq!(
        response.body.get("status").and_then(Value::as_str),
        Some("auth_required")
    );
    assert_session_absent(&runtime.control_plane_sqlite(), &session_key);
}

async fn connect_bootstrap_client_session(
    admin: &mut trellis_test::TrellisTestAdmin,
    bootstrap_url: &str,
    contract: &trellis_test::TrellisTestContract,
) -> (String, String) {
    let (seed, session_key) = trellis_rs::auth::generate_session_keypair();
    let client = admin
        .connect_client_with_session_seed(bootstrap_url, contract, seed.clone())
        .await
        .expect("connect live Rust bootstrap client session");
    drop(client);
    (seed, session_key)
}

async fn assert_bootstrap_auth_required_and_session_deleted(
    runtime: &trellis_test::TrellisTestRuntime,
    seed: &str,
    session_key: &str,
) {
    let response = fetch_client_bootstrap(runtime.trellis_url(), seed)
        .await
        .expect("fetch bootstrap for invalidated user session");
    assert_eq!(response.status, 200);
    assert_eq!(
        response.body.get("status").and_then(Value::as_str),
        Some("auth_required")
    );
    assert_session_absent(&runtime.control_plane_sqlite(), session_key);
}

fn session_row_user_id(
    sqlite: &trellis_test::TrellisControlPlaneSqlite,
    session_key: &str,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let rows = sqlite.query(
        "SELECT trellis_id AS trellisId FROM sessions WHERE session_key = ?",
        [session_key],
    )?;
    rows.first()
        .and_then(|row| row.get("trellisId"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| format!("session user id not found for {session_key}").into())
}

fn mark_session_user_inactive(
    sqlite: &trellis_test::TrellisControlPlaneSqlite,
    session_key: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    sqlite.execute(
        "UPDATE users SET active = 0 WHERE user_id = ?",
        params![session_row_user_id(sqlite, session_key)?],
    )?;
    Ok(())
}

fn delete_session_user_projection(
    sqlite: &trellis_test::TrellisControlPlaneSqlite,
    session_key: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    sqlite.execute(
        "DELETE FROM users WHERE user_id = ?",
        params![session_row_user_id(sqlite, session_key)?],
    )?;
    Ok(())
}

fn clear_session_user_capabilities(
    sqlite: &trellis_test::TrellisControlPlaneSqlite,
    session_key: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let rows = sqlite.query(
        "SELECT session FROM sessions WHERE session_key = ?",
        [session_key],
    )?;
    let session_text = rows
        .first()
        .and_then(|row| row.get("session"))
        .and_then(Value::as_str)
        .ok_or_else(|| format!("session row not found for {session_key}"))?;
    let session: Value = serde_json::from_str(session_text)?;
    let delegated = session
        .get("delegatedCapabilities")
        .and_then(Value::as_array)
        .ok_or("session missing delegatedCapabilities")?;
    assert!(
        !delegated.is_empty(),
        "test session must have delegated capabilities before clearing the user"
    );
    sqlite.execute(
        "UPDATE users SET capabilities = ?, capability_groups = ? WHERE user_id = ?",
        params!["[]", "[]", session_row_user_id(sqlite, session_key)?],
    )?;
    Ok(())
}

async fn approve_bootstrap_non_client_device_contract(
    admin: &mut trellis_test::TrellisTestAdmin,
    bootstrap_url: &str,
    admin_contract: &trellis_test::TrellisTestContract,
    device_contract: &trellis_test::TrellisTestContract,
) {
    let client = admin
        .connect_client(bootstrap_url, admin_contract)
        .await
        .expect("connect bootstrap non-client device admin client");
    let auth = trellis_rs::sdk::auth::AuthClient::new(&client);
    let deployment_id = "bootstrap-non-client-device";
    auth.rpc()
        .auth()
        .deployments_create(&AuthDeploymentsCreateRequest(json!({
            "deploymentId": deployment_id,
            "kind": "device",
            "reviewMode": "none"
        })))
        .await
        .expect("create bootstrap non-client device deployment");

    let contract_map: BTreeMap<String, Value> = device_contract
        .manifest()
        .as_object()
        .expect("device contract manifest should be a JSON object")
        .clone()
        .into_iter()
        .collect();
    let planned = auth
        .rpc()
        .auth()
        .deployment_authority_plan(&AuthDeploymentAuthorityPlanRequest {
            deployment_id: deployment_id.to_string(),
            contract: contract_map,
            expected_digest: device_contract.digest().to_string(),
        })
        .await
        .expect("plan bootstrap non-client device contract authority");
    let plan_id = planned
        .plan
        .get("planId")
        .and_then(Value::as_str)
        .expect("device authority planId")
        .to_string();
    match planned.plan.get("classification").and_then(Value::as_str) {
        Some("update") => {
            auth.rpc()
                .auth()
                .deployment_authority_accept_update(
                    &trellis_rs::sdk::auth::types::AuthDeploymentAuthorityAcceptUpdateRequest {
                        plan_id,
                        expected_desired_version: None,
                    },
                )
                .await
                .expect("accept bootstrap non-client device contract update");
        }
        Some("migration") => {
            auth.rpc()
                .auth()
                .deployment_authority_accept_migration(
                    &trellis_rs::sdk::auth::types::AuthDeploymentAuthorityAcceptMigrationRequest {
                        plan_id,
                        expected_desired_version: None,
                        acknowledgement: "Approved by bootstrap non-client integration test."
                            .to_string(),
                    },
                )
                .await
                .expect("accept bootstrap non-client device contract migration");
        }
        other => panic!("unexpected device authority plan classification: {other:?}"),
    }
    auth.rpc()
        .auth()
        .deployment_authority_reconcile(
            &trellis_rs::sdk::auth::types::AuthDeploymentAuthorityReconcileRequest {
                deployment_id: deployment_id.to_string(),
                desired_version: None,
            },
        )
        .await
        .expect("reconcile bootstrap non-client device deployment");
}

fn rewrite_session_contract(
    sqlite: &trellis_test::TrellisControlPlaneSqlite,
    session_key: &str,
    contract_id: &str,
    contract_digest: &str,
    display_name: &str,
    description: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let rows = sqlite.query(
        "SELECT session FROM sessions WHERE session_key = ?",
        [session_key],
    )?;
    let session_text = rows
        .first()
        .and_then(|row| row.get("session"))
        .and_then(Value::as_str)
        .ok_or_else(|| format!("session row not found for {session_key}"))?;
    let mut session: Value = serde_json::from_str(session_text)?;
    session["contractDigest"] = Value::String(contract_digest.to_string());
    session["contractId"] = Value::String(contract_id.to_string());
    session["contractDisplayName"] = Value::String(display_name.to_string());
    session["contractDescription"] = Value::String(description.to_string());
    sqlite.execute(
        "UPDATE sessions SET contract_digest = ?, contract_id = ?, session = ? WHERE session_key = ?",
        params![contract_digest, contract_id, session.to_string(), session_key],
    )?;
    Ok(())
}

fn assert_session_absent(sqlite: &trellis_test::TrellisControlPlaneSqlite, session_key: &str) {
    let rows = sqlite
        .query(
            "SELECT 1 FROM sessions WHERE session_key = ?",
            [session_key],
        )
        .expect("query session row after bootstrap rejection");
    assert!(
        rows.is_empty(),
        "expected session {session_key} to be deleted"
    );
}

fn assert_session_present(sqlite: &trellis_test::TrellisControlPlaneSqlite, session_key: &str) {
    let rows = sqlite
        .query(
            "SELECT 1 FROM sessions WHERE session_key = ?",
            [session_key],
        )
        .expect("query session row after logout rejection");
    assert!(
        !rows.is_empty(),
        "expected session {session_key} to remain present"
    );
}

fn rewrite_session_provider(
    sqlite: &trellis_test::TrellisControlPlaneSqlite,
    session_key: &str,
    provider: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let rows = sqlite.query(
        "SELECT session FROM sessions WHERE session_key = ?",
        [session_key],
    )?;
    let session_text = rows
        .first()
        .and_then(|row| row.get("session"))
        .and_then(Value::as_str)
        .ok_or_else(|| format!("session row not found for {session_key}"))?;
    let mut session: Value = serde_json::from_str(session_text)?;
    session["identity"]["provider"] = Value::String(provider.to_string());
    session["identity"]["identityId"] = Value::String(format!("idn_{provider}_user"));
    sqlite.execute(
        "UPDATE sessions SET origin = ?, session = ? WHERE session_key = ?",
        params![provider, session.to_string(), session_key],
    )?;
    Ok(())
}

async fn wait_for_sessions_me_denied(auth: &trellis_rs::sdk::auth::AuthClient<'_>, label: &str) {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if auth.rpc().auth().sessions_me().await.is_err() {
            return;
        }
        if Instant::now() >= deadline {
            panic!("{label} app session continued to call Auth.Sessions.Me after logout");
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

fn contract_manifest_str<'a>(
    contract: &'a trellis_test::TrellisTestContract,
    field: &str,
) -> &'a str {
    contract
        .manifest()
        .get(field)
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("contract manifest missing string field {field}"))
}

#[derive(Debug)]
struct ClientBootstrapFetch {
    status: u16,
    session_key: String,
    body: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClientBootstrapRequest<'a> {
    session_key: &'a str,
    iat: u64,
    sig: String,
}

#[derive(Debug, Default)]
struct SessionLogoutOptions {
    provider_logout: Option<bool>,
    federated_provider_logout: Option<bool>,
    return_to: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionLogoutRequest<'a> {
    session_key: &'a str,
    iat: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    provider_logout: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    federated_provider_logout: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    return_to: Option<&'a str>,
    sig: String,
}

#[derive(Debug)]
struct HttpTextResponse {
    status: u16,
    body: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum BindFlowResponse {
    Bound {
        sentinel: trellis_rs::auth::SentinelCredsRecord,
        transports: trellis_rs::auth::ClientTransportsRecord,
    },
    ApprovalRequired,
    ApprovalDenied,
    InsufficientCapabilities,
}

async fn complete_local_password_account_flow(
    trellis_url: &str,
    flow_id: &str,
    username: &str,
    password: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let response = post_json_success::<Value>(
        &format!(
            "{}/auth/account-flow/{}/local-password",
            trellis_url.trim_end_matches('/'),
            flow_id
        ),
        &json!({ "username": username, "password": password }),
    )
    .await?;
    assert_eq!(
        response.get("status").and_then(Value::as_str),
        Some("created")
    );
    Ok(())
}

async fn connect_with_local_password(
    trellis_url: &str,
    contract: &trellis_test::TrellisTestContract,
    session_seed: &str,
    username: &str,
    password: &str,
) -> Result<trellis_rs::client::TrellisClient, Box<dyn std::error::Error + Send + Sync>> {
    let auth = trellis_rs::client::SessionAuth::from_seed_base64url(session_seed)?;
    let redirect_to = format!(
        "{}/_trellis/test/password-reset-change",
        trellis_url.trim_end_matches('/')
    );
    let flow_id = start_local_auth_flow(trellis_url, &redirect_to, &auth, contract).await?;
    let login = post_local_login(trellis_url, &flow_id, username, password).await?;
    if !(200..300).contains(&login.status) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("local login failed ({}): {}", login.status, login.body),
        )
        .into());
    }
    approve_flow_if_needed(trellis_url, &flow_id).await?;
    let bound = bind_flow(trellis_url, &auth, &flow_id).await?;
    let BindFlowResponse::Bound {
        sentinel,
        transports,
    } = bound
    else {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            "local login flow did not bind after approval",
        )
        .into());
    };
    let native = transports.native.ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::Other,
            "bind response missing native transport",
        )
    })?;
    let servers = native.nats_servers.join(",");
    Ok(
        trellis_rs::client::TrellisClient::connect_user(trellis_rs::client::UserConnectOptions {
            servers: &servers,
            sentinel_jwt: &sentinel.jwt,
            sentinel_seed: &sentinel.seed,
            session_key_seed_base64url: session_seed,
            contract_digest: contract.digest(),
            timeout_ms: 5_000,
        })
        .await?,
    )
}

async fn local_password_login_failure(
    trellis_url: &str,
    contract: &trellis_test::TrellisTestContract,
    session_seed: &str,
    username: &str,
    password: &str,
) -> Result<HttpTextResponse, Box<dyn std::error::Error + Send + Sync>> {
    let auth = trellis_rs::client::SessionAuth::from_seed_base64url(session_seed)?;
    let redirect_to = format!(
        "{}/_trellis/test/password-reset-change-rejected",
        trellis_url.trim_end_matches('/')
    );
    let flow_id = start_local_auth_flow(trellis_url, &redirect_to, &auth, contract).await?;
    post_local_login(trellis_url, &flow_id, username, password).await
}

async fn start_local_auth_flow(
    trellis_url: &str,
    redirect_to: &str,
    auth: &trellis_rs::client::SessionAuth,
    contract: &trellis_test::TrellisTestContract,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let sig = auth.sign_sha256_domain(
        "oauth-init",
        &auth_start_signature_payload(redirect_to, contract.manifest())?,
    );
    let started = post_json_success::<trellis_rs::auth::AuthStartResponse>(
        &format!("{}/auth/requests", trellis_url.trim_end_matches('/')),
        &trellis_rs::auth::AuthStartRequest {
            provider: None,
            redirect_to: redirect_to.to_string(),
            session_key: auth.session_key.clone(),
            sig,
            contract: contract_manifest_map(contract)?,
            context: None,
        },
    )
    .await?;
    match started {
        trellis_rs::auth::AuthStartResponse::FlowStarted { login_url, .. } => {
            flow_id_from_url(&login_url)
        }
        trellis_rs::auth::AuthStartResponse::Bound { .. } => Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            "fresh local-password auth request unexpectedly returned bound",
        )
        .into()),
    }
}

fn auth_start_signature_payload(
    redirect_to: &str,
    contract: &Value,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    Ok(format!(
        "{}:{}:{}:{}",
        redirect_to,
        "",
        trellis_rs::contracts::canonicalize_json(contract)?,
        trellis_rs::contracts::canonicalize_json(&Value::Null)?,
    ))
}

fn contract_manifest_map(
    contract: &trellis_test::TrellisTestContract,
) -> Result<BTreeMap<String, Value>, Box<dyn std::error::Error + Send + Sync>> {
    let Value::Object(map) = contract.manifest() else {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            "contract manifest must be a JSON object",
        )
        .into());
    };
    Ok(map.clone().into_iter().collect())
}

async fn post_local_login(
    trellis_url: &str,
    flow_id: &str,
    username: &str,
    password: &str,
) -> Result<HttpTextResponse, Box<dyn std::error::Error + Send + Sync>> {
    post_json_text(
        &format!("{}/auth/login/local", trellis_url.trim_end_matches('/')),
        &json!({ "flowId": flow_id, "username": username, "password": password }),
    )
    .await
}

async fn approve_flow_if_needed(
    trellis_url: &str,
    flow_id: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let state = fetch_json(&format!(
        "{}/auth/flow/{}",
        trellis_url.trim_end_matches('/'),
        flow_id
    ))
    .await?;
    match state.get("status").and_then(Value::as_str) {
        Some("redirect") => Ok(()),
        Some("approval_required") => {
            let approved = post_json_success::<Value>(
                &format!(
                    "{}/auth/flow/{}/approval",
                    trellis_url.trim_end_matches('/'),
                    flow_id
                ),
                &json!({ "approved": true }),
            )
            .await?;
            assert_eq!(
                approved.get("status").and_then(Value::as_str),
                Some("redirect")
            );
            Ok(())
        }
        status => Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("unexpected local auth flow status: {status:?}"),
        )
        .into()),
    }
}

async fn bind_flow(
    trellis_url: &str,
    auth: &trellis_rs::client::SessionAuth,
    flow_id: &str,
) -> Result<BindFlowResponse, Box<dyn std::error::Error + Send + Sync>> {
    post_json_success(
        &format!(
            "{}/auth/flow/{}/bind",
            trellis_url.trim_end_matches('/'),
            flow_id
        ),
        &json!({
            "sessionKey": auth.session_key.clone(),
            "sig": auth.sign_sha256_domain("bind-flow", flow_id),
        }),
    )
    .await
}

async fn fetch_json(url: &str) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
    let response = reqwest::Client::builder()
        .no_proxy()
        .build()?
        .get(url)
        .send()
        .await?;
    decode_json_response(url, response).await
}

async fn post_json_success<T>(
    url: &str,
    body: &impl Serialize,
) -> Result<T, Box<dyn std::error::Error + Send + Sync>>
where
    T: for<'de> Deserialize<'de>,
{
    let response = reqwest::Client::builder()
        .no_proxy()
        .build()?
        .post(url)
        .json(body)
        .send()
        .await?;
    decode_json_response(url, response).await
}

async fn decode_json_response<T>(
    url: &str,
    response: reqwest::Response,
) -> Result<T, Box<dyn std::error::Error + Send + Sync>>
where
    T: for<'de> Deserialize<'de>,
{
    let status = response.status();
    let body = response.text().await?;
    if !status.is_success() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!(
                "HTTP request failed ({}) for {url}: {body}",
                status.as_u16()
            ),
        )
        .into());
    }
    Ok(serde_json::from_str(&body)?)
}

async fn post_json_text(
    url: &str,
    body: &impl Serialize,
) -> Result<HttpTextResponse, Box<dyn std::error::Error + Send + Sync>> {
    let response = reqwest::Client::builder()
        .no_proxy()
        .build()?
        .post(url)
        .json(body)
        .send()
        .await?;
    let status = response.status().as_u16();
    let body = response.text().await?;
    Ok(HttpTextResponse { status, body })
}

fn flow_id_from_url(url: &str) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    reqwest::Url::parse(url)?
        .query_pairs()
        .find_map(|(key, value)| (key == "flowId").then(|| value.into_owned()))
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::Other,
                format!("Trellis auth URL is missing flowId: {url}"),
            )
            .into()
        })
}

async fn fetch_client_bootstrap(
    trellis_url: &str,
    session_seed: &str,
) -> Result<ClientBootstrapFetch, Box<dyn std::error::Error + Send + Sync>> {
    let auth = trellis_rs::client::SessionAuth::from_seed_base64url(session_seed)?;
    let iat = current_iat();
    let sig = auth.sign_sha256_domain("bootstrap-client", &iat.to_string());
    fetch_client_bootstrap_with_sig(trellis_url, session_seed, iat, sig).await
}

async fn fetch_client_bootstrap_with_iat(
    trellis_url: &str,
    session_seed: &str,
    iat: u64,
) -> Result<ClientBootstrapFetch, Box<dyn std::error::Error + Send + Sync>> {
    let auth = trellis_rs::client::SessionAuth::from_seed_base64url(session_seed)?;
    let sig = auth.sign_sha256_domain("bootstrap-client", &iat.to_string());
    fetch_client_bootstrap_with_sig(trellis_url, session_seed, iat, sig).await
}

async fn fetch_client_bootstrap_with_sig(
    trellis_url: &str,
    session_seed: &str,
    iat: u64,
    sig: String,
) -> Result<ClientBootstrapFetch, Box<dyn std::error::Error + Send + Sync>> {
    let auth = trellis_rs::client::SessionAuth::from_seed_base64url(session_seed)?;
    let body = ClientBootstrapRequest {
        session_key: &auth.session_key,
        iat,
        sig,
    };
    let response = reqwest::Client::builder()
        .no_proxy()
        .build()?
        .post(format!(
            "{}/bootstrap/client",
            trellis_url.trim_end_matches('/')
        ))
        .json(&body)
        .send()
        .await?;
    let status = response.status().as_u16();
    let body = response.json::<Value>().await?;

    Ok(ClientBootstrapFetch {
        status,
        session_key: auth.session_key,
        body,
    })
}

async fn post_session_logout(
    trellis_url: &str,
    session_seed: &str,
    options: SessionLogoutOptions,
) -> Result<HttpTextResponse, Box<dyn std::error::Error + Send + Sync>> {
    let auth = trellis_rs::client::SessionAuth::from_seed_base64url(session_seed)?;
    let iat = current_iat();
    let payload = logout_signature_payload(
        iat,
        options.provider_logout,
        options.federated_provider_logout,
        options.return_to.as_deref(),
    )?;
    let body = SessionLogoutRequest {
        session_key: &auth.session_key,
        iat,
        provider_logout: options.provider_logout,
        federated_provider_logout: options.federated_provider_logout,
        return_to: options.return_to.as_deref(),
        sig: auth.sign_sha256_domain("logout-session", &payload),
    };
    post_json_text(
        &format!("{}/auth/sessions/logout", trellis_url.trim_end_matches('/')),
        &body,
    )
    .await
}

fn logout_signature_payload(
    iat: u64,
    provider_logout: Option<bool>,
    federated_provider_logout: Option<bool>,
    return_to: Option<&str>,
) -> Result<String, trellis_rs::contracts::ContractsError> {
    let mut payload = serde_json::Map::new();
    payload.insert("iat".to_string(), Value::from(iat));
    if let Some(provider_logout) = provider_logout {
        payload.insert("providerLogout".to_string(), Value::from(provider_logout));
    }
    if let Some(federated_provider_logout) = federated_provider_logout {
        payload.insert(
            "federatedProviderLogout".to_string(),
            Value::from(federated_provider_logout),
        );
    }
    if let Some(return_to) = return_to {
        payload.insert("returnTo".to_string(), Value::from(return_to));
    }
    trellis_rs::contracts::canonicalize_json(&Value::Object(payload))
}

fn current_iat() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before UNIX epoch")
        .as_secs()
}

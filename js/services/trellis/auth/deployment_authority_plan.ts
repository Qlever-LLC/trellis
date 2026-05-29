import { computeAuthorityNeedsDelta } from "./authority_needs_decision.ts";
import type { AuthorityNeedSet, AuthorityNeedSetResource } from "./schemas.ts";

export type DeploymentAuthorityPlanClassification = "update" | "migration";

export type DeploymentAuthorityPlanClassificationResult = {
  classification: DeploymentAuthorityPlanClassification;
  desiredChange: AuthorityNeedSet;
};

function resourceKey(
  resource: Pick<AuthorityNeedSetResource, "kind" | "alias">,
) {
  return `${resource.kind}:${resource.alias}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownEquals(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    return left.length === right.length &&
      left.every((entry, index) => unknownEquals(entry, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) =>
      key === rightKeys[index] && unknownEquals(left[key], right[key])
    );
}

function requestedResourceMap(requested: AuthorityNeedSet) {
  const resources = new Map<string, AuthorityNeedSetResource>();
  for (const resource of requested.resources) {
    resources.set(resourceKey(resource), resource);
  }
  return resources;
}

function hasResourceRemoval(
  current: AuthorityNeedSet,
  requested: AuthorityNeedSet,
): boolean {
  const requestedResources = requestedResourceMap(requested);
  return current.resources.some((resource) =>
    !requestedResources.has(resourceKey(resource))
  );
}

function changedResourceDefinitions(
  current: AuthorityNeedSet,
  requested: AuthorityNeedSet,
): AuthorityNeedSetResource[] {
  const requestedResources = requestedResourceMap(requested);
  return current.resources.flatMap((resource) => {
    const requestedResource = requestedResources.get(resourceKey(resource));
    if (
      requestedResource === undefined ||
      unknownEquals(resource.definition, requestedResource.definition)
    ) {
      return [];
    }
    return [requestedResource];
  });
}

/** Classifies a requested deployment authority desired-state change. */
export function classifyDeploymentAuthorityPlan(
  current: AuthorityNeedSet,
  requested: AuthorityNeedSet,
): DeploymentAuthorityPlanClassificationResult {
  const desiredChange = computeAuthorityNeedsDelta(current, requested);
  const definitionChanges = changedResourceDefinitions(current, requested);
  const classification = hasResourceRemoval(current, requested) ||
      definitionChanges.length > 0
    ? "migration"
    : "update";

  return {
    classification,
    desiredChange: {
      ...desiredChange,
      resources: [...desiredChange.resources, ...definitionChanges],
    },
  };
}

import type { TrellisIntegrationCase } from "@qlever-llc/trellis-test/integration";
import { serviceTestMatrix } from "./matrix.ts";

export type TrellisControlPlaneIntegrationCase = TrellisIntegrationCase & {
  readonly runtime: "live-trellis";
};

/** Local Trellis service-integration cases derived from the shared matrix. */
export const controlPlaneIntegrationCases:
  readonly TrellisControlPlaneIntegrationCase[] = serviceTestMatrix.cases.map(
    (caseEntry) => ({
      id: caseEntry.id,
      fixture: caseEntry.fixture,
      file: caseEntry.implementations.typescript.file,
      testName: caseEntry.implementations.typescript.testName,
      coverage: caseEntry.coverage,
      runtime: "live-trellis",
    }),
  );

/** Returns the local service-integration case for an id. */
export function controlPlaneCaseById(
  id: string,
): TrellisControlPlaneIntegrationCase | undefined {
  return controlPlaneIntegrationCases.find((caseEntry) => caseEntry.id === id);
}

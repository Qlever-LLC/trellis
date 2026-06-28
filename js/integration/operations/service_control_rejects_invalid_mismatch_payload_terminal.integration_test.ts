import { assert, assertEquals, assertInstanceOf } from "@std/assert";
import {
  isErr,
  OperationAlreadyTerminalError,
  OperationMismatchError,
  OperationNotFoundError,
} from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createOperationsFixture } from "./_fixture.ts";

const CASE_ID =
  "operations.service-control-rejects-invalid-mismatch-payload-terminal" as const;
const fixture = createOperationsFixture(CASE_ID, {
  cancelable: true,
  statusOperation: true,
});

liveTrellisTest({
  name:
    "operations.service-control-rejects-invalid-mismatch-payload-terminal returns modeled errors for control edge cases",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const serviceKey = await runtime.registerService({
      name: fixture.serviceName,
      contract: fixture.serviceContract,
    });
    const service = await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: fixture.serviceContract,
      name: fixture.serviceName,
      sessionKeySeed: serviceKey.seed,
      telemetry: false,
      server: {},
    }).orThrow();
    let otherService: typeof service | undefined;

    try {
      const clientKey = await runtime.registerClient({
        name: fixture.clientName,
        contract: fixture.clientContract,
      });
      const accepted = await service.handle.operation.entity.process.accept({
        sessionKey: clientKey.sessionKey,
      }).orThrow();

      const missing = await service.handle.operation.entity.process.control(
        "missing-operation-id",
      ).take();
      assert(isErr(missing), "missing operation id should fail");
      assertInstanceOf(missing.error, OperationNotFoundError);

      const wrongOperation = await service.handle.operation.entity.status
        .control(
          accepted.id,
        ).take();
      assert(isErr(wrongOperation), "wrong operation control should fail");
      assertInstanceOf(wrongOperation.error, OperationMismatchError);
      assertEquals(wrongOperation.error.expectedOperation, "Entity.Status");
      assertEquals(wrongOperation.error.actualOperation, "Entity.Process");

      const controlled = await service.handle.operation.entity.process.control(
        accepted.id,
      ).orThrow();
      // @ts-expect-error Process progress requires message/step; runtime rejection is asserted below.
      const invalidProgress = await controlled.progress({ stage: "wrong" })
        .take();
      assert(isErr(invalidProgress), "invalid progress should fail");
      // @ts-expect-error Process output requires message/done; runtime rejection is asserted below.
      const invalidOutput = await controlled.complete({ status: "wrong" })
        .take();
      assert(isErr(invalidOutput), "invalid output should fail");

      await controlled.complete({
        message: `${fixture.message}:done`,
        done: true,
      })
        .orThrow();
      const terminalProgress = await controlled.progress({
        message: "late",
        step: 3,
      }).take();
      assert(isErr(terminalProgress), "terminal progress should fail");
      assertInstanceOf(terminalProgress.error, OperationAlreadyTerminalError);

      const client = await runtime.connectClient({
        name: fixture.clientName,
        contract: fixture.clientContract,
        sessionKeySeed: clientKey.seed,
      });
      const wrongRemoteOperation = await client.operation.entity.status.resume(
        accepted.ref,
      ).get().take();
      assert(
        isErr(wrongRemoteOperation),
        "wrong resumed operation should fail",
      );
      assertInstanceOf(wrongRemoteOperation.error, OperationMismatchError);

      otherService = await TrellisService.connect({
        trellisUrl: runtime.trellisUrl,
        contract: fixture.serviceContract,
        name: fixture.otherServiceName,
        sessionKeySeed: serviceKey.seed,
        telemetry: false,
        server: {},
      }).orThrow();
      const wrongService = await otherService.handle.operation.entity.process
        .control(accepted.id).take();
      assert(isErr(wrongService), "wrong service control should fail");
      assertInstanceOf(wrongService.error, OperationMismatchError);
      assertEquals(
        wrongService.error.expectedService,
        fixture.otherServiceName,
      );
      assertEquals(wrongService.error.actualService, fixture.serviceName);
    } finally {
      await otherService?.stop().catch(() => undefined);
      await service.stop();
    }
  },
});

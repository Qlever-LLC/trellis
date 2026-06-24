import { defineAppContract, defineServiceContract } from "@qlever-llc/trellis";
import {
  caseScopedContractId,
  caseScopedName,
  caseScopedSubject,
  integrationSlug,
} from "@qlever-llc/trellis-test/integration";
import { Type } from "typebox";

/** Builds case-scoped contracts and names for durable event-consumer live tests. */
export function createEventConsumersFixture(caseId: string) {
  const slug = integrationSlug(caseId);
  const schemas = {
    EventRecord: Type.Object({ id: Type.String(), value: Type.String() }),
  } as const;

  const sourceContract = defineServiceContract({ schemas }, (ref) => ({
    id: caseScopedContractId(
      "trellis.integration.event-consumers-source",
      caseId,
    ),
    displayName: `Trellis Event Consumers Source (${slug})`,
    description:
      "Publishes source events for durable consumer integration tests.",
    capabilities: {
      publishEvents: {
        displayName: "Publish event-consumer fixture events",
        description: "Publish source events for durable consumer tests.",
      },
      readEvents: {
        displayName: "Read event-consumer fixture events",
        description: "Subscribe to source events for durable consumer tests.",
      },
    },
    events: {
      "Source.Pinged": {
        version: "v1",
        subject: caseScopedSubject(
          "events.v1.integration.event-consumers.source",
          caseId,
          "pinged",
        ),
        event: ref.schema("EventRecord"),
        capabilities: {
          publish: ["publishEvents"],
          subscribe: ["readEvents"],
        },
      },
      "Source.Ponged": {
        version: "v1",
        subject: caseScopedSubject(
          "events.v1.integration.event-consumers.source",
          caseId,
          "ponged",
        ),
        event: ref.schema("EventRecord"),
        capabilities: {
          publish: ["publishEvents"],
          subscribe: ["readEvents"],
        },
      },
    },
  }));

  const missingGroupConsumerContract = defineServiceContract(
    { schemas },
    () => ({
      id: caseScopedContractId(
        "trellis.integration.event-consumers-missing-group",
        caseId,
      ),
      displayName: `Trellis Event Consumers Missing Group (${slug})`,
      description:
        "Uses source events but intentionally declares no durable event consumer group.",
      uses: {
        required: {
          source: sourceContract.use({
            events: { subscribe: ["Source.Pinged"] },
          }),
        },
      },
    }),
  );

  const ambiguousGroupConsumerContract = defineServiceContract(
    { schemas },
    () => ({
      id: caseScopedContractId(
        "trellis.integration.event-consumers-ambiguous-group",
        caseId,
      ),
      displayName: `Trellis Event Consumers Ambiguous Group (${slug})`,
      description:
        "Declares two durable groups for the same source event to require opts.group.",
      uses: {
        required: {
          source: sourceContract.use({
            events: { subscribe: ["Source.Pinged"] },
          }),
        },
      },
      eventConsumers: {
        primary: {
          uses: { source: ["Source.Pinged"] },
          ackWaitMs: 1_000,
          maxDeliver: 2,
        },
        secondary: {
          uses: { source: ["Source.Pinged"] },
          ackWaitMs: 1_000,
          maxDeliver: 2,
        },
      },
    }),
  );

  const dependencyConsumerContract = defineServiceContract(
    { schemas },
    () => ({
      id: caseScopedContractId(
        "trellis.integration.event-consumers-dependency",
        caseId,
      ),
      displayName: `Trellis Event Consumers Dependency (${slug})`,
      description:
        "Consumes source events through one Trellis-provisioned durable group.",
      uses: {
        required: {
          source: sourceContract.use({
            events: { subscribe: ["Source.Pinged"] },
          }),
        },
      },
      eventConsumers: {
        ingest: {
          uses: { source: ["Source.Pinged"] },
          ackWaitMs: 1_000,
          maxDeliver: 2,
        },
      },
    }),
  );

  const groupedDependencyConsumerContract = defineServiceContract(
    { schemas },
    () => ({
      id: caseScopedContractId(
        "trellis.integration.event-consumers-grouped-dependency",
        caseId,
      ),
      displayName: `Trellis Event Consumers Grouped Dependency (${slug})`,
      description:
        "Consumes two source events through one Trellis-provisioned durable group.",
      uses: {
        required: {
          source: sourceContract.use({
            events: { subscribe: ["Source.Pinged", "Source.Ponged"] },
          }),
        },
      },
      eventConsumers: {
        paired: {
          uses: { source: ["Source.Pinged", "Source.Ponged"] },
          ackWaitMs: 1_000,
          maxDeliver: 2,
        },
      },
    }),
  );

  const selfConsumerContract = defineServiceContract({ schemas }, (ref) => ({
    id: caseScopedContractId(
      "trellis.integration.event-consumers-self",
      caseId,
    ),
    displayName: `Trellis Event Consumers Self (${slug})`,
    description:
      "Publishes and consumes self-owned events through durable groups.",
    events: {
      "Self.Pinged": {
        version: "v1",
        subject: caseScopedSubject(
          "events.v1.integration.event-consumers.self",
          caseId,
          "pinged",
        ),
        event: ref.schema("EventRecord"),
      },
      "Self.Ponged": {
        version: "v1",
        subject: caseScopedSubject(
          "events.v1.integration.event-consumers.self",
          caseId,
          "ponged",
        ),
        event: ref.schema("EventRecord"),
      },
    },
    eventConsumers: {
      ingest: {
        self: ["Self.Pinged"],
        ackWaitMs: 1_000,
        maxDeliver: 2,
      },
      paired: {
        self: ["Self.Pinged", "Self.Ponged"],
        ackWaitMs: 1_000,
        maxDeliver: 2,
      },
    },
  }));

  const sourcePublisherContract = defineAppContract(() => ({
    id: caseScopedContractId(
      "trellis.integration.event-consumers-publisher",
      caseId,
    ),
    displayName: `Trellis Event Consumers Publisher (${slug})`,
    description: "Publishes source events through a generated app facade.",
    uses: {
      required: {
        source: sourceContract.use({
          events: { publish: ["Source.Pinged", "Source.Ponged"] },
        }),
      },
    },
  }));

  return {
    sourceContract,
    sourcePublisherContract,
    missingGroupConsumerContract,
    ambiguousGroupConsumerContract,
    dependencyConsumerContract,
    groupedDependencyConsumerContract,
    selfConsumerContract,
    sourceName: caseScopedName("event-consumers-source", caseId),
    publisherName: caseScopedName("event-consumers-publisher", caseId),
    consumerName: caseScopedName("event-consumers-consumer", caseId),
    eventId: caseScopedName("event", caseId),
    secondEventId: caseScopedName("event-second", caseId),
    sourcePingedFilterSubject: caseScopedSubject(
      "events.v1.integration.event-consumers.source",
      caseId,
      "pinged",
    ),
    sourcePongedFilterSubject: caseScopedSubject(
      "events.v1.integration.event-consumers.source",
      caseId,
      "ponged",
    ),
    selfPingedFilterSubject: caseScopedSubject(
      "events.v1.integration.event-consumers.self",
      caseId,
      "pinged",
    ),
    selfPongedFilterSubject: caseScopedSubject(
      "events.v1.integration.event-consumers.self",
      caseId,
      "ponged",
    ),
  };
}

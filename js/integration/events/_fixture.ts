import { defineAppContract, defineServiceContract } from "@qlever-llc/trellis";
import { Type } from "typebox";
import {
  caseScopedContractId,
  caseScopedName,
  caseScopedSubject,
  integrationSlug,
} from "../_support/names.ts";

export function createEventsFixture(caseId: string) {
  const slug = integrationSlug(caseId);
  const eventSchemas = {
    EntityChanged: Type.Object({
      id: Type.String(),
      value: Type.String(),
      header: Type.Optional(Type.String()),
    }),
  } as const;
  const entityChangedSubject = caseScopedSubject(
    "events.v1.Integration.Events",
    caseId,
    "Entity.Changed",
  );

  const serviceContract = defineServiceContract(
    { schemas: eventSchemas },
    (ref) => ({
      id: caseScopedContractId("trellis.integration.events-service", caseId),
      displayName: `Trellis Integration Events Service (${slug})`,
      description: "Exercises generated event publish and subscribe surfaces.",
      capabilities: {
        publishRecords: {
          displayName: "Publish records",
          description: "Publish entity change records in the events fixture.",
        },
        readRecords: {
          displayName: "Read records",
          description:
            "Subscribe to entity change records in the events fixture.",
        },
      },
      events: {
        "Entity.Changed": {
          version: "v1",
          subject: entityChangedSubject,
          event: ref.schema("EntityChanged"),
          capabilities: {
            publish: ["publishRecords"],
            subscribe: ["readRecords"],
          },
        },
      },
    }),
  );

  const pubSubClientContract = defineAppContract(() => ({
    id: caseScopedContractId(
      "trellis.integration.events-pubsub-client",
      caseId,
    ),
    displayName: `Trellis Integration Events PubSub Client (${slug})`,
    description:
      "App/client participant with event publish and subscribe authority.",
    uses: {
      required: {
        eventsService: serviceContract.use({
          events: {
            publish: ["Entity.Changed"],
            subscribe: ["Entity.Changed"],
          },
        }),
      },
    },
  }));

  const subscribeOnlyClientContract = defineAppContract(() => ({
    id: caseScopedContractId(
      "trellis.integration.events-subscribe-only-client",
      caseId,
    ),
    displayName: `Trellis Integration Events Subscribe-Only Client (${slug})`,
    description: "App/client participant without event publish authority.",
    uses: {
      required: {
        eventsService: serviceContract.use({
          events: { subscribe: ["Entity.Changed"] },
        }),
      },
    },
  }));

  const publishOnlyClientContract = defineAppContract(() => ({
    id: caseScopedContractId(
      "trellis.integration.events-publish-only-client",
      caseId,
    ),
    displayName: `Trellis Integration Events Publish-Only Client (${slug})`,
    description: "App/client participant without event subscribe authority.",
    uses: {
      required: {
        eventsService: serviceContract.use({
          events: { publish: ["Entity.Changed"] },
        }),
      },
    },
  }));

  return {
    slug,
    serviceContract,
    pubSubClientContract,
    subscribeOnlyClientContract,
    publishOnlyClientContract,
    captureName: caseScopedName("events-fixture-capture", caseId),
    publisherName: caseScopedName("events-fixture-publisher", caseId),
    authorizedPublisherName: caseScopedName(
      "events-fixture-authorized-publisher",
      caseId,
    ),
    subscribeOnlyName: caseScopedName(
      "events-fixture-subscribe-only",
      caseId,
    ),
    publishOnlyName: caseScopedName("events-fixture-publish-only", caseId),
    sourceSubject: entityChangedSubject,
    publishedEntityId: caseScopedName("entity-events", caseId),
    deniedPublishEntityId: caseScopedName("entity-denied", caseId),
    deniedSubscribeEntityId: caseScopedName("entity-no-subscribe", caseId),
  };
}

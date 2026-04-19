export type JobsQueueBinding = {
  queueType: string;
  publishPrefix: string;
  workSubject: string;
  consumerName: string;
  payload: { schema: string };
  result?: { schema: string };
  maxDeliver: number;
  backoffMs: number[];
  ackWaitMs: number;
  defaultDeadlineMs?: number;
  progress: boolean;
  logs: boolean;
  dlq: boolean;
  concurrency: number;
};

export type JobsBinding = {
  namespace: string;
  queues: Record<string, JobsQueueBinding>;
};

export type JobsRuntimeBinding = {
  jobs: JobsBinding;
  workStream: string;
};

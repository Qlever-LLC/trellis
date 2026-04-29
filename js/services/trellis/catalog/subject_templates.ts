/**
 * Convert a contract subject template to the effective NATS wildcard subject.
 */
export function templateToWildcard(subject: string): string {
  return subject.replace(/\{[^}]+\}/g, "*");
}

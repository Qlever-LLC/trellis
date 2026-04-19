export function printScenarioHeading(name: string): void {
  console.info(`\n=== ${name} ===`);
}

export function printJson(label: string, value: unknown): void {
  console.info(label);
  console.dir(value, { depth: null });
}

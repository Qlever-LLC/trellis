export function shouldRenderProviderChooser(
  providerCount: number,
  alwaysShowProviderChooser: boolean,
): boolean {
  return alwaysShowProviderChooser || providerCount > 1;
}

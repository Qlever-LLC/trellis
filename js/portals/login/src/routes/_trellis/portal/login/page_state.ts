function isSamePageLocation(currentUrl: URL, location: string | null): boolean {
  if (!location) return false;

  const nextUrl = new URL(location, currentUrl);
  return `${nextUrl.origin}${nextUrl.pathname}${nextUrl.search}` ===
    `${currentUrl.origin}${currentUrl.pathname}${currentUrl.search}`;
}

export function shouldStayOnPortalCompletionPage(
  currentUrl: URL,
  redirectLocation: string | null,
): boolean {
  return isSamePageLocation(currentUrl, redirectLocation);
}

export function shouldOfferPortalReturnLink(
  currentUrl: URL,
  returnLocation: string | null | undefined,
): boolean {
  if (!returnLocation) return false;
  return !isSamePageLocation(currentUrl, returnLocation);
}

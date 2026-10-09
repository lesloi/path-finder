/** The header that tells the API which build asked, so that it can answer a tab left open across a deploy. */
export function buildIdHeader(): Record<string, string> {
  const buildId: unknown = import.meta.env.VITE_BUILD_ID;
  // Outside a build there is no id, and "undefined" would never match the API's.
  return typeof buildId === 'string' ? { 'X-Build-Id': buildId } : {};
}

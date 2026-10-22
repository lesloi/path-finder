import { API_VERSION } from '../contract/index.ts';

/**
 * The header that tells the API which version of it the app is built for, so that it can refuse a tab left open across
 * a breaking deploy. Outside a build there is none: the dev server may run an older binary than `contract.json`, and a
 * reload would not fix that.
 */
export function apiVersionHeader(): Record<string, string> {
  return typeof import.meta.env.VITE_BUILD_ID === 'string' ? { 'X-Api-Version': String(API_VERSION) } : {};
}

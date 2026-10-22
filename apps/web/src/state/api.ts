import { API_VERSION } from '../contract/index.ts';

/** The header that tells the API which version of it the app is built for, so that it can refuse a tab left open across a breaking deploy. */
export function apiVersionHeader(): Record<string, string> {
  return { 'X-Api-Version': String(API_VERSION) };
}

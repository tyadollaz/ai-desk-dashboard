// Google OAuth token endpoint helpers (shared by the live adapter and the OAuth routes).
// Goes through the allow-listed HttpClient. Never logs or returns raw upstream bodies.
import { ProviderError, type HttpClient } from '../types.js';

export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';
export const REAUTH_MESSAGE = 'Google access was revoked or expired — reconnect Google Calendar in Settings';

export interface GoogleTokens {
  refresh_token?: string;
  access_token?: string;
  expiry_date?: number;
  scope?: string;
}

export interface GoogleOAuthEnv {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function googleOAuthEnv(env: Record<string, string | undefined>): GoogleOAuthEnv | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = env.GOOGLE_REDIRECT_URI?.trim();
  return clientId && clientSecret && redirectUri ? { clientId, clientSecret, redirectUri } : null;
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

/** POSTs to the token endpoint. Maps `invalid_grant` to reauth_required; other 4xx to a generic upstream error. */
export async function postTokenRequest(http: HttpClient, form: Record<string, string>): Promise<TokenResponse> {
  const res = await http.request(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
    acceptStatuses: [400, 401],
  });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const obj = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  if (res.status === 400 || res.status === 401) {
    if (obj.error === 'invalid_grant') throw new ProviderError('reauth_required', REAUTH_MESSAGE);
    if (res.status === 401 || obj.error === 'invalid_client' || obj.error === 'unauthorized_client') {
      throw new ProviderError('auth_failed', 'Google rejected the OAuth client credentials — check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET');
    }
    throw new ProviderError('upstream', 'Google rejected the token request');
  }
  if (typeof obj.access_token !== 'string' || typeof obj.expires_in !== 'number') {
    throw new ProviderError('malformed', 'Google returned an unreadable token response');
  }
  return {
    access_token: obj.access_token,
    expires_in: obj.expires_in,
    refresh_token: typeof obj.refresh_token === 'string' ? obj.refresh_token : undefined,
    scope: typeof obj.scope === 'string' ? obj.scope : undefined,
  };
}

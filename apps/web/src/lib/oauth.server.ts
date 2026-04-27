import crypto from "node:crypto";

const FOURM_BASE_URL = process.env.FOURM_URL ?? "http://localhost:8000";
const FOURM_CLIENT_ID = process.env.FOURM_CLIENT_ID ?? "artbin";
const ARTBIN_BASE_URL = process.env.ARTBIN_URL ?? "http://localhost:5173";

export const FOURM_AUTHORIZE_URL = `${FOURM_BASE_URL}/oauth/authorize`;
export const FOURM_TOKEN_URL = `${FOURM_BASE_URL}/oauth/token`;
export const FOURM_USERINFO_URL = `${FOURM_BASE_URL}/oauth/userinfo`;
export const FOURM_REDIRECT_URI = `${ARTBIN_BASE_URL}/auth/4orm/callback`;

export { FOURM_CLIENT_ID };

export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

export async function exchangeCode(
  code: string,
  codeVerifier: string,
): Promise<{ access_token: string; token_type: string; expires_in: number }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: FOURM_REDIRECT_URI,
    client_id: FOURM_CLIENT_ID,
    code_verifier: codeVerifier,
  });

  const response = await fetch(FOURM_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${err}`);
  }

  return response.json();
}

export async function fetchUserinfo(
  accessToken: string,
): Promise<{ sub: string; username: string; display_name: string }> {
  const response = await fetch(FOURM_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Userinfo fetch failed (${response.status})`);
  }

  return response.json();
}

import { redirect } from "react-router";
import type { Route } from "./+types/auth.4orm";
import {
  FOURM_AUTHORIZE_URL,
  FOURM_CLIENT_ID,
  FOURM_REDIRECT_URI,
  generateCodeVerifier,
  generateCodeChallenge,
} from "~/lib/oauth.server";

export async function loader({ request }: Route.LoaderArgs) {
  const verifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);
  const state = crypto.randomUUID();

  const params = new URLSearchParams({
    response_type: "code",
    client_id: FOURM_CLIENT_ID,
    redirect_uri: FOURM_REDIRECT_URI,
    scope: "openid profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  const oauthData = JSON.stringify({ verifier, state });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const cookie = `artbin_oauth=${encodeURIComponent(oauthData)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure}`;

  return redirect(`${FOURM_AUTHORIZE_URL}?${params.toString()}`, {
    headers: { "Set-Cookie": cookie },
  });
}

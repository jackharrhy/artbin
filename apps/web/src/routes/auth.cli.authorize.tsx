import { redirect } from "react-router";
import type { Route } from "./+types/auth.cli.authorize";
import {
  FOURM_AUTHORIZE_URL,
  FOURM_CLIENT_ID,
  getCliRedirectUri,
  generateCodeVerifier,
  generateCodeChallenge,
} from "~/lib/oauth.server";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const cliPort = url.searchParams.get("port");

  if (!cliPort) {
    return new Response("Missing port parameter", { status: 400 });
  }

  const verifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);
  const state = crypto.randomUUID();

  const params = new URLSearchParams({
    response_type: "code",
    client_id: FOURM_CLIENT_ID,
    redirect_uri: getCliRedirectUri(),
    scope: "openid profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  const oauthData = JSON.stringify({ verifier, state, cliPort });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const cookie = `artbin_cli_oauth=${encodeURIComponent(oauthData)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure}`;

  return redirect(`${FOURM_AUTHORIZE_URL}?${params.toString()}`, {
    headers: { "Set-Cookie": cookie },
  });
}

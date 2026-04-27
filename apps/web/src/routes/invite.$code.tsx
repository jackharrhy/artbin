import { redirect } from "react-router";
import type { Route } from "./+types/invite.$code";
import { getInviteByCode } from "~/lib/auth.server";

export async function loader({ params }: Route.LoaderArgs) {
  const code = params.code;

  if (!code) {
    return redirect("/login");
  }

  // Validate the invite code exists and is usable
  const invite = await getInviteByCode(code);

  if (!invite || !invite.isActive) {
    return redirect("/login?error=invalid_invite");
  }

  if (invite.maxUses !== null && (invite.useCount ?? 0) >= invite.maxUses) {
    return redirect("/login?error=invite_exhausted");
  }

  // Redirect to register with the code pre-filled
  return redirect(`/register?code=${code}`);
}

export default function InviteRedirect() {
  return null;
}

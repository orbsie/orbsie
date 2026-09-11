import { generationMaxTokens } from "@/lib/server/generation-limits";
import { getAuth, isAdminEmail } from "@/lib/server/auth";

export async function GET(request: Request) {
  let admin = false;
  const auth = getAuth();
  if (auth) {
    try {
      const session = await auth.api.getSession({ headers: request.headers });
      admin = isAdminEmail(session?.user.email);
    } catch {
      admin = false;
    }
  }
  return Response.json({
    generationMaxTokens: generationMaxTokens(),
    accounts: !!(process.env.DATABASE_URL && process.env.BETTER_AUTH_SECRET),
    publishing: !!(
      process.env.DATABASE_URL &&
      process.env.VERCEL_DEPLOY_TOKEN &&
      process.env.VERCEL_TEAM_ID
    ),
    google: !!(
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ),
    isAdmin: admin,
    ...(process.env.ORBSIE_CHATGPT_HOSTED === "1" &&
    process.env.DATABASE_URL &&
    process.env.BETTER_AUTH_SECRET
      ? { chatgptHosted: true }
      : {}),
    ...(process.env.ORBSIE_CHATGPT_HOSTED === "1" &&
    process.env.ORBSIE_CHATGPT_GENERATION === "1" &&
    process.env.DATABASE_URL &&
    process.env.BETTER_AUTH_SECRET
      ? { chatgptGeneration: true }
      : {}),
  });
}

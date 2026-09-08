import { generationMaxTokens } from "@/lib/server/generation-limits";

export async function GET() {
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
  });
}

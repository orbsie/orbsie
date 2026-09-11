import {
  apiError,
  checkOrigin,
  isAdminEmail,
  requireUser,
} from "../../../../lib/server/auth";
import { resetRecentTrialUsage } from "../../../../lib/server/trial";

export const maxDuration = 30;
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await requireUser(request);
    if (!isAdminEmail(user.email))
      return new Response(null, { status: 404 });
    const result = await resetRecentTrialUsage();
    return Response.json(result);
  } catch (e) {
    return apiError(e);
  }
}

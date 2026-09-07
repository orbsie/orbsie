import {getAuth} from '@/lib/server/auth';
export const runtime='nodejs';
async function handler(request:Request){const auth=getAuth();if(!auth)return Response.json({error:'Cloud accounts are not configured.'},{status:503});return auth.handler(request);}
export {handler as GET,handler as POST};

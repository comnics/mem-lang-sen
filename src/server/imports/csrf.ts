import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { HttpError } from '@/server/http';
import { createClient } from '@/lib/supabase/server';
const name='personal-csrf';
async function sessionBinding(userId:string) {
 const {data:{session}}=await (await createClient()).auth.getSession();
 if(!session?.access_token)throw new HttpError(401,'다시 로그인해 주세요.');
 return createHash('sha256').update(userId+'\0'+session.access_token).digest('hex');
}
// Same-origin token endpoint + HttpOnly double-submit cookie, bound to the
// verified Auth UUID. Cross-origin JS cannot read the token and HTML forms
// cannot set the custom header. No global Origin policy changes.
export async function issuePersonalCsrf(userId:string) {
  const token=randomBytes(32).toString('hex');const jar=await cookies();
  jar.set(name,`${await sessionBinding(userId)}.${token}`,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/api/v1',maxAge:1800});
  return {token};
}
export async function assertPersonalCsrf(request:Request,userId:string) {
  if(request.headers.get('sec-fetch-site')==='cross-site')throw new HttpError(403,'보안 확인에 실패했습니다.');
  const raw=(await cookies()).get(name)?.value??'';const supplied=request.headers.get('x-personal-csrf')??'';
  const expected=`${await sessionBinding(userId)}.${supplied}`;
  if(!/^[a-f0-9]{64}$/.test(supplied)||raw.length!==expected.length||!timingSafeEqual(Buffer.from(raw),Buffer.from(expected)))throw new HttpError(403,'보안 토큰이 만료되었습니다. 다시 시도해 주세요.');
}

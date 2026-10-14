import 'server-only';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { db } from './db';
import { HttpError } from './http';
import { isConfigured } from './env';
export async function getCurrentUser(){
 if(!isConfigured())return null;
 const supabase=await createClient();const {data:{user},error}=await supabase.auth.getUser();
 if(error||!user)return null;
 const existing=await db.appUser.findUnique({where:{id:user.id}});
 if(existing)return existing;
 // Concurrent page/layout guards may see a new Auth user at the same time.
 await db.appUser.createMany({data:[{id:user.id,email:user.email??'',displayName:typeof user.user_metadata?.displayName==='string'?user.user_metadata.displayName.slice(0,80):null}],skipDuplicates:true});
 return db.appUser.findUniqueOrThrow({where:{id:user.id}});
}
export async function requireUser(){const user=await getCurrentUser();if(!user)throw new HttpError(401,'로그인이 필요합니다.');if(user.status!=='ACTIVE')throw new HttpError(403,'이 계정은 현재 이용할 수 없습니다.');return user;}
export async function requireAdmin(){const user=await requireUser();if(user.role!=='ADMIN')throw new HttpError(403,'관리자 권한이 필요합니다.');return user;}
export async function requirePageUser(admin=false){
 if(!isConfigured())redirect('/login?reason=setup');
 const user=await getCurrentUser();if(!user)redirect('/login');if(user.status!=='ACTIVE')redirect('/login?reason=suspended');if(admin&&user.role!=='ADMIN')redirect('/today');return user;
}

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireUser, getCurrentUser } from '@/server/auth';
import { api, HttpError, jsonBody } from '@/server/http';
import { appOrigin, isConfigured } from '@/server/env';
const email=z.string().email().max(254);const password=z.string().min(10,'비밀번호는 10자 이상 입력해 주세요.').max(128);
export const POST=api(async(req,{params})=>{
 if(!isConfigured())throw new HttpError(503,'서비스 연결을 준비하고 있습니다. 잠시 후 이용해 주세요.');
 const {action}=await params;const supabase=await createClient();
 if(action==='signout'){await supabase.auth.signOut();return Response.json({redirectTo:'/'});}
 if(action==='signin'){
  const body=await jsonBody(req,z.object({email,password:z.string().min(1).max(128)}));
  const {error}=await supabase.auth.signInWithPassword(body);if(error)throw new HttpError(400,'이메일과 비밀번호를 확인해 주세요.');
  const user=await getCurrentUser();if(!user||user.status!=='ACTIVE'){await supabase.auth.signOut();throw new HttpError(403,'이 계정은 현재 이용할 수 없습니다.');}
  return Response.json({redirectTo:user.role==='ADMIN'?'/admin':user.onboarded?'/today':'/onboarding'});
 }
 if(action==='signup'){
  const body=await jsonBody(req,z.object({email,password,displayName:z.string().trim().min(1).max(80).optional()}));
  const {error}=await supabase.auth.signUp({email:body.email,password:body.password,options:{data:{displayName:body.displayName},emailRedirectTo:appOrigin()+'/auth/callback'}});
  if(error)throw new HttpError(400,'가입 요청을 처리하지 못했습니다. 입력값을 확인하거나 잠시 후 다시 시도해 주세요.');
  return Response.json({message:'가입 확인 메일을 보냈습니다. 메일의 링크를 눌러 주세요.'});
 }
 if(action==='forgot'){
  const body=await jsonBody(req,z.object({email}));
  await supabase.auth.resetPasswordForEmail(body.email,{redirectTo:appOrigin()+'/auth/callback?next=/reset-password'});
  return Response.json({message:'등록된 이메일이면 비밀번호 재설정 링크를 보내드립니다.'});
 }
 if(action==='update-password'){
  await requireUser();const body=await jsonBody(req,z.object({password}));const {error}=await supabase.auth.updateUser(body);if(error)throw new HttpError(400,'비밀번호를 변경하지 못했습니다. 링크를 다시 요청해 주세요.');return Response.json({message:'비밀번호를 변경했습니다.',redirectTo:'/today'});
 }
 throw new HttpError(404,'지원하지 않는 요청입니다.');
});

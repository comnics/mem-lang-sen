import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { appOrigin } from '@/server/env';
export async function GET(request:Request){
 const url=new URL(request.url);const code=url.searchParams.get('code');
 if(code){const supabase=await createClient();const {error}=await supabase.auth.exchangeCodeForSession(code);if(!error){const next=url.searchParams.get('next');return NextResponse.redirect(new URL(next==='/reset-password'?next:'/today',appOrigin()));}}
 return NextResponse.redirect(new URL('/login?reason=expired',appOrigin()));
}

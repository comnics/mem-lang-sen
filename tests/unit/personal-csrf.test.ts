import { beforeEach,describe,it,expect,vi } from 'vitest';
const state=vi.hoisted(()=>({value:'',session:'session-A'}));
vi.mock('next/headers',()=>({cookies:async()=>({set:(_name:string,value:string)=>{state.value=value;},get:()=>({value:state.value})})}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getSession:async()=>({data:{session:{access_token:state.session}}})}})}));
import { issuePersonalCsrf,assertPersonalCsrf } from '@/server/imports/csrf';
const id='11111111-1111-4111-8111-111111111111';
describe('personal session-bound CSRF',()=>{
 beforeEach(()=>{state.value='';state.session='session-A';});
 it('accepts issued token only for its owner and Auth session',async()=>{const {token}=await issuePersonalCsrf(id);const req=new Request('http://local.test',{headers:{'x-personal-csrf':token}});await expect(assertPersonalCsrf(req,id)).resolves.toBeUndefined();await expect(assertPersonalCsrf(req,'22222222-2222-4222-8222-222222222222')).rejects.toMatchObject({status:403});state.session='session-B';await expect(assertPersonalCsrf(req,id)).rejects.toMatchObject({status:403});});
 it('rejects missing/forged header and cross-site fetch',async()=>{const {token}=await issuePersonalCsrf(id);const cases:Record<string,string>[]=[{},{'x-personal-csrf':'0'.repeat(64)},{'x-personal-csrf':token,'sec-fetch-site':'cross-site'}];for(const headers of cases)await expect(assertPersonalCsrf(new Request('http://local.test',{headers}),id)).rejects.toMatchObject({status:403});});
});

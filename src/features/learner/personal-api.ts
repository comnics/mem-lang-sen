export async function personalRequest<T>(url:string,method='GET',body?:unknown):Promise<T> {
  const headers:Record<string,string>={};
  if(method!=='GET'){
    const response=await fetch('/api/v1/personal-csrf',{cache:'no-store'});const csrf=await response.json();
    if(!response.ok)throw new Error(csrf.error??'다시 로그인해 주세요.');headers['x-personal-csrf']=csrf.token;
  }
  const multipart=body instanceof FormData;
  if(body!==undefined&&!multipart)headers['Content-Type']='application/json';
  const response=await fetch(url,{method,headers,cache:'no-store',body:body===undefined?undefined:multipart?body:JSON.stringify(body)});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(`${response.status===409?'변경 충돌: ':''}${result.error??'요청을 처리하지 못했습니다.'}`);
  return result as T;
}

export class UploadFailure extends Error{
 constructor(message,{code='network',status=0,requestId='',retryable=false}={}){super(message);Object.assign(this,{code,status,requestId,retryable});}
}

export function checkAbort(signal){
 if(signal?.aborted)throw signal.reason||new DOMException('已取消','AbortError');
}
export class PrivateServiceClient{
 constructor({endpoint,token,fetch:fetcher=(...args)=>globalThis.fetch(...args)}){
  this.endpoint=endpoint.replace(/\/$/,'');this.token=token;this.fetch=fetcher;
 }
 async request(path,{method='GET',body,signal,anonymous=false}={}){
  checkAbort(signal);const control=new AbortController(),abort=()=>control.abort(signal.reason),timer=setTimeout(()=>control.abort(new DOMException('请求超时','TimeoutError')),30000);
  signal?.addEventListener('abort',abort,{once:true});
  try{
   let response;
   try{response=await this.fetch(this.endpoint+path,{method,credentials:'omit',cache:'no-store',signal:control.signal,headers:{...(anonymous?{}:{Authorization:'Bearer '+this.token()}),...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body!==undefined?JSON.stringify(body):undefined});}
   catch(error){checkAbort(signal);throw new UploadFailure(control.signal.aborted?'上传服务响应超时，请重试；已确认的分块会复用。':'暂时无法连接私有上传服务，请检查网络后重试。',{code:control.signal.aborted?'timeout':'network',retryable:true});}
   let value;try{value=await response.json();}catch{throw new UploadFailure('上传服务返回了无法识别的响应。',{code:'response',status:response.status,retryable:response.status>=500});}
   if(!response.ok)throw new UploadFailure(value.error?.message||'上传操作未完成。',{code:value.error?.code||'http_error',status:response.status,requestId:value.error?.requestId||'',retryable:value.error?.retryable??response.status>=500});
   return value;
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 }
}

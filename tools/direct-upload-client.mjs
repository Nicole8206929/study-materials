import {checkAbort,createFileHasher} from './file-hash.mjs';
import {PrivateServiceClient,UploadFailure} from './private-service-client.mjs';
export {UploadFailure};
const sleep=(ms,signal)=>new Promise((resolve,reject)=>{
 checkAbort(signal);const abort=()=>{clearTimeout(timer);reject(signal.reason||new DOMException('已暂停','AbortError'));};
 const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);signal?.addEventListener('abort',abort,{once:true});
});
export function sendUploadPart({url,token,sha256,body,signal,onProgress}){
 return new Promise((resolve,reject)=>{
  checkAbort(signal);const xhr=new XMLHttpRequest(),requestId=crypto.randomUUID();
  const abort=()=>xhr.abort();signal?.addEventListener('abort',abort,{once:true});
  xhr.open('PUT',url);xhr.timeout=240000;
  xhr.setRequestHeader('Authorization','Bearer '+token);xhr.setRequestHeader('Content-Type','application/octet-stream');xhr.setRequestHeader('X-Chunk-Sha256',sha256);xhr.setRequestHeader('X-Upload-Request',requestId);
  xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress?.(e.loaded);};
  const failure=(message,code,status=0,retryable=true)=>new UploadFailure(message,{code,status,requestId,retryable});
  xhr.onload=()=>{
   let value;try{value=JSON.parse(xhr.responseText);}catch{}
   if(xhr.status>=200&&xhr.status<300&&value)return resolve(value);
   reject(new UploadFailure(value?.error?.message||`上传接口返回 HTTP ${xhr.status}。`,{code:value?.error?.code||'http_error',status:xhr.status,requestId:value?.error?.requestId||requestId,retryable:xhr.status>=500||xhr.status===429}));
  };
  xhr.onerror=()=>reject(failure('浏览器没有收到上传响应；将先核对服务器已收到的分块。','network'));
  xhr.ontimeout=()=>reject(failure('本分块传输超时；将核对后重试未完成的部分。','timeout'));
  xhr.onabort=()=>reject(signal?.reason||new DOMException('已暂停上传','AbortError'));
  xhr.onloadend=()=>signal?.removeEventListener('abort',abort);
  xhr.send(body);
 });
}
export class DirectUploadClient extends PrivateServiceClient{
 constructor({endpoint,token,fetch:fetcher=(...args)=>globalThis.fetch(...args),sendPart=sendUploadPart,wait=sleep}){
  super({endpoint,token,fetch:fetcher});this.sendPart=sendPart;this.wait=wait;
 }
 async pair(ticket,clientToken){return this.request('/api/pair',{method:'POST',body:{ticket,clientToken},anonymous:true});}
 async health(){return this.request('/health',{anonymous:true});}
 async hash(file,{signal,onProgress}={}){
  try{return (await createFileHasher({signal,onBytes:(_,bytes)=>onProgress?.(bytes)})(file)).slice(7);}
  catch(error){checkAbort(signal);throw new UploadFailure('手机未能完整读出这个文件。请先从微信完整保存到“下载”或“文档”，再重新选择。',{code:'read_file'});}
 }
 async uploadFile(batch,file,{sha256,signal,onProgress=()=>{}}={}){
  sha256||=await this.hash(file,{signal});
  const base='/api/batches/'+encodeURIComponent(batch)+'/files';
  let result=await this.request(base,{method:'POST',body:{name:file.name,size:file.size,sha256},signal}),remote=result.file;
  if(!remote||remote.size!==file.size||remote.sha256!==sha256||!Number.isInteger(result.chunkSize)||result.chunkSize<1||result.chunkSize>8*1024*1024)throw new UploadFailure('服务器记录与所选文件不一致，已停止上传。',{code:'integrity'});
  const filePath=base+'/'+encodeURIComponent(remote.id),chunkSize=result.chunkSize;
  if(remote.state==='complete'){onProgress({state:'complete',sent:file.size,confirmed:file.size,total:file.size,reused:true});return remote;}
  const parts=new Map(remote.parts.map(p=>[p.number,p]));let confirmed=remote.receivedBytes||0;
  for(let offset=0;offset<file.size;offset+=chunkSize){
   checkAbort(signal);const number=Math.floor(offset/chunkSize)+1,body=file.slice(offset,Math.min(file.size,offset+chunkSize));
   const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await body.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');
   if(parts.get(number)?.sha256===digest&&parts.get(number).size===body.size){onProgress({state:'uploading',sent:confirmed,confirmed,total:file.size,resumed:true});continue;}
   if(parts.has(number)){confirmed-=parts.get(number).size;parts.delete(number);}
   for(let attempt=0;;attempt++){
    checkAbort(signal);
    try{
     const ack=await this.sendPart({url:this.endpoint+filePath+'/parts/'+number,number,token:this.token(),sha256:digest,body,signal,
      onProgress:loaded=>onProgress({state:'uploading',sent:confirmed+Math.min(loaded,body.size),confirmed,total:file.size})});
     if(ack.number!==number||ack.sha256!==digest||ack.size!==body.size)throw new UploadFailure('服务器分块回执不一致，已停止。',{code:'integrity'});
     confirmed+=body.size;parts.set(number,ack);onProgress({state:'uploading',sent:confirmed,confirmed,total:file.size});break;
    }catch(error){
     checkAbort(signal);
     if(!error.retryable||attempt>=3){error.part=number;throw error;}
     onProgress({state:'retrying',sent:confirmed,confirmed,total:file.size,attempt:attempt+1,message:error.message});
     await this.wait([1500,4000,10000][attempt],signal);checkAbort(signal);
     try{
      const latest=(await this.request(filePath,{signal})).file,prior=latest.parts.find(p=>p.number===number);
      if(prior?.sha256===digest&&prior.size===body.size){confirmed=latest.receivedBytes;for(const p of latest.parts)parts.set(p.number,p);break;}
     }catch(check){checkAbort(signal);if(!check.retryable)throw check;}
    }
   }
  }
  onProgress({state:'verifying',sent:file.size,confirmed,total:file.size});
  remote=(await this.request(filePath+'/complete',{method:'POST',body:{},signal})).file;
  const deadline=Date.now()+300000;
  while(remote.state!=='complete'){
   checkAbort(signal);if(remote.state==='failed')throw new UploadFailure('文件整体校验不一致，请重新保存原文件后再上传。',{code:'integrity'});
   if(Date.now()>deadline)throw new UploadFailure('文件已发送，服务器校验暂未完成。重新选择同一文件可继续核对。',{code:'timeout',retryable:true});
   await this.wait(1000,signal);remote=(await this.request(filePath,{signal})).file;
  }
  onProgress({state:'complete',sent:file.size,confirmed:file.size,total:file.size});return remote;
 }
 async status(batch){return this.request('/api/batches/'+encodeURIComponent(batch));}
 async cancel(batch){return this.request('/api/batches/'+encodeURIComponent(batch),{method:'DELETE'});}
 async fail(batch,error){return this.request('/api/batches/'+encodeURIComponent(batch)+'/failed',{method:'POST',body:{code:error.code||'http_error',requestId:error.requestId||'',httpStatus:error.status||0,part:error.part||0,hidden:globalThis.document?.visibilityState==='hidden'}});}
}

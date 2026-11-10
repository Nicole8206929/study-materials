import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DirectUploadClient} from '../tools/direct-upload-client.mjs';
test('a lost part response is reconciled before retry, and progress reaches success only after server verification',async()=>{
 const bytes=new Uint8Array(12);bytes.set([37,80,68,70]);
 const file=new File([bytes],'physics.pdf'),sha256=createHash('sha256').update(bytes).digest('hex');
 const stored={id:'file-test',name:file.name,size:12,sha256,state:'uploading',parts:[],receivedBytes:0};
 let posts=0,completed=false;const progress=[];
 const client=new DirectUploadClient({endpoint:'https://upload.example',token:()=> 'example',wait:async()=>{},fetch:async(url,options={})=>{
  let data;
  if(url.endsWith('/files')&&options.method==='POST')data={file:stored,chunkSize:8};
  else if(url.endsWith('/complete')){completed=true;stored.state='complete';data={file:stored};}
  else data={file:stored,chunkSize:8};
  return new Response(JSON.stringify(data),{status:200});
 },sendPart:async({number,sha256,body,onProgress})=>{
  posts++;onProgress(body.size);
  const part={number,sha256,size:body.size};stored.parts.push(part);stored.receivedBytes+=body.size;
  if(number===1)throw Object.assign(new Error('response lost'),{code:'network',status:0,retryable:true});
  return part;
 }});
 const result=await client.uploadFile('upload-20261110123456-1234abcd',file,{sha256,onProgress:p=>progress.push({...p,serverComplete:completed})});
 assert.equal(posts,2,'already received first part must not be sent again');
 assert.equal(result.state,'complete');assert.equal(result.receivedBytes,12);
 assert(progress.some(p=>p.state==='uploading'&&p.sent>0));
 assert(progress.filter(p=>p.state==='complete').every(p=>p.serverComplete));
});

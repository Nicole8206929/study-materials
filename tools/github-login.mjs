const prefix='nicole-github-attempt-v1:',valid=/^[A-Za-z0-9_-]{43}$/;
const encode=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const random=()=>encode(crypto.getRandomValues(new Uint8Array(32)));
const challenge=async verifier=>encode(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
export function initializeGithubLogin({client,entryUrl=location.href,onSession,notify,onContinue=()=>{}}){
 let starting=false;
 function read(proof){try{return JSON.parse(localStorage.getItem(prefix+proof)||'null');}catch{return null;}}
 async function start({setupKey,usePopup=false}={}){
  if(starting)return;starting=true;
  const popup=usePopup?window.open('about:blank','nicole-github-login'):null;
  try{
   onContinue(null);notify('正在连接 GitHub，请稍候…');
   const verifier=random(),proof=await challenge(verifier),attempt={verifier,clientToken:random(),expires:Date.now()+600000};
   try{
    for(const key of Object.keys(localStorage))if(key.startsWith(prefix)&&(!read(key.slice(prefix.length))||read(key.slice(prefix.length)).expires<Date.now()))localStorage.removeItem(key);
    localStorage.setItem(prefix+proof,JSON.stringify(attempt));
   }catch{throw new Error('浏览器未允许保存登录状态，请允许本网站存储数据后重试。');}
   const result=await client.request('/auth/github/'+(setupKey?'bootstrap':'start'),{method:'POST',anonymous:true,body:{challenge:proof,...(setupKey?{key:setupKey}:{})}});
   const target=new URL(result.url);
   if(target.origin!==new URL(client.endpoint).origin||!/^\/auth\/github\/(authorize|setup)$/.test(target.pathname))throw new Error('GitHub 登录地址不正确，已停止跳转。');
   onContinue(target.href);
   if(popup&&!popup.closed){popup.location.replace(target.href);notify('请在 GitHub 页面确认登录，完成后会自动启用本页上传。');}
   else location.assign(target.href);
  }catch(error){popup?.close();notify(error.message);}finally{starting=false;}
 }
 async function complete(grant,proof){
  const attempt=valid.test(proof||'')?read(proof):null;
  if(!valid.test(grant||'')||!attempt||attempt.expires<Date.now()||!valid.test(attempt.verifier)||!valid.test(attempt.clientToken))throw new Error('登录回执已失效。请在这个浏览器中重新点击 GitHub 登录。');
  const session=await client.request('/auth/github/complete',{method:'POST',anonymous:true,body:{grant,verifier:attempt.verifier,clientToken:attempt.clientToken}});
  if(session.token!==attempt.clientToken||session.scope!=='owner'||!Number.isFinite(session.expires))throw new Error('GitHub 登录回执不完整，请重试。');
  onSession(session);localStorage.removeItem(prefix+proof);
  if(window.name==='nicole-github-login'&&window.opener){try{window.opener.postMessage({type:'nicole-github-login'},location.origin);window.close();}catch{}}
 }
 const fragment=new URLSearchParams(new URL(entryUrl).hash.slice(1));
 let completion=Promise.resolve();
 if(fragment.has('github')||fragment.has('githubSetup')){
  history.replaceState(null,'',location.pathname+location.search);
  completion=(fragment.has('githubSetup')?start({setupKey:fragment.get('githubSetup')}):complete(fragment.get('github'),fragment.get('challenge'))).catch(error=>notify(error.message));
 }
 return {start,completion};
}

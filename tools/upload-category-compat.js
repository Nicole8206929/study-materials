"use strict";
(() => {
  const url=new URL(location.href),cat=url.searchParams.get('cat'),subcat=url.searchParams.get('subcat');let changed=false;
  if(cat==='statistics'){url.searchParams.set('cat','university-math');url.searchParams.set('subcat','probability-statistics');changed=true;}
  if(subcat==='differential-geometry'){url.searchParams.set('subcat','geometry-topology');changed=true;}
  if(changed)history.replaceState(null,'',url);
})();

(() => {
  const subcat=new URL(location.href).searchParams.get('subcat');
  if(!['analysis','algebra','geometry-topology','probability-statistics','applied-math'].includes(subcat))return;
  document.addEventListener('DOMContentLoaded',()=>{
    const target=document.getElementById('uploadSubcategories');if(!target)return;
    const apply=()=>{
      const input=[...target.querySelectorAll('input')].find(x=>x.value===subcat);if(!input)return false;
      input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));return true;
    };
    if(apply())return;
    const observer=new MutationObserver(()=>{if(apply())observer.disconnect();});
    observer.observe(target,{childList:true,subtree:true});setTimeout(()=>observer.disconnect(),20000);
  },{once:true});
})();

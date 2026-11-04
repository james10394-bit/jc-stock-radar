(function(){
  'use strict';
  let snapshot=null,polling=false;
  const $=id=>document.getElementById(id),esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=x=>Number.isFinite(x)?new Intl.NumberFormat('zh-TW',{maximumFractionDigits:2}).format(x):'—';
  const app=()=>window.JCApp;
  function selectedQuote(){
    const code=app()?.getSelected(),q=snapshot?.quotes?.[code],age=q?Date.now()-Date.parse(q.timestamp):Infinity;
    if(q&&snapshot.phase==='trading'&&age>=0&&age<=120000)return {...q,live:true};
    const m=app()?.getMarket(),h=m?.price_history?.[code]||[],r=h.at(-1);
    return {price:r?.close,date:r?.date,live:false};
  }
  function status(){
    const node=$('liveStatus');if(!node)return;
    if(!snapshot){node.textContent='尚未取得盤中快照。可於09:00前執行 Start-Live.bat 開啟本機持續報價。';return;}
    const count=Object.keys(snapshot.quotes||{}).length,mode=snapshot.mode==='local_live'?'本機持續抓取':'GitHub定時快照（非逐筆即時）';
    node.textContent=mode+'｜'+(snapshot.phase==='trading'?'交易時段':'非交易時段／等待開盤')+'｜快照 '+(snapshot.generated_at||'尚無')+'｜已取得 '+count+' 檔';
    const code=app()?.getSelected(),q=snapshot.quotes?.[code],quote=$('liveSelected');
    if(quote){quote.textContent=q?code+' '+q.name+'：'+fmt(q.price)+' 元｜成交時間 '+q.timestamp+'｜累計 '+fmt(q.volume/1000)+' 張':'尚無所選股票的當日成交報價';}
  }
  function renderScanner(){
    const m=app()?.getMarket();if(!m)return;
    const result=JCRisk.scan(m,snapshot);
    $('scanSummary').textContent=result.reason+'｜已檢查 '+result.examined+' 檔';
    $('openingPicks').innerHTML=result.candidates.length?result.candidates.map((r,i)=>'<article class="pick-card"><small>候選 '+(i+1)+' · '+esc(r.industry)+'</small><h3><button type="button" data-pick="'+esc(r.code)+'">'+esc(r.code+' '+r.name)+'</button></h3><strong>'+fmt(r.quote.price)+' 元</strong><p>開盤觀測量 '+fmt(r.openingVolume/1000)+' 張 · 占前20日平均日量 '+fmt(r.openingFraction*100)+'%</p><p>觀測時間 '+esc(r.quote.opening_observed_at)+'</p><p>結構停損 '+fmt(r.risk.stop)+' · 前高參考 '+fmt(r.risk.target)+' · 報酬／風險 '+fmt(r.risk.rr)+' 倍</p><p>僅在報價新鮮、價格未跌回開盤區間低點且風險檢核持續通過時觀察。名單會隨成交資料改變。</p></article>').join(''):'<div class="scan-empty">09:00開始觀察，約09:05取得開盤觀測後才篩選。資料不足、量大但下跌、EPS虧損、追價過熱或報酬／風險不足時不補排名。</div>';
    const sectorRows={};for(const [code,q]of Object.entries(snapshot?.quotes||{})){
      if(!(q.price>0&&q.previous_close>0))continue;
      const age=Date.now()-Date.parse(q.timestamp||'');
      if(snapshot.phase!=='trading'||!(age>=0&&age<=120000))continue;
      const industry=m.company_profiles?.[code]?.industry;if(!industry)continue;
      const group=sectorRows[industry]||={n:0,change:0,amount:0};group.n++;group.change+=(q.price/q.previous_close-1)*100;group.amount+=q.volume*q.price;
    }
    const ranking=Object.entries(sectorRows).sort((a,b)=>b[1].amount-a[1].amount).slice(0,6);
    $('openingSectors').innerHTML=ranking.map(([name,v])=>'<span>'+esc(name)+'：累計成交金額估計 '+fmt(v.amount/1e8)+' 億｜有效樣本 '+v.n+' 檔｜平均 '+fmt(v.change/v.n)+'%</span>').join('');
  }
  function positionKey(){return 'jc-position-v1-'+app()?.getSelected();}
  function record(){try{return JSON.parse(localStorage.getItem(positionKey())||'null');}catch(_){return null;}}
  function renderPosition(fill=false){
    const code=app()?.getSelected();if(!code)return;
    $('positionCode').textContent=code;
    const saved=record(),q=selectedQuote(),v=JCRisk.position(saved,q);
    if(fill){$('positionCost').value=saved?.cost||'';$('positionShares').value=saved?.shares||'';$('positionStop').value=saved?.stop||'';}
    $('positionResult').textContent=v&&v.price?'成本 '+fmt(v.cost)+' 元｜'+fmt(v.shares)+' 股｜損益 '+fmt(v.pnl)+' 元（'+fmt(v.pnlPct)+'%）｜固定停損 '+fmt(v.stop)+' 元｜'+v.status+'｜'+(q.live?'盤中成交':'盤後資料 '+(q.date||'待更新')):'輸入實際成本、股數與固定停損，才會計算持倉風險；資料僅保存在本機瀏覽器。';
    $('positionResult').className=v?.breached?'position-result breached':'position-result';
  }
  function renderRisk(v){
    if(!v)return;
    const node=$('riskGuard');
    node.className='risk-guard '+(v.eligible?'guard-pass':'guard-stop');
    node.innerHTML='<h3>'+(v.eligible?'通過保守型新買進檢核，仍需盤中確認':'暫不列入新買進')+'</h3><p>統一檢查資料完整性、獲利、位置、停損距離及報酬／風險；以下多空分數不是上漲機率。</p><ul>'+v.blocks.concat(v.notes).map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>'+(v.stop&&v.price?'<p>依目前結構估算：停損距離 '+fmt(v.riskPct)+'%｜至前高報酬／風險 '+fmt(v.rr)+' 倍。實際持倉停損以你儲存的紀錄為準。</p>':'');
  }
  async function poll(){
    if(polling)return;polling=true;
    const local=['127.0.0.1','localhost'].includes(location.hostname),url=local?'/api/intraday':'data/intraday.json';
    try{const response=await fetch(url+'?t='+Date.now(),{cache:'no-store'});if(!response.ok)throw Error('尚無快照');snapshot=await response.json();}
    catch(_){snapshot=null;}
    finally{polling=false;status();renderScanner();renderPosition();}
  }
  window.JCView={onRender(v){renderRisk(v);status();renderScanner();renderPosition(true);},getSnapshot:()=>snapshot,getSelectedQuote:selectedQuote};
  document.addEventListener('DOMContentLoaded',()=>{
    $('liveRefresh').addEventListener('click',poll);
    $('openingPicks').addEventListener('click',e=>{const b=e.target.closest('[data-pick]');if(b)app()?.select(b.dataset.pick);});
    $('positionSave').addEventListener('click',()=>{
      const code=app()?.getSelected(),cost=JCRisk.num($('positionCost').value),shares=JCRisk.num($('positionShares').value),stop=JCRisk.num($('positionStop').value),old=record();
      if(!code||!(cost>0&&shares>0&&Number.isInteger(shares)&&stop>0&&stop<cost)){alert('請輸入正確的成本、整數股數與低於成本的停損價。');return;}
      if(old&&stop<old.stop){alert('已儲存的停損不可往下移。若已出清並重新進場，請先清除舊紀錄。');return;}
      localStorage.setItem(positionKey(),JSON.stringify({cost,shares,stop,created_at:old?.created_at||new Date().toISOString(),updated_at:new Date().toISOString()}));renderPosition();
    });
    $('positionClear').addEventListener('click',()=>{if(confirm('清除此股票的本機持倉紀錄？')){localStorage.removeItem(positionKey());renderPosition(true);}});
    poll();setInterval(()=>{status();renderScanner();renderPosition();},15000);setInterval(poll,30000);
  });
})();

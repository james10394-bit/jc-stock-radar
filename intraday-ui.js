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
    const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'}),age=Date.now()-Date.parse(snapshot.generated_at||'');
    const health=!snapshot.generated_at?'尚無成功行情':snapshot.date!==today?'舊日期資料，今日尚未同步':age>120000?'快照已過期，非目前行情':'最近快照可用';
    node.textContent=mode+'｜'+health+'｜資料日 '+(snapshot.date||'未知')+'｜行情取得 '+(snapshot.generated_at||'尚無')+'｜有效成交價 '+count+' 檔｜有效累計量 '+Object.keys(snapshot.volume_quotes||{}).length+' 檔';
    const code=app()?.getSelected(),q=snapshot.quotes?.[code],quote=$('liveSelected');
    if(quote){quote.textContent=q?code+' '+q.name+'：'+fmt(q.price)+' 元｜原資料時間 '+q.timestamp+'｜累計 '+fmt(q.volume/1000)+' 張':'本快照沒有所選股票的有效成交價；不以委託價格或其他股票代替';}
  }
  function renderScanner(){
    const m=app()?.getMarket();if(!m)return;
    const result=JCRisk.scan(m,snapshot);
    const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'});
    if(!snapshot?.generated_at)result.reason='尚未取得有效盤中快照，未開始篩選';
    else if(snapshot.date!==today)result.reason='目前是 '+snapshot.date+' 的舊快照，今天未取得可篩選資料';
    else if(Date.now()-Date.parse(snapshot.generated_at)>120000)result.reason='快照已過期，停止目前買進篩選；下方保留有日期的量能觀測';
    else if(snapshot.phase==='trading'&&!Object.values(snapshot.quotes||{}).some(q=>q.opening_complete))result.reason='尚無09:05附近開盤觀測，開盤候選尚未篩選；可查看量能觀察榜與外資排行';
    $('scanSummary').textContent=result.reason+'｜已檢查 '+result.examined+' 檔';
    const excluded=Object.entries(result.exclusions||{}).sort((a,b)=>b[1]-a[1]).slice(0,6);
    $('scanDiagnostics').textContent=excluded.length?'排除原因（一檔可能同時有多個原因）：'+excluded.map(([why,n])=>why+' '+n+'檔').join('；'):'尚無可用的逐股檢核紀錄；未開始篩選與篩選後未通過是不同狀態。';
    const board=JCSignals.volumeBoard(m,snapshot);
    $('volumeBoardTitle').textContent=board.title;
    $('volumeBoardStatus').textContent='資料日 '+(board.date||'尚無')+'｜有效量能 '+board.total+'檔｜保存開盤觀測 '+board.openingCount+'檔。'+board.warning;
    $('volumeBoard').innerHTML=board.rows.length?board.rows.map((q,i)=>'<tr><td>'+(i+1)+'</td><td><button type="button" data-volume-code="'+esc(q.code)+'">'+esc(q.code+' '+q.name)+'</button></td><td>'+fmt(q.volume/1000)+' 張</td><td>'+(q.price===null?'成交價未回傳':fmt(q.price)+' 元')+'</td><td>'+esc(q.timestamp||q.date)+'</td></tr>').join(''):'<tr><td colspan="5">今日盤中與歷史日量均不足；請檢查資料更新，不補造股票名單。</td></tr>';
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
  function renderSignals(){
    if(!$('signalCoverage'))return;
    const c=snapshot?.coverage||{},now=new Date(),today=now.toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'});
    $('signalCoverage').textContent=snapshot?.generated_at?'快照 '+snapshot.generated_at+'｜查詢 '+(c.requested??'—')+' 檔｜有效成交報價 '+Object.keys(snapshot.quotes||{}).length+' 檔｜五檔委託 '+Object.keys(snapshot.order_books||{}).length+' 檔｜依已取得資料顯示，非全市場完整排行':'尚未取得盤中資料；外資盤後排行可獨立查看。';
    const rows=JCSignals.nearLimit(snapshot,now);
    $('nearLimitSignals').innerHTML=rows.length?rows.map(q=>'<article class="signal-card"><button type="button" data-signal-code="'+esc(q.code)+'">'+esc(q.code+' '+q.name)+'</button><p><strong>'+fmt(q.price)+' 元（+'+fmt(q.change)+'%）</strong>｜漲停價 '+fmt(q.upper)+'｜距離 '+fmt(q.gap)+'%</p><p>'+(q.accelerating?'相鄰'+fmt(snapshot.quotes[q.code].interval_seconds)+'秒增加 '+fmt(q.intervalVolume/1000)+' 張、價格上升至少0.5%':'缺少相鄰成交觀測或未達短時放量條件')+'</p><p>買方五檔占比 '+(q.buyShare===null?'尚無資料':fmt(q.buyShare*100)+'%')+'；委託可撤單</p><small>成交 '+esc(q.timestamp)+'｜追價風險提示，非買進名單</small></article>').join(''):'<div class="signal-empty">目前有效、新鮮成交報價中沒有符合者，或資料不足／報價已過期。這不代表全市場沒有強勢股。</div>';
    const early=snapshot?.date===today?Object.values(snapshot.early_order_alerts||{}).filter(q=>q.date===today&&q.investor_identity==='unknown'&&q.bid_shares>=500000&&q.buy_share>=.8).sort((a,b)=>b.bid_shares-a.bid_shares).slice(0,20):[];
    $('earlyBookSignals').innerHTML=early.length?early.map(q=>'<article class="signal-card"><button type="button" data-signal-code="'+esc(q.code)+'">'+esc(q.code+' '+q.name)+'</button><p>買方五檔合計 '+fmt(q.bid_shares/1000)+' 張｜占比 '+fmt(q.buy_share*100)+'%</p><small>歷史觀測 '+esc(q.timestamp)+'｜非目前掛單、非外資辨識、非成交買進</small></article>').join(''):'<div class="signal-empty">尚無今天09:05前符合條件的實際觀測紀錄；晚啟動不會補造紀錄。</div>';
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
    finally{polling=false;status();renderScanner();renderSignals();renderPosition();}
  }
  window.JCView={onRender(v){renderRisk(v);status();renderScanner();renderSignals();renderPosition(true);},getSnapshot:()=>snapshot,getSelectedQuote:selectedQuote};
  document.addEventListener('DOMContentLoaded',()=>{
    $('liveRefresh').addEventListener('click',poll);
    $('openingPicks').addEventListener('click',e=>{const b=e.target.closest('[data-pick]');if(b)app()?.select(b.dataset.pick);});
    $('volumeBoard').addEventListener('click',e=>{const b=e.target.closest('[data-volume-code]');if(b)app()?.select(b.dataset.volumeCode);});
    for(const id of ['nearLimitSignals','earlyBookSignals'])$(id).addEventListener('click',e=>{const b=e.target.closest('[data-signal-code]');if(b)app()?.select(b.dataset.signalCode);});
    $('positionSave').addEventListener('click',()=>{
      const code=app()?.getSelected(),cost=JCRisk.num($('positionCost').value),shares=JCRisk.num($('positionShares').value),stop=JCRisk.num($('positionStop').value),old=record();
      if(!code||!(cost>0&&shares>0&&Number.isInteger(shares)&&stop>0&&stop<cost)){alert('請輸入正確的成本、整數股數與低於成本的停損價。');return;}
      if(old&&stop<old.stop){alert('已儲存的停損不可往下移。若已出清並重新進場，請先清除舊紀錄。');return;}
      localStorage.setItem(positionKey(),JSON.stringify({cost,shares,stop,created_at:old?.created_at||new Date().toISOString(),updated_at:new Date().toISOString()}));renderPosition();
    });
    $('positionClear').addEventListener('click',()=>{if(confirm('清除此股票的本機持倉紀錄？')){localStorage.removeItem(positionKey());renderPosition(true);}});
    poll();setInterval(()=>{status();renderScanner();renderSignals();renderPosition();},15000);setInterval(poll,30000);
  });
})();


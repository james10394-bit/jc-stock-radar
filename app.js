/* TWSE Flow v2.0.0 — rules-based research dashboard using dated TWSE snapshots. */
const $ = id => document.getElementById(id);
let market = null, selected = '2615', rankSide = 'buy';
const fmt = (n,digits=2) => Number.isFinite(n) ? new Intl.NumberFormat('zh-TW',{maximumFractionDigits:digits}).format(n) : '—';
const lots = n => Number.isFinite(n) ? (n>=0?'+':'')+fmt(n/1000)+' 張' : '—';
const color = n => Number.isFinite(n) ? (n>=0?'pos':'neg') : '';
const escape = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const days = () => Object.keys(market.days||{}).sort();
const current = () => market.days?.[market.latest_session]||{};
const flows = code => days().map(date=>({date:date,...market.days[date][code]})).filter(x=>x.foreign);
const prices = code => (market.price_history?.[code]||[]).filter(x=>['open','high','low','close'].every(k=>Number.isFinite(x[k])));
const last = a => a[a.length-1];
const sumNet = (a,key='foreign') => a.reduce((s,x)=>s+(Number(x[key]?.net)||0),0);
const sma = (a,n) => a.length>=n?a.slice(-n).reduce((s,x)=>s+x,0)/n:null;
function std(a,n){if(a.length<n)return null;const v=a.slice(-n),m=sma(v,n);return Math.sqrt(v.reduce((s,x)=>s+(x-m)**2,0)/n);}
function tick(n){if(!Number.isFinite(n))return null;const t=n<10?.01:n<50?.05:n<100?.1:n<500?.5:n<1000?1:5;return Math.round(n/t)*t;}
function setValue(id,text,n){const el=$(id);el.textContent=text;el.classList.remove('pos','neg');if(Number.isFinite(n))el.classList.add(color(n));}

function indicators(rows){
  if(rows.length<20)return null;
  const closes=rows.map(x=>x.close),ma5=sma(closes,5),ma10=sma(closes,10),ma20=sma(closes,20),sd=std(closes,20);
  let k=50,d=50;
  rows.forEach((row,i)=>{
    const window=rows.slice(Math.max(0,i-8),i+1);
    const hi=Math.max(...window.map(x=>x.high)),lo=Math.min(...window.map(x=>x.low));
    const rsv=hi===lo?50:(row.close-lo)/(hi-lo)*100;
    k=k*2/3+rsv/3; d=d*2/3+k/3;
  });
  return {ma5,ma10,ma20,upper:ma20+2*sd,middle:ma20,lower:ma20-2*sd,k,d};
}

function analyze(rows,flowRows){
  const ind=indicators(rows); if(!ind)return null;
  const quote=last(rows),prior=rows.slice(-21,-1);
  const rawSupport=Math.min(...prior.map(x=>x.low)),rawResistance=Math.max(...prior.map(x=>x.high));
  const below=[rawSupport,ind.lower,ind.ma20].filter(x=>Number.isFinite(x)&&x<=quote.close);
  const above=[rawResistance,ind.upper].filter(x=>Number.isFinite(x)&&x>=quote.close);
  const support=below.length?Math.max(...below):Math.min(rawSupport,ind.lower);
  const resistance=above.length?Math.min(...above):Math.max(rawResistance,ind.upper);
  const buyLow=tick(Math.min(support,ind.lower)),buyHigh=tick(Math.min(quote.close,Math.max(support,ind.lower)*1.018));
  const sellLow=tick(resistance*.985),sellHigh=tick(resistance*1.012),stop=tick(rawSupport*.97);
  const flow5=sumNet(flowRows.slice(-5)),flow20=sumNet(flowRows.slice(-20));
  let score=0; const reasons=[];
  if(quote.close>ind.ma20){score++;reasons.push('收盤站上20日均線');}else{score--;reasons.push('收盤仍在20日均線下');}
  if(ind.k>ind.d){score++;reasons.push('KD偏多，K值在D值上方');}else{score--;reasons.push('KD偏弱，K值在D值下方');}
  if(flow5>0){score++;reasons.push('外資近5日累計買超');}else if(flow5<0){score--;reasons.push('外資近5日累計賣超');}
  if(quote.close>ind.upper){score--;reasons.push('股價高於布林上軌，追價風險升高');}
  if(ind.k>80)reasons.push('KD進入80以上高檔區');
  if(ind.k<20)reasons.push('KD進入20以下低檔區');
  return {ind,quote,rawSupport,rawResistance,buyLow,buyHigh,sellLow,sellHigh,stop,flow5,flow20,score,reasons};
}

function renderWatchlist(){
  const codes=market.watchlist||Object.keys(market.price_history||{});
  $('watchlist').innerHTML=codes.map(code=>'<button data-watch="'+escape(code)+'" class="'+(code===selected?'active':'')+'">'+escape(code)+' <span>'+escape(current()[code]?.name||'')+'</span></button>').join('');
}

function flowChart(entries){
  if(entries.length<2){$('flowChart').textContent='法人歷史尚不足；每日更新後會自動累積。';return;}
  const w=560,h=230,p=34,values=entries.map(x=>x.foreign.net/1000),max=Math.max(1,...values.map(Math.abs)),zero=h/2,bw=Math.max(3,(w-2*p)/entries.length*.62);
  let html='<svg viewBox="0 0 '+w+' '+h+'" role="img" aria-label="外資逐日買賣超長條圖"><line x1="'+p+'" x2="'+(w-p)+'" y1="'+zero+'" y2="'+zero+'" stroke="#68809a"/>';
  values.forEach((v,i)=>{const x=p+i*(w-2*p)/values.length+4,y=zero-(v/max)*(h/2-p);html+='<rect x="'+x+'" y="'+Math.min(y,zero)+'" width="'+bw+'" height="'+Math.max(Math.abs(zero-y),1)+'" rx="2" fill="'+(v>=0?'#ff6f7d':'#37d4aa')+'"><title>'+entries[i].date+'：'+fmt(v)+' 張</title></rect>';});
  html+='<text x="'+p+'" y="'+(h-3)+'" fill="#91a7bd" font-size="11">'+entries[0].date.slice(5)+'</text><text x="'+(w-p)+'" text-anchor="end" y="'+(h-3)+'" fill="#91a7bd" font-size="11">'+last(entries).date.slice(5)+'</text></svg>';
  $('flowChart').innerHTML=html;
}

function technicalChart(rows,a){
  if(!a){$('techChart').textContent='此股票尚未加入自選資料，或歷史股價不足20個交易日。';return;}
  const q=rows.slice(-60),w=680,h=290,p=42,closes=q.map(x=>x.close);
  const bands=q.map((row,i)=>{const slice=rows.slice(0,rows.length-q.length+i+1),vals=slice.map(x=>x.close);if(vals.length<20)return null;const m=sma(vals,20),s=std(vals,20);return {m,u:m+2*s,l:m-2*s};});
  const all=[...q.flatMap(x=>[x.high,x.low]),...bands.filter(Boolean).flatMap(x=>[x.u,x.l]),a.rawSupport,a.rawResistance];
  const min=Math.min(...all),max=Math.max(...all),span=Math.max(1,max-min),x=i=>p+i*(w-2*p)/Math.max(1,q.length-1),y=v=>h-p-(v-min)/span*(h-2*p);
  const line=(values,stroke,dash='')=>'<polyline fill="none" stroke="'+stroke+'" stroke-width="2" '+(dash?'stroke-dasharray="'+dash+'"':'')+' points="'+values.map((v,i)=>v===null?'':x(i)+','+y(v)).join(' ')+'"/>';
  let svg='<svg viewBox="0 0 '+w+' '+h+'" role="img" aria-label="收盤價、布林通道與支撐壓力圖">';
  svg+=line(bands.map(v=>v?.u??null),'#9b7bea','5 4')+line(bands.map(v=>v?.m??null),'#e4b957','4 4')+line(bands.map(v=>v?.l??null),'#9b7bea','5 4');
  [[a.rawResistance,'#ff6f7d','壓力'],[a.rawSupport,'#37d4aa','支撐']].forEach(([v,c,name])=>{svg+='<line x1="'+p+'" x2="'+(w-p)+'" y1="'+y(v)+'" y2="'+y(v)+'" stroke="'+c+'" stroke-dasharray="7 5"/><text x="'+(w-p)+'" y="'+(y(v)-5)+'" text-anchor="end" fill="'+c+'" font-size="11">'+name+' '+fmt(v)+'</text>';});
  svg+=line(closes,'#7bd7f0')+'<circle cx="'+x(q.length-1)+'" cy="'+y(last(q).close)+'" r="4" fill="#fff"/><text x="'+p+'" y="'+(h-5)+'" fill="#91a7bd" font-size="11">'+q[0].date.slice(5)+'</text><text x="'+(w-p)+'" text-anchor="end" y="'+(h-5)+'" fill="#91a7bd" font-size="11">'+last(q).date.slice(5)+'</text></svg>';
  $('techChart').innerHTML=svg;
}

function renderPlan(a){
  if(!a){$('tradePlan').className='signal neutral';$('tradePlan').innerHTML='<strong>技術資料尚未完整</strong><p>將股票代號加入 data/watchlist.json，再執行更新取得至少20個交易日。</p>';['buyZone','stopPrice','sellZone'].forEach(id=>$(id).textContent='—');return;}
  const state=a.score>=2?['偏多觀察','bull']:a.score<=-2?['偏弱保守','bear']:['區間等待','neutral'];
  $('tradePlan').className='signal '+state[1];
  $('tradePlan').innerHTML='<div><small>規則式綜合判斷</small><strong>'+state[0]+'</strong></div><ul>'+a.reasons.map(x=>'<li>'+escape(x)+'</li>').join('')+'</ul>';
  $('buyZone').textContent=fmt(a.buyLow)+'～'+fmt(a.buyHigh)+' 元';
  $('stopPrice').textContent=fmt(a.stop)+' 元';
  $('sellZone').textContent=fmt(a.sellLow)+'～'+fmt(a.sellHigh)+' 元';
  $('levelNote').textContent='以前20日高低點、20日均線與布林通道交集估算；最新收盤 '+fmt(a.quote.close)+' 元。';
}

function rank(){
  const rows=Object.entries(current()).filter(([,s])=>Number.isFinite(s.foreign?.net)).sort((a,b)=>rankSide==='buy'?b[1].foreign.net-a[1].foreign.net:a[1].foreign.net-b[1].foreign.net).slice(0,10);
  $('ranking').innerHTML=rows.map(([code,s],i)=>'<tr data-code="'+escape(code)+'"><td>'+(i+1)+'</td><td>'+escape(code)+' '+escape(s.name)+'</td><td class="'+color(s.foreign.net)+'">'+lots(s.foreign.net)+'</td><td>'+(Number.isFinite(s.quote?.close)?fmt(s.quote.close)+' 元':'—')+'</td></tr>').join('');
}

function render(){
  if(!market)return; const stock=current()[selected];
  if(!stock){$('content').hidden=true;$('status').textContent='找不到這個上市股票代號。';return;}
  $('status').textContent='';$('content').hidden=false;$('title').textContent=selected+' · '+stock.name;$('dateBadge').textContent='法人資料：'+market.latest_session;
  const f=stock.foreign,period=Number($('period').value),allFlows=flows(selected),periodRows=allFlows.slice(-period);
  setValue('foreignToday',lots(f.net),f.net);$('foreignSub').textContent='買進 '+lots(f.buy).replace('+','')+' ｜ 賣出 '+lots(f.sell).replace('+','');
  setValue('foreignPeriod',lots(sumNet(periodRows)),sumNet(periodRows));setValue('trustPeriod',lots(sumNet(periodRows,'trust')),sumNet(periodRows,'trust'));setValue('dealerPeriod',lots(sumNet(periodRows,'dealer')),sumNet(periodRows,'dealer'));
  let streak=0;for(const row of [...allFlows].reverse()){if(!row.foreign.net||Math.sign(row.foreign.net)!==Math.sign(f.net))break;streak++;}
  $('foreignStreak').textContent=periodRows.length+'個交易日 · '+(streak?'連續'+streak+'日'+(f.net>0?'買超':'賣超'):'無連續訊號');
  const priceRows=prices(selected),a=analyze(priceRows,allFlows),price=last(priceRows)?.close??stock.quote?.close,pe=stock.pe;
  $('closePe').textContent=Number.isFinite(price)?fmt(price)+' 元 · '+(Number.isFinite(pe)&&pe>0?fmt(pe)+' 倍':'本益比無資料'):'股價尚無資料';
  $('details').innerHTML=[['外資及陸資',f],['投信',stock.trust],['自營商',stock.dealer]].map(([name,x])=>'<tr><td>'+name+'</td><td>'+lots(x.buy).replace('+','')+'</td><td>'+lots(x.sell).replace('+','')+'</td><td class="'+color(x.net)+'">'+lots(x.net)+'</td></tr>').join('');
  const total=f.buy+f.sell,ratio=Number.isFinite(total)&&total>0?f.buy/total:null;$('gaugeFill').style.width=ratio===null?'0%':(ratio*100).toFixed(1)+'%';$('gaugeText').innerHTML=ratio===null?'買賣分項不足':'<span>買進 '+fmt(ratio*100)+'%</span><span>賣出 '+fmt((1-ratio)*100)+'%</span>';
  $('kd').textContent=a?'K '+fmt(a.ind.k,1)+' / D '+fmt(a.ind.d,1):'—';$('boll').textContent=a?fmt(a.ind.lower)+' / '+fmt(a.ind.middle)+' / '+fmt(a.ind.upper):'—';$('ma').textContent=a?'MA5 '+fmt(a.ind.ma5)+' · MA10 '+fmt(a.ind.ma10)+' · MA20 '+fmt(a.ind.ma20):'—';
  flowChart(periodRows);technicalChart(priceRows,a);renderPlan(a);renderWatchlist();rank();
}

async function load(){
  $('status').textContent='正在載入證交所盤後資料…';
  try{const response=await fetch('data/market.json?cache='+Date.now(),{cache:'no-store'});if(!response.ok)throw new Error('HTTP '+response.status);market=await response.json();if(!market.latest_session||!current())throw new Error('尚未取得交易日資料。');$('stamp').textContent='最近交易日 '+market.latest_session+' · v'+(market.version||'2.0.0');if(!current()[selected])selected=(market.watchlist||[]).find(x=>current()[x])||Object.keys(current())[0];render();}
  catch(e){$('stamp').textContent='尚未取得資料';$('content').hidden=true;$('status').textContent=e.message+' 請先到 GitHub Actions 執行更新資料。';}
}

$('search').addEventListener('change',e=>{const term=e.target.value.trim(),list=Object.entries(current());const hit=list.find(([code])=>code===term)||list.find(([code,s])=>code.includes(term)||s.name.includes(term));if(hit){selected=hit[0];e.target.value='';render();}else if(term)$('status').textContent='沒有找到這個上市股票。';});
$('search').addEventListener('keydown',e=>{if(e.key==='Enter')e.target.blur();});$('period').addEventListener('change',render);$('refresh').addEventListener('click',load);
$('watchlist').addEventListener('click',e=>{const b=e.target.closest('[data-watch]');if(b&&current()[b.dataset.watch]){selected=b.dataset.watch;render();}});
document.querySelectorAll('[data-rank]').forEach(b=>b.addEventListener('click',()=>{rankSide=b.dataset.rank;document.querySelectorAll('[data-rank]').forEach(x=>x.classList.toggle('active',x===b));rank();}));
$('ranking').addEventListener('click',e=>{const row=e.target.closest('[data-code]');if(row){selected=row.dataset.code;render();scrollTo({top:0,behavior:'smooth'});}});
load();

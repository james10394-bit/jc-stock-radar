/* TWSE + TPEx Flow v2.4.7 — full adaptive stock-name display. */
const $ = id => document.getElementById(id);
let market = null, selected = '2615', rankSide = 'buy', activeWatchPage = 0, institutionDate = null;
let watchPagesData = [], editingPages = [];
const WATCH_STORAGE_KEY = 'jc-stock-radar-watchlists-v1';
const fmt = (n,digits=2) => Number.isFinite(n) ? new Intl.NumberFormat('zh-TW',{maximumFractionDigits:digits}).format(n) : '—';
const lots = n => Number.isFinite(n) ? (n>=0?'+':'')+fmt(n/1000)+' 張' : '—';
const color = n => Number.isFinite(n) ? (n>=0?'pos':'neg') : '';
const escape = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const days = () => Object.keys(market.days||{}).sort();
const latestMarket = () => market?.days?.[market?.latest_session]||{};
const current = () => market?.days?.[institutionDate||market?.latest_session]||latestMarket();
const flows = code => days().map(date=>({date:date,...market.days[date][code]})).filter(x=>x.foreign);
const prices = code => (market.price_history?.[code]||[]).filter(x=>['open','high','low','close'].every(k=>Number.isFinite(x[k])));
const last = a => a[a.length-1];
const sumNet = (a,key='foreign') => a.reduce((s,x)=>s+(Number(x[key]?.net)||0),0);
const sma = (a,n) => a.length>=n?a.slice(-n).reduce((s,x)=>s+x,0)/n:null;
function std(a,n){if(a.length<n)return null;const v=a.slice(-n),m=sma(v,n);return Math.sqrt(v.reduce((s,x)=>s+(x-m)**2,0)/n);}
function tick(n){if(!Number.isFinite(n))return null;const t=n<10?.01:n<50?.05:n<100?.1:n<500?.5:n<1000?1:5;return Math.round(n/t)*t;}
function setValue(id,text,n){const el=$(id);if(!el)return;el.textContent=text;el.classList.remove('pos','neg');if(Number.isFinite(n))el.classList.add(color(n));}

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

function emaSeries(values,period){
  if(!values.length)return [];
  const alpha=2/(period+1),result=[values[0]];
  for(let i=1;i<values.length;i++)result.push(values[i]*alpha+result[i-1]*(1-alpha));
  return result;
}

function macdAnalysis(rows){
  if(rows.length<26)return null;
  const closes=rows.map(x=>x.close),ema12=emaSeries(closes,12),ema26=emaSeries(closes,26);
  const dif=closes.map((_,i)=>ema12[i]-ema26[i]),dea=emaSeries(dif,9),hist=dif.map((v,i)=>(v-dea[i])*2);
  const i=rows.length-1,j=i-1,currentDif=dif[i],currentDea=dea[i],currentHist=hist[i],priorHist=hist[j];
  let cross,crossState;
  if(dif[j]<=dea[j]&&currentDif>currentDea){cross='黃金交叉';crossState='bull';}
  else if(dif[j]>=dea[j]&&currentDif<currentDea){cross='死亡交叉';crossState='bear';}
  else if(currentDif>=currentDea){cross='DIF 位於訊號線上方';crossState='bull';}
  else{cross='DIF 位於訊號線下方';crossState='bear';}
  const expanding=Math.abs(currentHist)>Math.abs(priorHist);
  let momentum,momentumState;
  if(currentHist>=0){momentum='多方柱狀體'+(expanding?'放大':'縮小');momentumState=expanding?'bull':'neutral';}
  else{momentum='空方柱狀體'+(expanding?'放大':'縮小');momentumState=expanding?'bear':'neutral';}
  let divergence='未出現明確背離',divergenceState='neutral';
  if(rows.length>=20){
    const start=rows.length-20,mid=rows.length-10;
    const older=rows.slice(start,mid),recent=rows.slice(mid);
    const oldHigh=older.reduce((best,row,k)=>row.close>best.row.close?{row,k:start+k}:best,{row:older[0],k:start});
    const newHigh=recent.reduce((best,row,k)=>row.close>best.row.close?{row,k:mid+k}:best,{row:recent[0],k:mid});
    const oldLow=older.reduce((best,row,k)=>row.close<best.row.close?{row,k:start+k}:best,{row:older[0],k:start});
    const newLow=recent.reduce((best,row,k)=>row.close<best.row.close?{row,k:mid+k}:best,{row:recent[0],k:mid});
    if(newHigh.row.close>oldHigh.row.close&&dif[newHigh.k]<dif[oldHigh.k]){divergence='頂背離提示：價格創高、DIF 未同步創高';divergenceState='bear';}
    else if(newLow.row.close<oldLow.row.close&&dif[newLow.k]>dif[oldLow.k]){divergence='底背離提示：價格創低、DIF 未同步創低';divergenceState='bull';}
  }
  let score=(currentDif>=currentDea?12:-12)+(currentHist>=0?8:-8);
  if(expanding)score+=currentHist>=0?8:-8;
  if(cross==='黃金交叉')score+=18;if(cross==='死亡交叉')score-=18;
  if(divergenceState==='bull')score+=18;if(divergenceState==='bear')score-=18;
  return {dif,dea,hist,currentDif,currentDea,currentHist,cross,crossState,momentum,momentumState,divergence,divergenceState,score};
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
  return {ind,macd:macdAnalysis(rows),quote,rawSupport,rawResistance,buyLow,buyHigh,sellLow,sellHigh,stop,flow5,flow20,score,reasons};
}

const ratio = raw => {const buy=Math.round(Math.max(5,Math.min(95,50+raw)));return {buy,sell:100-buy};};
function adviceRatios(a){
  if(!a)return null;
  const i=a.ind,q=a.quote,band=Math.max(.01,i.upper-i.lower),position=(q.close-i.lower)/band;
  const kd=ratio((i.k-i.d)*1.2+(i.k<20?18:0)-(i.k>80?18:0));
  const macd=ratio(a.macd?.score||0);
  const boll=ratio((.5-position)*70);
  const above=[i.ma5,i.ma10,i.ma20].filter(x=>q.close>x).length;
  const ma=ratio((above-1.5)*18+(i.ma5>i.ma10&&i.ma10>i.ma20?8:i.ma5<i.ma10&&i.ma10<i.ma20?-8:0));
  const downside=Math.max(.01,q.close-a.rawSupport),upside=Math.max(.01,a.rawResistance-q.close);
  const levels=ratio((upside/(upside+downside)-.5)*70);
  const inBuy=q.close>=a.buyLow*.98&&q.close<=a.buyHigh*1.02,inSell=q.close>=a.sellLow;
  const trade=ratio(inBuy?25:inSell?-30:q.close<a.stop?-45:0);
  const globalBuy=Number(market.global_context?.buy_percent)||50;
  const technical=Math.round((kd.buy+macd.buy+boll.buy+ma.buy+levels.buy+trade.buy)/6);
  const combined=Math.round(technical*.7+globalBuy*.3);
  return {kd,macd,boll,ma,levels,trade,technical:ratio(technical-50),global:ratio(globalBuy-50),combined:ratio(combined-50)};
}
function ratioBadge(value){const bias=value.buy>=60?'bias-bull':value.buy<=40?'bias-bear':'bias-neutral';const label=value.buy>=60?'偏多':value.buy<=40?'偏空':'中性';return '<div class="ratio '+bias+'"><em>'+label+'</em><b>買 '+value.buy+'%</b><span>賣 '+value.sell+'%</span></div>';}
function renderAdvice(a){
  const r=adviceRatios(a),ids=['kdRatio','macdRatio','bollRatio','maRatio','levelRatio','tradeRatio'];
  if(!r){ids.forEach(id=>$(id).innerHTML=ratioBadge({buy:50,sell:50}));$('overallRatio').innerHTML=ratioBadge({buy:50,sell:50});return;}
  [['kdRatio',r.kd],['macdRatio',r.macd],['bollRatio',r.boll],['maRatio',r.ma],['levelRatio',r.levels],['tradeRatio',r.trade]].forEach(([id,v])=>$(id).innerHTML=ratioBadge(v));
  $('overallRatio').innerHTML=ratioBadge(r.combined);
  $('levelValue').textContent='支撐 '+fmt(a.rawSupport)+' · 壓力 '+fmt(a.rawResistance);
  $('tradeValue').textContent='買 '+fmt(a.buyLow)+'～'+fmt(a.buyHigh)+' · 停損 '+fmt(a.stop)+' · 賣 '+fmt(a.sellLow)+'～'+fmt(a.sellHigh);
}

function advisorModel(a,flowRows){
  if(!a)return null;
  let points=0;const factors=[];
  const flow5=sumNet(flowRows.slice(-5)),flow20=sumNet(flowRows.slice(-20));
  if(flow5>0&&flow20>0){points+=24;factors.push(['法人籌碼','近5日與20日外資同步買超','bull']);}
  else if(flow5<0&&flow20<0){points-=24;factors.push(['法人籌碼','近5日與20日外資同步賣超','bear']);}
  else{factors.push(['法人籌碼','短中期外資方向不一致','neutral']);}
  if(a.quote.close>a.ind.ma20&&a.ind.ma5>a.ind.ma10){points+=20;factors.push(['趨勢位置','收盤站上月線，短均線偏強','bull']);}
  else if(a.quote.close<a.ind.ma20&&a.ind.ma5<a.ind.ma10){points-=20;factors.push(['趨勢位置','收盤跌破月線，短均線偏弱','bear']);}
  else{factors.push(['趨勢位置','均線尚未形成明確排列','neutral']);}
  const inBuy=a.quote.close>=a.buyLow*.98&&a.quote.close<=a.buyHigh*1.02;
  if(inBuy&&a.ind.k>a.ind.d&&a.ind.k<80){points+=22;factors.push(['第一手買點','進入買進觀察區且KD偏多','bull']);}
  else if(a.ind.k>80||a.quote.close>=a.sellLow){points-=18;factors.push(['第一手買點','位置偏高，避免追價','bear']);}
  else{factors.push(['第一手買點','等待價位與KD訊號靠攏','neutral']);}
  if(a.quote.close>=a.sellLow){points-=18;factors.push(['八分飽原則','已接近分批賣出區，宜鎖定成果','bear']);}
  else if(a.quote.close<a.stop){points-=30;factors.push(['風險紀律','已跌破停損參考','bear']);}
  else{points+=6;factors.push(['風險紀律','尚未觸及停損或賣出區','neutral']);}
  const buy=Math.round(Math.max(5,Math.min(95,50+points/2)));
  return {buy,sell:100-buy,factors};
}
function renderAdvisor(a,flowRows){
  const view=advisorModel(a,flowRows);
  if(!view){$('advisorRatio').innerHTML=ratioBadge({buy:50,sell:50});$('advisorFactors').innerHTML='<div class="advisor-empty">歷史資料滿20個交易日後產生。</div>';return;}
  $('advisorRatio').innerHTML=ratioBadge(view);
  $('advisorFactors').innerHTML=view.factors.map(([name,text,state])=>'<div class="advisorfactor '+state+'"><span>'+escape(name)+'</span><strong>'+escape(text)+'</strong></div>').join('');
}

function industryAnalysis(code){
  const profile=market.company_profiles?.[code]||{},industry=profile.industry||'產業資料尚未建立';
  const peers=Object.entries(market.company_profiles||{}).filter(([,p])=>p.industry===industry).map(([peer])=>peer);
  const sample=peers.map(peer=>{
    const rows=prices(peer),quote=last(rows),prior=rows.at(-2),ma20=rows.length>=20?sma(rows.map(x=>x.close),20):null;
    const latest=latestMarket()[peer],change=quote&&prior&&prior.close?(quote.close/prior.close-1)*100:null;
    return {change,above:Number.isFinite(ma20)&&quote?quote.close>ma20:null,foreign:latest?.foreign?.net};
  }).filter(x=>Number.isFinite(x.change));
  const avg=sample.length?sample.reduce((s,x)=>s+x.change,0)/sample.length:null;
  const maSample=sample.filter(x=>x.above!==null),foreignSample=sample.filter(x=>Number.isFinite(x.foreign));
  const abovePct=maSample.length?maSample.filter(x=>x.above).length/maSample.length*100:null;
  const foreignPct=foreignSample.length?foreignSample.filter(x=>x.foreign>0).length/foreignSample.length*100:null;
  const raw=(Number.isFinite(avg)?avg*7:0)+(Number.isFinite(abovePct)?(abovePct-50)*.28:0)+(Number.isFinite(foreignPct)?(foreignPct-50)*.22:0);
  return {profile,industry,sample:sample.length,avg,abovePct,foreignPct,...ratio(raw)};
}
function renderIndustry(code){
  const view=industryAnalysis(code);
  $('industryName').textContent=view.industry+'產業強弱';
  $('industryBusiness').textContent=(view.profile.name||code)+'主要業務：'+(view.profile.business||'公司業務資料更新中');
  $('industryRatio').innerHTML=ratioBadge(view);
  $('industryStats').innerHTML=[
    ['同業樣本',view.sample?view.sample+' 家':'資料不足'],
    ['同業平均日漲跌',Number.isFinite(view.avg)?(view.avg>=0?'+':'')+fmt(view.avg)+'%':'—'],
    ['站上 MA20',Number.isFinite(view.abovePct)?fmt(view.abovePct,0)+'%':'—'],
    ['外資買超家數',Number.isFinite(view.foreignPct)?fmt(view.foreignPct,0)+'%':'—']
  ].map(([name,value])=>'<div><span>'+escape(name)+'</span><b>'+escape(value)+'</b></div>').join('');
  return view;
}

function renderNight(){
  const n=market.night_futures||{},lastPrice=Number(n.last),change=Number(n.change),changePct=Number(n.change_pct);
  $('nightStatus').textContent=n.session||'最近夜盤快照';
  $('nightContract').textContent=n.contract||'近月臺股期貨';
  setValue('nightPrice',Number.isFinite(lastPrice)?fmt(lastPrice,0):'—',change);
  setValue('nightChange',Number.isFinite(change)?(change>=0?'+':'')+fmt(change,0)+'（'+(changePct>=0?'+':'')+fmt(changePct)+'%）':'—',change);
  $('nightOpen').textContent=Number.isFinite(Number(n.open))?fmt(Number(n.open),0):'—';
  $('nightRange').textContent=Number.isFinite(Number(n.high))&&Number.isFinite(Number(n.low))?fmt(Number(n.high),0)+'／'+fmt(Number(n.low),0):'—';
  $('nightVolume').textContent=Number.isFinite(Number(n.volume))?fmt(Number(n.volume),0)+' 口':'—';
  $('nightUpdated').textContent=n.quote_date&&n.quote_time?'期交所行情 '+n.quote_date+' '+n.quote_time+'；排程可能延遲，不是券商逐筆即時價。':'尚未取得夜盤快照；請執行新版 GitHub Actions 更新資料。';
}

function masterModels(a,flowRows,industry){
  const latest=latestMarket()[selected]||{},pe=Number(latest.pe),flow5=sumNet(flowRows.slice(-5));
  const globalBuy=Number(market.global_context?.buy_percent)||50,night=Number(market.night_futures?.change_pct)||0;
  const q=a?.quote,i=a?.ind,inBuy=a&&q.close>=a.buyLow*.98&&q.close<=a.buyHigh*1.02;
  const models=[];
  let raw=(pe>0&&pe<=25?13:pe>40?-13:0)+(industry.buy-50)*.25+(a&&q.close<a.ind.upper?5:-5);
  models.push({name:'華倫・巴菲特',principle:'合理價格 × 企業品質',view:ratio(raw),text:(pe>0?'本益比 '+fmt(pe)+' 倍；':'本益比不足；')+'仍需核對 ROE、自由現金流與護城河。'});
  raw=(a?a.score*9:0)+(flow5>0?10:flow5<0?-10:0)+(globalBuy-50)*.2+Math.max(-12,Math.min(12,night*4));
  models.push({name:'喬治・索羅斯',principle:'趨勢驗證 × 嚴守停損',view:ratio(raw),text:a?(q.close<a.stop?'已跌破停損參考，風險優先。':'趨勢、法人與全球市場是否互相確認。'):'技術資料不足，暫採中性。'});
  raw=(industry.buy-50)*.3+(pe>0&&pe<=30?10:pe>45?-10:0)+(industry.profile.business?6:0);
  models.push({name:'彼得・林區',principle:'看懂公司 × 成長配估值',view:ratio(raw),text:(industry.profile.business||'公司業務待補')+'；仍需核對盈餘成長率與負債。'});
  raw=(globalBuy-50)*.35+(i&&i.k<30?10:i&&i.k>80?-10:0)+(a&&q.close<=a.ind.ma20?5:-3)+(night*2);
  models.push({name:'安德烈・科斯托蘭尼',principle:'資金 × 心理 × 耐心',view:ratio(raw),text:'以全球資金、夜盤與市場心理判讀，避免只因單日消息追價。'});
  raw=(industry.buy-50)*.35+(flow5>0?10:flow5<0?-10:0)+(inBuy?12:a&&q.close>=a.sellLow?-12:0);
  models.push({name:'是川銀藏',principle:'親自研究 × 產業前景',view:ratio(raw),text:(inBuy?'接近支撐觀察區；':'目前不在買進觀察區；')+'仍需查證產品供需與產業轉折。'});
  return models;
}
function renderMasters(a,flowRows,industry){
  const models=masterModels(a,flowRows,industry),buy=Math.round(models.reduce((s,x)=>s+x.view.buy,0)/models.length),overall={buy,sell:100-buy};
  $('mastersRatio').innerHTML=ratioBadge(overall);
  $('masterModels').innerHTML=models.map(x=>{const state=x.view.buy>=60?'bull':x.view.buy<=40?'bear':'neutral';return '<article class="mastercard '+state+'"><header><h4>'+escape(x.name)+'</h4><b>買 '+x.view.buy+'%</b></header><span>'+escape(x.principle)+'</span><p>'+escape(x.text)+'</p></article>';}).join('');
}

function renderGlobal(){
  const g=market.global_context||{},items=g.indicators||[],news=g.news||[];
  $('globalRatio').innerHTML=ratioBadge({buy:Number(g.buy_percent)||50,sell:Number(g.sell_percent)||50});
  $('globalStamp').textContent=g.updated_at?'約15分鐘同步 · 系統更新 '+g.updated_at.replace('T',' ').slice(0,16):'全球資料暫時無法更新';
  const stateName={REGULAR:'盤中',PRE:'盤前',POST:'盤後',CLOSED:'休市'};
  $('globalIndicators').innerHTML=items.length?items.map(x=>'<div><span>'+escape(x.name)+'<small>'+escape(stateName[x.market_state]||'狀態未知')+(x.asof?' · '+escape(x.asof.replace('T',' ').slice(5)):'')+'</small></span><strong class="'+color(x.change_pct)+'">'+(x.change_pct>=0?'+':'')+fmt(x.change_pct)+'%</strong></div>').join(''):'<p>美股指標暫時無資料，個股技術分析仍可正常使用。</p>';
  const holidays=g.holiday_factors||[];
  $('holidayFactor').innerHTML=holidays.length?holidays.map(x=>'<div><b>'+escape(x.country)+'</b><span>'+escape(x.name)+' · '+escape(x.date)+'</span><em>'+escape(x.market_closed?'市場休市':'美股照常交易')+'</em></div>').join(''):escape(g.holiday_factor?.label||'未來七日無美台假日');
  const risks=g.risk_analysis||{},riskCard=(id,data)=>{const d=data||{level:'無資料',points:0,impact:0,headlines:0};$(id).className='riskcard risk-'+(d.level==='高'?'high':d.level==='中'?'mid':'low');$(id).innerHTML='<span>風險等級</span><strong>'+escape(d.level)+'</strong><small>事件分數 '+fmt(d.points,0)+' · 買方影響 '+fmt(d.impact,0)+' 分 · '+fmt(d.headlines,0)+' 則新聞</small>';};
  riskCard('warRisk',risks.global_war);riskCard('straitRisk',risks.taiwan_strait);
  $('newsList').innerHTML=news.length?news.map(x=>'<li><span>'+escape(x.category)+'</span><a href="'+escape(x.url)+'" target="_blank" rel="noopener">'+escape(x.title)+'</a><b class="'+(x.score>0?'pos':x.score<0?'neg':'')+'">'+(x.score>0?'偏多':x.score<0?'風險':'中性')+'</b></li>').join(''):'<li>今日重大新聞暫時無法取得。</li>';
}

function normalizeWatchPages(value){
  const source=Array.isArray(value)?value:[];
  const pages=source.slice(0,10).map((page,i)=>({
    title:String(page?.title||('自選焦點 '+(i+1))).trim().slice(0,24),
    subtitle:String(page?.subtitle||'我的觀察清單').trim().slice(0,50),
    codes:[...new Set((Array.isArray(page?.codes)?page.codes:[]).map(String).map(x=>x.trim()).filter(x=>/^\d{4,6}$/.test(x)))].slice(0,10)
  }));
  return pages.length?pages:[{title:'我的自選焦點',subtitle:'點選編輯加入股票',codes:[]}];
}
function defaultWatchPages(){
  const fallback=[{title:'我的自選焦點',subtitle:'重點觀察清單',codes:Object.keys(market?.price_history||{}).slice(0,10)}];
  return normalizeWatchPages(market?.watchlist_pages?.length?market.watchlist_pages:fallback);
}
function loadWatchPages(){
  try{
    const raw=localStorage.getItem(WATCH_STORAGE_KEY);if(!raw)throw new Error('no saved watchlist');
    const saved=JSON.parse(raw);
    watchPagesData=normalizeWatchPages(saved?.pages||saved);
  }catch(_){watchPagesData=defaultWatchPages();}
  if(!watchPagesData.length)watchPagesData=defaultWatchPages();
}
function saveWatchPages(){
  watchPagesData=normalizeWatchPages(editingPages);
  localStorage.setItem(WATCH_STORAGE_KEY,JSON.stringify({version:1,pages:watchPagesData}));
  activeWatchPage=Math.min(activeWatchPage,watchPagesData.length-1);
  renderWatchlist();
}
function renderWatchlist(){
  const pages=watchPagesData.length?watchPagesData:defaultWatchPages();
  activeWatchPage=Math.min(activeWatchPage,pages.length-1);
  const page=pages[activeWatchPage];
  $('watchPages').innerHTML=pages.map((item,i)=>'<button data-page="'+i+'" class="'+(i===activeWatchPage?'active':'')+'"><small>第 '+(i+1)+' 頁</small><strong>'+escape(item.title)+'</strong></button>').join('');
  $('watchTitle').textContent=page.title||'我的自選股';
  $('watchSubtitle').textContent=page.subtitle||'每頁最多 10 支股票';
  $('watchlist').innerHTML=(page.codes||[]).slice(0,10).map(code=>{
    const stock=current()[code]||latestMarket()[code],profile=market.company_profiles?.[code]||{},price=last(prices(code))?.close??stock?.quote?.close,net=current()[code]?.foreign?.net;
    const business=profile.business||profile.industry||'公司業務資料更新中';
    return '<button data-watch="'+escape(code)+'" class="'+(code===selected?'active':'')+'"><span class="watchcode">'+escape(code)+'</span><strong>'+escape(stock?.name||profile.name||'尚無名稱')+'</strong><small class="watchbusiness">'+escape(business)+'</small><small>'+(Number.isFinite(price)?fmt(price)+' 元':'等待資料')+(Number.isFinite(net)?' · 外資 '+lots(net):'')+'</small></button>';
  }).join('')||'<div class="editornote">這個分類尚未加入股票，請點「編輯」。</div>';
}
function renderStockQuick(code){
  const profile=market.company_profiles?.[code]||{},stock=latestMarket()[code]||current()[code]||{},name=stock.name||profile.name||code;
  $('companyFullName').textContent=profile.full_name||profile.name||name;
  $('companySummary').textContent=(profile.industry?profile.industry+'｜':'')+(profile.business||'公司主要業務資料更新中');
  const facts=[];
  if(profile.market||stock.market)facts.push(profile.market||stock.market);
  if(profile.listed)facts.push((profile.market==='上櫃'?'上櫃 ':'上市 ')+profile.listed);
  if(profile.chairman)facts.push('董事長 '+profile.chairman);
  if(Number.isFinite(Number(profile.capital)))facts.push('資本額 '+fmt(Number(profile.capital)/100000000,1)+' 億');
  $('companyFacts').innerHTML=facts.slice(0,4).map(x=>'<span>'+escape(x)+'</span>').join('');
  const website=$('companyWebsite');
  if(profile.website){website.href=/^https?:\/\//i.test(profile.website)?profile.website:'https://'+profile.website;website.hidden=false;}else{website.removeAttribute('href');website.hidden=true;}
  const searchUrl='https://news.google.com/search?q='+encodeURIComponent(code+' '+name+' 股票')+'&hl=zh-TW&gl=TW&ceid=TW:zh-Hant';
  $('stockNewsSearch').href=searchUrl;
  const cache=market.stock_news?.[code],items=Array.isArray(cache)?cache:(cache?.items||[]);
  $('stockNews').innerHTML=items.length?items.slice(0,3).map(item=>{
    const parsed=Date.parse(item.published||''),stamp=Number.isFinite(parsed)?new Intl.DateTimeFormat('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(parsed)):'最新';
    return '<li><a href="'+escape(item.url||searchUrl)+'" target="_blank" rel="noopener" title="'+escape(item.title)+'">'+escape(item.title)+'</a><time>'+escape(stamp)+'</time></li>';
  }).join(''):'<li><a href="'+escape(searchUrl)+'" target="_blank" rel="noopener">目前沒有快取新聞，點此搜尋 '+escape(name)+' 最新消息</a><span>搜尋</span></li>';
}
function renderWatchEditor(){
  $('editorPages').innerHTML=editingPages.map((page,i)=>{
    const chips=page.codes.map(code=>'<span class="editorchip"><b>'+escape(code)+'</b><span>'+escape(current()[code]?.name||'查無上市資料')+'</span><button type="button" data-remove-code="'+escape(code)+'" aria-label="刪除 '+escape(code)+'">×</button></span>').join('');
    return '<section class="editorpage" data-edit-page="'+i+'"><div class="editorpagehead"><label>大標題<input data-field="title" maxlength="24" value="'+escape(page.title)+'"></label><label>分類說明<input data-field="subtitle" maxlength="50" value="'+escape(page.subtitle)+'"></label><button type="button" class="deletepage" data-delete-page>刪除分類</button></div><div class="editorcodes">'+(chips||'<span class="editornote">尚未加入股票</span>')+'</div><form class="addstock"><input data-new-code inputmode="numeric" maxlength="6" placeholder="輸入上市股票代號"><button type="submit">＋ 新增個股</button></form></section>';
  }).join('');
}
function openWatchEditor(){
  editingPages=normalizeWatchPages(JSON.parse(JSON.stringify(watchPagesData)));
  renderWatchEditor();
  $('watchEditor').showModal();
}
function closeWatchEditor(){$('watchEditor').close();}
function downloadWatchSettings(){
  const blob=new Blob([JSON.stringify({version:1,pages:normalizeWatchPages(editingPages)},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download='jc-stock-radar-watchlist.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
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
  if(!a){$('techChart').textContent='全市場歷史行情仍在建立，累積滿20個交易日後會自動顯示。';return;}
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

function renderMacd(rows,view){
  if(!view){
    $('macdSignals').innerHTML='<div class="macdsignal neutral"><span>資料狀態</span><strong>至少需要 26 個交易日</strong></div>';
    $('macdChart').textContent='MACD 歷史資料仍在累積。';
    $('macdValue').textContent='資料不足';
    return;
  }
  const signals=[['交叉訊號',view.cross,view.crossState],['柱狀體動能',view.momentum,view.momentumState],['背離偵測',view.divergence,view.divergenceState]];
  $('macdSignals').innerHTML=signals.map(([label,text,state])=>'<div class="macdsignal '+state+'"><span>'+escape(label)+'</span><strong>'+escape(text)+'</strong></div>').join('');
  $('macdValue').textContent='DIF '+fmt(view.currentDif,3)+' · DEA '+fmt(view.currentDea,3)+' · 柱 '+fmt(view.currentHist,3);
  const count=Math.min(60,rows.length),offset=rows.length-count,q=rows.slice(-count);
  const dif=view.dif.slice(-count),dea=view.dea.slice(-count),hist=view.hist.slice(-count),w=680,h=230,p=38;
  const all=[0,...dif,...dea,...hist].filter(Number.isFinite),min=Math.min(...all),max=Math.max(...all),span=Math.max(.001,max-min);
  const x=i=>p+i*(w-2*p)/Math.max(1,count-1),y=v=>h-p-(v-min)/span*(h-2*p),zero=y(0),bw=Math.max(2,(w-2*p)/count*.58);
  const line=(values,stroke)=>'<polyline fill="none" stroke="'+stroke+'" stroke-width="2" points="'+values.map((v,i)=>x(i)+','+y(v)).join(' ')+'"/>';
  let svg='<svg viewBox="0 0 '+w+' '+h+'" role="img" aria-label="MACD DIF、DEA與柱狀體走勢圖"><line x1="'+p+'" x2="'+(w-p)+'" y1="'+zero+'" y2="'+zero+'" stroke="#5e748b" stroke-width="1"/>';
  hist.forEach((v,i)=>{const yy=y(v);svg+='<rect x="'+(x(i)-bw/2)+'" y="'+Math.min(yy,zero)+'" width="'+bw+'" height="'+Math.max(1,Math.abs(zero-yy))+'" rx="1" fill="'+(v>=0?'#ff7581':'#3dd3ad')+'" opacity=".72"><title>'+q[i].date+' 柱狀體 '+fmt(v,3)+'</title></rect>';});
  svg+=line(dif,'#7bd7f0')+line(dea,'#efc96f');
  svg+='<text x="'+p+'" y="'+(h-5)+'" fill="#91a7bd" font-size="11">'+q[0].date.slice(5)+'</text><text x="'+(w-p)+'" text-anchor="end" y="'+(h-5)+'" fill="#91a7bd" font-size="11">'+last(q).date.slice(5)+'</text></svg>';
  $('macdChart').innerHTML=svg;
}

function renderPlan(a){
  if(!a){$('tradePlan').className='signal neutral';$('tradePlan').innerHTML='<strong>技術資料尚未完整</strong><p>全市場行情正在累積；取得至少20個交易日後將自動產生技術分析。</p>';['buyZone','stopPrice','sellZone'].forEach(id=>$(id).textContent='—');$('levelNote').textContent='每天盤後更新一次，無須把股票加入自選頁才會累積。';return;}
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
  if(!market)return; const stock=current()[selected],latestStock=latestMarket()[selected]||stock;
  if(!stock){$('content').hidden=true;$('status').textContent='找不到這個上市股票代號。';return;}
  $('status').textContent='';$('content').hidden=false;
  const stockTitle=$('title'),stockName=latestStock.name||stock.name;
  const stockNameLength=Array.from(stockName).length;
  const stockNameSize=stockNameLength<=5?'name-short':stockNameLength<=8?'name-medium':stockNameLength<=12?'name-long':'name-xlong';
  stockTitle.setAttribute('aria-label',selected+' '+stockName);
  stockTitle.innerHTML='<span class="stocktitle-code">'+escape(selected)+'</span><span class="stocktitle-name '+stockNameSize+'" title="'+escape(stockName)+'">'+escape(stockName)+'</span>';
  renderStockQuick(selected);
  const f=stock.foreign,period=Number($('period').value),allFlows=flows(selected),availableFlows=allFlows.filter(x=>x.date<=(institutionDate||market.latest_session)),periodRows=availableFlows.slice(-period);
  setValue('foreignToday',lots(f.net),f.net);$('foreignSub').textContent='買進 '+lots(f.buy).replace('+','')+' ｜ 賣出 '+lots(f.sell).replace('+','');
  setValue('foreignPeriod',lots(sumNet(periodRows)),sumNet(periodRows));setValue('trustPeriod',lots(sumNet(periodRows,'trust')),sumNet(periodRows,'trust'));setValue('dealerPeriod',lots(sumNet(periodRows,'dealer')),sumNet(periodRows,'dealer'));
  let streak=0;for(const row of [...availableFlows].reverse()){if(!row.foreign.net||Math.sign(row.foreign.net)!==Math.sign(f.net))break;streak++;}
  $('foreignStreak').textContent=periodRows.length+'個交易日 · '+(streak?'連續'+streak+'日'+(f.net>0?'買超':'賣超'):'無連續訊號');
  const priceRows=prices(selected),a=analyze(priceRows,availableFlows),price=last(priceRows)?.close??latestStock.quote?.close,pe=latestStock.pe;
  $('closePe').textContent=Number.isFinite(price)?fmt(price)+' 元 · '+(Number.isFinite(pe)&&pe>0?fmt(pe)+' 倍':'本益比無資料'):'股價尚無資料';
  $('details').innerHTML=[['外資及陸資',f],['投信',stock.trust],['自營商',stock.dealer]].map(([name,x])=>'<tr><td>'+name+'</td><td>'+lots(x.buy).replace('+','')+'</td><td>'+lots(x.sell).replace('+','')+'</td><td class="'+color(x.net)+'">'+lots(x.net)+'</td></tr>').join('');
  const total=f.buy+f.sell,ratio=Number.isFinite(total)&&total>0?f.buy/total:null;$('gaugeFill').style.width=ratio===null?'0%':(ratio*100).toFixed(1)+'%';$('gaugeText').innerHTML=ratio===null?'買賣分項不足':'<span>買進 '+fmt(ratio*100)+'%</span><span>賣出 '+fmt((1-ratio)*100)+'%</span>';
  $('kd').textContent=a?'K '+fmt(a.ind.k,1)+' / D '+fmt(a.ind.d,1):'—';$('boll').textContent=a?fmt(a.ind.lower)+' / '+fmt(a.ind.middle)+' / '+fmt(a.ind.upper):'—';$('ma').textContent=a?'MA5 '+fmt(a.ind.ma5)+' · MA10 '+fmt(a.ind.ma10)+' · MA20 '+fmt(a.ind.ma20):'—';
  flowChart(periodRows);technicalChart(priceRows,a);renderMacd(priceRows,a?.macd);renderPlan(a);renderAdvice(a);renderAdvisor(a,availableFlows);const industry=renderIndustry(selected);renderNight();renderMasters(a,availableFlows,industry);renderGlobal();renderWatchlist();rank();
}

async function load(){
  $('status').textContent='正在載入證交所盤後資料…';
  try{const response=await fetch('data/market.json?cache='+Date.now(),{cache:'no-store'});if(!response.ok)throw new Error('HTTP '+response.status);market=await response.json();if(!market.latest_session||!latestMarket())throw new Error('尚未取得交易日資料。');institutionDate=market.latest_session;loadWatchPages();const recent=days().slice(-5).reverse();$('institutionDate').innerHTML=recent.map(date=>'<option value="'+escape(date)+'">'+escape(date)+(date===market.latest_session?'（最新）':'')+'</option>').join('');$('institutionDate').value=institutionDate;$('stamp').textContent='最近交易日 '+market.latest_session+' · v'+(market.version||'2.4.7');const first=watchPagesData.flatMap(x=>x.codes||[]).find(x=>latestMarket()[x]);if(!latestMarket()[selected])selected=first||Object.keys(latestMarket())[0];render();}
  catch(e){if($('stamp'))$('stamp').textContent='尚未取得資料';if($('content'))$('content').hidden=true;if($('status'))$('status').textContent=e.message+' 請先到 GitHub Actions 執行更新資料。';}
}

$('search').addEventListener('change',e=>{const term=e.target.value.trim(),list=Object.entries(current());const hit=list.find(([code])=>code===term)||list.find(([code,s])=>code.includes(term)||s.name.includes(term));if(hit){selected=hit[0];e.target.value='';render();}else if(term)$('status').textContent='沒有找到這個上市或上櫃股票；興櫃股票目前尚未收錄。';});
$('search').addEventListener('keydown',e=>{if(e.key==='Enter')e.target.blur();});$('period').addEventListener('change',render);$('refresh').addEventListener('click',load);
$('institutionDate').addEventListener('change',e=>{institutionDate=e.target.value;render();});
$('watchlist').addEventListener('click',e=>{const b=e.target.closest('[data-watch]');if(b&&current()[b.dataset.watch]){selected=b.dataset.watch;render();}});
$('watchPages').addEventListener('click',e=>{const b=e.target.closest('[data-page]');if(b){activeWatchPage=Number(b.dataset.page);renderWatchlist();}});
$('editWatch').addEventListener('click',openWatchEditor);
$('toggleWatch').addEventListener('click',()=>{const collapsed=$('watchHub').classList.toggle('collapsed');$('toggleWatch').setAttribute('aria-expanded',String(!collapsed));});
$('closeEditor').addEventListener('click',closeWatchEditor);
$('cancelWatch').addEventListener('click',closeWatchEditor);
$('addWatchPage').addEventListener('click',()=>{if(editingPages.length>=10){alert('最多可建立 10 個分類。');return;}editingPages.push({title:'新自選焦點',subtitle:'我的觀察清單',codes:[]});renderWatchEditor();$('watchEditor').scrollTop=$('watchEditor').scrollHeight;});
$('editorPages').addEventListener('input',e=>{const page=e.target.closest('[data-edit-page]');if(page&&e.target.dataset.field)editingPages[Number(page.dataset.editPage)][e.target.dataset.field]=e.target.value;});
$('editorPages').addEventListener('click',e=>{const page=e.target.closest('[data-edit-page]');if(!page)return;const i=Number(page.dataset.editPage),remove=e.target.closest('[data-remove-code]');if(remove){editingPages[i].codes=editingPages[i].codes.filter(code=>code!==remove.dataset.removeCode);renderWatchEditor();return;}if(e.target.closest('[data-delete-page]')){if(editingPages.length===1){alert('至少需保留一個分類。');return;}editingPages.splice(i,1);renderWatchEditor();}});
$('editorPages').addEventListener('submit',e=>{if(!e.target.matches('.addstock'))return;e.preventDefault();const page=e.target.closest('[data-edit-page]'),i=Number(page.dataset.editPage),input=e.target.querySelector('[data-new-code]'),code=input.value.trim();if(!/^\d{4,6}$/.test(code)){alert('請輸入 4～6 位數股票代號。');return;}if(!current()[code]){alert('目前資料中找不到這支上市或上櫃股票。');return;}if(editingPages[i].codes.includes(code)){alert('這支股票已在此分類。');return;}if(editingPages[i].codes.length>=10){alert('每個分類最多 10 支股票。');return;}editingPages[i].codes.push(code);renderWatchEditor();});
$('saveWatch').addEventListener('click',()=>{try{saveWatchPages();closeWatchEditor();}catch(_){alert('瀏覽器無法儲存設定，請確認未停用網站儲存空間。');}});
$('exportWatch').addEventListener('click',downloadWatchSettings);
$('importWatch').addEventListener('click',()=>$('importWatchFile').click());
$('importWatchFile').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{const raw=JSON.parse(await file.text()),pages=normalizeWatchPages(raw?.pages||raw);editingPages=pages;renderWatchEditor();}catch(_){alert('無法讀取這個設定檔，請確認它是本系統匯出的 JSON。');}e.target.value='';});
$('resetWatch').addEventListener('click',()=>{if(!confirm('確定恢復 GitHub 檔案中的預設分類與股票嗎？'))return;localStorage.removeItem(WATCH_STORAGE_KEY);watchPagesData=defaultWatchPages();editingPages=JSON.parse(JSON.stringify(watchPagesData));activeWatchPage=0;renderWatchEditor();renderWatchlist();});
$('watchEditor').addEventListener('click',e=>{if(e.target===$('watchEditor'))closeWatchEditor();});
document.querySelectorAll('[data-rank]').forEach(b=>b.addEventListener('click',()=>{rankSide=b.dataset.rank;document.querySelectorAll('[data-rank]').forEach(x=>x.classList.toggle('active',x===b));rank();}));
$('ranking').addEventListener('click',e=>{const row=e.target.closest('[data-code]');if(row){selected=row.dataset.code;render();scrollTo({top:0,behavior:'smooth'});}});
load();

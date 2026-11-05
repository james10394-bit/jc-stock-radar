/* Shared, conservative entry checks. Scores are NOT probabilities. */
(function(root){
  'use strict';
  const num=x=>x===null||x===undefined||x===''?null:(Number.isFinite(Number(x))?Number(x):null);
  const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
  const last=a=>a[a.length-1];
  function technical(rows){
    if(rows.length<26)return null;
    const closes=rows.map(r=>num(r.close));if(closes.some(x=>x===null))return null;
    const ma=n=>mean(closes.slice(-n));let k=50,d=50;
    rows.forEach((r,i)=>{const w=rows.slice(Math.max(0,i-8),i+1),hi=Math.max(...w.map(x=>x.high)),lo=Math.min(...w.map(x=>x.low));k=k*2/3+(hi===lo?50:(r.close-lo)/(hi-lo)*100)/3;d=d*2/3+k/3;});
    const tr=rows.slice(1).map((r,i)=>Math.max(r.high-r.low,Math.abs(r.high-rows[i].close),Math.abs(r.low-rows[i].close)));
    return {ma5:ma(5),ma10:ma(10),ma20:ma(20),atr:mean(tr.slice(-14)),k,d};
  }
  function calendar(m,cutoff){return [...new Set(m.trading_sessions||[])].filter(d=>d<=cutoff).sort();}
  function coverage(m,code,cutoff){
    const sessions=calendar(m,cutoff),expected=sessions.slice(-30),rows=(m.price_history?.[code]||[]).filter(r=>r.date<=cutoff).sort((a,b)=>a.date.localeCompare(b.date));
    const have=new Set(rows.filter(r=>['open','high','low','close'].every(k=>num(r[k])>0)&&num(r.volume)!==null&&r.volume>=0&&r.high>=r.low&&r.close<=r.high&&r.close>=r.low).map(r=>r.date));
    const missing=expected.filter(d=>!have.has(d));
    const flowDates=sessions.slice(-5),missingFlows=flowDates.filter(d=>num(m.days?.[d]?.[code]?.foreign?.net)===null);
    const calendarAge=Date.parse(cutoff)-Date.parse(m.calendar_verified_at||'');
    return {rows,sessions,missing,missingFlows,verified:expected.length>=30&&missing.length===0&&missingFlows.length===0&&!!m.calendar_verified_at&&calendarAge<=7*86400000&&last(sessions)===cutoff};
  }
  function financial(m,code){
    const f=m.financials?.[code]||{},eps=num(f.eps),match=String(f.period||'').match(/(\d{3,4})Q([1-4])/);
    let periodEnd=null;if(match){let y=Number(match[1]);if(y<1911)y+=1911;const q=Number(match[2]);periodEnd=new Date(Date.UTC(y,q*3,0)).toISOString().slice(0,10);}
    return {eps,period:f.period||'尚無資料',periodEnd};
  }
  function assess(m,code,options={}){
    const cutoff=options.cutoff||m.latest_session,live=options.live||null,profile=m.company_profiles?.[code]||m.security_registry?.[code]||{};
    const cov=coverage(m,code,cutoff),rows=cov.rows,t=technical(rows),end=last(rows),f=financial(m,code),blocks=[],notes=[];
    const p=num(live?.price??end?.close),previous=num(live?.previous_close??rows.at(-2)?.close);
    const globalRisk=m.global_context||{},contextAge=Date.parse(options.now||new Date())-Date.parse(globalRisk.updated_at||'');
    const contextFresh=contextAge>=0&&contextAge<=36*3600000;
    const eventSignals=Object.values(globalRisk.risk_analysis||{});
    if(contextFresh&&globalRisk.risk_method_version===2&&eventSignals.some(r=>r.level==='高'&&r.usable&&r.evidence?.length))blocks.push('重大事件標題／摘要出現高警戒訊號，暫停新買進，待人工查核');
    if(!contextFresh||globalRisk.risk_method_version!==2||globalRisk.risk_data_incomplete)notes.push('事件資料過期、未驗證或不完整：不給全球因素多方加分，不代表低風險');
    if(contextFresh&&globalRisk.us_election?.focus?.risk_watch)notes.push(globalRisk.us_election.focus.name+'：'+globalRisk.us_election.focus.phase+'；留意政策及波動，未核實結果前不作方向加分');
    if(!['上市','上櫃'].includes(profile.market)||!/^\d{4}$/.test(code))blocks.push('此買進篩選僅支援上市／上櫃普通股');
    if(!cov.verified)blocks.push('行情或近5日法人缺漏／交易日曆未驗證，暫停評分');
    if(!end||end.date!==last(cov.sessions))blocks.push('最新完整交易日行情尚未同步');
    if(f.eps===null||!f.periodEnd)blocks.push('EPS 或財報期別不足');
    else if(f.eps<=0)blocks.push('最新累計 EPS 非正值，保守模式不列入買進');
    else if((Date.parse(cutoff)-Date.parse(f.periodEnd))/86400000>190)blocks.push('財報過期，暫停買進篩選');
    if(!t||p===null||p<=0)blocks.push('技術資料不足');
    let stop=null,target=null,riskPct=null,rr=null,score=null;
    if(t&&p>0){
      const window=rows.slice(-20),support=Math.min(...window.map(r=>r.low)),resistance=Math.max(...window.map(r=>r.high));
      stop=support*.97;
      if(num(live?.opening_low)>0)stop=Math.max(stop,live.opening_low*.995);
      target=resistance*.995;
      riskPct=(p-stop)/p*100;rr=p>stop?(target-p)/(p-stop):null;
      const jump=previous>0?(p/previous-1)*100:null,change5=rows.length>5?(p/rows.at(-6).close-1)*100:null;
      if(p<=stop)blocks.push('已跌破結構停損位置');
      if(p<t.ma20||t.ma5<t.ma10)blocks.push('股價或短均線趨勢尚未轉強');
      if(jump!==null&&jump<=-4)blocks.push('當日跌幅達4%，先停止新增買進');
      if(p/t.ma20-1>.08||t.k>=85||(change5!==null&&change5>15))blocks.push('乖離／KD／短期漲幅過熱，避免追價');
      if(!(riskPct>=.5&&riskPct<=8))blocks.push('停損距離不在0.5%～8%檢核範圍');
      if(!(rr>=2))blocks.push('至前高的潛在報酬／風險不足2倍');
      const recent=cov.sessions.slice(-5).map(d=>m.days?.[d]?.[code]).filter(Boolean),net=recent.reduce((s,r)=>s+(num(r.foreign?.net)||0),0);
      const lastNet=num(last(recent)?.foreign?.net),streak=(()=>{let n=0;for(const r of [...recent].reverse()){if(!(num(r.foreign?.net)>0))break;n++;}return n;})();
      if(lastNet!==null&&lastNet<0&&net<0)blocks.push('外資當日與近5日同步賣超');
      if(streak>=3)notes.push('外資連買至少3日：籌碼集中警戒，不能單獨視為買點');
      if(streak>=3&&(p/t.ma20-1>.05||t.k>80))blocks.push('外資連買且位置偏熱，暫停追價');
      if(cov.verified){
        const trend=(p>=t.ma20?16:-16)+(t.ma5>=t.ma10?8:-8),flow=net>0?8:-8,earnings=f.eps>0?12:-18;
        const global=m.global_context||{},age=Date.parse(options.now||new Date())-Date.parse(global.updated_at||'');
        let macro=age>=0&&age<=36*3600000&&num(global.buy_percent)!==null?Math.max(-8,Math.min(8,(global.buy_percent-50)*.2)):0;
        if(global.risk_method_version!==2||global.risk_data_incomplete)macro=Math.min(0,macro);
        score=Math.max(0,Math.min(100,Math.round(50+trend+flow+earnings+macro)));
      }
    }
    if(live){
      if(live.phase!=='trading')blocks.push('目前不在盤中交易時段');
      if(!live.fresh)blocks.push('報價過期或無當日成交');
      if(!live.opening_complete)blocks.push('尚未取得完整開盤前5分鐘觀測');
    }
    return {eligible:blocks.length===0,blocks:[...new Set(blocks)],notes,score,price:p,priceDate:end?.date,eps:f.eps,period:f.period,stop,target,riskPct,rr,technical:t,missing:cov.missing,missingFlows:cov.missingFlows};
  }
  function position(record,quote){
    const cost=num(record?.cost),shares=num(record?.shares),stop=num(record?.stop),price=num(quote?.price);
    if(!(cost>0&&shares>0&&stop>0&&stop<cost))return null;
    if(!(price>0))return {status:'尚無可用報價'};
    return {cost,shares,stop,price,pnl:(price-cost)*shares,pnlPct:(price/cost-1)*100,riskAtEntry:(cost-stop)*shares,breached:price<=stop,status:price<=stop?'已觸及你設定的停損，請立即檢查持倉':'尚未觸及固定停損'};
  }
  function scan(m,snapshot,now=new Date()){
    if(!snapshot||snapshot.phase!=='trading')return {candidates:[],reason:'非交易時段，開盤名單不構成目前買進建議',examined:0};
    const today=now.toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'}),parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]));
    const minutes=Number(parts.hour)*60+Number(parts.minute),weekday=new Date(today+'T12:00:00+08:00').getUTCDay();
    if(snapshot.date!==today)return {candidates:[],reason:'快照不是今日資料，尚未開始今日篩選',examined:0};
    if(weekday===0||weekday===6||minutes<540||minutes>=810)return {candidates:[],reason:'目前非交易時段，僅可回看觀測紀錄',examined:0};
    if(snapshot.coverage?.batches_failed>0)return {candidates:[],reason:'部分行情批次失敗，暫停全市場候選篩選',examined:0};
    const age=now.getTime()-Date.parse(snapshot.generated_at||'');
    if(!(age>=0&&age<=120000))return {candidates:[],reason:'整批快照已超過2分鐘，暫停候選名單',examined:0};
    const results=[],sectors={},exclusions={};let examined=0;
    const reject=reason=>{exclusions[reason]=(exclusions[reason]||0)+1;};
    const sessions=calendar(m,snapshot.date),cutoff=sessions.filter(d=>d<snapshot.date).at(-1);
    if(!cutoff)return {candidates:[],reason:'前一交易日資料未確認',examined:0};
    for(const [code,q]of Object.entries(snapshot.quotes||{})){
      if(!q.opening_complete||!(q.opening_volume>0)){reject('缺少09:05開盤觀測');continue;}
      const ageQuote=now.getTime()-Date.parse(q.timestamp||'');const live={...q,phase:snapshot.phase,fresh:ageQuote>=0&&ageQuote<=120000};
      const v=assess(m,code,{cutoff,live,now});examined++;
      const history=(m.price_history?.[code]||[]).filter(r=>r.date<=cutoff).slice(-20),avg=mean(history.map(r=>num(r.volume)).filter(x=>x!==null));
      const fraction=avg>0?q.opening_volume/avg:null,amount=q.opening_volume*q.open;
      // This is the first-five-minute volume / prior 20-day FULL-DAY volume.
      // It is intentionally NOT mislabeled as a same-time relative volume.
      if(!v.eligible){v.blocks.forEach(reject);continue;}
      if(fraction===null||fraction<.08||q.opening_volume<500000||amount<20000000){reject('開盤量能或成交金額未達門檻');continue;}
      if(q.price<q.open||q.price<q.opening_low||q.price/q.open-1>.03){reject('跌回開盤區間或追價過高');continue;}
      const industry=m.company_profiles?.[code]?.industry||'未分類';
      const strength=q.previous_close>0?(q.price/q.previous_close-1)*100:0;
      (sectors[industry]||= []).push(strength);
      results.push({code,name:q.name||m.company_profiles?.[code]?.name,industry,openingFraction:fraction,openingVolume:q.opening_volume,openingAmount:amount,strength,quote:q,risk:v,score:v.score+Math.min(15,fraction*35)});
    }
    results.sort((a,b)=>b.score-a.score||b.openingAmount-a.openingAmount);
    const chosen=[],used=new Set();for(const r of results){if(used.has(r.industry))continue;used.add(r.industry);r.sectorSample=sectors[r.industry].length;r.sectorMean=mean(sectors[r.industry]);chosen.push(r);if(chosen.length===3)break;}
    return {candidates:chosen,examined,exclusions,reason:chosen.length?'符合條件 '+chosen.length+' 檔；每個產業最多1檔':'目前沒有同時通過量能、財報、趨勢及風險報酬檢核的股票'};
  }
  const api={num,technical,coverage,financial,assess,position,scan};root.JCRisk=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);


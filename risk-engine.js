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
  function candleVolume(rows){
    const r=last(rows),prior=rows.slice(-21,-1),vol=prior.map(x=>num(x.volume));
    const [o,h,l,c,v]=['open','high','low','close','volume'].map(k=>num(r?.[k]));
    if(prior.length<20||vol.some(x=>x===null||x<0)||!(mean(vol)>0)||!(o>0&&c>0&&l>0&&h>=Math.max(o,c)&&l<=Math.min(o,c)&&v>0))return null;
    const range=h-l,upper=range>0?(h-Math.max(o,c))/range:0;
    const strength=range>0?(c-l)/range:.5,ratio=v/mean(vol),prev=num(last(prior).close);
    const top=Math.max(...prior.map(x=>num(x.high)));
    const rejection=ratio>=1.5&&upper>=.45&&strength<=.5;
    const reversal=ratio>=1.5&&h>top&&c<o&&c<prev&&(o-c)/range>=.45;
    const distribution=ratio>=1.5&&c<o&&c<prev&&strength<=.35;
    const breakout=ratio>=1.5&&c>top&&c>o&&strength>=.7;
    return {upper,ratio,rejection,reversal,distribution,breakout,volume:v};
  }
  function assessEntry(m,code,options={}){
    const cutoff=options.cutoff||m.latest_session,base=assess(m,code,options),cov=coverage(m,code,cutoff);
    const profile=m.company_profiles?.[code]||m.security_registry?.[code]||{},f=financial(m,code);
    const data=[],blocks=[],factors=[],notes=[...base.notes];
    const add=(name,weight,share,detail)=>factors.push({name,weight,points:share===null?null:Math.round(share*weight),detail});
    const n=x=>Number(x).toFixed(2),signed=x=>x===null?'缺資料':(x>0?'+':'')+n(x),lots=x=>x===null?'缺資料':new Intl.NumberFormat('zh-TW',{maximumFractionDigits:2}).format(x/1000)+' 張';
    const history=Object.fromEntries(cov.rows.map(r=>[r.date,r]));
    const rows=cov.sessions.slice(-60).map(d=>history[d]).filter(r=>r&&['open','high','low','close'].every(k=>num(r[k])>0)&&r.high>=Math.max(r.open,r.close)&&r.low<=Math.min(r.open,r.close));
    const t=technical(rows),r=last(rows),p=num(r?.close),cv=candleVolume(rows);
    if(!['上市','上櫃'].includes(profile.market)||!/^[1-9]\d{3}$/.test(code))data.push('此綜合評估適用上市／上櫃四碼普通股');
    if(!cov.verified||r?.date!==cutoff||rows.slice(-30).map(x=>x.date).join()!==cov.sessions.slice(-30).join())data.push('行情、交易日曆或近5日外資淨額未完整同步');
    if(m.latest_quotes?.date>cutoff&&num(m.latest_quotes.quotes?.[code]?.close)>0)data.push('已有較新的收盤價，等待同日法人與完整日線同步');
    if(cutoff!==m.latest_session)data.push('歷史日期只顯示交易資料；財報快照無法驗證當時是否已公布');
    const age=(Date.parse(cutoff)-Date.parse(f.periodEnd))/86400000;
    const validEPS=f.eps!==null&&age>=0&&age<=190;
    if(!validEPS)data.push('EPS 或財報期別不足、過期或日期不符');
    if(!t||!(p>0)||!cv)data.push('KD、布林通道或價量所需的日線資料不足');
    const frows=cov.sessions.slice(-5).map(d=>m.days?.[d]?.[code]?.foreign);
    const day=last(frows),net=num(day?.net),validFlow=frows.length===5&&frows.every(x=>num(x?.net)!==null);
    const sum=validFlow?frows.reduce((s,x)=>s+num(x.net),0):null;
    let streak=0;for(const row of [...frows].reverse()){if(!(num(row?.net)>0))break;streak++;}
    const o=m.company_outlook?.[code],y=num(o?.yoy),ytd=num(o?.ytd),oAge=(Date.parse(cutoff)-Date.parse(o?.published))/86400000;
    const outlook=oAge>=0&&oAge<=120&&/^\d{4}-\d{2}$/.test(o?.period||'')&&o.period<cutoff.slice(0,7)&&y!==null&&ytd!==null;
    add('KD 動能',15,t?(t.k>=85?.35:t.k>t.d?(t.k>=35?.95:.65):t.k===t.d?.5:.15):null,t?'K '+n(t.k)+'｜D '+n(t.d)+(t.k>=85?'｜過熱':''):'資料不足');
    add('EPS 獲利',15,validEPS?(f.eps>0?1:f.eps===0?.25:0):null,validEPS?f.period+' 累計 EPS '+n(f.eps)+' 元':'資料不足');
    add('公司營收動能',15,outlook?(y>0&&ytd>0?1:y<0&&ytd<0?0:.5):null,outlook?o.period+' 月年增 '+signed(y)+'%｜累計年增 '+signed(ytd)+'%（歷史營收，非財測）':'缺少可用月營收，不計分；無法推論公司前景');
    if(t){
      const mid=t.ma20,sd=Math.sqrt(mean(rows.slice(-20).map(x=>(x.close-mid)**2))),upper=mid+2*sd,lower=mid-2*sd;
      add('布林通道',15,sd===0?.5:p>upper?.5:p>=mid?.95:p>=lower?.3:0,'下軌 '+n(lower)+'｜中軌 '+n(mid)+'｜上軌 '+n(upper)+(p>upper?'｜超出上軌，留意追價':''));
      const old20=mean(rows.slice(-25,-5).map(x=>num(x.close)));
      const signals=[p>=t.ma20,t.ma5>=t.ma10,t.ma10>=t.ma20,t.ma20>old20];
      add('多頭趨勢',15,signals.filter(Boolean).length/4,'MA5 '+n(t.ma5)+'｜MA10 '+n(t.ma10)+'｜MA20 '+n(t.ma20)+'｜20日線較5個交易日前'+(t.ma20>old20?'上揚':t.ma20===old20?'持平':'下滑'));
    }else{
      add('布林通道',15,null,'資料不足');add('多頭趨勢',15,null,'資料不足');
    }
    add('外資買賣',15,validFlow?(net>0&&sum>0?(streak>=3?.75:1):net<0&&sum<0?0:.5):null,'當日買 '+lots(num(day?.buy))+'｜賣 '+lots(num(day?.sell))+'｜淨額 '+lots(net)+'｜5日淨額 '+lots(sum)+(streak>=3?'｜連買 '+streak+' 日，留意籌碼擁擠':''));
    const alert=cv&&(cv.rejection||cv.reversal||cv.distribution);
    const candleLabel=!cv?'資料不足':cv.reversal?'放量一日反轉':cv.rejection?'帶量長上影':cv.distribution?'放量收黑':cv.breakout?'放量突破':cv.upper>=.45?'長上影、未達放量門檻':'未出現明顯價量訊號';
    add('價量與上影線',10,cv?(alert?0:cv.breakout?1:cv.upper>=.45?.25:.5):null,cv?candleLabel+'｜成交 '+lots(cv.volume)+'｜前20日均量 '+n(cv.ratio)+' 倍｜上影佔振幅 '+n(cv.upper*100)+'%':candleLabel);
    if(!outlook)notes.push('營收資料缺失或過期：營收項不計分，其他項目維持原權重。');
    const severe=base.blocks.filter(x=>/重大事件|已跌破|當日跌幅/.test(x));
    if(alert)severe.push(candleLabel+'：先觀察下一交易日是否重新站穩，暫緩新買進');
    // Confirm a swing low with two completed bars on either side; never invent a target above the prior high.
    const recent=rows.slice(-21,-1);
    const pivots=recent.filter((x,i)=>i>=2&&i<recent.length-2&&[-2,-1,1,2].every(k=>x.low<recent[i+k].low));
    const pivot=last(pivots);
    const stop=pivot?pivot.low*.995:base.stop;
    const target=recent.length===20?Math.max(...recent.map(x=>num(x.high)))*.995:null;
    const riskPct=stop>0&&p>0?(p-stop)/p*100:null,rr=target>0&&p>stop&&stop>0?(target-p)/(p-stop):null;
    blocks.push(...base.blocks.filter(x=>/EPS 非正值|過熱|暫停追價/.test(x)));
    if(pivot&&p<=stop)blocks.push('收盤已跌破近期確認低點的結構停損');
    if(!(riskPct>=.5-1e-9&&riskPct<=8))blocks.push('停損距離不在0.5%～8%檢核範圍');
    if(!(rr>=2))blocks.push('至前20日高點的潛在報酬／風險不足2倍');
    if(pivot)notes.push('結構停損參考近期已確認的低點（'+pivot.date+'）；前高取前20日，不把當日高點當作目標。');
    const score=data.length?null:factors.reduce((s,x)=>s+(x.points??0),0);
    const eligible=score!==null&&score>=70&&!severe.length&&!blocks.length;
    const label=data.length?'資料不足・暫停評分':severe.length?'風險警戒・暫緩新買進':eligible?'條件偏多・可評估新進':score>=70?'偏多觀察・等待合適價位':score>=55?'中性觀察・等待確認':'條件偏弱・暫緩新買進';
    return {...base,cutoff,eligible,score,label,stop,target,riskPct,rr,factors,blocks:[...data,...severe,...blocks],notes,candle:cv};
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
  const api={num,technical,coverage,financial,assess,assessEntry,candleVolume,position,scan};root.JCRisk=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);


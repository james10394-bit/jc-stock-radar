/* Verifiable public observations; no investor identity or limit-up prediction. */
(function(root){
  'use strict';
  const number=x=>x===null||x===undefined||x===''?null:(Number.isFinite(Number(x))?Number(x):null);
  function foreignRanking(m,{period=5,side='buy',market='all',limit=20}={}){
    const cutoff=m.latest_session,official=[...new Set(m.trading_sessions||[])].filter(d=>d<=cutoff).sort();
    const sessions=official.slice(-5),latest=m.days?.[cutoff]||{},rows=[];let incomplete=0;
    if(!m.calendar_verified_at||sessions.length!==5||sessions.at(-1)!==cutoff||sessions.some(d=>!m.days?.[d]))return {rows:[],sessions,cutoff,incomplete:0,error:'交易日曆或5日法人資料不足，暫不排名'};
    for(const [code,s]of Object.entries(latest)){
      const listing=s.market||m.company_profiles?.[code]?.market||'上市';
      if(!/^\d{4}$/.test(code)||code.startsWith('00')||!['上市','上櫃'].includes(listing)||(market!=='all'&&listing!==market))continue;
      const today=number(s.foreign?.net),nets=sessions.map(d=>number(m.days[d]?.[code]?.foreign?.net));
      const total=nets.every(x=>x!==null)?nets.reduce((a,b)=>a+b,0):null;
      if(total===null)incomplete++;
      const value=period===1?today:total;if(value===null||(side==='buy'?value<=0:value>=0))continue;
      let streak=0;for(const d of [...official].reverse()){if(!(number(m.days?.[d]?.[code]?.foreign?.net)>0))break;streak++;}
      rows.push({code,name:s.name||m.company_profiles?.[code]?.name||code,market:listing,today,total,value,streak,close:number(s.quote?.close)});
    }
    rows.sort((a,b)=>(side==='buy'?b.value-a.value:a.value-b.value)||a.code.localeCompare(b.code));
    return {rows:rows.slice(0,limit),sessions,cutoff,incomplete,total:rows.length,error:null};
  }
  function nearLimit(snapshot,now=new Date()){
    const result=[];if(snapshot?.phase!=='trading')return result;
    const batchAge=+now-Date.parse(snapshot.generated_at||'');if(!(batchAge>=0&&batchAge<=120000))return result;
    for(const [code,q]of Object.entries(snapshot.quotes||{})){
      const b=snapshot.order_books?.[code],age=+now-Date.parse(q.timestamp||''),bookAge=+now-Date.parse(b?.timestamp||'');
      if(!(age>=0&&age<=120000&&q.price>0&&q.previous_close>0&&b?.upper_limit>q.previous_close))continue;
      const gap=(b.upper_limit-q.price)/b.upper_limit*100,change=(q.price/q.previous_close-1)*100;
      if(gap<0||gap>2||change<6||q.price<q.open||q.volume<500000)continue;
      const freshBook=bookAge>=0&&bookAge<=120000;
      const accelerating=q.interval_seconds>=10&&q.interval_seconds<=120&&q.interval_volume>=500000&&q.interval_price_change>=.5;
      result.push({code,name:q.name,price:q.price,upper:b.upper_limit,gap,change,timestamp:q.timestamp,accelerating,intervalVolume:accelerating?q.interval_volume:null,buyShare:freshBook?number(b.buy_share):null,bidShares:freshBook?number(b.bid_shares):null});
    }
    return result.sort((a,b)=>a.gap-b.gap||b.change-a.change).slice(0,10);
  }
  function volumeBoard(m,snapshot,now=new Date()){
    const today=now.toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'});
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]));
    const minutes=Number(parts.hour)*60+Number(parts.minute),active=minutes>=540&&minutes<810;
    const validCode=c=>/^\d{4}$/.test(c)&&!c.startsWith('00');
    const named=(code,q)=>({code,name:q.name||m.company_profiles?.[code]?.name||code,volume:q.volume,price:number(q.price),date:q.date,timestamp:q.timestamp||null});
    const age=q=>+now-Date.parse(q.timestamp||'');
    const candidates=Object.entries(snapshot?.volume_quotes||{}).filter(([c,q])=>validCode(c)&&q.date===today&&number(q.volume)>0);
    let rows=[],mode='none',date=null,title='尚無量能資料';
    const fresh=candidates.filter(([,q])=>age(q)>=0&&age(q)<=120000);
    if(active&&snapshot?.phase==='trading'&&fresh.length){rows=fresh.map(([c,q])=>named(c,q));mode='live';date=today;title='盤中累計成交量觀察榜';}
    else {
      const opening=Object.entries(snapshot?.opening_observations||{}).filter(([c,q])=>validCode(c)&&q.date===today&&q.opening_complete&&number(q.opening_volume)>0);
      if(opening.length){rows=opening.map(([c,q])=>({...named(c,q),volume:q.opening_volume,timestamp:q.opening_observed_at}));mode='opening_history';date=today;title='今日開盤實際觀測紀錄';}
      else if(candidates.length){rows=candidates.map(([c,q])=>named(c,q));mode='intraday_history';date=today;title='今日曾取得的累計量觀測（非即時／非收盤量）';}
    }
    if(!rows.length){
      // Daily fallback is separately labelled; never invent today's opening tape.
      for(const [code,history]of Object.entries(m.price_history||{})){
        if(!validCode(code))continue;
        const q=[...history].reverse().find(r=>r.date<today||(r.date===today&&minutes>=815));
        if(!q||!(number(q.volume)>0)||!(number(q.close)>0))continue;
        if(!date||q.date>date){date=q.date;rows=[];}
        if(q.date===date)rows.push(named(code,{...q,price:q.close}));
      }
      if(rows.length){mode='daily_history';title='最近完整交易日成交量榜（非開盤名單）';}
    }
    if(!rows.length&&snapshot?.date&&snapshot.date<today){
      const source=snapshot.volume_quotes||snapshot.quotes||{};
      rows=Object.entries(source).filter(([c,q])=>validCode(c)&&number(q.volume)>0&&q.date===snapshot.date).map(([c,q])=>named(c,q));
      if(rows.length){mode='intraday_history';date=snapshot.date;title='前次取得的累計量紀錄（非今日資料）';}
    }
    rows.sort((a,b)=>b.volume-a.volume||a.code.localeCompare(b.code));
    return {rows:rows.slice(0,20),mode,date,title,total:rows.length,
            openingCount:Object.keys(snapshot?.opening_observations||{}).length,
            warning:mode==='live'?'僅依已取得的新鮮累計量排序；未通過風控，不是買進名單':'歷史觀測只供回看，不是目前買進建議；沒抓到的開盤資料不能事後補造'};
  }
  root.JCSignals={foreignRanking,nearLimit,volumeBoard};if(typeof module!=='undefined')module.exports=root.JCSignals;
})(typeof globalThis!=='undefined'?globalThis:this);

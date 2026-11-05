const assert=require('node:assert/strict'),R=require('../risk-engine.js');
function fixture(){
  const sessions=[];let day=new Date('2026-09-01T00:00:00Z');while(sessions.length<40){if(![0,6].includes(day.getUTCDay()))sessions.push(day.toISOString().slice(0,10));day.setUTCDate(day.getUTCDate()+1);}
  const cutoff=sessions.at(-1),m={latest_session:cutoff,trading_sessions:sessions,calendar_verified_at:cutoff+'T16:00:00+08:00',price_history:{},days:{},company_profiles:{},financials:{},global_context:{buy_percent:95,updated_at:cutoff+'T16:00:00+08:00'}};
  for(const [index,code]of ['2330','2317','2603','1312'].entries()){
    m.company_profiles[code]={name:code,market:'上市',industry:index<2?'電子':'產業'+index};m.financials[code]={eps:1.2,period:'115Q2'};
    m.price_history[code]=sessions.map((date,i)=>({date,open:11.2+i*.02,close:11.2+i*.02,high:15,low:11.1+i*.02,volume:10000000}));
    for(const date of sessions)(m.days[date]||={})[code]={name:code,market:'上市',foreign:{buy:20000,sell:10000,net:10000},trust:{net:0},dealer:{net:0}};
  }return m;
}
let count=0;function test(name,f){f();count++;console.log('OK',name);}
const m=fixture(),cutoff=m.latest_session,now=new Date(cutoff+'T09:06:00+08:00');now.setDate(now.getDate()+1);const date=now.toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'});
function live(){return {price:12,open:11.8,previous_close:11.9,opening_low:11.7,opening_high:12.1,opening_volume:2200000,volume:2500000,opening_complete:true,phase:'trading',fresh:true,date,timestamp:date+'T09:05:30+08:00'};}
function snap(){return {date,generated_at:now.toISOString(),phase:'trading',coverage:{batches_failed:0},quotes:Object.fromEntries(['2330','2317','2603','1312'].map(c=>[c,live()]))};}
test('valid control case can pass',()=>assert.equal(R.assess(m,'2330',{cutoff,live:live(),now}).eligible,true));
test('EPS loss overrides strong technical and global scores',()=>{const x=structuredClone(m);x.financials['1312'].eps=-1.68;assert.equal(R.assess(x,'1312',{cutoff,live:live(),now}).eligible,false);});
test('unknown EPS is not zero or bullish',()=>{const x=structuredClone(m);x.financials['2330']={};const a=R.assess(x,'2330',{cutoff,live:live()});assert.equal(a.eps,null);assert.equal(a.eligible,false);});
test('one missing official trading session suspends scoring',()=>{const x=structuredClone(m);x.price_history['2330'].splice(-10,1);const a=R.assess(x,'2330',{cutoff,live:live()});assert.equal(a.eligible,false);assert.equal(a.score,null);});
test('unverified calendar blocks all entries',()=>{const x=structuredClone(m);x.calendar_verified_at=null;assert.equal(R.assess(x,'2330',{cutoff,live:live()}).eligible,false);});
test('invalid OHLC suspends scoring',()=>{const x=structuredClone(m);x.price_history['2330'].at(-1).high=0;assert.equal(R.assess(x,'2330',{cutoff,live:live()}).score,null);});
test('null foreign net is incomplete information',()=>{const x=structuredClone(m);x.days[cutoff]['2330'].foreign.net=null;assert.equal(R.assess(x,'2330',{cutoff,live:live()}).eligible,false);});
test('wide stop at 19 is rejected',()=>{const q=live();q.price=19;const a=R.assess(m,'2330',{cutoff,live:q});assert.equal(a.eligible,false);assert(a.blocks.some(x=>x.includes('停損距離')));});
test('price below fixed stop triggers held-position alert',()=>assert.equal(R.position({cost:19,shares:5000,stop:17.5},{price:14}).breached,true));
test('hold-position loss reflects actual cost and shares',()=>assert.equal(R.position({cost:19,shares:5000,stop:17.5},{price:14}).pnl,-25000));
test('stale quote is rejected even if the batch is new',()=>{const s=snap();Object.values(s.quotes).forEach(q=>q.timestamp=date+'T09:00:00+08:00');assert.equal(R.scan(m,s,now).candidates.length,0);});
test('closed-session snapshots never create a buy list',()=>{const s=snap();s.phase='closed';assert.equal(R.scan(m,s,now).candidates.length,0);});
test('late-start day without opening observation never invents a list',()=>{const s=snap();Object.values(s.quotes).forEach(q=>q.opening_complete=false);assert.equal(R.scan(m,s,now).candidates.length,0);});
test('failed batch blocks partial-market recommendations',()=>{const s=snap();s.coverage.batches_failed=1;assert.equal(R.scan(m,s,now).candidates.length,0);});
test('candidate list respects sector diversification and maximum three',()=>{const a=R.scan(m,snap(),now);assert.equal(a.candidates.length,3);assert.equal(new Set(a.candidates.map(x=>x.industry)).size,3);});
test('does not fill three when only one stock passes',()=>{const x=structuredClone(m);for(const c of ['2317','2603','1312'])x.financials[c].eps=-2;assert.equal(R.scan(x,snap(),now).candidates.length,1);});
test('high volume but below opening price is not selected',()=>{const s=snap();Object.values(s.quotes).forEach(q=>q.open=12.2);assert.equal(R.scan(m,s,now).candidates.length,0);});
test('future price rows are excluded from historical cutoff',()=>{const x=structuredClone(m);x.price_history['2330'].push({date:'2027-01-01',open:99,close:99,high:100,low:98,volume:100});assert.equal(R.assess(x,'2330',{cutoff,live:live()}).priceDate,cutoff);});
test('insufficient upside is rejected',()=>{const q=live();q.price=14.9;q.opening_low=14.5;assert.equal(R.assess(m,'2330',{cutoff,live:q}).eligible,false);});
test('zero, null and dash do not become valid prices',()=>{assert.equal(R.num(null),null);assert.equal(R.num(''),null);assert.equal(R.num('-'),null);assert.equal(R.num('0'),0);});
test('fresh high event signal blocks new entries pending review',()=>{const x=structuredClone(m);Object.assign(x.global_context,{risk_method_version:2,risk_data_incomplete:false,risk_analysis:{global_war:{level:'高',usable:true,evidence:[{title:'媒體報導待查核'}]}}});const r=R.assess(x,'2330',{cutoff,live:live(),now});assert.equal(r.eligible,false);assert(r.blocks.some(b=>b.includes('重大事件')));});
test('incomplete event data cannot add positive macro points',()=>{const x=structuredClone(m);Object.assign(x.global_context,{risk_method_version:2,risk_data_incomplete:false});const complete=R.assess(x,'2330',{cutoff,live:live(),now});x.global_context.risk_data_incomplete=true;const incomplete=R.assess(x,'2330',{cutoff,live:live(),now});assert(incomplete.score<complete.score);});
test('old high signal does not claim a fresh confirmed event',()=>{const x=structuredClone(m);Object.assign(x.global_context,{updated_at:'2025-01-01T00:00:00Z',risk_method_version:2,risk_data_incomplete:false,risk_analysis:{global_war:{level:'高',usable:true,evidence:[{}]}}});const r=R.assess(x,'2330',{cutoff,live:live(),now});assert(!r.blocks.some(b=>b.includes('重大事件')));assert(r.notes.some(n=>n.includes('過期')));});
test('current wall clock overrides a saved trading-phase flag',()=>{const s=snap(),closed=new Date(date+'T15:10:00+08:00');s.generated_at=closed.toISOString();Object.values(s.quotes).forEach(q=>q.timestamp=closed.toISOString());assert.equal(R.scan(m,s,closed).candidates.length,0);});
console.log(count+' risk regressions passed');


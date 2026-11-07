/* Long-cycle research stays independent of individual-stock screening. */
(function(root){
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=(v,d=2)=>Number.isFinite(v)?v.toLocaleString('zh-TW',{maximumFractionDigits:d,minimumFractionDigits:d}):'—';
let current=null;
const el=id=>document.getElementById(id);
function chart(){
 if(!current?.daily?.length)return;
 const monthly={};for(const r of current.daily)if(r.date<=current.analysis.complete_month_end)monthly[r.date.slice(0,7)]=r;
 const rows=Object.values(monthly), dd=el('cycleChartMode').value==='drawdown';if(!rows.length)return;
 let peak=0;const vals=rows.map(r=>{peak=Math.max(peak,r.close);return dd?100*(r.close/peak-1):Math.log(r.close);});
 const low=Math.min(...vals),high=Math.max(...vals),y=v=>235-(v-low)/(high-low||1)*205;
 const points=vals.map((v,i)=>(64+i/(vals.length-1)*810).toFixed(1)+','+y(v).toFixed(1)).join(' ');
 let ticks='';for(let i=0;i<=4;i++){const v=low+(high-low)*i/4,yy=y(v);ticks+='<line x1="64" x2="874" y1="'+yy+'" y2="'+yy+'" stroke="#30465c"/><text x="55" y="'+(yy+4)+'" text-anchor="end">'+(dd?n(v,0)+'%':n(Math.exp(v),0))+'</text>';}
 for(const year of [1990,2000,2010,2020]){const i=rows.findIndex(r=>r.date.startsWith(year+'-'));if(i>=0)ticks+='<text x="'+(64+i/(rows.length-1)*810)+'" y="260">'+year+'</text>';}
 ticks+='<text x="874" y="260" text-anchor="end">'+esc(rows.at(-1).date.slice(0,7))+'</text>';
 el('cycleChart').innerHTML='<svg viewBox="0 0 900 275" role="img" aria-label="1990起台股已完成月資料'+(dd?'回撤':'對數價格')+'走勢"><title>官方月末收盤；本月未完成不納入；無未來預測線</title>'+ticks+'<polyline points="'+points+'" fill="none" stroke="'+(dd?'#ff8795':'#60e1c4')+'" stroke-width="2"/></svg>';
}
function table(headers,rows){return '<div class="scroll"><table><thead><tr>'+headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+esc(c)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
function use(data){
 if(!data?.analysis||!Array.isArray(data.daily))return;
 if(current&&current.daily.length>data.daily.length)return;
 if(current&&current.daily.length===data.daily.length&&current.generated_at>data.generated_at)return;
 current=data;const a=data.analysis,c=a.coverage;
 el('cycleStatus').textContent='台股加權價格指數（證交所＋Yahoo Finance）｜'+c.start+'～'+c.end+'｜'+c.daily_rows+'筆日資料｜完整月份 '+c.complete_months+'/'+c.expected_complete_months+'｜系統整理 '+data.generated_at;
 if(a.status==='incomplete'){
  el('cycleConclusion').textContent=a.conclusion;
  el('cycleMetrics').textContent='缺少月份：'+c.missing_months.join('、');
  for(const id of ['cycleChart','cycleHypotheses','cycleBacktest','cycleHistory','cycleWindows','cycleScenarios'])el(id).innerHTML='';return;
 }
 el('cycleConclusion').innerHTML='<strong>'+esc(a.conclusion)+'</strong><p>康波判定：樣本不足，不能確認目前處於春、夏、秋或冬，也不能推算下一次崩盤或大底年份。長期大盤研究不直接改寫個股買進分數。</p>';
 const stats=[['最新已取得收盤',n(a.latest.close)+' 點',a.latest.date],['價格年化報酬',n(a.price_cagr_pct)+'%',n(a.years)+'年；不含股息與通膨'],['樣本日收盤最大回撤',n(a.max_drawdown.pct)+'%',a.max_drawdown.peak_date+'→'+a.max_drawdown.trough_date],['前高收復日',a.max_drawdown.recovery_date||'尚未收復','以日收盤比較；非盤中極值'],['24／60月均線',n(a.trend.ma24,0)+'／'+n(a.trend.ma60,0),a.complete_month_end+'已完成月'],['本月迄今漲跌',n(a.trend.current_month_change_pct)+'%','對比前月底；本月尚未完成']];
 el('cycleMetrics').innerHTML=stats.map(([label,value,note])=>'<div><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong><small>'+esc(note)+'</small></div>').join('');
 el('cycleHypotheses').innerHTML=table(['假設週期','實際觀察圈數','樣本內R²','1990起擬合','1995起擬合','2000起擬合'],a.hypotheses.map(h=>[h.period_years+'年',n(h.observed_cycles),n(h.r2_in_sample,3),...h.endpoint_sensitivity.map(s=>s.direction)]));
 el('cycleBacktest').innerHTML=table(['預測距離','非重疊測試次數','不變價格基準','單純時間趨勢','40年假說','50年假說','60年假說'],a.walk_forward.map(b=>[b.horizon_months+'個月',b.origins,...['last','trend','40','50','60'].map(k=>n(b.mae[k]))]));
 el('cycleHistory').innerHTML=table(['觀察區段','計算起訖','價格漲跌','區段內最大回撤'],a.decades.map(d=>[d.label,d.start+'～'+d.end,n(d.price_change_pct)+'%',n(d.drawdown.pct)+'%']));
 el('cycleWindows').innerHTML=table(['持有期間','重疊窗數','歷史P10','歷史中位數','歷史P90','歷史負報酬窗比例'],a.historical_return_windows.map(w=>[w.months+'個月',w.overlapping_windows,...[w.p10,w.median,w.p90,w.negative_frequency_pct].map(v=>n(v)+'%')]));
 const t=a.trend;
 el('cycleScenarios').innerHTML=table(['未來1–3年情境','可觀測的確認條件','使情境失效的條件','長期解讀'],[
 ['趨勢延續','完成月收盤持續站上24月與60月均線，24月均線上彎','月收盤跌破24月均線且持續轉弱','只支持價格擴張情境；仍需獲利與估值確認，不能等同康波新春'],
 ['高檔整理／轉折','24月與60月訊號不一致，或反覆跌破再站回','兩條長期均線同向並獲價格確認','可能是估值消化或結構轉換；不指定哪年結束'],
 ['長期收縮','月收盤低於24月與60月均線，24月均線下彎','價格重回兩條長期均線且斜率轉正','警惕較深回撤；低點時間不能由50年公式推算']
 ])+'<p>目前最近完整月收盤 '+n(t.close)+' 點，24月線 '+n(t.ma24)+' 點、60月線 '+n(t.ma60)+' 點；24月均線較6個月前 '+n(t.ma24_slope_6m_pct)+'%。這些是追蹤門檻，會隨月份更新，不是固定目標價。</p>';
 el('cycleSources').textContent='資料來源：證交所 '+(data.source_counts?.TWSE||0)+' 筆；Yahoo Finance '+(data.source_counts?.['Yahoo Finance']||0)+' 筆。已取得的證交所歷史與近期報表優先；其餘時段採Yahoo原始收盤，未使用還原收盤。重疊來源核對：'+(data.source_overlap_verification?.overlap_rows||0)+' 筆，差異超過0.05點 '+(data.source_overlap_verification?.discrepancies_over_005||0)+' 筆，重疊日期優先保留證交所。';
 el('cycleLimitations').innerHTML=a.limitations.map(s=>'<li>'+esc(s)+'</li>').join('')+(data.fetch_errors?.length?'<li>最近抓取未完全成功，保留原始資料；請核對上方實際截止日。</li>':'');
 chart();
}
root.JCLong={use,chart};
if(typeof document!=='undefined'){
 el('cycleChartMode')?.addEventListener('change',chart);
 fetch('data/longterm.json?v=2.7.0&t='+Date.now(),{cache:'no-store'}).then(r=>{if(!r.ok)throw Error(r.status);return r.json();}).then(use).catch(()=>{if(!current)el('cycleStatus').textContent='長期資料未載入。請確認已上傳data/longterm.json；不使用短期資料假造1990歷史。';});
}
})(typeof window==='undefined'?globalThis:window);

'use strict';
const $ = id => document.getElementById(id);
const statuses = {out_of_stock:'缺貨',in_stock:'來源有貨',preorder:'預購',backorder:'接受候補',discontinued:'已停產',unknown:'庫存待核實'};
let snapshot = null, filter = 'all', poll = null;
let currentMode='rankings',lastListMode='rankings';
let returnPoint=null,renderedRoute=null;
let ticketFilter='upcoming_sales';
let rankingSource='all';
let rankingCategory='all',rankingCountry='all',rankingPeriod='all',rankingSearch='',rankingPage=1;
let trackingCategory='all',trackingRegion='all',trackingPage=1;
const countryName=value=>({TW:'台灣',JP:'日本',US:'美國',KR:'韓國',CA:'加拿大',AU:'澳洲',DE:'德國',GB:'英國',unknown:'地區未核實'}[value]||value);
const rankLabel=e=>e.rank==null?'原榜位置 '+e.source_position:'第 '+e.rank+' 名';
const chartCategory=c=>c.category_group||(c.source_id==='capa-yodobashi-compact'?'相機／光學':'書籍');
const chartStale=c=>c.stale||!Number.isFinite(Date.parse(c.fetched_at))||Date.parse(c.fetched_at)>Date.now()||Date.now()-Date.parse(c.fetched_at)>=(c.freshness_seconds||3600)*1000;
const itemCategory=i=>i.category||((i.source_id==='adafruit'||i.source==='Adafruit')?'電子零件／開發板':i.source_id==='hanchor'?'包袋／戶外':i.source_id==='canon-tw'?'相機／光學':'未分類');
function scopeSelect(container,id,label,values,current,onChange){const wrap=el('label',undefined,'scope-select');wrap.append(el('span',label));const select=el('select');select.id=id;for(const value of ['all',...new Set(values)]){const option=el('option',value==='all'?'全部':id.includes('country')||id.includes('region')?countryName(value):value);option.value=value;select.append(option);}select.value=current;select.addEventListener('change',()=>onChange(select.value));wrap.append(select);container.append(wrap);}
const publicStatic=()=>snapshot?.publication?.mode==='static';
const time = value => value ? new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)) : '尚未取證';
const stamp=value=>value?new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)):'未取證';
function el(tag, text, cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
function link(title,url){const a=el('a',title);try{const u=new URL(url);if(u.protocol!=='https:')return el('span','來源網址待核實');a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';}catch{return el('span','來源網址待核實');}return a;}
function say(text,error=false){$('feedback').textContent=text;$('feedback').classList.toggle('error',error);}
function currentStock(item){const at=Date.parse(item.fetched_at),failed=(snapshot?.source_runs||[]).some(r=>r.source_id===(item.source_id||'adafruit')&&['failed','blocked'].includes(r.status)&&Date.parse(r.finished_at)>=at);return item.stale||!Number.isFinite(at)||at>Date.now()||Date.now()-at>=3600000||failed?'unknown':item.stock;}
function historyNote(item){return item.shortage_history?.status==='evidenced'?'曾觀測缺貨；後來有貨、預購或未知仍保留此事實。觀測點不代表起始日，兩點之間未知。':'尚無已驗證缺貨；日本供貨公告與本地庫存分開。';}
function purchaseSummary(item,entry,chart){
 const section=el('section',undefined,'purchase-summary');section.setAttribute('aria-label','可購狀態與下一步');
 const policy=item.source_verification,official=policy?.official_source==='verified';
 const current=currentStock(item),state=current==='unknown'?'needs_refresh':current==='out_of_stock'?'out_of_stock':item.purchasable_verified?'verified':'unverified';section.dataset.state=state;
 section.append(el('h3',state==='needs_refresh'?'目前庫存未知':state==='out_of_stock'?'此規格缺貨':state==='verified'?'可購條件已核實':'可購狀態待核實'));
 if(state==='needs_refresh')section.append(el('p','先確認最新庫存 · 舊觀測仍保留','purchase-next'));
 section.append(el('p',`${item.region==='TW'?'台灣 TW':item.region} · ${item.color||'顏色未提供'} · SKU ${item.sku||item.variant_id}`,'purchase-identity'));
 section.append(link(official?'查看官方最新狀態 ↗':'查看來源最新狀態 ↗',item.url));
 if(chart)section.append(el('p',`${chart.country==='JP'?'日本':chart.country}榜第 ${entry.rank} 名 · ${chart.period_label}`,'purchase-ranking'));
 const facts=el('dl');const add=(name,value)=>facts.append(el('dt',name),el('dd',value));
 add('庫存觀測',`${statuses[item.stock]||'未知'} · ${stamp(item.fetched_at)}${item.stale?' · 已過期，非目前保證':''}`);
 add('官方來源',official?policy.operator:item.official_dispatch==='verified'?item.source+' · 品牌來源已核實':'身份待核實');
 add('實際出貨方',item.official_dispatch==='verified'?'已核實 · 依來源政策':'未明示／待核實');
 add('配送地區',item.taiwan_shipping==='verified'?'已核實':policy?'未明示；地址／離島待核實':'配送及地址待核實');
 section.append(facts);
 if(policy)section.append(el('p',`來源／政策查核 ${stamp(policy.checked_at)} · 台灣時間`,'tiny'));
 section.append(el('p',state==='needs_refresh'?'先查看來源的最新庫存；價格與上榜不等於現貨。':state==='out_of_stock'?'補貨時間未公告；來源頁面僅供查核。':'出貨與配送未核實前，不提供可購保證。','purchase-next'));
 return section;
}
function card(item){
 const c=el('article',undefined,'card');const top=el('div',undefined,'card-top');
 top.append(el('span','● '+(currentStock(item)==='unknown'?'目前庫存未知':statuses[item.stock]||'庫存待核實'),'status '+currentStock(item)),el('span',item.source,'tiny'));c.append(top,el('div','◇','symbol'));
 const b=el('div',undefined,'card-body');b.append(el('h3',item.title),el('p',item.variant,'variant'),el('p',item.demand.label,'muted'));
 if(item.shortage_history?.first_shortage_observed_on)b.append(el('p',item.shortage_history.first_shortage_observed_on+' 首次觀測缺貨','pill'));
 if(item.related_supply_history?.length)b.append(el('p','日本型號供貨紀錄 '+item.related_supply_history.length,'pill'));
 const number=Number(item.price);b.append(el('p',item.price&&Number.isFinite(number)?`${item.currency||'幣別待核實'} ${number.toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2})}`:'價格待核實','price'));
 const checks=el('div',undefined,'checks');checks.append(el('span',item.official_dispatch==='verified'?'✓ 品牌官方出貨':'○ 品牌／出貨待核實','check'+(item.official_dispatch==='verified'?'':' pending')),el('span',item.taiwan_shipping==='verified'?'✓ 可寄台灣':item.taiwan_shipping==='policy_only'?'○ 台灣商店 · 配送待確認':'○ 寄台灣待核實','check pending'));b.append(checks);
 b.append(link(item.official_dispatch==='verified'?'↗ 查看品牌官方商品':'↗ 查看來源商品',item.url),el('p',`取證 ${time(item.fetched_at)} · ${item.region} 市場`,'tiny'));
 if(item.change)b.append(el('p','↗ 兩次觀測間狀態有變化','status'));
 const detailButton=el('button','→ 追蹤詳頁','detail-button');detailButton.dataset.returnKey='tracking:'+item.key;detailButton.addEventListener('click',()=>navigate('product/'+encodeURIComponent(item.key),{key:detailButton.dataset.returnKey,label:'熱銷追蹤'}));b.append(detailButton);
 const detail=el('details');detail.append(el('summary','來源與觀測歷史'));
 detail.append(el('p',item.shipping_note,'muted'),el('p',item.stock_note,'muted'),el('p','補貨時間：未公告／未知','muted'));
 const evidence=el('div',undefined,'evidence');for(const [k,title] of [['stock','庫存依據'],['dispatch','出貨政策'],['terms','來源條款']])evidence.append(link(title,item.evidence[k].url));evidence.append(link('探索依據',item.demand.evidence.url));if(item.evidence.identity)evidence.append(link('官方經營身份',item.evidence.identity.url));detail.append(evidence);
 if(item.demand.evidence.published_date)detail.append(el('p',`需求線索發布 ${item.demand.evidence.published_date} · 與庫存取證分開`,'tiny'));
 detail.append(el('p',`庫存證據：${item.stock_raw||'未知'} · 原始擷取 ${item.fetched_at}`,'tiny'),el('p',`SHA-256 ${item.evidence.stock.sha256}`,'tiny'));
 const history=el('div',undefined,'history');for(const h of item.history||[])history.append(el('p',`${time(h.fetched_at)}　${statuses[h.stock]||'未知'}${h.evidence_integrity?.stock_proof==='incomplete'?'（舊佐證不完整）':''}`,'tiny'));detail.append(history);b.append(detail);c.append(b);return c;
}
function render(){
 if(!snapshot)return;const items=(snapshot.items||[]).filter(x=>x.shortage_history?.status==='evidenced');const run=snapshot.latest_run;
 $('count').textContent=new Set(items.map(x=>x.source+':'+x.product_id)).size;$('shortage').textContent=items.filter(x=>currentStock(x)==='out_of_stock').length;$('verified').textContent=items.filter(x=>currentStock(x)==='in_stock'&&x.purchasable_verified).length;$('queue-count').textContent=(snapshot.candidate_queue||[]).length;
 $('freshness').textContent=run?`最近執行 ${time(run.finished_at)}`:'尚未執行來源查核';
 $('scope').textContent='本次更新 Canon 台灣 · 單次 1 型號 · 1 小時快取';
 if(publicStatic()){$('freshness').textContent='發布快照 '+stamp(snapshot.publication.built_at);$('scope').textContent='只讀快照 · 不執行網站爬取；庫存依原觀測時間判斷';}
 const quality=snapshot.data_quality||{},qualityCounts=snapshot.history_evidence_summary||{};
 $('audit-state').textContent=quality.status==='failed'?'整體稽核 failed':quality.status==='passed'?'整體稽核通過':'尚未稽核';
 $('audit-state').classList.toggle('error',quality.status==='failed');$('quality-verified').textContent=`可驗缺貨觀測 ${qualityCounts.stock_observations||0} 筆`;$('quality-excluded').textContent=`歷史證據缺失 ${qualityCounts.unverifiable_stock_records||0} 筆 · 已排除`;
 $('quality-note').textContent=`缺失紀錄保留，不計入已驗歷史；其餘可驗資料持續顯示。${quality.audited_at?'稽核 '+time(quality.audited_at):''}`;
 const taxonomy=$('tracking-scopes');taxonomy.replaceChildren();scopeSelect(taxonomy,'tracking-category','品類',[...items.map(itemCategory),'包袋／戶外'],trackingCategory,v=>{trackingCategory=v;trackingPage=1;render();$('tracking-category').focus();});scopeSelect(taxonomy,'tracking-region','觀測地區',[...items.map(i=>i.region),'unknown'],trackingRegion,v=>{trackingRegion=v;trackingPage=1;render();$('tracking-region').focus();});
 const q=$('search').value.trim().toLocaleLowerCase();const selected=items.filter(x=>(trackingCategory==='all'||itemCategory(x)===trackingCategory)&&(trackingRegion==='all'||x.region===trackingRegion)&&(!q||(x.title+' '+x.variant).toLocaleLowerCase().includes(q))&&(filter==='all'||filter==='purchasable'&&currentStock(x)==='in_stock'&&x.purchasable_verified||filter==='unknown'&&(currentStock(x)==='unknown'||x.taiwan_shipping!=='verified')||currentStock(x)===filter));
 const pages=Math.max(1,Math.ceil(selected.length/8));trackingPage=Math.min(trackingPage,pages);
 $('tracking-result-count').textContent='符合 '+selected.length+' 個規格 · 第 '+trackingPage+'／'+pages+' 頁；目前庫存與曾缺貨分開。';
 const cards=$('cards');cards.replaceChildren();for(const item of selected.slice((trackingPage-1)*8,trackingPage*8))cards.append(card(item));
 const pager=$('tracking-pages');pager.replaceChildren();if(pages>1){for(const [label,step] of [['← 上一頁',-1],['下一頁 →',1]]){const b=el('button',label);b.dataset.trackingPage=step;b.disabled=trackingPage+step<1||trackingPage+step>pages;b.addEventListener('click',()=>{trackingPage+=step;render();const focus=pager.querySelector('[data-tracking-page="'+step+'"]');(focus?.disabled?pager.querySelector('button:not(:disabled)'):focus)?.focus();$('tracking-result-count').scrollIntoView?.({block:'start'});});pager.append(b);}}
 if(!selected.length){const empty=el('div',undefined,'empty');empty.append(el('strong',items.length?'目前沒有符合的商品':'等待第一筆官方觀測'),el('p',filter==='purchasable'?'只有庫存、官方出貨與台灣配送都核實，才會出現在這裡。':'可調整篩選，或按「查核來源」取得真實資料。','muted'));cards.append(empty);}
 $('coverage').textContent=snapshot.coverage.region+'。'+snapshot.coverage.demand+'。';$('gaps').textContent='尚未覆蓋：'+snapshot.coverage.gaps.join('、')+'。';
 $('tracking-window').textContent=snapshot.tracking_window?`${snapshot.tracking_window.start_date} 至 ${snapshot.tracking_window.end_date} · 只計已取證缺貨`:'僅列出已取得近兩年缺貨證據的規格';
 renderRankings();renderRoute(typeof location==='undefined'?currentMode:location.hash.slice(1)||'rankings');
 renderEncore();
 renderModelHistory();
 const reviewed=$('source-review-content');reviewed.replaceChildren();for(const item of (snapshot.items||[]).filter(x=>x.source_id==='hanchor'&&x.shortage_history?.status!=='evidenced')){const row=el('div',undefined,'source-state');row.append(el('strong',item.title),el('p',item.variant+' · '+(statuses[item.stock]||'待核實'),'muted'));const button=el('button','查看規格 →','detail-button');button.addEventListener('click',()=>navigate('product/'+encodeURIComponent(item.key)));row.append(button);reviewed.append(row);}
 $('queue').replaceChildren();if(!snapshot.candidate_queue.length)$('queue').append(el('p','還沒有 AI／研究線索。','muted'));
 for(const item of snapshot.candidate_queue.slice(0,3)){const n=el('div',undefined,'queue-item');n.append(el('strong',item.title),el('p',item.kind==='reported_demand'?'媒體需求線索 · 庫存待核實':item.kind==='official_editorial'?'官方精選線索 · 需求與庫存待核實':'探索線索 · 官方身份與庫存待核實','muted'));if(item.published_date)n.append(el('p',`發布 ${item.published_date}`,'tiny'));n.append(link('探索依據',item.source_url));$('queue').append(n);}
 if(snapshot.candidate_queue.length>3)$('queue').append(el('p',`另有 ${snapshot.candidate_queue.length-3} 項候選，完整清單保留在本機。`,'muted'));
 const running=snapshot.job?.status==='running';$('collect').disabled=running;$('collect').textContent=running?'Canon 更新中…':'↻ 更新 Canon 觀測';$('collect').title=running?'Canon 單次限速查核中，完成後可再次操作':'Canon 台灣官方 · 單次 1 型號；1 小時快取，不強制重抓';
 if(running){say('正在查核官方來源；依來源限速，可能需要數分鐘。');if(poll)clearTimeout(poll);poll=setTimeout(load,2000);}
 else if(poll){clearTimeout(poll);poll=null;const result=snapshot.job?.result;if(result){const success=result.status==='success';say(success?result.new_observations?`Canon 更新完成 · 新增 ${result.new_observations} 筆規格觀測；出貨與配送另行核實。`:'Canon 查核完成 · 沿用有效快取，原觀測時間與歷史筆數不變。':'Canon 來源查核失敗 · 保留最後成功觀測；目前狀態待核實。',!success);}}
 else if(snapshot.history_evidence_summary?.unverifiable_stock_records)say(`${snapshot.history_evidence_summary.unverifiable_stock_records} 筆舊紀錄缺佐證，已排除於驗證歷史；詳頁保留缺口。`,true);
 else if((snapshot.source_runs||[run]).some(r=>r&&['failed','blocked','partial'].includes(r.status)))say('最近查核有來源失敗；下列卡片保留最後成功取證。',true);
 else if(run?.mode==='offline_replay')say('目前顯示先前真實取證的離線重播，並非新的網路查核。');
 if(publicStatic()){$('collect').disabled=false;$('collect').textContent='↻ 重新讀取快照';$('collect').title='只重新讀取已發布的資料，不更新官方庫存';}
}
function navigate(target,opener=null){
 if((target.startsWith('product/')||target==='tickets')&&['rankings','tracking'].includes(currentMode)){
  const key=opener?.key||document.activeElement?.dataset?.returnKey||null;
  const control=[...document.querySelectorAll('[data-return-key]')].find(n=>n.dataset.returnKey===key)||document.activeElement;
  returnPoint={mode:currentMode,key,label:opener?.label||(currentMode==='tracking'?'熱銷追蹤':'熱銷排行'),chartId:opener?.chartId||null,anchorTop:control?.getBoundingClientRect?.().top??null,width:typeof window==='undefined'?0:window.innerWidth,height:typeof window==='undefined'?0:window.innerHeight};
 }
 if(typeof location!=='undefined')location.hash=target;renderRoute(target,true);
}
function focusRoute(){
 if(typeof window==='undefined')return;
 if(currentMode==='product'){
  const heading=$('product-content').querySelector('h2');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}$('product-mode').scrollIntoView({block:'start',behavior:'instant'});return;
 }
 if(currentMode==='tickets'){const section=$('tickets-mode');section.scrollIntoView({block:'start',behavior:'instant'});section.querySelector('h2').focus({preventScroll:true});return;}
 const opener=returnPoint?.mode===currentMode?[...document.querySelectorAll('[data-return-key]')].find(n=>n.dataset.returnKey===returnPoint.key):null;
 if(opener){opener.focus({preventScroll:true});if(window.innerWidth===returnPoint.width&&window.innerHeight===returnPoint.height&&Number.isFinite(returnPoint.anchorTop))window.scrollTo({top:window.scrollY+opener.getBoundingClientRect().top-returnPoint.anchorTop,left:0,behavior:'instant'});else opener.scrollIntoView({block:'center',behavior:'instant'});}
 else{const section=$(currentMode==='tracking'?'tracking-mode':'ranking-mode');section.scrollIntoView({block:'start',behavior:'instant'});const heading=section.querySelector('h2');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}}
}
function renderRankings(){
 const container=$('ranking-content');container.replaceChildren();const charts=(snapshot.rankings||[]).map(c=>({...c,stale:chartStale(c)}));
 const scopes=$('ranking-scopes');scopes.replaceChildren();
 const change=(key,value)=>{if(key==='category')rankingCategory=value;if(key==='country')rankingCountry=value;if(key==='period')rankingPeriod=value;rankingSource='all';rankingPage=1;rankingSearch='';renderRankings();$('ranking-'+key)?.focus?.();say('已篩選榜單；保留原地區、期間與口徑。');};
 scopeSelect(scopes,'ranking-category','品類',[...charts.map(chartCategory),'包袋／戶外'],rankingCategory,v=>change('category',v));scopeSelect(scopes,'ranking-country','地區',[...charts.map(c=>c.country),'KR'],rankingCountry,v=>change('country',v));scopeSelect(scopes,'ranking-period','期間',charts.map(c=>c.period_label),rankingPeriod,v=>change('period',v));
 const filtered=charts.filter(c=>(rankingCategory==='all'||chartCategory(c)===rankingCategory)&&(rankingCountry==='all'||c.country===rankingCountry)&&(rankingPeriod==='all'||c.period_label===rankingPeriod));
 if(rankingSource!=='all'&&!filtered.some(c=>c.source_id===rankingSource))rankingSource='all';
 const controls=$('ranking-filters');controls.replaceChildren();
 const choose=id=>{rankingSource=id;rankingPage=1;rankingSearch='';renderRankings();$('ranking-content').scrollIntoView?.({block:'start'});$('ranking-content').querySelector('h3')?.focus?.();};
 const all=el('button','榜單目錄 '+filtered.length);all.dataset.rankingSource='all';all.addEventListener('click',()=>choose('all'));controls.append(all);
 $('ranking-source-count').textContent=charts.length+' 份真榜 · '+charts.reduce((n,c)=>n+c.entries.length,0)+' 個來源榜項';
 if(rankingSource==='all'){
  for(const c of filtered){const panel=el('article',undefined,'chart chart-index');panel.append(el('h3',c.source_name+' · '+c.chart_name),el('p',countryName(c.country)+' · '+c.category+' · '+c.period_label,'muted'),el('p',c.entries.length+' 項 · '+(c.stale?'資料過期':'來源已取證'),'tiny'));const b=el('button','開啟榜單 →');b.dataset.rankingSource=c.source_id;b.addEventListener('click',()=>choose(c.source_id));panel.append(b);container.append(panel);}
  if((rankingCountry==='all'||rankingCountry==='KR')&&(rankingCategory==='all'||rankingCategory==='包袋／戶外')){const missing=el('article',undefined,'chart chart-index pending-source');missing.append(el('h3','MUSINSA 韓國男士側背包'),el('p','待取得允許來源 · 尚未接入','pill'),el('p','既有自動存取限制保留；性別、側背包分類與真期間待核實。不是其他男裝或女包榜。','muted'));container.append(missing);}
  if(!filtered.length)container.append(el('p','此條件尚無已接入真榜。','empty'));
 }else{
  const chart=filtered.find(c=>c.source_id===rankingSource),panel=el('article',undefined,'chart');const heading=el('h3',chart.source_name+' · '+chart.chart_name);heading.tabIndex=-1;panel.append(heading,el('p',countryName(chart.country)+' · '+chart.category+' · '+chart.period_label,'pill'),el('p','來源更新 '+stamp(chart.source_updated_at)+' · 取得 '+stamp(chart.fetched_at)+(chart.stale?' · 已過期':''),'tiny'));
  const search=el('input');search.id='ranking-item-search';search.type='search';search.placeholder='在這份榜找商品';search.setAttribute('aria-label','在所選榜單搜尋商品');search.value=rankingSearch;search.addEventListener('input',()=>{rankingSearch=search.value;rankingPage=1;const at=search.selectionStart;renderRankings();const next=$('ranking-item-search');next.focus();next.setSelectionRange?.(at,at);});panel.append(search);
  const entries=chart.entries.filter(e=>(e.title+' '+(e.brand||'')).toLocaleLowerCase().includes(rankingSearch.toLocaleLowerCase())),pages=Math.max(1,Math.ceil(entries.length/10));rankingPage=Math.min(rankingPage,pages);panel.append(el('p',entries.length+' 項 · 第 '+rankingPage+'／'+pages+' 頁 · 保留原榜位置','tiny'));
  for(const entry of entries.slice((rankingPage-1)*10,rankingPage*10)){
   const row=el('div',undefined,'rank-row'),number=el('span',(entry.rank==null?'序 ':'')+String(entry.rank??entry.source_position).padStart(2,'0'),'rank-no');row.append(number);const text=el('div');text.append(el('h3',entry.title),el('p',entry.product_kind==='digital'?'數位商品 · 不作實體缺貨證據':(entry.linked_variants||[]).some(v=>v.shortage_status==='evidenced')?'同型號有已驗規格 · 分市場核對':'缺貨歷史待核實','tiny'));const open=el('button','查看詳頁 →','detail-button');open.dataset.returnKey='ranking:'+chart.source_id+':'+entry.identity_key;open.setAttribute('aria-label',rankLabel(entry)+' '+entry.title);open.addEventListener('click',()=>navigate('product/'+encodeURIComponent(entry.identity_key),{key:open.dataset.returnKey,label:rankLabel(entry),chartId:chart.source_id}));row.append(text,open);panel.append(row);
  }
  if(!entries.length)panel.append(el('p','此榜沒有符合的商品。','empty'));
  const pagination=el('div',undefined,'pagination');for(const [label,delta] of [['上一頁',-1],['下一頁',1]]){const b=el('button',label);b.disabled=delta<0?rankingPage===1:rankingPage===pages;b.dataset.rankingPage=String(delta);b.addEventListener('click',()=>{rankingPage+=delta;renderRankings();$('ranking-content').scrollIntoView?.({block:'start'});});pagination.append(b);}panel.append(pagination);
  const basis=el('details');basis.append(el('summary','來源方法與範圍'),el('p',chart.ranking_basis,'muted'),el('p',chart.rank_semantics||'原榜明確數字名次','tiny'),el('p',chart.coverage,'tiny'),el('p',chart.variant_aggregation,'tiny'));panel.append(link('查看原榜',chart.source_url),basis);container.append(panel);
 }
 const states=$('ranking-status');states.replaceChildren();for(const source of snapshot.ranking_source_status||[]){const box=el('div',undefined,'source-state');box.append(el('strong',source.source),el('p',source.reason,'muted'),link('來源狀態依據',source.url));states.append(box);}
}
function renderRoute(target,announce=false){
 if(!snapshot)return;const detail=target.startsWith('product/');currentMode=detail?'product':target==='tickets'?'tickets':target==='tracking'?'tracking':'rankings';if(['rankings','tracking'].includes(currentMode))lastListMode=currentMode;
 $('ranking-mode').hidden=currentMode!=='rankings';$('tracking-mode').hidden=currentMode!=='tracking';$('product-mode').hidden=!detail;
 $('tickets-mode').hidden=currentMode!=='tickets';$('tickets-back').textContent='← 返回'+(lastListMode==='tracking'?'熱銷追蹤':'熱銷排行');
 for(const name of ['rankings','tracking']){const active=currentMode===name||(detail||currentMode==='tickets')&&lastListMode===name;$('mode-'+name).classList.toggle('selected',active);$('mode-'+name).setAttribute('aria-pressed',String(active));}
 if(detail){let key;try{key=decodeURIComponent(target.slice(8));}catch{key='';}renderProduct(key);}
 renderedRoute=target;
 if(announce){say(detail?'已開啟商品追蹤詳頁':currentMode==='tickets'?'已開啟 Encore 開賣時間':currentMode==='tracking'?'已切換：熱銷追蹤':'已切換：熱銷排行');focusRoute();}
}
function encoreRows(live){
 const table=live?.all_phases;if(!table)return live?.phase_rows||[];
 if(table.version!==1||!Array.isArray(table.keys)||!Array.isArray(table.strings)||!Array.isArray(table.values)||table.values.length!==live.phase_count||table.keys.length>20)throw Error('Invalid full phase table');
 if(live.phase_count===0&&table.keys.length===0)return [];
 const allowed=['title','category','kind','label','start','end','precision','status','url','observed','eligibility','stale','time_state','group'];
 if(table.keys.length!==allowed.length||new Set(table.keys).size!==allowed.length||table.keys.some(k=>!allowed.includes(k)))throw Error('Invalid phase fields');
 return table.values.map(values=>{if(values.length!==table.keys.length)throw Error('Invalid phase row');return Object.fromEntries(table.keys.map((key,i)=>{const v=values[i];if(typeof v==='number'&&(!Number.isInteger(v)||v<0||v>=table.strings.length))throw Error('Invalid phase reference');return [key,typeof v==='number'?table.strings[v]:v]}))});
}
function renderEncore(){
 const offline=snapshot.encore||{},connection=offline.connection;
 const accepted=publicStatic()?connection?.protocol==='encore-public-snapshot/1':connection?.protocol==='encore-served-read/1'&&connection.endpoint==='local-endpoint-disabled';
 const success=accepted?connection.last_success:null,attempt=accepted?connection.last_attempt:null,failed=attempt?.status==='failed';
 const live=success?.contract==='encore.sale-calendar'&&success.contract_version===1&&Array.isArray(success.phase_rows)?success:null;
 const state=publicStatic()?'Encore 發布快照 · 非即時同步':live?(failed?'正式讀取失敗 · 保留上次成功資料':'正式來源已接入 · 按次讀取'):failed?'正式讀取失敗 · 使用離線摘要':'正式來源尚未接入';
 $('encore-state').textContent=state;$('tickets-state').textContent=state;
 $('tickets-read-time').textContent=live?'最後成功讀取 '+stamp(live.received_at)+' · 時間分類以讀取時為準；按次同步，非持續監控':offline.imported_at?'離線匯入 '+stamp(offline.imported_at)+' · 無正式成功讀取':'';
 $('encore-count').textContent=live?`${live.counts.upcoming_sales} 個未來開賣 · ${live.counts.started_sales} 個已開始 · ${live.counts.registrations} 個登記`:offline.counts?`離線摘要 ${offline.counts.event_groups} 組活動`:'尚無可驗證快照';
 $('encore-time').textContent=live?`最後成功讀取 ${stamp(live.received_at)} · 非持續同步`:offline.producer_generated_at?`離線產生 ${stamp(offline.producer_generated_at)}`:'不另抓票務來源';
 $('tickets-failure').textContent=failed?`本次 ${attempt.failure_kind==='timeout'?'逾時':attempt.http_status&&attempt.http_status!==200?'HTTP '+attempt.http_status:'回應無效或無法連線'}；${live?'上次成功的 '+live.event_groups+' 組活動仍保留':'尚無正式成功快照，保留離線摘要'}。`:'';
 const counts=$('tickets-counts');counts.replaceChildren();const filters=$('ticket-filters');filters.replaceChildren();
 const labels={upcoming_sales:'未來開賣',started_sales:'已開始',registrations:'登記',ended_sales:'已截止',unknown:'時間未知',needs_review:'待核實'};
 const available=encoreRows(live);
 if(live){for(const [group,label]of Object.entries(labels)){const box=el('div');box.append(el('strong',live.counts[group]),el('span',label));counts.append(box);{const b=el('button',label+' '+live.counts[group]);b.dataset.ticketGroup=group;b.classList.toggle('selected',ticketFilter===group);b.setAttribute('aria-pressed',String(ticketFilter===group));b.addEventListener('click',()=>{const top=b.getBoundingClientRect?.().top;ticketFilter=group;renderEncore();const next=[...filters.children].find(n=>n.dataset.ticketGroup===group);next?.focus?.({preventScroll:true});if(typeof window!=='undefined'&&Number.isFinite(top))window.scrollBy(0,next.getBoundingClientRect().top-top);say('已篩選 Encore：'+label)});filters.append(b)}}
  $('tickets-coverage').textContent=`${live.event_groups} 組活動 · ${live.phase_count} 個波次；${live.unknown_event_groups} 組尚無明確波次。可查 ${available.length}／${live.phase_count} 個波次；來源覆蓋不完整。`;
 }else $('tickets-coverage').textContent=offline.counts?`離線保留 ${offline.counts.event_groups} 組活動；僅有摘要，無法逐筆分類。`:'尚無票務資料；連線失敗不代表零活動。';
 const rows=$('ticket-rows');rows.replaceChildren();
 const selected=available.filter(p=>p.group===ticketFilter);$('tickets-list-count').textContent=live?`${labels[ticketFilter]} · 顯示 ${selected.length}／${live.counts[ticketFilter]} 個波次`:'';
 const timeLabels={upcoming:'尚未到開賣時間','within-window':'公告期間內 · 票量未知','started-unknown-end':'已開始 · 截止待核',ended:'公告已截止','needs-review':'時間／精度待核',cancelled:'取消待核',unknown:'時間待核'};
 for(const p of selected){
  const row=el('article',undefined,'ticket-row');row.dataset.group=p.group;
  row.append(el('p',(p.kind==='registration'?'登記 · ':'')+(timeLabels[p.time_state]||'時間待核'),'ticket-status'),el('h3',p.title),el('p',p.label,'muted'),el('p',p.start?stamp(p.start)+' 開始':'開始時間未知','ticket-time'));
  if(p.end)row.append(el('p',stamp(p.end)+' 截止','tiny'));
  if(p.eligibility)row.append(el('p',p.eligibility,'tiny'));
  const hosts=['tixcraft.com','www.livenation.com.tw','www.opentix.life','www.farglorydome.com.tw','www.cpbl.com.tw','www.wdragons.com','kktix.com'];
  try{const u=new URL(p.url);if(u.protocol==='https:'&&!u.port&&!u.username&&!u.password&&hosts.includes(u.hostname))row.append(link('查看官方公告 ↗',u.href));}catch{}
  row.append(el('p','來源查核 '+stamp(p.observed),'tiny'));rows.append(row);
 }
 if(!rows.children.length)rows.append(el('p',live&&live.counts[ticketFilter]?'此分類未納入本機精簡列表；完整證據已封存。':'此快照沒有可顯示的波次。','empty'));
 const proof=$('tickets-provenance');proof.replaceChildren();
 if(live){proof.append(el('p','最後成功讀取 '+stamp(live.received_at)),el('p','Encore 產生快照 '+stamp(live.producer_generated_at)),el('p','原始來源查核 '+stamp(live.source_verified_range.oldest)+' 至 '+stamp(live.source_verified_range.newest)),el('p','時間分類於 '+stamp(live.classification_at)+'；已開始不等於仍有票。','tiny'),el('p','SHA-256 '+live.source_sha256,'tiny'))}
 if(attempt)proof.append(el('p','本次讀取 '+stamp(attempt.attempted_at)+' · '+attempt.status,'tiny'));
 if(publicStatic())proof.append(el('p','Encore 發布快照 · 分類以最後讀取時間為準，非即時同步','tiny'));
 else proof.append(el('p','固定正式端點 local-endpoint-disabled','tiny'),el('p','原離線匯入 '+stamp(offline.imported_at)+' · 與正式讀取分開','tiny'));
}
function variantChoices(entry,chart){
 const box=el('section',undefined,'source-state model-variants');box.append(el('h3','同型號 · 分規格追蹤'));
 box.append(el('p',`${chart.country==='JP'?'日本':chart.country}榜 · 第 ${entry.rank} 名 · ${chart.period_label}`,'tiny'),el('p','排名與各地規格的缺貨、出貨證據分開。','muted'));
 for(const variant of entry.linked_variants||[]){
  const own=(snapshot.items||[]).find(i=>i.key===variant.key),row=el('div',undefined,'variant-choice');
  const button=el('button',`${variant.region} · ${variant.variant} →`,'detail-button');button.dataset.variantKey=variant.key;button.addEventListener('click',()=>navigate('product/'+encodeURIComponent(variant.key)));
  row.append(button,el('p',(own?.shortage_history?.status==='evidenced'?'曾觀測缺貨':'缺貨史待核實')+' · '+(own&&currentStock(own)!=='unknown'?statuses[currentStock(own)]:'目前庫存未知'),'tiny'));box.append(row);
 }
 if(!(entry.linked_variants||[]).length)box.append(el('p','尚未核實相符規格；目前庫存、官方出貨與台灣配送待查。','muted'));
 return box;
}
function renderProduct(key){
 const container=$('product-content');container.replaceChildren();const back=el('button','← 返回'+(returnPoint?.mode===lastListMode?returnPoint.label:lastListMode==='rankings'?'熱銷排行':'熱銷追蹤'));container.append(back);
 const model=(snapshot.model_history?.events||[]).find(e=>key===e.model_key||(e.current_options||[]).some(o=>key===e.model_key+':option:'+o.option_id));
 if(model){if(key===model.model_key)back.addEventListener('click',()=>navigate(lastListMode));renderModelDetail(model,key,container);return;}
 back.addEventListener('click',()=>navigate(lastListMode));
 const observed=(snapshot.items||[]).find(x=>x.key===key);let entry=null,chart=null;
 const charts=[...(snapshot.rankings||[])].sort((a,b)=>Number(b.source_id===returnPoint?.chartId)-Number(a.source_id===returnPoint?.chartId));
 for(const c of charts){const found=c.entries.find(x=>x.identity_key===key||(x.linked_variants||[]).some(v=>v.key===key));if(found){entry=found;chart=c;break;}}
 const item=observed||entry;if(!item){container.append(el('p','找不到此商品身份；請返回來源清單重新選擇。','empty'));return;}
 const panel=el('article',undefined,'product-detail');panel.append(el('p',observed?'規格追蹤':'由熱銷排行進入','eyebrow'),el('h2',item.title));
 if(entry?.product_kind==='digital'){
  panel.append(el('p',countryName(chart.country)+' · '+chart.category+' · '+rankLabel(entry),'pill'),el('p',chart.period_label,'muted'),el('p','Apple內容ID '+entry.product_id+' · '+(entry.brand||'發行者未提供'),'tiny'),el('p','數位商品；這份榜不提供實體缺貨、官方出貨或寄台灣的證明。','muted'),el('p','來源更新 '+stamp(chart.source_updated_at)+' · 取得 '+stamp(chart.fetched_at),'tiny'),link('查看來源商品 ↗',entry.reference_product_url));
  container.append(panel);return;
 }
 if(observed)panel.append(purchaseSummary(item,entry,chart));
 if(!observed&&entry?.identity_scope==='brand_model')panel.append(variantChoices(entry,chart));
 if(observed){const timeline=el('section',undefined,'history');timeline.append(el('h3','歷史觀測 · 不代表目前庫存'),el('p',historyNote(item),'muted'));for(const h of [...(item.history||[])].reverse()){const excluded=h.evidence_integrity?.stock_proof==='incomplete';timeline.append(el('p',`${stamp(h.fetched_at)} · ${statuses[h.stock]||'未知'}${excluded?' · 缺原件，已排除':''}`,'tiny'))}panel.append(timeline);}
 const facts=el('dl');const history=item.shortage_history||{status:'unverified',entries:[]};
 const add=(name,value)=>facts.append(el('dt',name),el('dd',value));add('商品身份',observed?item.variant:item.identity_scope==='storefront_item'?'Apple '+item.product_id+' · '+item.region+' 商店':item.identity_scope==='brand_model'?item.brand+' · '+item.title+' · 型號層級，顏色未拆分':'ISBN '+item.isbn);add('來源市場',observed?item.region:chart.country);if(chart)add('原榜名次',chart.source_name+' · '+chart.period_label+' · '+rankLabel(entry)+(entry.identity_scope==='brand_model'?'（日本型號榜）':''));
 if(!observed&&item.product_kind!=='digital'){add('目前庫存','官方庫存尚未核實');add('官方出貨','尚未核實');add('台灣配送','尚未核實');}if(item.product_kind==='digital')add('商品類型','數位商品；不作實體缺貨或配送判定');add('近兩年缺貨',item.product_kind==='digital'?'本榜未提供實體缺貨證據':history.status==='evidenced'?`已取證 ${history.entries.length} 次觀測`:'尚未取得證據；上榜不代表缺貨');add('觀測起點',history.coverage_start?time(history.coverage_start)+'；更早歷史未知':'尚未開始缺貨觀測');
 add('首次缺貨觀測',history.first_shortage_observed_on||'尚未觀測');add('本地規格缺貨公告',(history.evidence_counts?.dated_official_announcements||0)+' 筆已核實');add('缺貨持續時間','未知；觀測日不等於開始日');
 if(observed){add('來源價格',item.price?`${item.currency} ${Number(item.price).toLocaleString('zh-TW')}`:'待核實');add('來源取證',time(item.fetched_at)+(item.stale?' · 已過期':''));}
 if(entry)add('詳頁身份',entry.identity_scope==='brand_model'?'原榜品牌與完整型號；不同市場／SKU 分開':entry.identity_scope==='storefront_item'?'官方feed內容ID＋商店地區；未核ISBN或實體版本':entry.detail_checked?'原榜 ISBN 已與原始商品頁核對':'僅原榜 ISBN；原始詳頁尚未核對');if(observed||entry?.identity_scope==='brand_model'){const details=el('details',undefined,observed?'purchase-history':'model-facts');details.append(el('summary',observed?'缺貨證據與原始身份':'原榜身份與未核實範圍'),facts);panel.append(details);}else panel.append(facts);
 if(observed&&entry?.identity_scope==='brand_model')panel.append(variantChoices(entry,chart));
 for(const gap of history.evidence_gaps||[])panel.append(el('p',`${gap.observed_date} · 舊紀錄缺原始佐證，未計入已驗證缺貨。`,'tiny'));
 for(const event of item.related_supply_history||[]){const box=el('section',undefined,'source-state');box.append(el('h3','日本型號供貨紀錄'),el('p',`${event.published_date} · 官方確認先前曾停接單`),el('p',`${event.announcement_effective_date} · 宣布恢復接單，並非現貨保證`,'muted'),el('p','未分顏色；不作台灣 SKU 缺貨證據。開始日與結束日未知。','tiny'),link('查看日本官方公告',event.source_url),el('p',`公告取證 ${time(event.fetched_at)}`,'tiny'));panel.append(box);}
 if(observed){panel.append(link('查看來源商品頁',item.url),el('p',item.shipping_note,'muted'));for(const event of history.entries.slice(-6))panel.append(el('p',`${event.observed_date} · 庫存觀測，非歷史公告；持續時間未知`,'tiny'));}
 else{panel.append(link(entry.identity_scope==='brand_model'?'原榜型號依據':'原榜商品頁（來源參考）',entry.reference_product_url),el('p','來源排行只證明該榜排序；品牌官方出貨、台灣可購與缺貨歷史依市場及規格另查。','muted'));}
 container.append(panel);
}
function renderModelHistory(){
 const box=$('model-history-content');box.replaceChildren();const evidence=snapshot.model_history||{events:[],quality:{}};const scopedEvents=evidence.events.filter(e=>(trackingCategory==='all'||trackingCategory==='包袋／戶外')&&(trackingRegion==='all'||e.market===trackingRegion));
 $('model-history-state').textContent=evidence.quality.status==='partial'?'部分型號證據未通過查核':`${scopedEvents.length} 則型號事件 · 不計入 SKU 缺貨觀測`;
 for(const event of scopedEvents){const row=el('article',undefined,'source-state');row.append(el('h3',event.title),el('p','型號級 · 地區／顏色／尺寸未確認','pill'),el('p',event.published_date+' · 官方商店回覆當時售罄'),el('p','目前庫存、熱度、出貨與配送另行核實。','muted'));const button=el('button','查看型號歷史 →','detail-button');button.dataset.returnKey='model:'+event.model_key;button.addEventListener('click',()=>navigate('product/'+encodeURIComponent(event.model_key),{key:button.dataset.returnKey,label:'型號歷史'}));row.append(button);box.append(row);}
 if(!scopedEvents.length)box.append(el('p','尚無可驗的近兩年型號售罄事件。','muted'));
}
function renderModelDetail(event,key,container){
 const option=(event.current_options||[]).find(o=>key===event.model_key+':option:'+o.option_id);
 if(option){const old=container.children[0];old.textContent='← 返回型號歷史';old.addEventListener('click',()=>{navigate('product/'+encodeURIComponent(event.model_key));const opener=$('product-content').querySelector('[data-model-option="'+option.option_id+'"]');opener?.focus?.();opener?.scrollIntoView?.({block:'center'});});}
 const panel=el('article',undefined,'product-detail');panel.append(el('p',option?'顏色選項 · 未建立 SKU 庫存觀測':'型號級歷史 · 規格未確認','eyebrow'),el('h2',event.title+(option?' · '+option.color:'')));
 panel.append(el('p','目前庫存未知','large'),el('p','地區未確認 · 出貨／配送未確認 · 熱度未核實','muted'));
 if(option)panel.append(el('p',`選項 ${option.option_id} · 製造商 SKU 未提供；此顏色沒有已驗缺貨觀測。`),el('p','下方事件只證明型號當時售罄，不適用於此 BLACK 選項。','pill'));
 const history=el('section',undefined,'history');history.append(el('h3','型號歷史事件'),el('p',event.published_date+' · 官方商店回覆當時售罄'),el('p','證據範圍：產品／型號；地區、顏色、尺寸未指明。','muted'),el('p','這是店家回覆，不是 SKU 觀測；起始日、持續時間及停售／暫缺未知。','tiny'),link('查看官方原回覆 ↗',event.canonical_url),el('p','原件接收 '+stamp(event.evidence.received_at),'tiny'));panel.append(history);
 if(!option){panel.append(el('h3','當前頁面的選項 · 庫存另行核實'));for(const o of event.current_options||[]){const button=el('button',o.color+' · 庫存未知 →','detail-button');button.dataset.modelOption=o.option_id;button.addEventListener('click',()=>navigate('product/'+encodeURIComponent(event.model_key+':option:'+o.option_id)));panel.append(button);}}
 panel.append(el('p','來源取證通過僅限型號事件，不解除全站 failed 或驗證可買。','tiny'));container.append(panel);
}
async function load(){try{const response=await fetch('snapshot.json',{cache:'no-store'});if(!response.ok)throw Error('讀取失敗');snapshot=await response.json();render();return true;}catch{say(publicStatic()?'快照讀取失敗；保留目前畫面，可再次重試。':'無法讀取本機資料，請確認服務啟動後重新整理。',true);$('collect').disabled=false;$('collect').textContent=publicStatic()?'↻ 重試讀取快照':'↻ 重試查核';return false;}}
$('collect').addEventListener('click',async()=>{if($('collect').disabled)return;if(publicStatic()){$('collect').disabled=true;$('collect').textContent='讀取中…';say('正在讀取發布快照…');const ok=await load();if(ok)say('快照已讀取；官方庫存未重新查核。');return;}$('collect').disabled=true;$('collect').textContent='Canon 更新中…';say('已開始 Canon 台灣單次查核…');try{const r=await fetch('api/collect',{method:'POST',headers:{'X-Local-Action':'collect'}});if(r.status!==202&&r.status!==409)throw Error('啟動失敗');await load();}catch{say('無法啟動 Canon 查核。可在本機重試，或用終端 collect --source canon-tw --limit 1。',true);$('collect').disabled=false;$('collect').textContent='↻ 重試 Canon';}});
$('mode-rankings').addEventListener('click',()=>navigate('rankings'));$('mode-tracking').addEventListener('click',()=>navigate('tracking'));
for(const mode of ['rankings','tracking'])$(mode==='rankings'?'ranking-tickets':'tracking-tickets').addEventListener('click',()=>navigate('tickets',{key:'tickets:'+mode,label:mode==='rankings'?'熱銷排行':'熱銷追蹤'}));
$('tickets-back').addEventListener('click',()=>navigate(lastListMode));
$('tickets-reload').addEventListener('click',async()=>{const b=$('tickets-reload');if(b.disabled)return;b.disabled=true;b.textContent='讀取中…';$('tickets-feedback').textContent=publicStatic()?'正在讀取發布快照…':'正在讀取本機收據…';const ok=await load();b.disabled=false;b.textContent=publicStatic()?'重新讀取發布快照':'重新讀取本機收據';$('tickets-feedback').textContent=ok?(publicStatic()?'發布快照已讀取；本次未向 Encore 發出更新請求。':'本機收據已載入；本次未向 Encore 發出更新請求。'):'資料讀取失敗；保留畫面資料，可重試。';});
if(typeof history!=='undefined'&&'scrollRestoration' in history)history.scrollRestoration='manual';
if(typeof addEventListener==='function')addEventListener('hashchange',()=>{const target=location.hash.slice(1)||'rankings';if(target!==renderedRoute)renderRoute(target,true);});
$('search').addEventListener('input',()=>{trackingPage=1;render();});for(const button of document.querySelectorAll('[data-filter]'))button.addEventListener('click',()=>{filter=button.dataset.filter;trackingPage=1;for(const b of document.querySelectorAll('[data-filter]')){const selected=b===button;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));}render();});load();

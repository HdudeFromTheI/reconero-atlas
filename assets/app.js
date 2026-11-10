/* Reconero Atlas — browser UI for Supabase Auth + RLS-protected Postgres. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const CONFIG = window.RECONERO_CONFIG || {};
  const STATES = [['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],['CA','California'],['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],['DC','District of Columbia'],['FL','Florida'],['GA','Georgia'],['HI','Hawaii'],['ID','Idaho'],['IL','Illinois'],['IN','Indiana'],['IA','Iowa'],['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],['MD','Maryland'],['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],['MO','Missouri'],['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],['NH','New Hampshire'],['NJ','New Jersey'],['NM','New Mexico'],['NY','New York'],['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],['OK','Oklahoma'],['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],['VT','Vermont'],['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],['WI','Wisconsin'],['WY','Wyoming']];
  const STATUS = ['Not contacted','Attempted','In conversation','Meeting booked','Pilot discussion','Pilot secured','Not interested'];
  const METHODS = ['cold_call','cold_email','linkedin'];
  const nf = n => Number(n || 0).toLocaleString('en-US');
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const today = () => new Date().toLocaleDateString('en-CA');
  const show = (id, yes=true) => $(id).classList.toggle('hidden', !yes);
  const stateOptions = (selected='') => STATES.map(([id,n])=>`<option value="${id}" ${selected===id?'selected':''}>${esc(n)}</option>`).join('');
  const normalization = s => String(s || '').toLowerCase().replace(/&/g,'and').replace(/\bdept\b/g,'department').replace(/\bpd\b/g,'police department').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  const getErr = res => { if (res.error) throw res.error; return res.data; };
  const closeDrawer = () => {show('overlay',false); $('overlay').setAttribute('aria-hidden','true');};
  const openDrawer = (title, body, eyebrow='AGENCY DETAILS') => { $('drawer-title').textContent=title;$('drawer-eyebrow').textContent=eyebrow;$('drawer-content').innerHTML=body;show('overlay');$('overlay').setAttribute('aria-hidden','false');$('close-drawer').focus(); };
  let client, user, page=0, rows=[], totalResults=0, searchTimer, toastTimer, loadId=0;
  const pageSize=30;
  const state={q:'',state:'',type:'',contact:''};

  function toast(message, bad=false) {
    const el=$('toast');el.textContent=message;el.className=`toast show ${bad?'error':''}`;
    clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.className='toast',4500);
  }
  function ensureConfigured() {
    return !!(CONFIG.supabaseUrl && /^https:\/\//.test(CONFIG.supabaseUrl) &&
      CONFIG.supabaseAnonKey && !CONFIG.supabaseAnonKey.includes('PASTE_') && window.supabase);
  }
  async function start() {
    $('state-filter').insertAdjacentHTML('beforeend',stateOptions());
    $('login-form').addEventListener('submit',signIn);
    $('logout').addEventListener('click',async()=>{await client.auth.signOut();user=null;show('dashboard',false);show('login-screen');});
    $('search-input').addEventListener('input',e=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.q=e.target.value.trim();page=0;loadAgencies();},280);});
    [['state-filter','state'],['type-filter','type'],['contact-filter','contact']].forEach(([id,key])=>$(id).addEventListener('change',e=>{state[key]=e.target.value;page=0;loadAgencies();}));
    $('prev-page').addEventListener('click',()=>{if(page>0){page--;loadAgencies();}});
    $('next-page').addEventListener('click',()=>{if((page+1)*pageSize<totalResults){page++;loadAgencies();}});
    $('refresh-button').addEventListener('click',refresh);
    $('nav-agencies').addEventListener('click',e=>{e.preventDefault();closeDrawer();window.scrollTo({top:0,behavior:'smooth'});});
    $('nav-import').addEventListener('click',openImport);
    $('nav-bulk').addEventListener('click',openBulk);
    $('add-button').addEventListener('click',openAdd);
    $('export-button').addEventListener('click',exportProgress);
    $('close-drawer').addEventListener('click',closeDrawer);
    $('overlay').addEventListener('click',e=>{if(e.target===$('overlay'))closeDrawer();});
    document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDrawer();});
    $('agency-rows').addEventListener('click',async e=>{const detail=e.target.closest('[data-detail]');if(detail){openAgency(detail.dataset.detail);}});
    $('agency-rows').addEventListener('change',toggleMethod);

    if(!ensureConfigured()){show('setup-screen');return;}
    client=window.supabase.createClient(CONFIG.supabaseUrl,CONFIG.supabaseAnonKey,{
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}
    });
    try {
      const {data:{session},error}=await client.auth.getSession();if(error)throw error;
      if(session?.user){await checkAccess(session.user);}else show('login-screen');
    } catch(e) {show('login-screen');toast('Unable to connect to Supabase: '+e.message,true);}
  }
  async function signIn(e){
    e.preventDefault();$('login-error').textContent='';$('login-button').disabled=true;
    try{
      const {data,error}=await client.auth.signInWithPassword({email:$('login-email').value.trim(),password:$('login-password').value});
      if(error)throw error;await checkAccess(data.user);
    }catch(err){$('login-error').textContent=err.message||'Sign-in failed.';}
    finally{$('login-button').disabled=false;}
  }
  async function checkAccess(candidate){
    const {data,error}=await client.rpc('reconero_is_member');
    if(error)throw error;
    if(data!==true){await client.auth.signOut();show('login-screen');$('login-error').textContent='This account is not on the authorized-user list. Add its UUID in Supabase SQL Editor.';return;}
    user=candidate;show('login-screen',false);show('setup-screen',false);show('dashboard');$('user-email').textContent=user.email;$('user-avatar').textContent=(user.email||'R')[0].toUpperCase();
    await Promise.all([refresh(),loadAgencyTypes()]);
  }
  async function loadAgencyTypes(){
    const {data,error}=await client.rpc('reconero_agency_types');
    if(error){toast('Could not load agency types: '+error.message,true);return;}
    const previous=$('type-filter').value;
    $('type-filter').innerHTML='<option value="">All types</option>'+(data||[]).map(x=>`<option value="${esc(x.agency_type)}">${esc(x.agency_type)}</option>`).join('');
    if((data||[]).some(x=>x.agency_type===previous))$('type-filter').value=previous;
  }
  async function refresh(){await Promise.all([loadAgencies(),loadStats()]);}

  function applyFilters(query){
    if(state.state)query=query.eq('state',state.state);
    if(state.type)query=query.eq('agency_type',state.type);
    if(state.q){const safe=state.q.replace(/[,()%*\\]/g,' ').replace(/\s+/g,' ').trim();if(safe)query=query.or(`name.ilike.%${safe}%,ori.ilike.%${safe}%`);}
    if(state.contact==='untouched')query=query.eq('cold_call',false).eq('cold_email',false).eq('linkedin',false);
    else if(state.contact==='reached')query=query.or('cold_call.eq.true,cold_email.eq.true,linkedin.eq.true');
    else if(METHODS.includes(state.contact))query=query.eq(state.contact,true);
    else if(state.contact==='followup')query=query.not('next_followup','is',null).lte('next_followup',today());
    return query;
  }
  async function loadAgencies(){
    const myLoad=++loadId;
    $('agency-rows').innerHTML='<tr><td class="empty" colspan="8">Loading agencies…</td></tr>';
    try{
      let q=client.from('reconero_agencies').select('ori,name,state,county,agency_type,cold_call,cold_email,linkedin,status,next_followup',{count:'exact'}).order('name',{ascending:true}).range(page*pageSize,(page+1)*pageSize-1);
      q=applyFilters(q);
      const {data,error,count}=await q;
      if(myLoad!==loadId)return;if(error)throw error;
      rows=data||[];totalResults=count||0;
      renderRows();renderPagination();
      if(!totalResults && !state.q && !state.state && !state.type && !state.contact){$('result-count').textContent='No agencies imported yet';}
      else $('result-count').textContent=`${nf(totalResults)} agencies match your filters`;
    }catch(err){if(myLoad===loadId){$('agency-rows').innerHTML=`<tr><td class="empty" colspan="8">Could not load directory: ${esc(err.message)}</td></tr>`;toast(err.message,true);}}
  }
  function statusClass(s){return ['Pilot secured','Meeting booked','In conversation','Pilot discussion'].includes(s)?'live':s==='Attempted'?'warm':s==='Not interested'?'closed':'';}
  function renderRows(){
    if(!rows.length){$('agency-rows').innerHTML='<tr><td class="empty" colspan="8"><strong>No matching agencies.</strong><br>Try another filter, or import the nationwide directory.</td></tr>';return;}
    $('agency-rows').innerHTML=rows.map(r=>`<tr>
      <td><strong class="agency-name">${esc(r.name)}</strong><span class="agency-ori">${esc(r.ori)}</span></td>
      <td><span class="state-chip">${esc(r.state)}</span></td>
      <td><div class="agency-type">${esc(r.agency_type||'—')}</div><div class="agency-county">${esc(r.county||'')}</div></td>
      ${METHODS.map(k=>`<td class="check-col"><input class="method-check" type="checkbox" data-ori="${esc(r.ori)}" data-method="${k}" aria-label="${k.replace('_',' ')} contacted for ${esc(r.name)}" ${r[k]?'checked':''}></td>`).join('')}
      <td><span class="status-pill ${statusClass(r.status)}">${esc(r.status)}</span></td>
      <td><button class="details-button" data-detail="${esc(r.ori)}">Details →</button></td>
      </tr>`).join('');
  }
  function renderPagination(){
    $('pagination-summary').textContent=totalResults?`Showing ${nf(page*pageSize+1)}–${nf(Math.min((page+1)*pageSize,totalResults))} of ${nf(totalResults)}`:'0 results';
    $('page-label').textContent=`${page+1} / ${Math.max(1,Math.ceil(totalResults/pageSize))}`;
    $('prev-page').disabled=page===0;$('next-page').disabled=(page+1)*pageSize>=totalResults;
  }
  async function loadStats(){
    try{
      const q=()=>client.from('reconero_agencies').select('ori',{head:true,count:'exact'});
      const resp=await Promise.all([q(),q().or('cold_call.eq.true,cold_email.eq.true,linkedin.eq.true'),q().eq('cold_email',true),q().eq('cold_call',true)]);
      resp.forEach(r=>{if(r.error)throw r.error;});
      ['total','reached','email','call'].forEach((k,i)=>$('stat-'+k).textContent=nf(resp[i].count));
    }catch(e){toast('Statistics unavailable: '+e.message,true);}
  }
  async function toggleMethod(e){
    const input=e.target;if(!input.matches('.method-check'))return;
    const ori=input.dataset.ori,method=input.dataset.method;if(!METHODS.includes(method))return;
    const old=rows.find(r=>r.ori===ori);if(!old)return;
    input.disabled=true;const value=input.checked;
    try{
      const updates={[method]:value,[`${method}_at`]:value?new Date().toISOString():null};
      if(value && old.status==='Not contacted')updates.status='Attempted';
      const res=await client.from('reconero_agencies').update(updates).eq('ori',ori).select('ori');getErr(res);
      if(!res.data?.length)throw new Error('Update was not authorized.');
      Object.assign(old,updates);renderRows();loadStats();toast('Saved to the shared database.');
    }catch(err){input.checked=!value;input.disabled=false;toast('Could not save: '+err.message,true);}
  }
  async function openAgency(ori){
    try{
      const {data,error}=await client.from('reconero_agencies').select('*').eq('ori',ori).single();if(error)throw error;
      const r=data;
      const touch=METHODS.map(k=>`<label class="touch-option"><input type="checkbox" name="${k}" ${r[k]?'checked':''}>${{cold_call:'☎ Call',cold_email:'✉ Email',linkedin:'▣ LinkedIn'}[k]}</label>`).join('');
      const body=`<div class="info">${esc(r.ori)} · ${esc(r.state)} · ${esc(r.agency_type||'Law enforcement agency')} ${r.county?'· '+esc(r.county):''}</div>
        <form id="agency-form"><div class="section-label">OUTREACH ACTIVITY</div><div class="touch-list">${touch}</div>
        <div class="section-label">PIPELINE</div><div class="form-grid">
          <label>Status<select name="status">${STATUS.map(s=>`<option value="${esc(s)}" ${r.status===s?'selected':''}>${esc(s)}</option>`).join('')}</select></label>
          <label>Next follow-up<input type="date" name="next_followup" value="${esc(r.next_followup||'')}"></label>
        </div><div class="section-label">CONTACT DETAILS</div><div class="form-grid">
          <label class="span2">Point of contact<input name="contact_name" maxlength="200" value="${esc(r.contact_name)}" placeholder="Chief / captain / administrator"></label>
          <label>Contact email<input name="contact_email" type="email" maxlength="320" value="${esc(r.contact_email)}" placeholder="name@agency.gov"></label>
          <label>Phone<input name="contact_phone" maxlength="100" value="${esc(r.contact_phone)}" placeholder="(555) 000-0000"></label>
          <label class="span2">LinkedIn profile<input name="linkedin_url" maxlength="800" value="${esc(r.linkedin_url)}" placeholder="https://linkedin.com/in/..."></label>
          <label class="span2">Personalization / reason for outreach<textarea name="personalization" maxlength="30000" placeholder="One verified reason this agency might be a good fit…">${esc(r.personalization)}</textarea></label>
          <label class="span2">Personalization evidence URL<input name="personalization_source_url" maxlength="800" value="${esc(r.personalization_source_url)}" placeholder="https://... (source for your claim)"></label>
          <label class="span2">Notes<textarea name="notes" maxlength="30000" placeholder="What did they say? Who should you follow up with?">${esc(r.notes)}</textarea></label>
        </div>
        <p class="helper">${r.source_url?`Directory source: <a href="${esc(safeUrl(r.source_url))}" target="_blank" rel="noopener noreferrer">view source ↗</a>. `:''}Changes save for every authorized Reconero user.</p>
        <div class="drawer-actions"><button type="button" class="button ghost" id="cancel-edit">Cancel</button><button type="submit" class="button primary" id="agency-save">Save changes →</button></div></form>`;
      openDrawer(r.name,body);
      $('cancel-edit').addEventListener('click',closeDrawer);
      $('agency-form').addEventListener('submit',async e=>{
        e.preventDefault();const btn=$('agency-save');btn.disabled=true;
        const form=new FormData(e.target),out={};
        for(const k of METHODS){out[k]=form.get(k)==='on';out[k+'_at']=out[k]?(r[k+'_at']||new Date().toISOString()):null;}
        for(const k of ['status','contact_name','contact_email','contact_phone','linkedin_url','notes','personalization','personalization_source_url'])out[k]=String(form.get(k)||'').trim();
        out.next_followup=String(form.get('next_followup')||'')||null;
        if(out.status==='Not contacted' && METHODS.some(k=>out[k]))out.status='Attempted';
        try{const ret=await client.from('reconero_agencies').update(out).eq('ori',ori).select('ori');getErr(ret);if(!ret.data?.length)throw new Error('Not authorized');toast('Agency updated.');closeDrawer();refresh();}
        catch(er){toast(er.message,true);btn.disabled=false;}
      });
    }catch(err){toast('Could not open agency: '+err.message,true);}
  }
  function safeUrl(s){try{const u=new URL(s);return ['http:','https:'].includes(u.protocol)?u.href:'#';}catch{return '#';}}

  function openAdd(){
    openDrawer('Add an agency',`<p class="drawer-desc">Missing a department? Add a custom record. You can search and track it like any other.</p><form id="add-form" class="form-grid">
      <label class="span2">Agency name<input name="name" required maxlength="300" placeholder="Example Police Department"></label>
      <label>State<select name="state" required><option value="">Choose state…</option>${stateOptions()}</select></label>
      <label>Type<input name="agency_type" value="Local police" maxlength="200"></label>
      <label class="span2">County (optional)<input name="county" maxlength="200"></label>
      <div class="span2 drawer-actions"><button type="submit" class="button primary" id="create-agency">Add to directory →</button></div></form>`,'DIRECTORY MANAGEMENT');
    $('add-form').addEventListener('submit',async e=>{
      e.preventDefault();const form=new FormData(e.target);
      const ori='CUSTOM-'+(window.crypto?.randomUUID?.()||Date.now().toString(36)).toUpperCase();
      const record={ori,name:String(form.get('name')).trim(),state:String(form.get('state')),county:String(form.get('county')||'').trim(),agency_type:String(form.get('agency_type')||'').trim()};
      try{getErr(await client.from('reconero_agencies').insert(record));closeDrawer();toast('Agency added.');refresh();}
      catch(err){toast('Could not add: '+err.message,true);}
    });
  }

  // Import a local CSV, preserving existing outreach records via ignoreDuplicates=true.
  function openImport(){
    openDrawer('Import nationwide roster',`<p class="drawer-desc">Populate the directory with approximately 19,600 FBI-listed law-enforcement agencies covering all 50 states and DC.</p>
      <div class="warning">This is a broad FBI agency directory, not a guaranteed current list of every active police department. It includes sheriffs, special agencies and other law-enforcement entities. Verify individual prospects before outreach.</div>
      <div class="section-label">STEP 1 — DOWNLOAD THE SOURCE</div>
      <p class="helper">Download the free, CC0 FBI-derived roster from IROPO (retrieved September 2026). It contains agency names, state, ORI, and type — not personal contact emails.</p>
      <a class="button outline" href="https://iropo.org/data/agencies.csv" target="_blank" rel="noopener noreferrer">↓ Download nationwide agencies.csv</a>
      <div class="section-label">STEP 2 — SELECT THE DOWNLOADED CSV</div>
      <div class="import-drop"><strong>Upload agencies.csv</strong><span class="helper">CSV with columns for agency ORI, name and state</span><input type="file" id="roster-file" accept=".csv,text/csv"></div>
      <div id="import-controls" class="hidden"><div class="section-label">STEP 3 — MATCH COLUMNS</div><div class="import-mapping" id="import-mapping"></div>
      <div class="preview-box" id="import-preview"></div><p id="import-summary" class="helper"></p><div class="progress-track"><div id="import-progress" class="progress-fill"></div></div><div class="drawer-actions"><button id="start-import" class="button primary">Import to shared database →</button></div></div>
      <div class="section-label">IMPORTANT</div><p class="helper">Already-recorded cold calls, emails, LinkedIn checkmarks and notes are preserved. Reimporting an existing ORI will not erase your outreach work.</p>`,'NATIONWIDE DATA');
    let parsed=[],head=[];const mapKeys=['ori','name','state','county','agency_type'];
    const aliases={ori:['ori','agency_id','agencyid','ori_code','ori_number'],name:['name','agency_name','agency','agencyname'],state:['state','state_abbr','state_code','stateabbr'],county:['county','counties','county_name'],agency_type:['agency_type','type','agencytype','type_name']};
    $('roster-file').addEventListener('change',e=>{
      const file=e.target.files?.[0];if(!file)return;if(!window.Papa){toast('CSV parser did not load. Check your internet connection.',true);return;}
      $('import-summary')?.replaceChildren(document.createTextNode('Reading CSV…'));
      window.Papa.parse(file,{header:true,skipEmptyLines:'greedy',complete:r=>{
        if(r.errors?.length && !r.data?.length){toast('Could not parse CSV: '+r.errors[0].message,true);return;}
        parsed=r.data||[];head=r.meta?.fields||Object.keys(parsed[0]||{});
        $('import-mapping').innerHTML=mapKeys.map(k=>`<label>${esc({ori:'ORI identifier *',name:'Agency name *',state:'State *',county:'County (optional)',agency_type:'Agency type (optional)'}[k])}<select id="map-${k}"><option value="">— Select column —</option>${head.map(h=>`<option value="${esc(h)}">${esc(h)}</option>`).join('')}</select></label>`).join('');
        mapKeys.forEach(k=>{const found=head.find(h=>aliases[k].includes(normalization(h).replaceAll(' ','_'))) || head.find(h=>aliases[k].includes(h.toLowerCase()));if(found)$('map-'+k).value=found;});
        $('import-summary').textContent=`${nf(parsed.length)} rows detected. Review column mapping, then import.`;
        $('import-preview').textContent=JSON.stringify(parsed[0]||{},null,2).slice(0,900);show('import-controls');
      },error:e=>toast('CSV read failed: '+e.message,true)});
    });
    $('start-import').addEventListener('click',async()=>{
      const mapping=Object.fromEntries(mapKeys.map(k=>[k,$('map-'+k).value]));
      if(!mapping.ori||!mapping.name||!mapping.state){toast('Map ORI, name, and state before importing.',true);return;}
      const seen=new Set(),invalid=[];
      const normalized=parsed.map((r,i)=>{
        const ori=String(r[mapping.ori]||'').trim().toUpperCase();
        const name=String(r[mapping.name]||'').trim();
        const rawState=String(r[mapping.state]||'').trim();
        const found=STATES.find(([code,label])=>code.toLowerCase()===rawState.toLowerCase()||label.toLowerCase()===rawState.toLowerCase());
        if(!ori||!name||!found||seen.has(ori)){invalid.push(i+2);return null;}
        seen.add(ori);
        return {ori,name,state:found[0],county:String(mapping.county?r[mapping.county]||'':'').trim().slice(0,300),agency_type:String(mapping.agency_type?r[mapping.agency_type]||'':'').trim().slice(0,300),source_url:'https://iropo.org/sources/'};
      }).filter(Boolean);
      if(normalized.length===0){toast('No valid records found. Check the column mapping.',true);return;}
      const btn=$('start-import');btn.disabled=true;
      let count=0;try{
        for(let i=0;i<normalized.length;i+=200){
          const chunk=normalized.slice(i,i+200);
          getErr(await client.from('reconero_agencies').upsert(chunk,{onConflict:'ori',ignoreDuplicates:true}));
          count+=chunk.length;
          $('import-progress').style.width=(100*count/normalized.length).toFixed(1)+'%';
          $('import-summary').textContent=`Processed ${nf(count)} / ${nf(normalized.length)} agencies · ${nf(invalid.length)} invalid/duplicate rows skipped.`;
        }
        toast(`Roster import finished: ${nf(count)} agency rows processed.`);
        setTimeout(()=>{closeDrawer();refresh();loadAgencyTypes();},600);
      }catch(err){toast('Import paused after '+nf(count)+' rows: '+err.message,true);$('import-summary').textContent+=' Import interrupted; you can safely retry the same CSV.';btn.disabled=false;}
    });
  }

  function openBulk(){
    openDrawer('Bulk mark cold emails',`<p class="drawer-desc">Already sent your first campaign? Paste one department name per line and we'll mark the <strong>exactly matched</strong> agencies as cold emailed. No new emails are sent.</p>
      <div class="warning">This uses conservative name matching. Ambiguous or unmatched names are skipped so we don't accidentally mark the wrong agency.</div>
      <div class="section-label">CAMPAIGN DEPARTMENTS</div>
      <div class="form-grid"><label class="span2">State<select id="bulk-state">${stateOptions('CA')}</select></label>
      <label class="span2">Department names<textarea id="bulk-names" class="inputlist" placeholder="Emeryville Police Department&#10;Marina Police Department&#10;..." spellcheck="false"></textarea></label>
      <label class="span2">Or upload your GMass contacts CSV<input id="bulk-file" type="file" accept=".csv,text/csv"></label></div>
      <p class="helper">If you upload a CSV, we use its <code>Department</code> column. Use the file containing only recipients you know GMass actually sent to.</p>
      <div class="drawer-actions"><button class="button outline" id="bulk-check">Preview matches</button><button class="button primary" id="bulk-apply" disabled>Mark matched as emailed →</button></div>
      <div class="section-label">MATCH RESULTS</div><div id="bulk-results" class="result-list">No preview yet.</div>`,'PREVIOUS CAMPAIGNS');
    let pending=[];
    $('bulk-file').addEventListener('change',e=>{
      const file=e.target.files?.[0];if(!file)return;
      if(!window.Papa){toast('CSV parser did not load.',true);return;}
      window.Papa.parse(file,{header:true,skipEmptyLines:true,complete:res=>{
        const names=res.data.map(r=>r.Department||r.department||r.Agency||r.agency||'').map(s=>s.trim()).filter(Boolean);
        if(!names.length){toast('Could not find a Department column in that CSV.',true);return;}
        $('bulk-names').value=names.join('\n');$('bulk-results').textContent=`Loaded ${names.length} department names. Click Preview matches.`;
      }});
    });
    $('bulk-check').addEventListener('click',async()=>{
      $('bulk-apply').disabled=true;pending=[];const names=[...new Set($('bulk-names').value.split(/\r?\n/).map(x=>x.replace(/^\s*"|"\s*$/g,'').trim()).filter(Boolean))];
      if(!names.length){toast('Paste or upload at least one department name.',true);return;}
      const st=$('bulk-state').value;
      try{
        // State-sized query; large states are paged to avoid silent truncation at 1000.
        const agencies=[];for(let offset=0;;offset+=750){const {data,error}=await client.from('reconero_agencies').select('ori,name,state,cold_email,status').eq('state',st).range(offset,offset+749);if(error)throw error;agencies.push(...data);if(data.length<750)break;}
        const map=new Map();
        for(const a of agencies){const key=normalization(a.name);if(!map.has(key))map.set(key,[]);map.get(key).push(a);}
        const misses=[];for(const name of names){const choices=map.get(normalization(name))||[];
          if(choices.length===1)pending.push(choices[0]);
          else misses.push((choices.length?'AMBIGUOUS: ':'NOT FOUND: ')+name);
        }
        pending=[...new Map(pending.map(a=>[a.ori,a])).values()];
        $('bulk-results').textContent=`${pending.length} exact matches in ${st} (of ${names.length} unique names).\n${pending.length?'\nREADY TO MARK:\n'+pending.map(a=>a.name+(a.cold_email?' (already marked)':'')).join('\n'):''}${misses.length?'\n\nNEEDS MANUAL REVIEW:\n'+misses.join('\n'):''}`;
        $('bulk-apply').disabled=pending.length===0;
      }catch(err){toast('Bulk preview failed: '+err.message,true);}
    });
    $('bulk-apply').addEventListener('click',async()=>{
      const btn=$('bulk-apply');btn.disabled=true;let done=0;
      try{
        for(const a of pending){
          if(a.cold_email){done++;continue;}
          const update={cold_email:true,cold_email_at:new Date().toISOString()};
          if(a.status==='Not contacted')update.status='Attempted';
          const result=await client.from('reconero_agencies').update(update).eq('ori',a.ori).select('ori');
          getErr(result);if(!result.data?.length)throw new Error('Not authorized to update '+a.name);
          done++;$('bulk-results').textContent=`Saving ${done} / ${pending.length}…`;
        }
        $('bulk-results').textContent=`Done: ${done} matched agencies now marked as cold emailed.\nUnmatched agencies were not changed.`;
        toast(`${done} agencies processed.`);refresh();
      }catch(err){toast(`Stopped after ${done}: ${err.message}`,true);btn.disabled=false;}
    });
  }

  const CSV_HEADERS=['ORI','Agency','State','County','Type','Cold Call','Cold Email','LinkedIn','Status','Contact Name','Contact Email','Contact Phone','LinkedIn URL','Follow Up','Personalization','Personalization Source','Notes','Updated'];
  const csvCell=v=>{let s=String(v??'');if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
  async function exportProgress(){
    const btn=$('export-button');btn.disabled=true;toast('Preparing export from the shared database…');
    try{
      const all=[];
      for(let offset=0;;offset+=750){const {data,error}=await client.from('reconero_agencies').select('*').order('ori').range(offset,offset+749);if(error)throw error;all.push(...data);if(data.length<750)break;}
      const entries=all.filter(r=>r.cold_call||r.cold_email||r.linkedin||r.notes||r.status!=='Not contacted'||r.contact_name||r.contact_email);
      const csv=[CSV_HEADERS.map(csvCell).join(',')].concat(entries.map(r=>[
        r.ori,r.name,r.state,r.county,r.agency_type,r.cold_call,r.cold_email,r.linkedin,r.status,r.contact_name,r.contact_email,r.contact_phone,r.linkedin_url,r.next_followup,r.personalization,r.personalization_source_url,r.notes,r.updated_at
      ].map(csvCell).join(','))).join('\r\n');
      const url=URL.createObjectURL(new Blob(['\ufeff',csv],{type:'text/csv;charset=utf-8;'}));const a=document.createElement('a');a.href=url;a.download=`Reconero_Atlas_Progress_${today()}.csv`;document.body.append(a);a.click();a.remove();URL.revokeObjectURL(url);
      toast(`Exported ${entries.length} agencies with recorded progress.`);
    }catch(err){toast('Export failed: '+err.message,true);}finally{btn.disabled=false;}
  }
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',start):start();
})();

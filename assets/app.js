/* Reconero Atlas — browser UI for Supabase Auth + RLS-protected Postgres. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const CONFIG = window.RECONERO_CONFIG || {};
  const STATES = [['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],['CA','California'],['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],['DC','District of Columbia'],['FL','Florida'],['GA','Georgia'],['HI','Hawaii'],['ID','Idaho'],['IL','Illinois'],['IN','Indiana'],['IA','Iowa'],['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],['MD','Maryland'],['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],['MO','Missouri'],['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],['NH','New Hampshire'],['NJ','New Jersey'],['NM','New Mexico'],['NY','New York'],['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],['OK','Oklahoma'],['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],['VT','Vermont'],['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],['WI','Wisconsin'],['WY','Wyoming']];
  const STATUS = ['Not contacted','Attempted','In conversation','Meeting booked','Pilot discussion','Pilot secured','Not interested'];
  const METHODS = ['cold_call','cold_email','linkedin'];
  const METHOD_LABELS={cold_call:'Cold call',cold_email:'Cold email',linkedin:'LinkedIn'};
  const HEX_COLOR=c=>/^#[0-9a-fA-F]{6}$/.test(String(c||''))?c:'#94A3B8';
  const dateLabel=iso=>{
    if(!iso)return '';
    const d=new Date(iso);
    return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(d):'';
  };
  const nf = n => Number(n || 0).toLocaleString('en-US');
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const today = () => new Date().toLocaleDateString('en-CA');
  const show = (id, yes=true) => $(id).classList.toggle('hidden', !yes);
  const stateOptions = (selected='') => STATES.map(([id,n])=>`<option value="${id}" ${selected===id?'selected':''}>${esc(n)}</option>`).join('');
  const normalization = s => String(s || '').toLowerCase().replace(/&/g,'and').replace(/\bdept\b/g,'department').replace(/\bpd\b/g,'police department').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  // Reconero outreach targets, audited against the FBI/IROPO 19,636-row roster.
  // Uses source agency type first. Explicit police/constable/ranger names are required
  // for mixed "other" / "other_state" categories. Heuristic, not individual verification.
  function isOutreachTarget(record){
    const name=String(record.name||'').trim().toLowerCase().replace(/&/g,'and');
    const type=String(record.agency_type||record.type||'').trim().toLowerCase().replace(/[\s-]+/g,'_');
    // In this FBI-derived dataset, university agencies often have school-only names.
    if(['city','county','state_police','university','tribal'].includes(type))return true;
    if(!['other','other_state','state_other'].includes(type))return false;
    // Reject courts, corrections, administrative and fire agencies first.
    if(/\b(?:corrections?|correctional|probation|parole|detention|jail|prison|prosecutor|district attorney|attorney general|judicial (?:circuit|district)|court(?:s)?|fire|firefighters?|arson|medical examiner|animal control|humane society|drug task force|narcotics (?:task force|unit)|task force|revenue|lottery|tax commission|motor vehicles|training|certification|campus security|school security)\b/.test(name))return false;
    // Mixed categories are included only with an explicit policing indicator.
    return /\b(?:police|sheriff'?s?|constable|marshals?|state patrol|highway patrol|transport police|peace officer|law enforcement|public safety|state bureau of investigation|bureau of (?:criminal )?investigation|division of criminal investigation|park rangers?)\b/.test(name);
  }
  const getErr = res => { if (res.error) throw res.error; return res.data; };
  const closeDrawer = () => {show('overlay',false); $('overlay').setAttribute('aria-hidden','true');};
  const openDrawer = (title, body, eyebrow='AGENCY DETAILS') => { $('drawer-title').textContent=title;$('drawer-eyebrow').textContent=eyebrow;$('drawer-content').innerHTML=body;show('overlay');$('overlay').setAttribute('aria-hidden','false');$('close-drawer').focus(); };
  let client, user, assistant, page=0, rows=[], totalResults=0, searchTimer, toastTimer, loadId=0;
  let teamProfiles=[], profileLookup=new Map(), attributionLookup=new Map(), currentView='agencies', teamWindow='7d';
  const profileOf=id=>profileLookup.get(id)||{user_id:id,display_name:'Former / unlisted member',color:'#94A3B8'};
  const contributorKey=(ori,method)=>ori+'|'+method;
  function attributionFor(ori,method){return attributionLookup.get(contributorKey(ori,method))||[];}
  function contributorTags(items){
    if(!items.length)return '<span class="who-legacy" title="This was checked before activity tracking began; author unknown">?</span>';
    return items.map(item=>{
      const p=profileOf(item.actor_id);
      return `<span class="who-dot" style="--person-color:${HEX_COLOR(p.color)}" title="${esc(p.display_name)} · ${nf(item.attempt_count)} recorded attempt(s)">${esc((p.display_name||'?').slice(0,1).toUpperCase())}</span>`;
    }).join('');
  }
  function methodCell(row,method){
    const contributors=attributionFor(row.ori,method);
    const color=contributors.length?HEX_COLOR(profileOf(contributors[0].actor_id).color):'#64748B';
    const colors=[...new Set(contributors.map(x=>HEX_COLOR(profileOf(x.actor_id).color)))];
    const bg=colors.length>1?`--mixed-color:linear-gradient(125deg,${colors[0]} 0 50%,${colors[1]} 50% 100%);`:'';
    const label=row[method]?(contributors.length?contributors.map(x=>`${profileOf(x.actor_id).display_name}: ${x.attempt_count} attempt(s)`).join(', '):'Checked before tracking — original author unknown'):'Not contacted yet';
    return `<td class="check-col"><div class="method-cell"><input class="method-check" type="checkbox" data-ori="${esc(row.ori)}" data-method="${method}" aria-label="${esc(METHOD_LABELS[method])} at ${esc(row.name)} — ${esc(label)}" title="${esc(label)}" style="--method-color:${color};${bg}" ${row[method]?'checked':''}>${row[method]?`<span class="who-dots">${contributorTags(contributors)}</span>`:''}</div></td>`;
  }
  function activityLine(item){
    const p=profileOf(item.actor_id),name=esc(p.display_name),color=HEX_COLOR(p.color);
    const kind=item.event_kind;
    let label=kind==='outreach'?`logged ${esc(METHOD_LABELS[item.method]||'outreach')}`:
      kind==='cleared'?`unchecked ${esc(METHOD_LABELS[item.method]||'outreach')}`:
      kind==='note'?'added a team note':`updated: ${esc(item.detail||'agency details')}`;
    return `<div class="activity-entry"><div class="activity-avatar" style="--person-color:${color}">${esc(p.display_name.slice(0,1).toUpperCase())}</div><div class="activity-copy"><strong>${name}</strong> ${label}${kind==='note'&&item.note?`<div class="activity-note">${esc(item.note)}</div>`:''}<span class="activity-date">${esc(dateLabel(item.created_at))}</span></div></div>`;
  }

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
    $('logout').addEventListener('click',async()=>{await client.auth.signOut();assistant?.reset();user=null;switchView('agencies');show('dashboard',false);show('login-screen');});
    $('search-input').addEventListener('input',e=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.q=e.target.value.trim();page=0;loadAgencies();},280);});
    [['state-filter','state'],['type-filter','type'],['contact-filter','contact']].forEach(([id,key])=>$(id).addEventListener('change',e=>{state[key]=e.target.value;page=0;loadAgencies();}));
    $('prev-page').addEventListener('click',()=>{if(page>0){page--;loadAgencies();}});
    $('next-page').addEventListener('click',()=>{if((page+1)*pageSize<totalResults){page++;loadAgencies();}});
    $('refresh-button').addEventListener('click',refresh);
    $('nav-agencies').addEventListener('click',e=>{e.preventDefault();switchView('agencies');window.scrollTo({top:0,behavior:'smooth'});});
    $('nav-import').addEventListener('click',openImport);
    $('nav-bulk').addEventListener('click',openBulk);
    $('nav-assistant').addEventListener('click',()=>switchView('assistant'));
    $('nav-team').addEventListener('click',()=>switchView('team'));
    $('team-window').addEventListener('change',e=>{teamWindow=e.target.value;loadTeam();});
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
    assistant=window.createAtlasAssistant(client,()=>user,openAgency);
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
    if(user?.id!==candidate.id)assistant.reset();
    user=candidate;show('login-screen',false);show('setup-screen',false);show('dashboard');$('user-email').textContent=user.email;$('user-avatar').textContent=(user.email||'R')[0].toUpperCase();
    await loadProfiles();
    await Promise.all([refresh(),loadAgencyTypes()]);
  }
  async function loadAgencyTypes(){
    const {data,error}=await client.rpc('reconero_agency_types');
    if(error){toast('Could not load agency types: '+error.message,true);return;}
    const previous=$('type-filter').value;
    $('type-filter').innerHTML='<option value="">All types</option>'+(data||[]).map(x=>`<option value="${esc(x.agency_type)}">${esc(x.agency_type)}</option>`).join('');
    if((data||[]).some(x=>x.agency_type===previous))$('type-filter').value=previous;
  }
  async function loadProfiles(){
    try{
      const {data,error}=await client.from('reconero_team_profiles').select('user_id,display_name,color').order('display_name');
      if(error)throw error;
      teamProfiles=data||[];
      profileLookup=new Map(teamProfiles.map(p=>[p.user_id,p]));
      $('team-legend').innerHTML=teamProfiles.map(p=>`<span class="member-key"><span class="who-dot" style="--person-color:${HEX_COLOR(p.color)}">${esc(p.display_name.slice(0,1).toUpperCase())}</span> ${esc(p.display_name)}</span>`).join('');
      $('agency-legend').innerHTML=teamProfiles.map(p=>`<span class="member-key"><span class="who-dot" style="--person-color:${HEX_COLOR(p.color)}">${esc(p.display_name.slice(0,1).toUpperCase())}</span> ${esc(p.display_name)}</span>`).join('')+'<span class="legacy-key">? = before tracking</span>';
    }catch(e){toast('Team profiles are not ready. Run the team upgrade SQL first: '+e.message,true);}
  }
  function switchView(view){
    currentView=view;closeDrawer();
    show('agency-view',view==='agencies');show('team-view',view==='team');show('assistant-view',view==='assistant');
    $('nav-agencies').classList.toggle('active',view==='agencies');
    $('nav-team').classList.toggle('active',view==='team');
    $('nav-assistant').classList.toggle('active',view==='assistant');
    $('breadcrumb-section').textContent={agencies:'Agency directory',team:'Team performance',assistant:'Atlas assistant'}[view];
    window.scrollTo({top:0,behavior:'smooth'});
    if(view==='team')loadTeam();
  }
  async function refresh(){
    if(currentView==='team')await Promise.all([loadTeam(),loadStats()]);
    else await Promise.all([loadAgencies(),loadStats()]);
  }
  function startOfDay(daysBefore=0){const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-daysBefore);return d.toISOString();}
  async function loadTeam(){
    const since=teamWindow==='today'?startOfDay():teamWindow==='7d'?startOfDay(6):teamWindow==='30d'?startOfDay(29):null;
    $('team-cards').innerHTML='<div class="team-loading">Loading team statistics…</div>';
    try{
      const [stats,activity]=await Promise.all([
        client.rpc('reconero_team_performance',{p_since:since}),
        client.from('reconero_activity').select('id,agency_ori,actor_id,event_kind,method,detail,note,created_at').order('created_at',{ascending:false}).limit(15)
      ]);
      if(stats.error)throw stats.error;
      if(activity.error)throw activity.error;
      const results=stats.data||[];
      $('team-total-attempts').textContent=nf(results.reduce((n,x)=>n+Number(x.attempts||0),0));
      $('team-total-emails').textContent=nf(results.reduce((n,x)=>n+Number(x.emails||0),0));
      $('team-total-calls').textContent=nf(results.reduce((n,x)=>n+Number(x.calls||0),0));
      $('team-total-linkedin').textContent=nf(results.reduce((n,x)=>n+Number(x.linkedin_actions||0),0));
      const peak=Math.max(1,...results.map(x=>Number(x.attempts||0)));
      $('team-cards').innerHTML=results.length?results.map(p=>{
        const color=HEX_COLOR(p.color),pct=100*Number(p.attempts||0)/peak;
        return `<div class="member-performance-card"><div class="member-performance-heading"><span class="activity-avatar large" style="--person-color:${color}">${esc(p.display_name.slice(0,1).toUpperCase())}</span><div><strong>${esc(p.display_name)}</strong><span>${nf(p.unique_agencies)} unique agencies</span></div><strong class="member-performance-total">${nf(p.attempts)} <small>attempts</small></strong></div><div class="member-progress"><div style="width:${pct.toFixed(1)}%;background:${color}"></div></div><div class="member-breakdown"><span>✉ ${nf(p.emails)} emails</span><span>☎ ${nf(p.calls)} calls</span><span>▣ ${nf(p.linkedin_actions)} LinkedIn</span></div></div>`;
      }).join(''):'<div class="team-loading">No team profiles found. Check the Supabase upgrade.</div>';
      const recent=(activity.data||[]);
      $('team-recent').innerHTML=recent.length?recent.map(x=>`<div class="team-recent-item"><span class="recent-ori">${esc(x.agency_ori)}</span>${activityLine(x)}</div>`).join(''):'<p class="helper">No activity recorded since the upgrade yet.</p>';
    }catch(e){
      $('team-cards').innerHTML=`<div class="team-loading">Could not load team data. Run <strong>01_TEAM_UPGRADE_RUN_IN_SUPABASE.sql</strong> first. ${esc(e.message)}</div>`;
      toast('Team data unavailable: '+e.message,true);
    }
  }

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
      attributionLookup=new Map();
      if(rows.length){
        const attrs=await client.from('reconero_method_attribution')
          .select('agency_ori,method,actor_id,attempt_count,last_at')
          .in('agency_ori',rows.map(r=>r.ori)).order('last_at',{ascending:false});
        if(attrs.error){toast('Team attribution unavailable: '+attrs.error.message,true);}
        else for(const x of attrs.data||[]){
          const key=contributorKey(x.agency_ori,x.method);
          if(!attributionLookup.has(key))attributionLookup.set(key,[]);
          attributionLookup.get(key).push(x);
        }
      }
      if(myLoad!==loadId)return;
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
      ${METHODS.map(k=>methodCell(r,k)).join('')}
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
      await refresh();
      toast('Saved. Team attribution was recorded.');
    }catch(err){input.checked=!value;input.disabled=false;toast('Could not save: '+err.message,true);}
  }
  async function openAgency(ori){
    try{
      const [agency,activity,attrs]=await Promise.all([
        client.from('reconero_agencies').select('*').eq('ori',ori).single(),
        client.from('reconero_activity').select('id,agency_ori,actor_id,event_kind,method,detail,note,created_at').eq('agency_ori',ori).order('created_at',{ascending:false}).limit(80),
        client.from('reconero_method_attribution').select('agency_ori,method,actor_id,attempt_count,last_at').eq('agency_ori',ori).order('last_at',{ascending:false})
      ]);
      if(agency.error)throw agency.error;
      if(activity.error)throw activity.error;
      if(attrs.error)throw attrs.error;
      const r=agency.data;
      const attribution=new Map();
      for(const a of attrs.data||[]){if(!attribution.has(a.method))attribution.set(a.method,[]);attribution.get(a.method).push(a);}
      const touch=METHODS.map(k=>{
        const marks=attribution.get(k)||[];
        return `<label class="touch-option"><input type="checkbox" name="${k}" ${r[k]?'checked':''}>${esc(METHOD_LABELS[k])} ${r[k]?contributorTags(marks):''}</label>`;
      }).join('');
      const owners='<option value="">Unassigned</option>'+teamProfiles.map(p=>`<option value="${esc(p.user_id)}" ${r.owner_id===p.user_id?'selected':''}>${esc(p.display_name)}</option>`).join('');
      const events=(activity.data||[]);
      const body=`<div class="info">${esc(r.ori)} · ${esc(r.state)} · ${esc(r.agency_type||'Law enforcement agency')} ${r.county?'· '+esc(r.county):''}</div>
        <div class="activity-hint">${METHODS.some(m=>r[m]&&!(attribution.get(m)||[]).length)?'Gray question marks mean an outreach checkmark predates team tracking. Its author is unknown.':''}</div>
        <form id="agency-form"><div class="section-label">OUTREACH ACTIVITY</div><div class="touch-list">${touch}</div>
        <p class="helper">Check or uncheck an outreach method and save. To log a second attempt—or a teammate’s attempt—use a button below; it keeps the first person’s history.</p>
        <div class="section-label">PIPELINE & OWNERSHIP</div><div class="form-grid">
          <label>Status<select name="status">${STATUS.map(st=>`<option value="${esc(st)}" ${r.status===st?'selected':''}>${esc(st)}</option>`).join('')}</select></label>
          <label>Assigned to<select name="owner_id">${owners}</select></label>
          <label class="span2">Next follow-up<input type="date" name="next_followup" value="${esc(r.next_followup||'')}"></label>
        </div><div class="section-label">CONTACT DETAILS</div><div class="form-grid">
          <label class="span2">Point of contact<input name="contact_name" maxlength="200" value="${esc(r.contact_name)}" placeholder="Chief / captain / administrator"></label>
          <label>Contact email<input name="contact_email" type="email" maxlength="320" value="${esc(r.contact_email)}" placeholder="name@agency.gov"></label>
          <label>Phone<input name="contact_phone" maxlength="100" value="${esc(r.contact_phone)}" placeholder="(555) 000-0000"></label>
          <label class="span2">LinkedIn profile<input name="linkedin_url" maxlength="800" value="${esc(r.linkedin_url)}" placeholder="https://linkedin.com/in/..."></label>
          <label class="span2">Personalization / reason for outreach<textarea name="personalization" maxlength="30000" placeholder="One verified reason this agency might be a good fit…">${esc(r.personalization)}</textarea></label>
          <label class="span2">Personalization evidence URL<input name="personalization_source_url" maxlength="800" value="${esc(r.personalization_source_url)}" placeholder="https://... (source for your claim)"></label>
          <label class="span2">Shared notes (legacy)<textarea name="notes" maxlength="30000" placeholder="Previous freeform notes…">${esc(r.notes)}</textarea></label>
        </div>
        <p class="helper">${r.source_url?`Directory source: <a href="${esc(safeUrl(r.source_url))}" target="_blank" rel="noopener noreferrer">view source ↗</a>. `:''}Your changes are shared with authorized Reconero members.</p>
        <div class="drawer-actions"><button type="button" class="button ghost" id="cancel-edit">Cancel</button><button type="submit" class="button primary" id="agency-save">Save changes →</button></div></form>
        <div class="section-label">LOG ANOTHER OUTREACH ATTEMPT</div>
        <div class="log-buttons">${METHODS.map(k=>`<button type="button" class="button outline log-attempt" data-method="${k}">+ ${esc(METHOD_LABELS[k])}</button>`).join('')}</div>
        <p class="helper">Every click logs one new attempt under your account, even if the checkbox is already checked.</p>
        <div class="section-label">ADD AN AUTHORED TEAM NOTE</div>
        <textarea class="team-note-input" id="team-note-text" maxlength="2000" placeholder="What did they say? Next steps? Notes here are signed and timestamped, and cannot overwrite someone else's note."></textarea>
        <div class="drawer-actions"><button type="button" id="team-note-save" class="button primary">Add note →</button></div>
        <div class="section-label">ACTIVITY HISTORY</div>
        <div class="activity-list">${events.length?events.map(activityLine).join(''):'<p class="helper">No team activity yet. Older checkmarks cannot be assigned retroactively.</p>'}</div>
        <p class="helper">Showing the ${Math.min(events.length,80)} most recent events. Times are displayed in your local time zone.</p>`;
      openDrawer(r.name,body);
      $('cancel-edit').addEventListener('click',closeDrawer);
      $('agency-form').addEventListener('submit',async e=>{
        e.preventDefault();const btn=$('agency-save');btn.disabled=true;
        const form=new FormData(e.target),out={};
        // Only write checkboxes deliberately changed in this drawer; don't overwrite
        // a teammate's unrelated checkbox change from a stale browser tab.
        for(const k of METHODS){
          const next=form.get(k)==='on';
          if(next!==r[k]){out[k]=next;out[k+'_at']=next?new Date().toISOString():null;}
        }
        for(const k of ['status','contact_name','contact_email','contact_phone','linkedin_url','notes','personalization','personalization_source_url']){
          const next=String(form.get(k)||'').trim();
          if(next!==String(r[k]||''))out[k]=next;
        }
        const nextOwner=String(form.get('owner_id')||'')||null;
        if(nextOwner!==(r.owner_id||null))out.owner_id=nextOwner;
        const nextFollowup=String(form.get('next_followup')||'')||null;
        if(nextFollowup!==(r.next_followup||null))out.next_followup=nextFollowup;
        const resultingStatus=out.status??r.status;
        if(resultingStatus==='Not contacted' && METHODS.some(k=>(out[k]??r[k])))out.status='Attempted';
        try{
          if(Object.keys(out).length){
            const ret=await client.from('reconero_agencies').update(out).eq('ori',ori).select('ori');
            getErr(ret);if(!ret.data?.length)throw new Error('Not authorized');
          }
          toast('Agency updated.');closeDrawer();await refresh();
        }catch(er){toast(er.message,true);btn.disabled=false;}
      });
      document.querySelectorAll('.log-attempt').forEach(button=>button.addEventListener('click',async()=>{
        const method=button.dataset.method;button.disabled=true;
        try{
          const res=await client.rpc('reconero_log_outreach',{p_ori:ori,p_method:method,p_note:''});
          getErr(res);toast(`${METHOD_LABELS[method]} logged under your account.`);
          await refresh();await openAgency(ori);
        }catch(er){toast('Could not log outreach: '+er.message,true);button.disabled=false;}
      }));
      $('team-note-save').addEventListener('click',async()=>{
        const note=$('team-note-text').value.trim();if(!note){toast('Enter a note first.',true);return;}
        const btn=$('team-note-save');btn.disabled=true;
        try{
          getErr(await client.rpc('reconero_add_team_note',{p_ori:ori,p_note:note}));
          toast('Authored note saved.');await openAgency(ori);
        }catch(er){toast('Could not save note: '+er.message,true);btn.disabled=false;}
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
    openDrawer('Import nationwide roster',`<p class="drawer-desc">Import police departments, sheriffs’ offices, highway patrol, university/campus police, tribal police and similar agencies from the nationwide FBI directory.</p>
      <div class="warning">This is a broad FBI agency directory, not a guaranteed current list of every active police department. It includes sheriffs, special agencies and other law-enforcement entities. Verify individual prospects before outreach.</div>
      <div class="section-label">STEP 1 — DOWNLOAD THE SOURCE</div>
      <p class="helper">Download the free, CC0 FBI-derived roster from IROPO (retrieved September 2026). It contains agency names, state, ORI, and type — not personal contact emails.</p>
      <a class="button outline" href="https://iropo.org/data/agencies.csv" target="_blank" rel="noopener noreferrer">↓ Download nationwide agencies.csv</a>
      <div class="section-label">STEP 2 — SELECT THE DOWNLOADED CSV</div>
      <div class="import-drop"><strong>Upload agencies.csv</strong><span class="helper">CSV with columns for agency ORI, name and state</span><input type="file" id="roster-file" accept=".csv,text/csv"></div>
      <div id="import-controls" class="hidden"><div class="section-label">STEP 3 — SELECT YOUR TARGETS</div>
      <label class="helper" style="display:flex;align-items:center;gap:10px;margin:9px 0 14px"><input type="checkbox" id="only-targets" checked style="width:18px;height:18px"> <strong>Only import police / sheriff / campus / patrol agencies (recommended)</strong></label>
      <p class="helper">Includes university-category agencies even when the name does not say “police”. Reviews mixed other/other_state types by name; excludes courts, corrections, fire marshals and similar non-targets. This is a heuristic, not individual verification.</p>
      <div class="section-label">STEP 4 — MATCH COLUMNS</div><div class="import-mapping" id="import-mapping"></div>
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
        $('import-summary').textContent=`${nf(parsed.length)} source rows detected. Confirm mapping, then import your selected agencies.`;
        $('import-preview').textContent=JSON.stringify(parsed[0]||{},null,2).slice(0,900);show('import-controls');
      },error:e=>toast('CSV read failed: '+e.message,true)});
    });
    $('start-import').addEventListener('click',async()=>{
      const mapping=Object.fromEntries(mapKeys.map(k=>[k,$('map-'+k).value]));
      if(!mapping.ori||!mapping.name||!mapping.state){toast('Map ORI, name, and state before importing.',true);return;}
      const seen=new Set(),invalid=[];
      const allValid=parsed.map((r,i)=>{
        const ori=String(r[mapping.ori]||'').trim().toUpperCase();
        const name=String(r[mapping.name]||'').trim();
        const rawState=String(r[mapping.state]||'').trim();
        const found=STATES.find(([code,label])=>code.toLowerCase()===rawState.toLowerCase()||label.toLowerCase()===rawState.toLowerCase());
        if(!ori||!name||!found||seen.has(ori)){invalid.push(i+2);return null;}
        seen.add(ori);
        return {ori,name,state:found[0],county:String(mapping.county?r[mapping.county]||'':'').trim().slice(0,300),agency_type:String(mapping.agency_type?r[mapping.agency_type]||'':'').trim().slice(0,300),source_url:'https://iropo.org/sources/'};
      }).filter(Boolean);
      const onlyTargets=$('only-targets').checked;
      const normalized=onlyTargets?allValid.filter(isOutreachTarget):allValid;
      const excluded=allValid.length-normalized.length;
      if(normalized.length===0){toast('No eligible records found. Check column mapping and target filter.',true);return;}
      if(onlyTargets && !window.confirm(`Import ${nf(normalized.length)} outreach targets and skip ${nf(excluded)} non-target agencies? Existing records will not be overwritten.`))return;
      const btn=$('start-import');btn.disabled=true;
      let count=0;try{
        for(let i=0;i<normalized.length;i+=200){
          const chunk=normalized.slice(i,i+200);
          getErr(await client.from('reconero_agencies').upsert(chunk,{onConflict:'ori',ignoreDuplicates:true}));
          count+=chunk.length;
          $('import-progress').style.width=(100*count/normalized.length).toFixed(1)+'%';
          $('import-summary').textContent=`Processed ${nf(count)} / ${nf(normalized.length)} selected targets · ${nf(excluded)} non-targets excluded · ${nf(invalid.length)} invalid/duplicates skipped.`;
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

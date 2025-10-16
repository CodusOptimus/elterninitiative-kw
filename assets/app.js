/* ========= Utility: Escaping & URL-Sanitizer ========= */
function escapeHTML(str){
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function safeURL(href){
  const s = String(href || '').trim();
  if (!s) return '#';
  try{
    const u = new URL(s, location.origin);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
  }catch(_){}
  return '#';
}
function safeLog(scope, err){ try{ console.error(`[${scope}]`, err); }catch(_){} }

/* ========= Global: Copy-Buttons für Snippets ========= */
document.addEventListener('click', (e)=>{
  const btn = e.target.closest('.copy-btn');
  if(!btn) return;
  const sel = btn.getAttribute('data-copy') || '';
  const el = document.querySelector(sel);
  if(!el) return;
  const text = el.textContent || '';
  navigator.clipboard?.writeText(text).then(()=>{
    btn.textContent = 'Kopiert';
    setTimeout(()=>{ btn.textContent = 'Kopieren'; }, 1200);
  }).catch(()=>{ /* ignore */ });
});

/* ========= LINKS: Mitmachen/Petition/Datenschutz/Kontakt ========= */
(async function(){
  try{
    const res = await fetch('data/links.json?' + Date.now(), { cache:'no-store' });
    if(!res.ok) return;
    const l = await res.json();

    const byId = id => document.getElementById(id);

    byId('link-whatsapp')?.setAttribute('href', safeURL(l.whatsapp));
    byId('link-newsletter')?.setAttribute('href', safeURL(l.newsletter));
    byId('link-info')?.setAttribute('href', safeURL(l.info));
    byId('link-petition')?.setAttribute('href', safeURL(l.petition));

    byId('link-dse')?.setAttribute('href', safeURL(l.datenschutz));
    if (l.impressum_name) byId('impressum-name').textContent = l.impressum_name;
    if (l.impressum_mail) byId('impressum-mail').textContent = l.impressum_mail;

    // Kontakt-Endpoint aktiviert Formular
    if (l.contact_endpoint){
      const form = document.getElementById('contact-form');
      const submit = document.getElementById('contact-submit');
      const hint = document.getElementById('contact-hint');
      if (submit) submit.disabled = false;
      if (hint) hint.textContent = 'Nachricht wird an unser Postfach gesendet.';
      initContact(form, safeURL(l.contact_endpoint));
    } else {
      // Zeichenzähler trotzdem aktiv
      initContactCounterOnly();
    }
  }catch(e){ safeLog('links', e); initContactCounterOnly(); }
})();

/* ========= TERMINE: Laden & Rendern ========= */
(async function(){
  try{
    const root = document.getElementById('events');
    if(!root) return;

    const empty = (msg='Aktuell liegen keine kommenden Termine vor.') =>
      root.innerHTML = `<div class="event"><p class="title">${escapeHTML(msg)}</p><p class="sub">Bitte später erneut prüfen.</p></div>`;

    const res = await fetch('data/termine.json?' + Date.now(), { cache:'no-store' });
    if(!res.ok){ empty('Termine konnten nicht geladen werden.'); return; }
    const json = await res.json();

    const arr = Array.isArray(json) ? json
      : (Array.isArray(json.items) ? json.items
      : (json?.data?.items ?? []));

    function parseDate(d, t){
      const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(d||'');
      const tm = /^(\d{2}):(\d{2})$/.exec(t||'');
      if(!m) return Number.POSITIVE_INFINITY;
      const dd=+m[1], mm=+m[2]-1, yy=+m[3]; const hh=tm?+tm[1]:0, mi=tm?+tm[2]:0;
      return new Date(yy,mm,dd,hh,mi).getTime();
    }

    const items = arr.map(e => ({
      title: String(e?.title||'').trim(),
      date: String(e?.date||'').trim(),
      start: String(e?.time?.start||'').trim(),
      end: String(e?.time?.end||'').trim(),
      location: String(e?.location||'').trim(),
      url: String(e?.detail_url||'').trim()
    })).sort((a,b)=> parseDate(a.date,a.start)-parseDate(b.date,b.start)).slice(0,20);

    if(!items.length){ empty(); return; }

    root.innerHTML = items.map(e=>{
      const time = e.start ? (e.end ? `${e.start}–${e.end} Uhr` : `${e.start} Uhr`) : '';
      const meta = [e.date, time, e.location].filter(Boolean).map(escapeHTML).join(' · ');
      const link = e.url ? `<a href="${safeURL(e.url)}" target="_blank" rel="noopener noreferrer">Details</a>` : '';
      return `<article class="event" role="listitem">
        <h3 class="title">${escapeHTML(e.title || 'Sitzung')}</h3>
        <p class="sub">${meta}</p>
        <div class="links">${link}</div>
      </article>`;
    }).join('');
  }catch(e){ safeLog('termine', e); }
})();

/* ========= PRESSE: Lazy-Images + Mehr laden ========= */
(function(){
  try{
    const grid = document.getElementById('news-grid');
    const emptyHint = document.getElementById('news-empty');
    const moreBtn = document.getElementById('news-more');
    if(!grid) return;

    const pageSize = 6;
    let cursor = 0;
    let items = [];

    const toDate = (s) =>{
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((s||'').trim());
      return m ? new Date(+m[1], +m[2]-1, +m[3]).getTime() : NaN;
    };

    const io = ('IntersectionObserver' in window)
      ? new IntersectionObserver((entries, obs)=>{
          entries.forEach(entry=>{
            if(!entry.isIntersecting) return;
            const el = entry.target, bg = el.getAttribute('data-bg');
            if(bg){
              el.style.backgroundImage = `url('${bg.replace(/'/g,"\\'")}')`;
              el.classList.remove('is-loading'); el.classList.add('is-loaded'); el.removeAttribute('data-bg');
            }
            obs.unobserve(el);
          });
        }, { root:null, rootMargin:'200px 0px', threshold:0.1 })
      : null;

    function cardHTML(it){
      const title = escapeHTML((it.title||'Artikel').trim());
      const url = safeURL(it.url);
      const source = escapeHTML((it.source||'').trim());
      const date = escapeHTML((it.date||'').trim());
      const excerpt = escapeHTML((it.excerpt||'').trim());
      const img = String(it.image||'').trim();
      const hasImg = !!img;
      const mediaClass = hasImg ? 'news-media is-loading' : 'news-media';
      const dataBg = hasImg ? ` data-bg="${escapeHTML(img)}"` : '';
      const meta = [source, date].filter(Boolean).join(' • ');
      return `<article class="news-card" role="listitem">
        <a href="${url}" target="_blank" rel="noopener noreferrer" aria-label="Zum Artikel: ${title}">
          <div class="${mediaClass}"${dataBg}></div>
        </a>
        <div class="news-body">
          <h3 class="news-title"><a href="${url}" target="_blank" rel="noopener noreferrer">${title}</a></h3>
          <p class="news-excerpt">${excerpt || 'Kurzinfo folgt.'}</p>
          <p class="news-meta">${meta || '&nbsp;'}</p>
          <div class="news-actions"><a href="${url}" target="_blank" rel="noopener noreferrer">Zum Artikel</a></div>
        </div>
      </article>`;
    }

    async function init(){
      try{
        const res = await fetch('data/presse.json?' + Date.now(), { cache:'no-store' });
        if(!res.ok) throw new Error('HTTP '+res.status);
        items = await res.json();
        items = Array.isArray(items) ? items : [];
        items = items.map(x=>({
          title:String(x?.title||''),
          url:String(x?.url||''),
          source:String(x?.source||''),
          date:String(x?.date||''),
          image:String(x?.image||''),
          excerpt:String(x?.excerpt||'')
        }));
        items.sort((a,b)=>{
          const da=toDate(a.date), db=toDate(b.date);
          if(isNaN(da)&&isNaN(db)) return 0; if(isNaN(da)) return 1; if(isNaN(db)) return -1;
          return db-da;
        });
        cursor=0; grid.innerHTML='';

        if(items.length===0){ emptyHint.style.display='block'; return; }
        renderChunk();
        moreBtn.onclick = renderChunk;
      }catch(e){
        safeLog('presse-init', e);
        emptyHint.style.display='block';
      }
    }

    function renderChunk(){
      const end = Math.min(cursor+pageSize, items.length);
      const slice = items.slice(cursor, end);
      if(slice.length===0){ moreBtn.style.display='none'; return; }

      const temp = document.createElement('div');
      temp.innerHTML = slice.map(cardHTML).join('');
      const frag = document.createDocumentFragment();
      while(temp.firstChild){ frag.appendChild(temp.firstChild); }
      grid.appendChild(frag);

      const lazy = grid.querySelectorAll('.news-media.is-loading[data-bg]');
      if(io) lazy.forEach(el=>io.observe(el)); else lazy.forEach(el=>{
        const bg=el.getAttribute('data-bg'); if(bg){ el.style.backgroundImage=`url('${bg}')`; el.classList.remove('is-loading'); el.classList.add('is-loaded'); el.removeAttribute('data-bg'); }
      });

      cursor = end;
      moreBtn.style.display = cursor>=items.length ? 'none' : 'inline-block';
      emptyHint.style.display='none';
    }

    init();
  }catch(e){ safeLog('presse', e); }
})();

/* ========= AKTUELLES (eigene News): data/news.json ========= */
(function(){
  try{
    const grid = document.getElementById('blog-grid');
    const emptyHint = document.getElementById('blog-empty');
    const moreBtn = document.getElementById('blog-more');
    if(!grid) return;

    const pageSize = 6;
    let cursor = 0;
    let items = [];

    const toDate = (s) =>{
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((s||'').trim());
      return m ? new Date(+m[1], +m[2]-1, +m[3]).getTime() : NaN;
    };

    const io = ('IntersectionObserver' in window)
      ? new IntersectionObserver((entries, obs)=>{
          entries.forEach(entry=>{
            if(!entry.isIntersecting) return;
            const el = entry.target, bg = el.getAttribute('data-bg');
            if(bg){
              el.style.backgroundImage = `url('${bg.replace(/'/g,"\\'")}')`;
              el.classList.remove('is-loading'); el.classList.add('is-loaded'); el.removeAttribute('data-bg');
            }
            obs.unobserve(el);
          });
        }, { root:null, rootMargin:'200px 0px', threshold:0.1 })
      : null;

    function cardHTML(it){
      const title = escapeHTML((it.title||'Update').trim());
      const date = escapeHTML((it.date||'').trim());
      const text = escapeHTML((it.text||'').trim());
      const url  = safeURL(it.url);
      const img  = String(it.image||'').trim();
      const hasImg = !!img;
      const mediaClass = hasImg ? 'news-media is-loading' : 'news-media';
      const dataBg = hasImg ? ` data-bg="${escapeHTML(img)}"` : '';
      const meta = [date].filter(Boolean).join(' • ');
      const titleHtml = url ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${title}</a>` : title;
      const actionHtml = url ? `<div class="news-actions"><a href="${url}" target="_blank" rel="noopener noreferrer">Weiterlesen</a></div>` : '';
      return `<article class="news-card" role="listitem">
        <div class="${mediaClass}"${dataBg}></div>
        <div class="news-body">
          <h3 class="news-title">${titleHtml}</h3>
          <p class="news-excerpt">${text || 'Kurzinfo folgt.'}</p>
          <p class="news-meta">${meta || '&nbsp;'}</p>
          ${actionHtml}
        </div>
      </article>`;
    }

    async function init(){
      try{
        const res = await fetch('data/news.json?' + Date.now(), { cache:'no-store' });
        if(!res.ok) throw new Error('HTTP '+res.status);
        items = await res.json();
        items = Array.isArray(items) ? items : [];
        items = items.map(x=>({
          title:String(x?.title||''),
          date:String(x?.date||''),   // JJJJ-MM-TT
          text:String(x?.text||''),
          url :String(x?.url||''),
          image:String(x?.image||'')
        }));
        items.sort((a,b)=>{
          const da=toDate(a.date), db=toDate(b.date);
          if(isNaN(da)&&isNaN(db)) return 0; if(isNaN(da)) return 1; if(isNaN(db)) return -1;
          return db-da;
        });
        cursor=0; grid.innerHTML='';

        if(items.length===0){ emptyHint.style.display='block'; return; }
        renderChunk();
        moreBtn.onclick = renderChunk;
      }catch(e){
        safeLog('news-init', e);
        emptyHint.style.display='block';
      }
    }

    function renderChunk(){
      const end = Math.min(cursor+pageSize, items.length);
      const slice = items.slice(cursor, end);
      if(slice.length===0){ moreBtn.style.display='none'; return; }

      const temp = document.createElement('div');
      temp.innerHTML = slice.map(cardHTML).join('');
      const frag = document.createDocumentFragment();
      while(temp.firstChild){ frag.appendChild(temp.firstChild); }
      grid.appendChild(frag);

      const lazy = grid.querySelectorAll('.news-media.is-loading[data-bg]');
      if(io) lazy.forEach(el=>io.observe(el)); else lazy.forEach(el=>{
        const bg=el.getAttribute('data-bg'); if(bg){ el.style.backgroundImage=`url('${bg}')`; el.classList.remove('is-loading'); el.classList.add('is-loaded'); el.removeAttribute('data-bg'); }
      });

      cursor = end;
      moreBtn.style.display = cursor>=items.length ? 'none' : 'inline-block';
      emptyHint.style.display='none';
    }

    init();
  }catch(e){ safeLog('news', e); }
})();

/* ========= BEWERBUNG: Live-Preview + Mailto (CRLF) ========= */
(function(){
  const root = document.getElementById('bewerbung');
  if(!root) return;

  const firstEl = document.getElementById('bf-firstname');
  const lastEl  = document.getElementById('bf-lastname');
  const phoneEl = document.getElementById('bf-phone');
  const streetEl= document.getElementById('bf-street');
  const houseEl = document.getElementById('bf-houseno');
  const zipEl   = document.getElementById('bf-zip');
  const cityEl  = document.getElementById('bf-city');

  const kidsWrap= document.getElementById('kids-list');
  const addKid  = document.getElementById('add-kid');
  const cta     = document.getElementById('bewerbung-cta');
  const refresh = document.getElementById('refresh-preview');

  const addrSrc = root.querySelector('#bew-addr .copy-source');
  const subjSrc = root.querySelector('#bew-subj .copy-source');
  const bodySrc = root.querySelector('#bew-body .copy-source');

  let CFG = {
    to: 'buergermeisterin@stadt-kw.de',
    subject: 'Bewerbung als Mitglied des Elternbeirats der Stadt Königs Wusterhausen',
    intro: [
      'Sehr geehrte Frau Bürgermeisterin,',
      '',
      'gemäß § 12 Abs. 3 der Hauptsatzung der Stadt Königs Wusterhausen bewerbe ich mich hiermit als Mitglied des Elternbeirats.',
      '',
      'Ich möchte mich aktiv an der Vertretung der Interessen der Kinder und Familien in unserer Stadt beteiligen und einen Beitrag zu einer konstruktiven Zusammenarbeit zwischen Eltern, Einrichtungen und Verwaltung leisten.',
      ''
    ],
    closing: ['Mit freundlichen Grüßen','[VORNAME] [NACHNAME]']
  };

  (async ()=>{
    try{
      const res = await fetch('data/bewerbung.json?' + Date.now(), { cache:'no-store' });
      if(res.ok){
        const data = await res.json();
        CFG = {
          to: data.to || CFG.to,
          subject: data.subject || CFG.subject,
          intro: Array.isArray(data.intro)? data.intro : CFG.intro,
          closing: Array.isArray(data.closing)? data.closing : CFG.closing
        };
      }
    }catch(e){ safeLog('bewerbung-config', e); }
    render();
  })();

  function kidRow(first='', last='', inst=''){
    const row = document.createElement('div');
    row.className='kid-row';
    row.innerHTML = `
      <div class="kid-col">
        <label><span>Vorname des Kindes *</span>
          <input type="text" class="kid-first" placeholder="Vorname" value="${escapeHTML(first)}">
        </label>
      </div>
      <div class="kid-col">
        <label><span>Nachname des Kindes *</span>
          <input type="text" class="kid-last" placeholder="Nachname" value="${escapeHTML(last)}">
        </label>
      </div>
      <div class="kid-col">
        <label><span>Einrichtung *</span>
          <input type="text" class="kid-inst" placeholder="Einrichtung" value="${escapeHTML(inst)}">
        </label>
      </div>
      <div class="kid-actions">
        <button type="button" class="kid-remove btn-neutral">Entfernen</button>
      </div>
    `;
    return row;
  }

  function ensureOneKid(){
    if(!kidsWrap.querySelector('.kid-row')) kidsWrap.appendChild(kidRow());
    updateRemoveButtons();
  }
  function updateRemoveButtons(){
    const rows = kidsWrap.querySelectorAll('.kid-row');
    kidsWrap.querySelectorAll('.kid-remove').forEach(b=> b.disabled = rows.length<=1);
  }
  function readKids(){
    return Array.from(kidsWrap.querySelectorAll('.kid-row')).map(r=>({
      first: (r.querySelector('.kid-first')?.value||'').trim(),
      last:  (r.querySelector('.kid-last')?.value||'').trim(),
      inst:  (r.querySelector('.kid-inst')?.value||'').trim()
    }));
  }

  function buildBodyCRLF(){
    const first = (firstEl?.value||'').trim();
    const last  = (lastEl?.value||'').trim();
    const phone = (phoneEl?.value||'').trim();

    const street= (streetEl?.value||'').trim();
    const house = (houseEl?.value||'').trim();
    const zip   = (zipEl?.value||'').trim();
    const city  = (cityEl?.value||'').trim();

    const addr1 = [street, house].filter(Boolean).join(' ');
    const addr2 = [zip, city].filter(Boolean).join(', ');
    const addr  = [addr1, addr2].filter(Boolean).join(', ');

    const kids = readKids().filter(k => k.first || k.last || k.inst);

    const lines = [...CFG.intro];

    if(kids.length){
      lines.push('Meine Kinder:');
      kids.forEach(k=>{
        const nm = [k.first, k.last].filter(Boolean).join(' ');
        const row = nm && k.inst ? `• ${nm} | ${k.inst}`
                 : (nm || k.inst ? `• ${[nm,k.inst].filter(Boolean).join(' | ')}` : '');
        if(row) lines.push(row);
      });
      lines.push('');
    }

    const contact = [];
    const full = [first,last].filter(Boolean).join(' ');
    if(full)  contact.push(full);
    if(addr)  contact.push(addr);
    if(phone) contact.push(phone);
    if(contact.length){
      lines.push('Kontaktdaten:');
      contact.forEach(c=>lines.push(c));
      lines.push('');
    }

    const closing = CFG.closing.map(l=> l.replace('[VORNAME]', first||'').replace('[NACHNAME]', last||''));
    lines.push(...closing);

    return lines.join('\r\n');
  }

  function isValid(){
    const first=(firstEl?.value||'').trim(), last=(lastEl?.value||'').trim();
    const street=(streetEl?.value||'').trim(), house=(houseEl?.value||'').trim();
    const zip=(zipEl?.value||'').trim(), city=(cityEl?.value||'').trim();
    const kidsOk = readKids().some(k=> k.first && k.last && k.inst);
    const addrOk = !!(street && house && zip && city);
    return !!(first && last && kidsOk && addrOk);
  }

  function render(){
    try{
      const body = buildBodyCRLF();
      const href = `mailto:${encodeURIComponent(CFG.to)}?subject=${encodeURIComponent(CFG.subject)}&body=${encodeURIComponent(body)}`;

      addrSrc && (addrSrc.textContent = CFG.to || '');
      subjSrc && (subjSrc.textContent = CFG.subject || '');
      bodySrc && (bodySrc.textContent = body);

      if(cta){
        cta.setAttribute('href', href);
        cta.setAttribute('aria-disabled', isValid() ? 'false' : 'true');
        cta.title = isValid()
          ? 'E-Mail in deinem Mailprogramm öffnen'
          : 'Bitte Pflichtfelder ausfüllen (Elternname, vollständige Adresse, mind. ein Kind mit Vor-/Nachname & Einrichtung).';
      }
    }catch(e){ safeLog('bewerbung-render', e); }
  }

  // Init + Events
  ensureOneKid();
  addKid?.addEventListener('click', e=>{ e.preventDefault(); kidsWrap.appendChild(kidRow()); updateRemoveButtons(); render(); });
  kidsWrap.addEventListener('click', e=>{
    const btn = e.target.closest('.kid-remove');
    if(!btn) return;
    const rows = kidsWrap.querySelectorAll('.kid-row');
    if(rows.length>1){ btn.closest('.kid-row')?.remove(); updateRemoveButtons(); render(); }
  });

  [firstEl,lastEl,phoneEl,streetEl,houseEl,zipEl,cityEl].forEach(el=> el?.addEventListener('input', render));
  kidsWrap.addEventListener('input', render);
  refresh?.addEventListener('click', (e)=>{ e.preventDefault(); render(); });

  cta?.addEventListener('click', e=>{ if(!isValid()){ e.preventDefault(); alert('Bitte fülle alle Pflichtfelder aus.'); } });

  render();
})();

/* ========= KONTAKT: Zeichenzähler + optionaler Versand ========= */
function initContact(form, endpoint){
  if(!form) return;
  const msg = form.querySelector('#message');
  const cnt = form.querySelector('#msg-count');
  const submit = form.querySelector('#contact-submit');
  const ts = form.querySelector('input[name="ts"]');
  if(ts) ts.value = String(Math.floor(Date.now()/1000));

  function updateCount(){ if(msg && cnt) cnt.textContent = String(msg.value.length); }
  msg?.addEventListener('input', updateCount); updateCount();

  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    if(!submit) return;
    submit.disabled = true;
    try{
      const data = Object.fromEntries(new FormData(form));
      const res = await fetch(endpoint, {
        method:'POST',
        headers:{ 'Content-Type':'application/json', 'Accept':'application/json' },
        body: JSON.stringify(data)
      });
      const json = await res.json().catch(()=>({}));
      if(!res.ok || json.ok===false) throw new Error(json.error || 'Versand fehlgeschlagen');
      alert('Danke! Deine Nachricht wurde gesendet.');
      form.reset();
      if(ts) ts.value = String(Math.floor(Date.now()/1000));
      updateCount();
    }catch(err){
      alert('Senden fehlgeschlagen: ' + (err?.message||'Unbekannter Fehler'));
    }finally{
      submit.disabled = false;
    }
  });
}
function initContactCounterOnly(){
  const form = document.getElementById('contact-form');
  if(!form) return;
  const msg = form.querySelector('#message');
  const cnt = form.querySelector('#msg-count');
  function updateCount(){ if(msg && cnt) cnt.textContent = String(msg.value.length); }
  msg?.addEventListener('input', updateCount); updateCount();
}

/* ========= „Nach oben“-Button ========= */
(function(){
  const btn = document.getElementById('to-top');
  if(!btn) return;

  const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function onScroll(){
    const show = window.scrollY > 400;
    if (show) btn.classList.add('show');
    else btn.classList.remove('show');
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  btn.addEventListener('click', (e)=>{
    e.preventDefault();
    if (prefersReduced) {
      window.scrollTo(0,0);
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    // optional: Fokus nach oben verschieben (A11y)
    const topEl = document.getElementById('top');
    if (topEl) topEl.setAttribute('tabindex', '-1'), topEl.focus({ preventScroll:true });
  });
})();

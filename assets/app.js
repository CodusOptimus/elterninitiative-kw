/* ========== TERMINE: Laden & Rendern ========== */
(async function(){
  const root = document.getElementById('events');
  if(!root) return;

  function clear(){ root.innerHTML=''; }
  const empty = (msg='Aktuell liegen keine kommenden Termine vor.') => {
    root.innerHTML = `<div class="event"><p class="title">${msg}</p><p class="sub">Bitte später erneut prüfen.</p></div>`;
  };

  function coerceItems(json){
    if (Array.isArray(json)) return json;
    if (json && Array.isArray(json.items)) return json.items;
    if (json && json.data && Array.isArray(json.data.items)) return json.data.items;
    if (json && Array.isArray(json.events)) return json.events;
    return [];
  }

  function parseDate(d, t){
    const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(d || '');
    const tm = /^(\d{2}):(\d{2})$/.exec(t || '');
    if (!m) return Number.POSITIVE_INFINITY;
    const dd = +m[1], mm = +m[2]-1, yy = +m[3];
    const hh = tm ? +tm[1] : 0, min = tm ? +tm[2] : 0;
    return new Date(yy, mm, dd, hh, min).getTime();
  }

  try{
    const res = await fetch('data/termine.json?' + Date.now(), { cache: 'no-store' });
    if(!res.ok){ empty('Termine konnten nicht geladen werden (HTTP-Fehler).'); return; }
    const json = await res.json();
    const raw = coerceItems(json);

    const items = raw.map(e => ({
      title: (e && e.title ? String(e.title) : '').trim(),
      date: (e && e.date ? String(e.date) : '').trim(),
      start: (e && e.time && e.time.start ? String(e.time.start) : '').trim(),
      end: (e && e.time && e.time.end ? String(e.time.end) : '').trim(),
      location: (e && e.location ? String(e.location) : '').trim(),
      url: (e && e.detail_url ? String(e.detail_url) : '').trim()
    })).sort((a,b)=> parseDate(a.date,a.start)-parseDate(b.date,b.start)).slice(0,20);

    clear();
    if(!items.length){ empty(); return; }

    root.innerHTML = items.map(e => {
      const time = e.start ? (e.end ? `${e.start}–${e.end} Uhr` : `${e.start} Uhr`) : '';
      const meta = [e.date, time, e.location].filter(Boolean).join(' · ');
      const link = e.url ? `<a href="${e.url}" target="_blank" rel="noopener">Details</a>` : '';
      return `
        <article class="event" role="listitem">
          <h3 class="title">${e.title || 'Sitzung'}</h3>
          <p class="sub">${meta}</p>
          <div class="links">${link}</div>
        </article>
      `;
    }).join('');

  }catch(err){
    console.error('[termine] Fehler:', err);
    empty('Termine konnten nicht geladen werden (Parsingfehler).');
  }
})();

/* ========== PRESSE: Laden, Sortieren, Lazy Loading + „Mehr laden“ (Logo-Heuristik) ========== */
(function(){
  const grid = document.getElementById('news-grid');
  const emptyHint = document.getElementById('news-empty');
  const moreBtn = document.getElementById('news-more');
  if(!grid) return;

  const pageSize = 6;
  let cursor = 0;
  let items = [];

  const toDate = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((s || '').trim());
    if(!m) return NaN;
    return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
  };

  const io = ('IntersectionObserver' in window)
    ? new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          const el = entry.target;
          const bg = el.getAttribute('data-bg');
          if (bg) {
            el.style.backgroundImage = `url('${bg.replace(/'/g, "\\'")}')`;
            el.classList.add('is-loaded');
            el.classList.remove('is-loading');
            el.removeAttribute('data-bg');
          }
          obs.unobserve(el);
        });
      }, { root: null, rootMargin: '200px 0px', threshold: 0.1 })
    : null;

  function isLogoLike(url){
    return /wikipedia|wikimedia|logo|\.svg(\?|$)|rbb24|ardmediathek/i.test(url || '');
  }

  function cardHTML(it){
    const title = (it.title || 'Artikel').toString().trim();
    const url = (it.url || '#').toString().trim();
    const source = (it.source || '').toString().trim();
    const date = (it.date || '').toString().trim();
    const excerpt = (it.excerpt || '').toString().trim();
    const img = (it.image || '').toString().trim();

    const hasImg = !!img;
    const isLogo = hasImg && isLogoLike(img);
    const mediaClass = hasImg
      ? `news-media is-loading${isLogo ? ' news-media--contain' : ''}`
      : 'news-media news-media--placeholder';
    const dataBgAttr = hasImg ? ` data-bg="${img.replace(/"/g, '&quot;')}"` : '';
    const meta = [source, date].filter(Boolean).join(' • ');

    return `
      <article class="news-card" role="listitem">
        <a href="${url}" target="_blank" rel="noopener" aria-label="Zum Artikel: ${title}">
          <div class="${mediaClass}"${dataBgAttr}></div>
        </a>
        <div class="news-body">
          <h3 class="news-title">
            <a href="${url}" target="_blank" rel="noopener">${title}</a>
          </h3>
          <p class="news-excerpt">${excerpt || 'Kurzinfo folgt in Kürze.'}</p>
          <p class="news-meta">${meta || '&nbsp;'}</p>
          <div class="news-actions">
            <a href="${url}" target="_blank" rel="noopener">Zum Artikel</a>
          </div>
        </div>
      </article>
    `;
  }

  function renderChunk(){
    if (!Array.isArray(items) || items.length === 0){
      grid.innerHTML = '';
      if (emptyHint) emptyHint.style.display = 'block';
      if (moreBtn) moreBtn.style.display = 'none';
      return;
    }

    const end = Math.min(cursor + pageSize, items.length);
    const slice = items.slice(cursor, end);

    if (slice.length === 0){
      if (moreBtn) moreBtn.style.display = 'none';
      return;
    }

    const frag = document.createDocumentFragment();
    const temp = document.createElement('div');
    temp.innerHTML = slice.map(cardHTML).join('');
    while (temp.firstChild){
      frag.appendChild(temp.firstChild);
    }
    grid.appendChild(frag);

    if (io){
      grid.querySelectorAll('.news-media.is-loading[data-bg]').forEach(el => io.observe(el));
    }else{
      grid.querySelectorAll('.news-media.is-loading[data-bg]').forEach(el => {
        const bg = el.getAttribute('data-bg');
        if (bg) {
          el.style.backgroundImage = `url('${bg.replace(/'/g, "\\'")}')`;
          el.classList.add('is-loaded');
          el.classList.remove('is-loading');
          el.removeAttribute('data-bg');
        }
      });
    }

    cursor = end;
    if (cursor >= items.length){
      if (moreBtn) moreBtn.style.display = 'none';
    } else {
      if (moreBtn) moreBtn.style.display = 'inline-block';
    }
  }

  async function init(){
    try{
      grid.innerHTML = '';
      if (moreBtn) moreBtn.style.display = 'none';
      if (emptyHint) emptyHint.style.display = 'none';

      const res = await fetch('data/presse.json?' + Date.now(), { cache: 'no-store' });
      if(!res.ok) throw new Error('HTTP ' + res.status);

      let list;
      try { list = await res.json(); }
      catch (e) { console.error('[presse] JSON-Parse-Fehler:', e); list = []; }

      items = Array.isArray(list) ? list.slice() : [];
      items = items.map(it => ({
        title: (it && it.title ? String(it.title) : '').trim(),
        url: (it && it.url ? String(it.url) : '').trim(),
        source: (it && it.source ? String(it.source) : '').trim(),
        date: (it && it.date ? String(it.date) : '').trim(),
        image: (it && it.image ? String(it.image) : '').trim(),
        excerpt: (it && it.excerpt ? String(it.excerpt) : '').trim()
      }));

      items.sort((a,b) => {
        const da = toDate(a.date), db = toDate(b.date);
        if (isNaN(da) && isNaN(db)) return 0;
        if (isNaN(da)) return 1;
        if (isNaN(db)) return -1;
        return db - da;
      });

      cursor = 0;

      if(items.length === 0){
        if (emptyHint) emptyHint.style.display = 'block';
        return;
      }

      renderChunk();
      if (moreBtn){
        moreBtn.removeEventListener('click', renderChunk);
        moreBtn.addEventListener('click', renderChunk);
      }
    }catch(err){
      console.error('[presse] Fehler:', err);
      grid.innerHTML = '';
      if (emptyHint) emptyHint.style.display = 'block';
      if (moreBtn) moreBtn.style.display = 'none';
    }
  }
  init();
})();

/* ========== BEWERBUNG ELTERNBEIRAT: Formular + Kinder add/remove + Mailto/Vorschau ========== */
(async function(){
  const root = document.getElementById('bewerbung');
  if(!root) return;

  // UI-Refs
  const form = document.getElementById('bewerbung-form');
  const firstEl = document.getElementById('bf-firstname');
  const lastEl  = document.getElementById('bf-lastname');
  const phoneEl = document.getElementById('bf-phone');
  const addrEl  = document.getElementById('bf-address');
  const kidsWrap = document.getElementById('kids-list');
  const addKidBtn = document.getElementById('add-kid');
  const cta = document.getElementById('bewerbung-cta');
  const refreshBtn = document.getElementById('refresh-preview');

  const addrSrc = root.querySelector('#bew-addr .copy-source');
  const subjSrc = root.querySelector('#bew-subj .copy-source');
  const bodySrc = root.querySelector('#bew-body .copy-source');

  // Konfiguration laden
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

  try{
    const res = await fetch('data/bewerbung.json?' + Date.now(), { cache: 'no-store' });
    if (res.ok){
      const data = await res.json();
      CFG = {
        to: data.to || CFG.to,
        subject: data.subject || CFG.subject,
        intro: Array.isArray(data.intro) ? data.intro : CFG.intro,
        closing: Array.isArray(data.closing) ? data.closing : CFG.closing
      };
    }
  }catch(err){
    console.warn('[bewerbung] Verwende Default-Konfig (Ladefehler).', err);
  }

  // Hilfsfunktionen
  function kidRow(name='', inst=''){
    const id = 'kid-' + Math.random().toString(36).slice(2,8);
    const row = document.createElement('div');
    row.className = 'kid-row';
    row.innerHTML = `
      <div class="kid-col">
        <label><span>Kind *</span>
          <input type="text" class="kid-name" placeholder="Name des Kindes" value="${name.replace(/"/g,'&quot;')}">
        </label>
      </div>
      <div class="kid-col">
        <label><span>Einrichtung *</span>
          <input type="text" class="kid-inst" placeholder="Name der Einrichtung" value="${inst.replace(/"/g,'&quot;')}">
        </label>
      </div>
      <div class="kid-actions">
        <button type="button" class="kid-remove btn-neutral" aria-label="Kind entfernen" title="Entfernen">Entfernen</button>
      </div>
    `;
    return row;
  }

  function ensureAtLeastOneKid(){
    if (!kidsWrap.querySelector('.kid-row')){
      kidsWrap.appendChild(kidRow());
    }
    updateRemoveButtons();
  }

  function updateRemoveButtons(){
    const rows = kidsWrap.querySelectorAll('.kid-row');
    kidsWrap.querySelectorAll('.kid-remove').forEach(btn => {
      btn.disabled = (rows.length <= 1);
    });
  }

  function readKids(){
    const rows = Array.from(kidsWrap.querySelectorAll('.kid-row'));
    return rows.map(r => ({
      name: (r.querySelector('.kid-name')?.value || '').trim(),
      inst: (r.querySelector('.kid-inst')?.value || '').trim()
    })).filter(k => k.name || k.inst);
  }

  function buildBody(){
    const first = (firstEl.value || '').trim();
    const last  = (lastEl.value || '').trim();
    const phone = (phoneEl.value || '').trim();
    const addr  = (addrEl.value || '').trim();
    const kids  = readKids().filter(k => k.name && k.inst);

    // Intro
    const lines = [...CFG.intro];

    // Kinder-Liste
    if (kids.length){
      lines.push('Meine Kinder:');
      kids.forEach(k => {
        lines.push(`• ${k.name} | ${k.inst}`);
      });
      lines.push('');
    }

    // Kontaktdaten
    const contact = [];
    if (first || last) contact.push(`${first} ${last}`.trim());
    if (addr) contact.push(addr);
    if (phone) contact.push(phone);
    if (contact.length){
      lines.push('Kontaktdaten:');
      contact.forEach(c => lines.push(c));
      lines.push('');
    }

    // Closing (mit Namen ersetzt)
    const closing = CFG.closing.map(l =>
      l.replace('[VORNAME]', first || '').replace('[NACHNAME]', last || '')
    );
    lines.push(...closing);

    return lines.join('\n');
  }

  function buildMailto(){
    const body = buildBody();
    return `mailto:${CFG.to}?subject=${encodeURIComponent(CFG.subject)}&body=${encodeURIComponent(body)}`;
  }

  function validateMinimal(){
    const first = (firstEl.value || '').trim();
    const last  = (lastEl.value || '').trim();
    const validKids = readKids().filter(k => k.name && k.inst);
    return !!(first && last && validKids.length >= 1);
  }

  function renderPreview(){
    // Ziel/Betreff
    if (addrSrc) addrSrc.textContent = CFG.to || '';
    if (subjSrc) subjSrc.textContent = CFG.subject || '';
    // Body
    if (bodySrc) bodySrc.textContent = buildBody();
  }

  // Initiale Kinderzeile und Events
  ensureAtLeastOneKid();
  addKidBtn?.addEventListener('click', () => {
    kidsWrap.appendChild(kidRow());
    updateRemoveButtons();
    renderPreview();
  });
  kidsWrap.addEventListener('click', (e) => {
    const btn = e.target.closest('.kid-remove');
    if (!btn) return;
    const rows = kidsWrap.querySelectorAll('.kid-row');
    if (rows.length > 1){
      btn.closest('.kid-row')?.remove();
      updateRemoveButtons();
      renderPreview();
    }
  });

  // Live-Update bei Eingaben
  [firstEl, lastEl, phoneEl, addrEl].forEach(el => {
    el?.addEventListener('input', renderPreview);
  });
  kidsWrap.addEventListener('input', renderPreview);
  refreshBtn?.addEventListener('click', (e) => { e.preventDefault(); renderPreview(); });

  // CTA → E-Mail öffnen (mit Minimal-Validierung)
  cta?.addEventListener('click', (e) => {
    e.preventDefault();
    if (!validateMinimal()){
      alert('Bitte Vorname, Nachname sowie mindestens ein Kind mit Einrichtung angeben.');
      return;
    }
    const url = buildMailto();
    try { window.location.href = url; } catch(_) {}
    setTimeout(() => {
      try{
        const a = document.createElement('a');
        a.href = url; a.style.display = 'none';
        document.body.appendChild(a); a.click(); a.remove();
      }catch(_){}
    }, 150);
  });

  // Copy-Buttons (delegiert)
  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('.copy-btn');
    if (!btn) return;
    const sel = btn.getAttribute('data-copy');
    if (!sel) return;
    const src = root.querySelector(sel);
    if (!src) return;
    const text = src.innerText.trim();
    try{
      await navigator.clipboard.writeText(text);
      const old = btn.textContent;
      btn.textContent = 'Kopiert';
      btn.disabled = true;
      setTimeout(() => { btn.textContent = old; btn.disabled = false; }, 1200);
    }catch(err){
      console.error('[bewerbung] Copy fehlgeschlagen', err);
    }
  });

  // Erste Vorschau nach Laden
  renderPreview();

  // Optionales Auto-Open, wenn gültig
  try{
    const hash = (location.hash || '').toLowerCase();
    const qs = new URLSearchParams(location.search);
    const wantsAuto = hash.includes('#bewerbung') && (qs.get('auto') === '1' || hash.includes('auto=1'));
    if (wantsAuto && validateMinimal()){
      setTimeout(() => cta?.click(), 300);
    }
  }catch(_){}
})();

/* ========== KONTAKT: Nur Zeichenzähler (kein Versand) ========== */
(function(){
  const form = document.getElementById('contact-form');
  if(!form) return;

  const msg = form.querySelector('#message');
  const cnt = form.querySelector('#msg-count');

  function updateCount(){
    if(!msg || !cnt) return;
    cnt.textContent = String(msg.value.length);
  }
  msg && msg.addEventListener('input', updateCount);
  updateCount();
})();

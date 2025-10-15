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

/* ========== PRESSE: Laden, Sortieren, Lazy Loading + „Mehr laden“ (mit Logo-Heuristik) ========== */
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

/* ========== BEWERBUNG ELTERNBEIRAT: Mailto + Copy-Buttons aus data/bewerbung.json ========== */
(async function(){
  const root = document.getElementById('bewerbung');
  if(!root) return;

  const cta = document.getElementById('bewerbung-cta');
  const addrSrc = root.querySelector('#bew-addr .copy-source');
  const subjSrc = root.querySelector('#bew-subj .copy-source');
  const bodySrc = root.querySelector('#bew-body .copy-source');

  function updateUI(to, subject, bodyLines){
    const bodyText = Array.isArray(bodyLines) ? bodyLines.join('\n') : String(bodyLines || '');
    if (addrSrc) addrSrc.textContent = to || '';
    if (subjSrc) subjSrc.textContent = subject || '';
    if (bodySrc) bodySrc.textContent = bodyText || '';

    function buildMailto(){
      return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`;
    }
    if (cta){
      cta.href = '#';
      cta.addEventListener('click', (e) => {
        e.preventDefault();
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
    }

    // Optional: Auto-Open, wenn gezielt verlinkt
    try{
      const hash = (location.hash || '').toLowerCase();
      const qs = new URLSearchParams(location.search);
      const wantsAuto = hash.includes('#bewerbung') && (qs.get('auto') === '1' || hash.includes('auto=1'));
      if (wantsAuto && cta){
        setTimeout(() => cta.click(), 300);
      }
    }catch(_){}
  }

  try{
    const res = await fetch('data/bewerbung.json?' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    updateUI(data.to || '', data.subject || '', data.body || '');
  }catch(err){
    console.error('[bewerbung] Daten konnten nicht geladen werden:', err);
    // Fallback auf sinnvolle Defaults, damit die Section trotzdem nutzbar bleibt
    updateUI(
      'buergermeisterin@stadt-kw.de',
      'Bewerbung als Mitglied des Elternbeirats der Stadt Königs Wusterhausen',
      [
        'Sehr geehrte Frau Bürgermeisterin,',
        '',
        'gemäß § 12 Abs. 3 der Hauptsatzung der Stadt Königs Wusterhausen bewerbe ich mich hiermit als Mitglied des Elternbeirats.',
        '',
        'Ich möchte mich aktiv an der Vertretung der Interessen der Kinder und Familien in unserer Stadt beteiligen und einen Beitrag zu einer konstruktiven Zusammenarbeit zwischen Eltern, Einrichtungen und Verwaltung leisten.',
        '',
        'Mit freundlichen Grüßen',
        '[Name]',
        '[Kind] | [Einrichtung]',
        '[Telefonnummer] | [Anschrift]'
      ]
    );
  }

  // Delegierter Copy-Handler
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

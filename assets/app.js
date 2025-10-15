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

/* ========== PRESSE: Laden, Sortieren, Lazy Loading + „Mehr laden“ (robust) ========== */
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
    // Konstruktion über Date(yyyy, mm-1, dd) ist robust gegenüber Zeitzonen
    return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
  };

  // IntersectionObserver für Lazy Loading
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

  function cardHTML(it){
    const title = (it.title || 'Artikel').toString().trim();
    const url = (it.url || '#').toString().trim();
    const source = (it.source || '').toString().trim();
    const date = (it.date || '').toString().trim();
    const excerpt = (it.excerpt || '').toString().trim();
    const img = (it.image || '').toString().trim();

    const hasImg = !!img;
    const mediaClass = hasImg ? 'news-media is-loading' : 'news-media news-media--placeholder';
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
    // falls keine Items: sauber räumen & Button verstecken
    if (!Array.isArray(items) || items.length === 0){
      grid.innerHTML = '';
      if (emptyHint) emptyHint.style.display = 'block';
      if (moreBtn) moreBtn.style.display = 'none';
      return;
    }

    const end = Math.min(cursor + pageSize, items.length);
    const slice = items.slice(cursor, end);

    // Nichts mehr zu laden
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

    // Lazy Loading nachregistrieren
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

    // Button-Visibility
    if (cursor >= items.length){
      if (moreBtn) moreBtn.style.display = 'none';
    } else {
      if (moreBtn) moreBtn.style.display = 'inline-block';
    }
  }

  async function init(){
    try{
      // Platzhalter leeren, Button vorsorglich ausblenden bis Daten da sind
      grid.innerHTML = '';
      if (moreBtn) moreBtn.style.display = 'none';
      if (emptyHint) emptyHint.style.display = 'none';

      const res = await fetch('data/presse.json?' + Date.now(), { cache: 'no-store' });
      if(!res.ok) throw new Error('HTTP ' + res.status);

      let list;
      try {
        list = await res.json();
      } catch (e) {
        console.error('[presse] JSON-Parse-Fehler:', e);
        list = [];
      }

      items = Array.isArray(list) ? list.slice() : [];
      // defensiv: felder auf strings trimmen
      items = items.map(it => ({
        title: (it && it.title ? String(it.title) : '').trim(),
        url: (it && it.url ? String(it.url) : '').trim(),
        source: (it && it.source ? String(it.source) : '').trim(),
        date: (it && it.date ? String(it.date) : '').trim(),
        image: (it && it.image ? String(it.image) : '').trim(),
        excerpt: (it && it.excerpt ? String(it.excerpt) : '').trim()
      }));

      // sort: newest first (leere/ungültige Daten ans Ende)
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
        moreBtn.removeEventListener('click', renderChunk); // doppelte Listener vermeiden
        moreBtn.addEventListener('click', renderChunk);
      }
    }catch(err){
      console.error('[presse] Fehler:', err);
      // Fallback: leer + Hinweis
      grid.innerHTML = '';
      if (emptyHint) emptyHint.style.display = 'block';
      if (moreBtn) moreBtn.style.display = 'none';
    }
  }
  init();
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

  // Kein Submit-Handler → aktueller Stand ohne Versand
})();

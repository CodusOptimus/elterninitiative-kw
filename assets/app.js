// ========== TERMINE: Laden & Rendern ==========
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
      title: (e?.title ?? '').toString().trim(),
      date: (e?.date ?? '').toString().trim(),
      start: (e?.time?.start ?? '').toString().trim(),
      end: (e?.time?.end ?? '').toString().trim(),
      location: (e?.location ?? '').toString().trim(),
      url: (e?.detail_url ?? '').toString().trim()
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

// ========== PRESSE: Laden & Rendern ==========
(async function(){
  const grid = document.getElementById('news-grid');
  const emptyHint = document.getElementById('news-empty');
  if(!grid) return;

  // Hilfsfunktion: Datum in ms (YYYY-MM-DD)
  const toDate = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((s || '').trim());
    if(!m) return NaN;
    return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
  };

  try{
    const res = await fetch('data/presse.json?' + Date.now(), { cache: 'no-store' });
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const list = await res.json();
    const items = Array.isArray(list) ? list.slice() : [];

    // ✅ neueste zuerst
    items.sort((a, b) => {
      const da = toDate(a.date);
      const db = toDate(b.date);
      if (isNaN(da) && isNaN(db)) return 0;
      if (isNaN(da)) return 1;
      if (isNaN(db)) return -1;
      return db - da;
    });

    if(items.length === 0){
      grid.innerHTML = '';
      if(emptyHint) emptyHint.style.display = 'block';
      return;
    }

    grid.innerHTML = items.map((it) => {
      const title = (it.title || 'Artikel').trim();
      const url = (it.url || '#').trim();
      const source = (it.source || '').trim();
      const date = (it.date || '').trim();
      const excerpt = (it.excerpt || '').trim();
      const img = (it.image || '').trim();

      const mediaStyle = img ? `style="background-image:url('${img.replace(/"/g,'&quot;')}')"` : '';
      const mediaClass = img ? 'news-media' : 'news-media news-media--placeholder';
      const meta = [source, date].filter(Boolean).join(' • ');

      return `
        <article class="news-card" role="listitem">
          <a href="${url}" target="_blank" rel="noopener" aria-label="Zum Artikel: ${title}">
            <div class="${mediaClass}" ${mediaStyle}></div>
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
    }).join('');

    if(emptyHint) emptyHint.style.display = 'none';
  }catch(err){
    console.error('[presse] Fehler:', err);
    // Platzhalter bleibt stehen
  }
})();

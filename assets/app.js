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

/* ========== PRESSE: Laden, Sortieren, Lazy Loading + „Mehr laden“ ========== */
(function(){
  const grid = document.getElementById('news-grid');
  const emptyHint = document.getElementById('news-empty');
  const moreBtn = document.getElementById('news-more');
  if(!grid) return;

  const pageSize = 6;
  let cursor = 0;
  let items = [];

  // Datum zu ms (YYYY-MM-DD)
  const toDate = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((s || '').trim());
    if(!m) return NaN;
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
    const title = (it.title || 'Artikel').trim();
    const url = (it.url || '#').trim();
    const source = (it.source || '').trim();
    const date = (it.date || '').trim();
    const excerpt = (it.excerpt || '').trim();
    const img = (it.image || '').trim();

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
    const end = Math.min(cursor + pageSize, items.length);
    const slice = items.slice(cursor, end);
    const html = slice.map(cardHTML).join('');
    const temp = document.createElement('div');
    temp.innerHTML = html;
    // Elemente einfügen und ggf. für Lazy Loading beobachten
    while (temp.firstChild){
      const node = temp.firstChild;
      grid.appendChild(node);
      temp.removeChild(node);
    }
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
      const res = await fetch('data/presse.json?' + Date.now(), { cache: 'no-store' });
      if(!res.ok) throw new Error('HTTP ' + res.status);
      const list = await res.json();
      items = Array.isArray(list) ? list.slice() : [];
      // sort: newest first
      items.sort((a,b) => {
        const da = toDate(a.date), db = toDate(b.date);
        if (isNaN(da) && isNaN(db)) return 0;
        if (isNaN(da)) return 1;
        if (isNaN(db)) return -1;
        return db - da;
      });

      grid.innerHTML = '';
      if(items.length === 0){
        if (emptyHint) emptyHint.style.display = 'block';
        if (moreBtn) moreBtn.style.display = 'none';
        return;
      }
      renderChunk();
      if (moreBtn) moreBtn.addEventListener('click', renderChunk);
    }catch(err){
      console.error('[presse] Fehler:', err);
      // Platzhalter bleibt stehen
    }
  }
  init();
})();

/* ========== KONTAKT: Live-Zeichenzähler + mailto-Versand + Bestätigung ========== */
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

  // Hilfsfunktion: Info-Box einfügen (schließbar, auto-hide)
  function showInfo(message){
    // Falls schon vorhanden, erst entfernen
    const old = form.querySelector('.note[data-kind="contact-info"]');
    if (old) old.remove();

    const box = document.createElement('div');
    box.className = 'note';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    box.setAttribute('data-kind', 'contact-info');
    box.style.display = 'flex';
    box.style.justifyContent = 'space-between';
    box.style.alignItems = 'center';
    box.style.gap = '.8rem';
    box.innerHTML = `
      <span>${message}</span>
      <button type="button" aria-label="Hinweis schließen" style="border:none;background:transparent;cursor:pointer;font-weight:700;">×</button>
    `;
    // Oben im Formular einfügen
    form.insertBefore(box, form.firstChild);

    const closeBtn = box.querySelector('button');
    closeBtn.addEventListener('click', () => box.remove());

    // automatisch ausblenden
    setTimeout(() => {
      box.style.transition = 'opacity .3s ease';
      box.style.opacity = '0';
      setTimeout(() => box.remove(), 350);
    }, 6000);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const subject = (f.get('subject') || '').toString().trim();
    const name = (f.get('name') || '').toString().trim();
    const email = (f.get('email') || '').toString().trim();
    const phone = (f.get('phone') || '').toString().trim();
    const message = (f.get('message') || '').toString().trim();

    if (!subject || !name || !email || !message){
      alert('Bitte Betreff, Name, E-Mail und Nachricht ausfüllen.');
      return;
    }
    // very simple email check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
      alert('Bitte eine gültige E-Mail-Adresse angeben.');
      return;
    }

    const to = '[KONTAKT-EMAIL-EINFÜGEN]';
    const bodyLines = [
      `Name: ${name}`,
      `E-Mail: ${email}`,
      phone ? `Telefon: ${phone}` : '',
      '',
      message
    ].filter(Boolean);
    const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyLines.join('\n'))}`;

    // Bestätigungsbox sofort anzeigen (falls Popup-Blocker o.ä. greift, hat der User trotzdem Feedback)
    showInfo('Deine E-Mail wurde vorbereitet. Falls sich kein E-Mail-Fenster öffnet, prüfe bitte deinen Browser oder E-Mail-Client.');

    // mailto öffnen
    window.location.href = mailto;
  });
})();

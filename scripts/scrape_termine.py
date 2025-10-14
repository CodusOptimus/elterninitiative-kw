import json, re, datetime as dt, sys
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup

BASE = "https://sessionnet.owl-it.de/koenigs_wusterhausen/bi"
LIST_URL = f"{BASE}/si0046.asp"

ALLOW_TITLES = [
    "Stadtverordnetenversammlung",
    "Hauptausschuss",
    "Ausschuss für Soziales",
    "Sozialausschuss",
]

BERLIN = ZoneInfo("Europe/Berlin")

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (compatible; ElterninitiativeKWBot/1.1)",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
    "Connection": "close",
})

DATE_RE = re.compile(r"\b(\d{2}\.\d{2}\.\d{4})\b")
TIME_RE = re.compile(r"\b(\d{2}:\d{2})(?:\s*[–-]\s*(\d{2}:\d{2}))?\s*Uhr")

LINK_PATTERNS = (
    "si0057.asp", "si0056.asp", "si0050.asp",  # Sitzungsdetails / Gremien
    "to0040.asp", "to0045.asp", "vo0050.asp",  # Tagesordnung / Vorlagen
    "si00", "to00", "vo00"
)

def log(*args): print("[scraper]", *args)

def month_params(y: int, m: int):
    return {"__cjahr": y, "__cmonat": m}

def fetch(url, params=None) -> str:
    r = SESSION.get(url, params=params, timeout=35)
    r.raise_for_status()
    if r.encoding is None:
        r.encoding = "utf-8"
    return r.text

def normalize(s: str) -> str:
    return " ".join((s or "").split())

def is_allowed(title: str) -> bool:
    t = (title or "").lower()
    return any(k.lower() in t for k in ALLOW_TITLES)

def parse_dt(date_str, time_str):
    if not date_str: return None
    try:
        d = dt.datetime.strptime(date_str, "%d.%m.%Y").date()
    except ValueError:
        return None
    hh, mm = (0, 0)
    if time_str:
        m = re.match(r"^(\d{2}):(\d{2})$", time_str.strip())
        if m:
            hh, mm = int(m.group(1)), int(m.group(2))
    return dt.datetime(d.year, d.month, d.day, hh, mm, tzinfo=BERLIN)

def future_only(items):
    now = dt.datetime.now(BERLIN)
    out = []
    for e in items:
        start_local = parse_dt(e.get("date"), (e.get("time") or {}).get("start"))
        if start_local and start_local >= now:
            out.append(e)
    return out

def dedupe_sort(items):
    seen, out = set(), []
    for e in items:
        key = (e.get("title"), e.get("date"), (e.get("time") or {}).get("start"))
        if key not in seen:
            seen.add(key); out.append(e)
    out.sort(key=lambda e: parse_dt(e.get("date"), (e.get("time") or {}).get("start")) or dt.datetime.max.replace(tzinfo=BERLIN))
    return out

# ----- STRATEGIE A: Link-basierte Extraktion -----
def parse_by_links(soup):
    items = []
    anchors = []
    for pat in LINK_PATTERNS:
        anchors.extend(soup.select(f"a[href*='{pat}']"))
    seen = set()
    for a in anchors:
        txt = normalize(a.get_text(" ", strip=True))
        href = a.get("href") or ""
        if not txt or (txt, href) in seen:
            continue
        seen.add((txt, href))
        # Kontext: suche tr/div/li
        ctx = None
        for p in a.parents:
            if p.name in ("tr","div","li","td"):
                ctx = normalize(p.get_text(" ", strip=True))
                break
        ctx = ctx or txt
        m_date = DATE_RE.search(ctx)
        m_time = TIME_RE.search(ctx)
        date = m_date.group(1) if m_date else None
        t_start = m_time.group(1) if m_time else None
        t_end = m_time.group(2) if (m_time and m_time.group(2)) else None
        title = txt
        # Bei kryptischen Linktexten: Titel aus Kontext nehmen
        if len(title) < 4 and ctx:
            title = ctx
        if not is_allowed(title) and not is_allowed(ctx):
            continue
        detail_url = href if href.startswith("http") else f"{BASE}/{href.lstrip('/')}"
        items.append({
            "title": title,
            "date": date,
            "time": {"start": t_start or "", "end": t_end or ""},
            "location": None,  # ggf. in B/C ermitteln
            "detail_url": detail_url
        })
    return items

# ----- STRATEGIE B: Tabellen-Erkennung (typische SessionNet-Listen) -----
def parse_by_tables(soup):
    items = []
    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        for tr in rows:
            cols = [normalize(td.get_text(" ", strip=True)) for td in tr.find_all(["td","th"])]
            if len(cols) < 2: 
                continue
            # heuristisch: Datum in einer Spalte, irgendwo „Uhr“, irgendwo Titel
            date = next((m.group(1) for c in cols if (m:=DATE_RE.search(c))), None)
            tmp_time = next((m for c in cols if (m:=TIME_RE.search(c))), None)
            t_start = tmp_time.group(1) if tmp_time else ""
            t_end   = tmp_time.group(2) if (tmp_time and tmp_time.group(2)) else ""
            # Titel: die längste Spalte, die nach Zielbegriffen aussieht
            title_candidates = sorted(cols, key=len, reverse=True)[:3]
            title = next((c for c in title_candidates if is_allowed(c)), None)
            if not (date and title):
                continue
            # Suche Ort in Zeile
            loc = None
            for c in cols:
                if re.search(r"(Rathaus|Bürgersaal|Schloss|Bahnhof|\b157\d{2})", c):
                    loc = c; break
            # Link aus Zeile
            href = ""
            a = tr.find("a")
            if a and a.get("href"):
                href = a.get("href")
            detail_url = href if href.startswith("http") else (f"{BASE}/{href.lstrip('/')}" if href else "")
            items.append({
                "title": title,
                "date": date,
                "time": {"start": t_start, "end": t_end},
                "location": loc,
                "detail_url": detail_url
            })
    return items

# ----- STRATEGIE C: Regex-Fallback über Volltext -----
def parse_by_regex_fallback(html_text):
    items = []
    # Sehr grob: „…<Gremium>… DD.MM.YYYY … HH:MM (– HH:MM) Uhr …“
    lines = [normalize(x) for x in html_text.splitlines() if x.strip()]
    for ln in lines:
        if not any(k.lower() in ln.lower() for k in ALLOW_TITLES):
            continue
        m_date = DATE_RE.search(ln)
        m_time = TIME_RE.search(ln)
        if not m_date:
            continue
        title = ln
        date = m_date.group(1)
        t_start = m_time.group(1) if m_time else ""
        t_end   = m_time.group(2) if (m_time and m_time.group(2)) else ""
        items.append({
            "title": title,
            "date": date,
            "time": {"start": t_start, "end": t_end},
            "location": None,
            "detail_url": ""
        })
    return items

def write_text(path: Path, content: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(content, encoding="utf-8")
    tmp.replace(path)

def to_ics(items):
    def fmt(z): return z.strftime("%Y%m%dT%H%M%SZ")
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Elterninitiative KW//Termine//DE",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
    ]
    nowz = dt.datetime.utcnow().replace(tzinfo=dt.timezone.utc)
    for e in items:
        start_local = parse_dt(e.get("date"), (e.get("time") or {}).get("start"))
        if not start_local: 
            continue
        end_local = parse_dt(e.get("date"), (e.get("time") or {}).get("end")) or (start_local + dt.timedelta(hours=2))
        start_utc = start_local.astimezone(dt.timezone.utc)
        end_utc   = end_local.astimezone(dt.timezone.utc)
        uid = f"{fmt(start_utc)}-{abs(hash((e.get('title'), e.get('date'), (e.get('time') or {}).get('start'))))}@elterninitiative-kw"
        title = (e.get("title") or "").replace("\n"," ").strip()
        loc   = (e.get("location") or "").replace("\n"," ").strip()
        url   = (e.get("detail_url") or "").strip()
        lines += [
            "BEGIN:VEVENT",
            f"UID:{uid}",
            f"DTSTAMP:{fmt(nowz)}",
            f"DTSTART:{fmt(start_utc)}",
            f"DTEND:{fmt(end_utc)}",
            f"SUMMARY:{title}",
            f"LOCATION:{loc}",
            f"URL:{url}",
            "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines)

def main():
    today = dt.date.today()
    months = []
    y, m = today.year, today.month
    for _ in range(4):   # aktueller + 3 Folgemonate
        months.append((y, m))
        if m == 12: y, m = y + 1, 1
        else: m += 1

    all_items = []
    for (yy, mm) in months:
        params = {"__cjahr": yy, "__cmonat": mm}
        log("Lade:", LIST_URL, params)
        html = fetch(LIST_URL, params=params)

        # HTML-Debug speichern
        dbg_path = Path(f"data/debug/sessionnet-{yy}-{mm:02d}.html")
        write_text(dbg_path, html)

        soup = BeautifulSoup(html, "html.parser")

        items = []
        # A: Links
        a_items = parse_by_links(soup)
        items.extend(a_items)
        # B: Tabellen
        if len(items) == 0:
            b_items = parse_by_tables(soup)
            items.extend(b_items)
        # C: Regex-Fallback
        if len(items) == 0:
            c_items = parse_by_regex_fallback(html)
            items.extend(c_items)

        log(f"Monat {yy}-{mm:02d}: A={len(a_items)} B={len(b_items) if 'b_items' in locals() else 0} C={len(c_items) if 'c_items' in locals() else 0} -> total {len(items)}")

        all_items.extend(items)

    # Nur erlaubte Titel + zukünftige Termine
    filtered = [e for e in all_items if is_allowed(e.get("title","")) or is_allowed(e.get("detail_url",""))]
    future = future_only(filtered)
    final_items = dedupe_sort(future)

    payload = {
        "source": LIST_URL,
        "generated_at": dt.datetime.utcnow().isoformat() + "Z",
        "filters": ALLOW_TITLES,
        "timezone": "Europe/Berlin",
        "months_loaded": months,
        "items": final_items[:200],
    }
    write_text(Path("data/termine.json"), json.dumps(payload, ensure_ascii=False, indent=2))
    write_text(Path("data/termine.ics"), to_ics(final_items[:200]))
    log(f"Finale Einträge: {len(final_items)} | JSON/ICS geschrieben | Debug: data/debug/*.html")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log("ERROR:", repr(e))
        sys.exit(1)

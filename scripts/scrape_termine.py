import json, re, datetime as dt, sys
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup

BASE = "https://sessionnet.owl-it.de/koenigs_wusterhausen/bi"
LIST_URL = f"{BASE}/si0046.asp"

# Welche Gremien behalten?
ALLOW_TITLES = [
    "Stadtverordnetenversammlung",
    "Hauptausschuss",
    "Ausschuss für Soziales",
    "Sozialausschuss",
]

BERLIN = ZoneInfo("Europe/Berlin")

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (compatible; ElterninitiativeKWBot/1.0)",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
    "Connection": "close",
})

def log(*args): print("[scraper]", *args)

def fetch(url, params=None) -> str:
    r = SESSION.get(url, params=params, timeout=30)
    r.raise_for_status()
    # Manche .asp-Seiten kommen in ISO-8859-1 / Windows-1252 – Requests rät, aber wir setzen hart UTF-8 fallback.
    if r.encoding is None:
        r.encoding = "utf-8"
    return r.text

def normalize(s: str) -> str:
    return " ".join((s or "").split())

def find_context_text(a_tag):
    # Suche sinnvollen Kontext: erst <tr>, sonst <div>, sonst parent
    for parent in a_tag.parents:
        if parent.name in ("tr", "div", "li"):
            return normalize(parent.get_text(" ", strip=True))
    return normalize(a_tag.get_text(" ", strip=True))

DATE_RE = re.compile(r"\b(\d{2}\.\d{2}\.\d{4})\b")
TIME_RE = re.compile(r"\b(\d{2}:\d{2})(?:-(\d{2}:\d{2}))?\s*Uhr")

def parse_list(html):
    soup = BeautifulSoup(html, "html.parser")
    # Primär: Detailseite si0057.asp, evtl. auch andere „si00xx.asp“-Detail-IDs
    detail_links = soup.select("a[href*='si0057.asp'], a[href*='si0056.asp'], a[href*='si00']")
    log("Detail-Links gefunden:", len(detail_links))
    out = []
    for a in detail_links:
        title = normalize(a.get_text(strip=True))
        if not title:
            continue
        href = a.get("href") or ""
        detail_url = href if href.startswith("http") else f"{BASE}/{href.lstrip('/')}"
        ctx = find_context_text(a)

        # Datum
        m_date = DATE_RE.search(ctx)
        date_str = m_date.group(1) if m_date else None

        # Zeit
        m_time = TIME_RE.search(ctx)
        start_str = m_time.group(1) if m_time else None
        end_str   = m_time.group(2) if (m_time and m_time.group(2)) else None

        # Ort (Heuristiken; erweitern bei Bedarf)
        loc = None
        for pat in (r"Rathaus[^,;]*", r"Bürgersaal[^,;]*", r"Schloss[^,;]*", r"Bahnhof[^,;]*", r"\b157\d{2}[^,;]*"):
            m_loc = re.search(pat, ctx)
            if m_loc:
                loc = m_loc.group(0).strip()
                break

        out.append({
            "title": title,
            "date": date_str,
            "time": {"start": start_str, "end": end_str},
            "location": loc,
            "detail_url": detail_url
        })
    # Debug: Erste Beispiele
    for i, e in enumerate(out[:3]):
        log(f"Beispiel {i+1}:", e["title"], e["date"], e["time"])
    return out

def keep_allowed(title: str) -> bool:
    t = (title or "").lower()
    return any(k.lower() in t for k in ALLOW_TITLES)

def parse_dt(date_str, time_str):
    if not date_str:
        return None
    try:
        d = dt.datetime.strptime(date_str, "%d.%m.%Y").date()
    except ValueError:
        return None
    hh, mm = (0, 0)
    if time_str:
        try:
            hh, mm = map(int, time_str.split(":"))
        except Exception:
            pass
    return dt.datetime(d.year, d.month, d.day, hh, mm, tzinfo=BERLIN)

def future_only(items):
    now = dt.datetime.now(BERLIN)
    out = []
    for e in items:
        start_local = parse_dt(e["date"], e["time"]["start"] if e.get("time") else None)
        if start_local and start_local >= now:
            out.append(e)
    log("Zukünftige Einträge:", len(out))
    return out

def dedupe_sort(items):
    seen, out = set(), []
    for e in items:
        key = (e["title"], e["date"], e["time"]["start"] if e.get("time") else None)
        if key not in seen:
            seen.add(key); out.append(e)
    def sort_key(e):
        dt_obj = parse_dt(e["date"], e["time"]["start"] if e.get("time") else None)
        return dt_obj or dt.datetime.max.replace(tzinfo=BERLIN)
    out.sort(key=sort_key)
    return out

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
        start_local = parse_dt(e["date"], e["time"]["start"] if e.get("time") else None)
        if not start_local: 
            continue
        if e.get("time") and e["time"].get("end"):
            end_local = parse_dt(e["date"], e["time"]["end"])
        else:
            end_local = start_local + dt.timedelta(hours=2)
        start_utc = start_local.astimezone(dt.timezone.utc)
        end_utc   = end_local.astimezone(dt.timezone.utc)
        uid = f"{fmt(start_utc)}-{abs(hash((e['title'], e['date'], e['time'].get('start') if e.get('time') else '')))}@elterninitiative-kw"
        title = (e["title"] or "").replace("\n"," ").strip()
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

def write_text(path: Path, content: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(content, encoding="utf-8")
    tmp.replace(path)

def main():
    log("Lade", LIST_URL)
    html = fetch(LIST_URL)
    all_items = parse_list(html)
    log("Gesamt gefunden:", len(all_items))

    filtered = [e for e in all_items if keep_allowed(e["title"])]
    log("Nach Filter", ALLOW_TITLES, ":", len(filtered))

    future = future_only(filtered)
    final_items = dedupe_sort(future)
    log("Final (sort+dedupe):", len(final_items))

    payload = {
        "source": LIST_URL,
        "generated_at": dt.datetime.utcnow().isoformat() + "Z",
        "filters": ALLOW_TITLES,
        "timezone": "Europe/Berlin",
        "items": final_items[:200],
    }
    write_text(Path("data/termine.json"), json.dumps(payload, ensure_ascii=False, indent=2))
    write_text(Path("data/termine.ics"), to_ics(final_items[:200]))
    log("geschrieben: data/termine.json & data/termine.ics")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log("ERROR:", repr(e))
        sys.exit(1)

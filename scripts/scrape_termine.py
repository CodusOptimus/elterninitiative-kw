import json, re, datetime as dt
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

def fetch(url, params=None):
    r = requests.get(url, params=params, timeout=30)
    r.raise_for_status()
    return r.text

def normalize_spaces(s: str) -> str:
    return " ".join((s or "").split())

def parse_list(html):
    soup = BeautifulSoup(html, "lxml")
    out = []
    for a in soup.select("a[href*='si0057.asp']"):
        title = normalize_spaces(a.get_text(strip=True))
        href = a.get("href") or ""
        detail_url = href if href.startswith("http") else f"{BASE}/{href.lstrip('/')}"
        block = normalize_spaces(a.find_parent().get_text(" ", strip=True))
        m_date = re.search(r"\b(\d{2}\.\d{2}\.\d{4})\b", block)
        date_str = m_date.group(1) if m_date else None
        m_time = re.search(r"\b(\d{2}:\d{2})(?:-(\d{2}:\d{2}))?\s*Uhr", block)
        start_str = m_time.group(1) if m_time else None
        end_str   = m_time.group(2) if (m_time and m_time.group(2)) else None
        loc = None
        m_loc = re.search(r"(Rathaus.*|Bürgersaal.*|Bahnhof.*|Schloss.*|^\d{5}.*)", block)
        if m_loc:
            loc = m_loc.group(1)
        out.append({
            "title": title,
            "date": date_str,
            "time": {"start": start_str, "end": end_str},
            "location": loc,
            "detail_url": detail_url
        })
    return out

def keep_allowed_title(title: str) -> bool:
    t = title.lower()
    return any(k.lower() in t for k in ALLOW_TITLES)

def parse_dt(date_str, time_str):
    if not date_str:
        return None
    d = dt.datetime.strptime(date_str, "%d.%m.%Y").date()
    if time_str:
        hh, mm = map(int, time_str.split(":"))
        return dt.datetime(d.year, d.month, d.day, hh, mm, tzinfo=BERLIN)
    return dt.datetime(d.year, d.month, d.day, 0, 0, tzinfo=BERLIN)

def future_only(items):
    now = dt.datetime.now(BERLIN)
    return [e for e in items if parse_dt(e["date"], e["time"]["start"] if e["time"] else None) >= now]

def dedupe_sort(items):
    seen = set()
    out = []
    for e in items:
        key = (e["title"], e["date"], e["time"]["start"] if e["time"] else None)
        if key not in seen:
            seen.add(key)
            out.append(e)
    def sort_key(e):
        dt_obj = parse_dt(e["date"], e["time"]["start"] if e["time"] else None)
        return dt_obj or dt.datetime.max.replace(tzinfo=BERLIN)
    out.sort(key=sort_key)
    return out

def to_ics(items):
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Elterninitiative KW//Termine//DE",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
    ]
    for e in items:
        start_local = parse_dt(e["date"], e["time"]["start"] if e["time"] else None)
        if not start_local:
            continue
        if e["time"] and e["time"]["end"]:
            end_local = parse_dt(e["date"], e["time"]["end"])
        else:
            end_local = start_local + dt.timedelta(hours=2)
        start_utc = start_local.astimezone(dt.timezone.utc)
        end_utc   = end_local.astimezone(dt.timezone.utc)
        def fmt(dtobj): return dtobj.strftime("%Y%m%dT%H%M%SZ")
        uid = f"{fmt(start_utc)}-{abs(hash(e['title']))}@elterninitiative-kw"
        title = e["title"]
        loc   = e["location"] or ""
        url   = e["detail_url"] or ""
        lines += [
            "BEGIN:VEVENT",
            f"UID:{uid}",
            f"DTSTAMP:{fmt(dt.datetime.utcnow().replace(tzinfo=dt.timezone.utc))}",
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
    html = fetch(LIST_URL)
    raw = parse_list(html)
    filtered = [e for e in raw if keep_allowed_title(e["title"])]
    future = future_only(filtered)
    final_items = dedupe_sort(future)
    Path("data").mkdir(parents=True, exist_ok=True)
    payload = {
        "source": LIST_URL,
        "generated_at": dt.datetime.utcnow().isoformat() + "Z",
        "filters": ALLOW_TITLES,
        "timezone": "Europe/Berlin",
        "items": final_items[:200],
    }
    Path("data/termine.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    Path("data/termine.ics").write_text(to_ics(final_items[:200]), encoding="utf-8")
    print(f"Saved {len(final_items)} upcoming items → data/termine.json & data/termine.ics")

if __name__ == "__main__":
    main()

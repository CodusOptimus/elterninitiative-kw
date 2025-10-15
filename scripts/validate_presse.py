import json, re, sys, pathlib

PATH = pathlib.Path("data/presse.json")
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

def fail(msg):
    print(f"[validate_presse] ERROR: {msg}")
    sys.exit(1)

def main():
    if not PATH.exists():
        fail("data/presse.json nicht gefunden.")
    try:
        data = json.loads(PATH.read_text(encoding="utf-8"))
    except Exception as e:
        fail(f"JSON konnte nicht geparst werden: {e!r}")

    if not isinstance(data, list):
        fail("Erwarte ein Array von Artikeln.")

    for i, it in enumerate(data):
        ctx = f"Eintrag #{i+1}"
        if not isinstance(it, dict):
            fail(f"{ctx}: muss ein Objekt sein.")
        for key in ["title", "url", "source", "date", "image", "excerpt"]:
            if key not in it:
                fail(f"{ctx}: Feld '{key}' fehlt.")
        title = str(it["title"]).strip()
        url = str(it["url"]).strip()
        source = str(it["source"]).strip()
        date = str(it["date"]).strip()
        image = str(it["image"]).strip()
        # excerpt darf leer sein, aber muss als String vorliegen
        _ = str(it["excerpt"])

        if not title:
            fail(f"{ctx}: 'title' darf nicht leer sein.")
        if not (url.startswith("http://") or url.startswith("https://")):
            fail(f"{ctx}: 'url' muss mit http:// oder https:// beginnen.")
        if not ISO_DATE.match(date):
            fail(f"{ctx}: 'date' muss im Format YYYY-MM-DD sein (z.B. 2025-10-14).")
        if image and not (image.startswith("http://") or image.startswith("https://")):
            fail(f"{ctx}: 'image' muss mit http:// oder https:// beginnen oder leer sein.")
        if not source:
            fail(f"{ctx}: 'source' darf nicht leer sein.")

    print("[validate_presse] OK: Schema geprüft, alles in Ordnung.")

if __name__ == "__main__":
    main()

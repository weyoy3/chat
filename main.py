import os, json, time, re, calendar, struct
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urljoin
import requests
import feedparser
from bs4 import BeautifulSoup

# ================= الإعدادات =================
SOURCES = [
    {"name": "elbalad",  "url": "https://www.elbalad.news/rss.aspx",              "interval": 7},
    {"name": "youm7",    "url": "https://youm7.com/rss/SectionRss?SectionID=328",  "interval": 10},
    {"name": "masrawy",  "url": "https://www.masrawy.com/feeds/rssfeedlist?fullfeed=1", "interval": 15},
]

OWN_DOMAINS = ["elbalad", "youm7", "masrawy"]

PAGE_ID        = "حط_معرف_صفحتك"
PAGE_TOKEN     = "حط_توكن_الصفحة"
STATE_FILE     = "posted.json"
TIMERS_FILE    = "timers.json"
TXT_LOG        = "posts.txt"
MAX_POSTS      = 1
CHECK_EVERY    = 120
MAX_AGE_MINUTES = 30
# =============================================

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
URL_RE = re.compile(r"\S+\.(?:com|net|org|gov\.eg|edu\.eg|eg|io|news)\S*", re.I)

BAD_IMG_WORDS = ["icon", "logo", "print", "share", "button", "whatsapp", "facebook",
                 "twitter", "emoji", "arrow", "next", "prev", "placeholder", "loading",
                 "blank", "spinner", "default", "sprite", "avatar", "banner"]

def clean_urls(text):
    def repl(m):
        u = m.group(0).lower()
        return "" if any(d in u for d in OWN_DOMAINS) else m.group(0)
    return URL_RE.sub(repl, text)

def normalize(t):
    t = re.sub(r"[\u064B-\u065F\u0670\u0640]", "", t)
    return re.sub(r"\s+", " ", t).strip()

def image_size(url):
    """بيقيس المقاس الحقيقي للصورة من أول بايتات بس"""
    try:
        with requests.get(url, headers=HEADERS, timeout=15, stream=True) as r:
            if r.status_code != 200:
                return (0, 0)
            r.raw.decode_content = True
            d = r.raw.read(65536)
        if d[:8] == b"\x89PNG\r\n\x1a\n":
            return struct.unpack(">II", d[16:24])
        if d[:6] in (b"GIF87a", b"GIF89a"):
            return struct.unpack("<HH", d[6:10])
        if d[:2] == b"\xff\xd8":  # JPEG
            i = 2
            while i < len(d) - 9:
                if d[i] != 0xFF:
                    i += 1
                    continue
                m = d[i+1]
                if m in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
                         0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                    h, w = struct.unpack(">HH", d[i+5:i+9])
                    return (w, h)
                if m in (0xD8, 0x01) or 0xD0 <= m <= 0xD7:
                    i += 2
                else:
                    i += 2 + struct.unpack(">H", d[i+2:i+4])[0]
            return (0, 0)
        if d[:4] == b"RIFF" and d[8:12] == b"WEBP":
            if d[12:16] == b"VP8 ":
                w, h = struct.unpack("<HH", d[26:30])
                return (w & 0x3FFF, h & 0x3FFF)
            if d[12:16] == b"VP8L":
                b = struct.unpack("<I", d[21:25])[0]
                return ((b & 0x3FFF) + 1, ((b >> 14) & 0x3FFF) + 1)
    except Exception:
        pass
    return (0, 0)

def is_fresh(entry):
    tp = entry.get("published_parsed") or entry.get("updated_parsed")
    if not tp:
        return True
    return (time.time() - calendar.timegm(tp)) / 60.0 <= MAX_AGE_MINUTES

def page_titles():
    try:
        r = requests.get(f"https://graph.facebook.com/v20.0/{PAGE_ID}/feed",
                         params={"access_token": PAGE_TOKEN, "limit": 50}, timeout=20)
        out = []
        for p in r.json().get("data", []):
            first = normalize((p.get("message") or "").split("\n")[0])
            if first:
                out.append(first)
        return out
    except Exception:
        return []

def is_duplicate(title, recent):
    t = normalize(title)
    for r in recent:
        if t == r or (len(t) > 20 and (t in r or r in t)) or t[:35] == r[:35]:
            return True
    return False

def load_state():
    if os.path.exists(STATE_FILE):
        try:
            data = json.load(open(STATE_FILE, encoding="utf-8"))
            if isinstance(data, dict):
                return data.get("links", []), data.get("titles", [])
            return data, []
        except Exception:
            return [], []
    return [], []

def save_state(links, titles):
    json.dump({"links": links, "titles": titles},
              open(STATE_FILE, "w", encoding="utf-8"), ensure_ascii=False)

def load_timers():
    if os.path.exists(TIMERS_FILE):
        try:
            return json.load(open(TIMERS_FILE, encoding="utf-8"))
        except Exception:
            pass
    return {s["name"]: 0 for s in SOURCES}

def save_timers(timers):
    json.dump(timers, open(TIMERS_FILE, "w", encoding="utf-8"), ensure_ascii=False)

def save_to_txt(title, text, link, source_name):
    with open(TXT_LOG, "a", encoding="utf-8") as f:
        f.write(f"===== {time.strftime('%Y-%m-%d %H:%M')} | {source_name} =====\n")
        f.write(title + "\n\n")
        f.write(text + "\n")
        f.write("الرابط الأصلي: " + link + "\n\n")

def pick_image(soup, article_url):
    candidates = []
    for tag in soup.select("figure img, article img, .article-body img, .article-content img, .entry-content img"):
        src = tag.get("data-src") or tag.get("data-original") or tag.get("data-lazy-src") or tag.get("src") or ""
        low = src.lower()
        if not src or low.startswith("data:"):
            continue
        if low.endswith((".svg", ".gif")):
            continue
        if any(k in low for k in BAD_IMG_WORDS):
            continue
        candidates.append(urljoin(article_url, src))

    # نقيس المقاس الحقيقي لأول 4 صور ونختار أول واحدة كبيرة
    for src in candidates[:4]:
        w, h = image_size(src)
        print(f"   🖼️  {w}x{h} <- {src[:70]}")
        if w >= 400 and h >= 250:
            return src

    # احتياطي: صورة المشاركة الرسمية
    og = soup.find("meta", property="og:image")
    if og and og.get("content"):
        return urljoin(article_url, og["content"])
    return None

def fetch_article(url):
    soup = BeautifulSoup(requests.get(url, headers=HEADERS, timeout=30).text, "html.parser")

    for br in soup.find_all("br"):
        br.replace_with("\n")
    for li in soup.find_all("li"):
        li.replace_with("\n• " + li.get_text(" ") + "\n")

    paras = []
    for p in soup.find_all("p"):
        raw = re.sub(r"[ \t]+", " ", p.get_text(" "))
        raw = raw.replace("\n ", "\n").replace(" \n", "\n").strip()
        if len(raw) > 50:
            paras.append(raw)
    text = "\n\n".join(paras)

    for stop in ["اقرأ أيضاً", "اقرأ ايضا", "شارك الخبر", "تابعنا"]:
        text = text.split(stop)[0]

    text = re.sub(r"[^\n]*اضغط هنا[^\n]*", "", text)
    text = re.sub(r"[^\n]*هذا الرابط[^\n]*", "", text)
    text = clean_urls(text)
    text = re.sub(r"\n{3,}", "\n\n", text)

    image = pick_image(soup, url)
    return text.strip(), image

def post_facebook(title, text, image):
    message = f"{title}\n\n{text}"
    if len(message) > 4500:
        message = message[:4500] + " ..."
    if image:
        r = requests.post(f"https://graph.facebook.com/v20.0/{PAGE_ID}/photos",
                          data={"url": image, "caption": message, "access_token": PAGE_TOKEN})
    else:
        r = requests.post(f"https://graph.facebook.com/v20.0/{PAGE_ID}/feed",
                          data={"message": message, "access_token": PAGE_TOKEN})
    return r.json()

def process_source(source, links, titles, recent, timers):
    name = source["name"]
    url  = source["url"]
    now = time.time()

    if (now - timers.get(name, 0)) < source["interval"] * 60:
        return links, titles, recent, timers, False

    try:
        entries = feedparser.parse(url).entries
        print(f"🔍 [{name}] found {len(entries)} entries")
    except Exception as ex:
        print(f"❌ [{name}] error: {ex}")
        timers[name] = now
        return links, titles, recent, timers, False

    count = 0
    for e in entries:
        if count >= MAX_POSTS:
            break
        if not is_fresh(e):
            continue
        t = normalize(e.title)
        if e.link in links or t in titles:
            continue
        if is_duplicate(e.title, recent):
            print(f"⏭️ [{name}] duplicate — skipping")
            links.append(e.link); titles.append(t)
            continue

        print(f"📰 [{name}] processing: {e.title}")
        text, image = fetch_article(e.link)
        if not text:
            continue
        result = post_facebook(e.title, text, image)
        print(f"✅ [{name}] posted:", result.get("id", "unknown"))
        save_to_txt(e.title, text, e.link, name)

        links.append(e.link)
        titles.append(t)
        recent.append(t)
        count += 1
        time.sleep(2)

    timers[name] = now
    return links, titles, recent, timers, True

def main():
    class _H(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"alive")
        def log_message(self, *a): pass

    port = int(os.environ.get("PORT", 8080))
    threading.Thread(target=lambda: HTTPServer(("0.0.0.0", port), _H).serve_forever(),
                     daemon=True).start()
    print("❤️ Heartbeat server started on port", port)
    print("🤖 Bot started on Render!")

    if not os.path.exists(STATE_FILE):
        links, titles = [], []
        for s in SOURCES:
            try:
                for e in feedparser.parse(s["url"]).entries:
                    links.append(e.link)
                    titles.append(normalize(e.title))
            except Exception:
                pass
        save_state(links, titles)
        save_timers({s["name"]: time.time() for s in SOURCES})
        print("📋 Baseline saved — هستنى الأخبار الجديدة بس")
    else:
        links, titles = load_state()

    timers = load_timers()

    while True:
        try:
            recent = page_titles()
            for s in SOURCES:
                links, titles, recent, timers, _ = \
                    process_source(s, links, titles, recent, timers)
            save_state(links, titles)
            save_timers(timers)
            print(f"💤 Sleeping {CHECK_EVERY}s...")
            time.sleep(CHECK_EVERY)
        except Exception as ex:
            print("❌ Error:", ex)
            time.sleep(300)

if __name__ == "__main__":
    main()

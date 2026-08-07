import os, json, time, re, calendar
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urljoin
import requests
import feedparser
from bs4 import BeautifulSoup

# ================= الإعدادات =================
RSS_URLS = [
    "https://www.elbalad.news/rss.aspx",
    "https://youm7.com/rss/SectionRss?SectionID=328",
    "https://www.masrawy.com/feeds/rssfeedlist?fullfeed=1",
]

OWN_DOMAINS = ["elbalad", "youm7", "masrawy"]

PAGE_ID        = "1204286986111478"
PAGE_TOKEN     = "EAAfY71sMZAikBSBoRGZBeZAPEwjbKIeDa9S25fLsceSEjI5cZA7Ymo4XSM3mdinqZCNI1Pa5ActYK6cDOkaTcvDUr5oNKLLL0od6C2YY942zAKnpWMKKHTXycUJVOWNjslUJvF9Pi7D5FNFFBhre3hFZAZCIOORdpiKEJZBrG6ZCkgXz13dRDQtFc8w6HnzOcSJOStfjEufFK"
STATE_FILE     = "posted.json"
TXT_LOG        = "posts.txt"
MAX_POSTS      = 1
SLEEP_SECONDS  = 420
MAX_AGE_MINUTES = 30
# =============================================

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

URL_RE = re.compile(r"\S+\.(?:com|net|org|gov\.eg|edu\.eg|eg|io|news)\S*", re.I)

def clean_urls(text):
    def repl(m):
        u = m.group(0).lower()
        return "" if any(d in u for d in OWN_DOMAINS) else m.group(0)
    return URL_RE.sub(repl, text)

def normalize(t):
    t = re.sub(r"[\u064B-\u065F\u0670\u0640]", "", t)
    return re.sub(r"\s+", " ", t).strip()

def is_fresh(entry):
    tp = entry.get("published_parsed") or entry.get("updated_parsed")
    if not tp:
        return True
    age_minutes = (time.time() - calendar.timegm(tp)) / 60.0
    return age_minutes <= MAX_AGE_MINUTES

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

def save_to_txt(title, text, link):
    with open(TXT_LOG, "a", encoding="utf-8") as f:
        f.write(f"===== {time.strftime('%Y-%m-%d %H:%M')} =====\n")
        f.write(title + "\n\n")
        f.write(text + "\n")
        f.write("الرابط الأصلي: " + link + "\n\n")

def pick_image(soup):
    for tag in soup.select("figure img, article img, .article-body img, .article-content img, .entry-content img"):
        src = tag.get("data-src") or tag.get("data-original") or tag.get("src") or ""
        low = src.lower()
        if not src or low.startswith("data:"):
            continue
        if low.endswith((".svg", ".gif")):
            continue
        if any(k in low for k in ["icon", "logo", "print", "share", "button",
                                  "whatsapp", "facebook", "twitter", "emoji"]):
            continue
        try:
            w = int(tag.get("width") or 0)
            h = int(tag.get("height") or 0)
        except ValueError:
            w = h = 0
        if (w and w < 300) or (h and h < 200):
            continue
        return src
    og = soup.find("meta", property="og:image")
    return og["content"] if og else None

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

    image = pick_image(soup)
    if image:
        image = urljoin(url, image)
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
    while True:
        try:
            all_entries = []
            for url in RSS_URLS:
                try:
                    entries = feedparser.parse(url).entries
                    all_entries += entries
                    print(f"✅ {url}: {len(entries)} entries")
                except Exception as ex:
                    print(f"❌ {url}: {ex}")

            all_entries.sort(key=lambda e: e.get("published_parsed")
                             or e.get("updated_parsed") or time.gmtime(),
                             reverse=True)

            links, titles = load_state()

            if not os.path.exists(STATE_FILE):
                for e in all_entries:
                    links.append(e.link)
                    titles.append(normalize(e.title))
                save_state(links, titles)
                print("📋 Baseline saved — هستنى الأخبار الجديدة بس")
                time.sleep(SLEEP_SECONDS)
                continue

            recent = page_titles()
            count = 0
            for e in all_entries:
                if count >= MAX_POSTS:
                    break
                if not is_fresh(e):
                    continue
                t = normalize(e.title)
                if e.link in links or t in titles:
                    continue
                if is_duplicate(e.title, recent):
                    print("⏭️ Duplicate — skipping:", e.title)
                    links.append(e.link)
                    titles.append(t)
                    save_state(links, titles)
                    continue
                print("📰 Processing:", e.title)
                text, image = fetch_article(e.link)
                if not text:
                    continue
                result = post_facebook(e.title, text, image)
                print("✅ Posted:", result.get("id", "unknown"))
                save_to_txt(e.title, text, e.link)
                links.append(e.link)
                titles.append(t)
                recent.append(t)
                save_state(links, titles)
                count += 1
                time.sleep(3)

            print("💤 Sleeping 7 minutes...")
            time.sleep(SLEEP_SECONDS)
        except Exception as ex:
            print("❌ Error:", ex)
            time.sleep(300)

if __name__ == "__main__":
    main()

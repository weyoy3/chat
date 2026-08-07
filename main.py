import os, json, time, re
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
import requests
import feedparser
from bs4 import BeautifulSoup

# ================= الإعدادات =================
RSS_URL       = "https://www.elbalad.news/rss.aspx"
PAGE_ID       = "حط_معرف_صفحتك"
PAGE_TOKEN    = "حط_توكن_الصفحة"
STATE_FILE    = "posted.json"
TXT_LOG       = "posts.txt"
MAX_POSTS     = 1
SLEEP_SECONDS = 420          # كل 7 دقائق
# =============================================

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

URL_RE = re.compile(r"\S+\.(?:com|net|org|gov\.eg|edu\.eg|eg|io|news)\S*", re.I)

def clean_urls(text):
    """بيمسح روابط الجريدة بس — ويسيب أي رابط خارجي"""
    def repl(m):
        return "" if "elbalad" in m.group(0).lower() else m.group(0)
    return URL_RE.sub(repl, text)

def normalize(t):
    t = re.sub(r"[\u064B-\u065F\u0670\u0640]", "", t)
    return re.sub(r"\s+", " ", t).strip()

def already_on_page(title):
    t = normalize(title)
    try:
        r = requests.get(f"https://graph.facebook.com/v20.0/{PAGE_ID}/feed",
                         params={"access_token": PAGE_TOKEN, "limit": 20}, timeout=20)
        for p in r.json().get("data", []):
            first_line = (p.get("message") or "").split("\n")[0]
            if normalize(first_line) == t:
                return True
    except Exception:
        pass
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

    # فك القوائم: كل <br> وكل عنصر قائمة يبقى سطر مستقل
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

    # قص الذيول الإعلانية
    for stop in ["اقرأ أيضاً", "اقرأ ايضا", "شارك الخبر", "تابعنا"]:
        text = text.split(stop)[0]

    # مسح جمل "اضغط هنا / هذا الرابط"
    text = re.sub(r"[^\n]*اضغط هنا[^\n]*", "", text)
    text = re.sub(r"[^\n]*هذا الرابط[^\n]*", "", text)

    # مسح روابط الجريدة فقط (الخارجية بتفضل)
    text = clean_urls(text)

    # تنظيف الأسطر الفاضية المتكررة
    text = re.sub(r"\n{3,}", "\n\n", text)

    image = pick_image(soup)
    if image and image.startswith("/"):
        image = "https://www.elbalad.news" + image
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
            feed = feedparser.parse(RSS_URL)
            links, titles = load_state()

            if not os.path.exists(STATE_FILE):
                for e in feed.entries:
                    links.append(e.link)
                    titles.append(normalize(e.title))
                save_state(links, titles)
                print("📋 Baseline saved — هستنى الأخبار الجديدة بس")
                time.sleep(SLEEP_SECONDS)
                continue

            count = 0
            for e in feed.entries:
                if count >= MAX_POSTS:
                    break
                t = normalize(e.title)
                if e.link in links or t in titles:
                    continue
                if already_on_page(e.title):
                    print("⏭️ Already on page — skipping:", e.title)
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

import os, json, time, re
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
import requests
import feedparser
from bs4 import BeautifulSoup

# ================= الإعدادات =================
RSS_URL       = "https://www.elbalad.news/rss.aspx"
PAGE_ID       = "1204286986111478"
PAGE_TOKEN    = "EAAfY71sMZAikBSBoRGZBeZAPEwjbKIeDa9S25fLsceSEjI5cZA7Ymo4XSM3mdinqZCNI1Pa5ActYK6cDOkaTcvDUr5oNKLLL0od6C2YY942zAKnpWMKKHTXycUJVOWNjslUJvF9Pi7D5FNFFBhre3hFZAZCIOORdpiKEJZBrG6ZCkgXz13dRDQtFc8w6HnzOcSJOStfjEufFK"
STATE_FILE    = "posted.json"
TXT_LOG       = "posts.txt"
MAX_POSTS     = 1
SLEEP_SECONDS = 420          # كل 7 دقائق
# =============================================

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

def normalize(t):
    """توحيد شكل العنوان عشان كشف التكرار"""
    t = re.sub(r"[\u064B-\u065F\u0670\u0640]", "", t)
    return re.sub(r"\s+", " ", t).strip()

def load_state():
    if os.path.exists(STATE_FILE):
        try:
            data = json.load(open(STATE_FILE, encoding="utf-8"))
            if isinstance(data, dict):
                return data.get("links", []), data.get("titles", [])
            return data, []          # صيغة قديمة
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
    paras = [p.get_text(" ", strip=True) for p in soup.find_all("p")]
    text = "\n\n".join(p for p in paras if len(p) > 50)
    for stop in ["اقرأ أيضاً", "اقرأ ايضا", "شارك الخبر", "تابعنا"]:
        text = text.split(stop)[0]
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
    # ❤️ نبضة القلب عشان الخدمة ما تنامش
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

            # أول تشغيل: سجّل الأخبار الحالية بدون نشر
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
                # حماية مزدوجة ضد التكرار: الرابط + العنوان
                if e.link in links or t in titles:
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

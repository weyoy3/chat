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
SLEEP_SECONDS = 420
# =============================================

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

STOPWORDS = {
    "في", "من", "على", "عن", "مع", "بعد", "قبل", "خلال", "حول", "ضد", "بين",
    "حتى", "منذ", "عبر", "نحو", "اليوم", "غدا", "امس", "التي", "الذي", "التى",
    "الذين", "انه", "انها", "هو", "هي", "هم", "ما", "لم", "لن", "قد", "كل",
    "بعض", "غير", "اعلن", "كشف", "قالت", "قال", "يؤكد", "مصدر", "رسميا",
    "عاجل", "بالفيديو", "بالصور", "صور", "فيديو", "مصر", "جديد", "اول",
    "اخر", "عدد", "تشيع", "ضبط", "يضبط", "يلقي", "تلقى", "يطلق", "تطلق",
    "يشهد", "تشهد", "يعقد", "تعقد", "تواصل", "يواصل", "ترتفع", "تنخفض",
    "تعلن", "تؤكد", "تقرر", "يصدر", "تصدر", "يتوجه", "تزور", "يزور",
}

def clean_word(w):
    w = re.sub(r"[^\u0600-\u06FF]", "", w)
    w = re.sub(r"[\u064B-\u065F\u0670\u0640\u0660-\u0669]", "", w)
    if w and w[0] in "وبلفك" and len(w) > 4:
        w = w[1:]
    if w.startswith("ال") and len(w) > 4:
        w = w[2:]
    return w

def make_hashtags(title, text):
    tags = []
    for source in (title, text[:400]):
        for w in re.split(r"[\s\.\،,؛;:!\?؟«»\"'\-()]+", source):
            w = clean_word(w)
            if len(w) < 3 or w in STOPWORDS:
                continue
            tag = "#" + w
            if tag not in tags:
                tags.append(tag)
            if len(tags) == 3:
                return " ".join(tags)
    return " ".join(tags) if tags else "#اخبار"

def load_posted():
    return json.load(open(STATE_FILE, encoding="utf-8")) if os.path.exists(STATE_FILE) else []

def save_posted(lst):
    json.dump(lst, open(STATE_FILE, "w", encoding="utf-8"), ensure_ascii=False)

def save_to_txt(title, text, tags, link):
    with open(TXT_LOG, "a", encoding="utf-8") as f:
        f.write(f"===== {time.strftime('%Y-%m-%d %H:%M')} =====\n")
        f.write(title + "\n\n")
        f.write(text + "\n\n")
        f.write(tags + "\n")
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

def post_facebook(title, text, image, tags):
    message = f"{title}\n\n{text}"
    if len(message) > 4200:
        message = message[:4200] + " ..."
    message += "\n\n" + tags

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

            if not os.path.exists(STATE_FILE):
                save_posted([e.link for e in feed.entries])
                print("📋 Baseline saved — هستنى الأخبار الجديدة بس")
                time.sleep(SLEEP_SECONDS)
                continue

            posted = load_posted()
            count = 0
            for e in feed.entries:
                if count >= MAX_POSTS:
                    break
                if e.link in posted:
                    continue
                print("📰 Processing:", e.title)
                text, image = fetch_article(e.link)
                if not text:
                    continue
                tags = make_hashtags(e.title, text)
                print("🏷️ Hashtags:", tags)
                result = post_facebook(e.title, text, image, tags)
                print("✅ Posted:", result.get("id", "unknown"))
                save_to_txt(e.title, text, tags, e.link)
                posted.append(e.link)
                save_posted(posted)
                count += 1
                time.sleep(3)

            print("💤 Sleeping 7 minutes...")
            time.sleep(SLEEP_SECONDS)
        except Exception as ex:
            print("❌ Error:", ex)
            time.sleep(300)

if __name__ == "__main__":
    main()

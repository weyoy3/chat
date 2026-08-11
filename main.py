"""
بث إذاعة القرآن الكريم مباشر على صفحة فيسبوك
Render Free + cron-job.org (keep-awake)
"""

import logging
import os
import struct
import subprocess
import threading
import time
import zlib

import imageio_ffmpeg
import requests
from flask import Flask, jsonify

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("quran-live")

app = Flask(__name__)

# =========================
# الإعدادات
# =========================

FB_PAGE_ID = os.environ.get("1204286986111478", "").strip()
FB_TOKEN = os.environ.get("EAAfY71sMZAikBSBoRGZBeZAPEwjbKIeDa9S25fLsceSEjI5cZA7Ymo4XSM3mdinqZCNI1Pa5ActYK6cDOkaTcvDUr5oNKLLL0od6C2YY942zAKnpWMKKHTXycUJVOWNjslUJvF9Pi7D5FNFFBhre3hFZAZCIOORdpiKEJZBrG6ZCkgXz13dRDQtFc8w6HnzOcSJOStfjEufFK", "").strip()
FB_VERSION = os.environ.get("FB_GRAPH_VERSION", "v23.0").strip()

RADIO_URL = os.environ.get(
    "RADIO_URL",
    "https://stream.radiojar.com/8s5u5tpdtwzuv",
).strip()

LIVE_TITLE = os.environ.get("LIVE_TITLE", "إذاعة القرآن الكريم - بث مباشر")
LIVE_DESC = os.environ.get("LIVE_DESCRIPTION", "بث مباشر 24 ساعة")

BASE = f"https://graph.facebook.com/{FB_VERSION}"

try:
    FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
except Exception:
    FFMPEG = None

IMG = "/tmp/live_bg.png"

_thread = None
_stop = threading.Event()
_proc = None
_state = {
    "live_id": None,
    "restarts": 0,
    "started_at": None,
    "last_error": None,
}


# =========================
# صورة الخلفية
# =========================

def make_black_png(path, width=1080, height=1920):
    """صورة سوداء بدون أي مكتبات (احتياطي)"""
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        c += struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        return c

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    row = b"\x00" + b"\x00\x00\x00" * width
    idat = zlib.compress(row * height, 6)

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", ihdr)
           + chunk(b"IDAT", idat)
           + chunk(b"IEND", b""))

    with open(path, "wb") as f:
        f.write(png)


def build_image():
    """صورة سوداء عليها اسم الإذاعة"""
    try:
        from PIL import Image, ImageDraw, ImageFont

        img = Image.new("RGB", (1080, 1920), (0, 0, 0))
        draw = ImageDraw.Draw(img)

        font = None
        for fp in [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
        ]:
            if os.path.exists(fp):
                try:
                    font = ImageFont.truetype(fp, 80)
                    break
                except Exception:
                    continue

        if font is None:
            font = ImageFont.load_default()

        text = "إذاعة القرآن الكريم"
        bbox = draw.textbbox((0, 0), text, font=font)
        w = bbox[2] - bbox[0]
        h = bbox[3] - bbox[1]
        draw.text(((1080 - w) // 2, (1920 - h) // 2),
                  text, fill=(212, 175, 55), font=font)

        img.save(IMG)

    except Exception:
        make_black_png(IMG)

    log.info("🎨 الخلفية جاهزة")


# =========================
# فيسبوك Live
# =========================

def create_live():
    log.info("📡 إنشاء لايف على فيسبوك...")

    r = requests.post(
        f"{BASE}/{FB_PAGE_ID}/live_videos",
        data={
            "access_token": FB_TOKEN,
            "title": LIVE_TITLE,
            "description": LIVE_DESC,
        },
        timeout=60,
    )

    if not r.ok:
        raise RuntimeError(f"live failed: {r.text[:300]}")

    live_id = r.json()["id"]
    log.info(f"✅ اللايف اتعمل: {live_id}")
    return live_id


def get_stream_url(live_id):
    for _ in range(10):
        r = requests.get(
            f"{BASE}/{live_id}",
            params={
                "fields": "secure_stream_url,stream_url",
                "access_token": FB_TOKEN,
            },
            timeout=60,
        )

        if not r.ok:
            raise RuntimeError(f"read failed: {r.text[:300]}")

        data = r.json()
        url = data.get("secure_stream_url") or data.get("stream_url")
        if url:
            return url
        time.sleep(3)

    raise RuntimeError("stream url not ready")


def end_live(live_id):
    log.info("🛑 إنهاء اللايف...")
    try:
        requests.post(
            f"{BASE}/{live_id}",
            data={"access_token": FB_TOKEN, "status": "LIVE_ENDED"},
            timeout=60,
        )
    except Exception:
        pass


# =========================
# البث بـ ffmpeg
# =========================

def run_ffmpeg(stream_url):
    global _proc

    cmd = [
        FFMPEG,
        "-hide_banner", "-loglevel", "warning",
        "-reconnect", "1",
        "-reconnect_streamed", "1",
        "-reconnect_delay_max", "10",
        "-loop", "1", "-framerate", "25",
        "-i", IMG,
        "-i", RADIO_URL,
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-tune", "stillimage",
        "-pix_fmt", "yuv420p",
        "-r", "25",
        "-b:v", "1500k",
        "-c:a", "aac",
        "-b:a", "128k",
        "-ar", "44100",
        "-ac", "2",
        "-f", "flv",
        stream_url,
    ]

    log.info(f"🔴 البث شغال: {RADIO_URL}")

    _proc = subprocess.Popen(
        cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    while not _stop.is_set():
        if _proc.poll() is not None:
            log.warning(f"ffmpeg وقف بكود {_proc.returncode}")
            break
        time.sleep(5)

    if _proc.poll() is None:
        _proc.terminate()


# =========================
# حلقة البث (خلفية)
# =========================

def stream_loop():
    while not _stop.is_set():

        if not FFMPEG:
            _state["last_error"] = "ffmpeg missing"
            log.error("❌ ffmpeg مش موجود")
            _stop.wait(60)
            continue

        if not FB_PAGE_ID or not FB_TOKEN:
            _state["last_error"] = "missing credentials"
            log.error("❌ حط FB_PAGE_ID و FB_PAGE_ACCESS_TOKEN في Render")
            _stop.wait(60)
            continue

        live_id = None
        try:
            live_id = create_live()
            _state["live_id"] = live_id
            _state["started_at"] = time.time()
            _state["last_error"] = None

            run_ffmpeg(get_stream_url(live_id))

        except Exception as e:
            _state["last_error"] = str(e)[:200]
            log.error(f"خطأ: {e}")

        finally:
            if live_id:
                end_live(live_id)
            _state["restarts"] += 1

        log.info("😴 استراحة 10 ثواني...")
        _stop.wait(10)


def ensure_thread():
    global _thread
    if _thread is None or not _thread.is_alive():
        _stop.clear()
        _thread = threading.Thread(target=stream_loop, daemon=True)
        _thread.start()
        log.info("🚀 خيط البث اتشغل")


# =========================
# صفحات الويب (لـ cron-job.org)
# =========================

@app.route("/")
def home():
    ensure_thread()
    return jsonify(
        status="alive",
        streaming=_thread is not None and _thread.is_alive(),
        ffmpeg=bool(FFMPEG),
        live_id=_state["live_id"],
        restarts=_state["restarts"],
        last_error=_state["last_error"],
    )


@app.route("/status")
def status():
    return home()


# =========================
# التشغيل
# =========================

if __name__ == "__main__":
    log.info("🚀 تشغيل سيرفر البث")

    build_image()
    ensure_thread()

    port = int(os.environ.get("PORT", 10000))
    app.run(host="0.0.0.0", port=port)

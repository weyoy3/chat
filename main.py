"""
بث إذاعة القرآن الكريم مباشر على فيسبوك (نسخة مستقرة وآمنة)
"""

import logging
import os
import struct
import subprocess
import threading
import time
import zlib

import imageio_ffmpeg
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

FB_STREAM_URL = os.environ.get("FB_STREAM_URL", "").strip()

RADIO_URL = os.environ.get(
    "RADIO_URL",
    "https://stream.radiojar.com/8s5u5tpdtwzuv",
).strip()

IMG = "/tmp/live_bg.png"

_thread = None
_stop = threading.Event()
_proc = None
_state = {
    "streaming": False,
    "restarts": 0,
    "started_at": None,
    "last_error": None,
}


# =========================
# صورة الخلفية البسيطة
# =========================

def make_black_png(path, width=854, height=480):
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
    try:
        from PIL import Image, ImageDraw

        img = Image.new("RGB", (854, 480), (0, 0, 0))
        draw = ImageDraw.Draw(img)
        
        from PIL import ImageFont
        font = ImageFont.load_default()

        text = "إذاعة القرآن الكريم"
        draw.text((320, 220), text, fill=(212, 175, 55), font=font)
        img.save(IMG)
    except Exception:
        make_black_png(IMG)

    log.info("🎨 الخلفية جاهزة")


# =========================
# البث بـ ffmpeg
# =========================

def run_ffmpeg(stream_url):
    global _proc

    try:
        ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        ffmpeg_exe = None

    if not ffmpeg_exe:
        raise RuntimeError("ffmpeg missing")

    cmd = [
        ffmpeg_exe,
        "-hide_banner",
        "-loglevel", "warning",
        "-loop", "1",
        "-framerate", "10",
        "-i", IMG,
        "-i", RADIO_URL,
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-r", "10",
        "-b:v", "400k",
        "-c:a", "aac",
        "-b:a", "64k",
        "-ar", "44100",
        "-ac", "2",
        "-f", "flv",
        stream_url,
    ]

    log.info("🔴 جاري البدء في البث المباشر المستقر...")

    _proc = subprocess.Popen(
        cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    while not _stop.is_set():
        if _proc.poll() is not None:
            log.warning(f"ffmpeg توقف الرمز {_proc.returncode}")
            break
        time.sleep(5)

    if _proc.poll() is None:
        _proc.terminate()


def stream_loop():
    while not _stop.is_set():
        if not FB_STREAM_URL:
            _state["last_error"] = "missing stream url"
            log.error("❌ يجب وضع رابط البث في متغير FB_STREAM_URL في Render")
            _stop.wait(60)
            continue

        try:
            _state["streaming"] = True
            _state["started_at"] = time.time()
            _state["last_error"] = None

            run_ffmpeg(FB_STREAM_URL)

        except Exception as e:
            _state["last_error"] = str(e)[:200]
            log.error(f"خطأ في البث: {e}")

        finally:
            _state["streaming"] = False
            _state["restarts"] += 1

        log.info("😴 استراحة 10 ثواني وإعادة المحاولة...")
        _stop.wait(10)


def ensure_thread():
    global _thread
    if _thread is None or not _thread.is_alive():
        _stop.clear()
        _thread = threading.Thread(target=stream_loop, daemon=True)
        _thread.start()
        log.info("🚀 خيط البث يعمل")


@app.route("/")
def home():
    ensure_thread()
    return jsonify(
        status="alive",
        streaming=_state["streaming"],
        restarts=_state["restarts"],
        last_error=_state["last_error"],
    )


if __name__ == "__main__":
    log.info("🚀 تشغيل سيرفر البث الثابت")
    build_image()
    ensure_thread()
    port = int(os.environ.get("PORT", 10000))
    app.run(host="0.0.0.0", port=port)

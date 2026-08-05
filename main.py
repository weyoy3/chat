import os
import subprocess
import traceback
import shutil
import threading
from flask import Flask, request, jsonify
from gtts import gTTS
import requests
import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageFont
from mutagen.mp3 import MP3

app = Flask(__name__)

@app.route('/')
def home():
    return "Nabd24 Reel Server is Alive! 🚀"

def background_processing(title, description, page_token):
    audio_path = f"/tmp/audio_{os.getpid()}_{threading.get_ident()}.mp3"
    image_path = f"/tmp/image_{os.getpid()}_{threading.get_ident()}.jpg"
    video_path = f"/tmp/video_{os.getpid()}_{threading.get_ident()}.mp4"

    try:
        full_speech = f"{title}. {description}"
        
        # 1. توليد الصوت
        tts = gTTS(text=full_speech, lang='ar', slow=False)
        tts.save(audio_path)

        audio_info = MP3(audio_path)
        duration = int(audio_info.info.length) + 1

        # 2. تصميم الصورة
        img = Image.new('RGB', (720, 1280), color=(12, 12, 24))
        draw = ImageDraw.Draw(img)
        
        draw.rectangle([(30, 30), (690, 1250)], outline=(0, 229, 255), width=5)
        draw.rectangle([(50, 70), (670, 240)], fill=(22, 22, 40))
        
        draw.text((70, 100), "NABD 24 NEWS", fill=(255, 75, 75))
        draw.text((70, 320), title[:60], fill=(255, 255, 255))
        draw.text((70, 500), description[:150], fill=(180, 190, 210))
        
        img.save(image_path)

        # 3. إعداد FFmpeg
        original_ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        ffmpeg_path = "/tmp/ffmpeg_bin"
        if not os.path.exists(ffmpeg_path):
            shutil.copy(original_ffmpeg, ffmpeg_path)
            os.chmod(ffmpeg_path, 0o755)

        # 4. دمج الفيديو
        cmd = [
            ffmpeg_path, '-y',
            '-loop', '1', '-i', image_path,
            '-i', audio_path,
            '-c:v', 'libx264', '-tune', 'stillimage',
            '-c:a', 'aac', '-b:a', '192k',
            '-pix_fmt', 'yuv420p',
            '-shortest', '-t', str(duration),
            video_path
        ]
        
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if result.returncode != 0:
            print(f"❌ FFmpeg Error: {result.stderr.decode('utf-8', errors='ignore')[-300:]}")
            return

        # 5. الرفع لفيسبوك
        upload_url = "https://graph.facebook.com/v19.0/me/videos"
        with open(video_path, "rb") as video_file:
            payload = {
                "access_token": page_token,
                "description": f"🚨 {title}\n\n{description}\n\n#نبض_24 #عاجل #أخبار"
            }
            files = {"source": video_file}
            fb_response = requests.post(upload_url, data=payload, files=files).json()
            print(f"🎉 Facebook API Response: {fb_response}")

    except Exception as e:
        print(f"❌ Background Error: {traceback.format_exc()}")

    finally:
        for p in [audio_path, image_path, video_path]:
            if os.path.exists(p):
                try:
                    os.remove(p)
                except:
                    pass

@app.route('/generate-reel', methods=['POST'])
def generate_reel():
    try:
        data = request.get_json(silent=True) or {}
        title = data.get('title', 'عاجل: آخر المستجدات الإخبارية')
        description = data.get('description', 'تغطية حصرية ومستمرة عبر منصة نبض 24.')
        page_token = data.get('page_token')
        
        if not page_token:
            return jsonify({"success": False, "error": "Missing page_token"}), 400

        # تشغيل العملية في الخلفية لضمان عدم حدوث Timeout
        thread = threading.Thread(target=background_processing, args=(title, description, page_token))
        thread.start()

        return jsonify({"success": True, "message": "Reel task started successfully in background!"})

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 3000))
    app.run(host='0.0.0.0', port=port)

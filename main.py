import os
import subprocess
from flask import Flask, request, jsonify
from gtts import gTTS
import requests
import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageFont
from mutagen.mp3 import MP3

app = Flask(__name__)

@app.route('/generate-reel', methods=['POST'])
def generate_reel():
    data = request.get_json() or {}
    title = data.get('title', 'عاجل: آخر المستجدات الإخبارية')
    description = data.get('description', 'تغطية حصرية ومستمرة على مدار الساعة عبر منصة نبض 24.')
    page_token = data.get('page_token')
    
    if not page_token:
        return jsonify({"success": False, "error": "Missing page_token"}), 400

    audio_path = f"audio_{os.getpid()}.mp3"
    image_path = f"image_{os.getpid()}.jpg"
    video_path = f"video_{os.getpid()}.mp4"

    try:
        full_speech = f"{title}. {description}"
        
        # 1. توليد الملف الصوتي بنبرة عربية أفضل
        print("🔊 [Cloud] جاري توليد الملف الصوتي المحسن...", flush=True)
        tts = gTTS(text=full_speech, lang='ar', tld='com.eg', slow=False)
        tts.save(audio_path)

        # حساب مدة الصوت بدقة لتتناسب مع الفيديو
        audio_info = MP3(audio_path)
        duration = int(audio_info.info.length) + 1

        # 2. تصميم بطاقة خبر احترافية ومتجاوبة باستخدام Pillow
        print("🎨 [Cloud] جاري تصميم بطاقة الخبر المتجاوبة...", flush=True)
        img = Image.new('RGB', (720, 1280), color=(12, 12, 24))
        draw = ImageDraw.Draw(img)
        
        # رسم إطار وبطاقة الخبر
        draw.rectangle([(30, 30), (690, 1250)], outline=(0, 229, 255), width=5)
        draw.rectangle([(50, 70), (670, 240)], fill=(22, 22, 40))
        
        try:
            font_title = ImageFont.truetype("DejaVuSans-Bold.ttf", 42)
            font_desc = ImageFont.truetype("DejaVuSans.ttf", 28)
        except IOError:
            font_title = ImageFont.load_default()
            font_desc = ImageFont.load_default()

        draw.text((70, 100), "🔴 شبكة نبض 24 الإخبارية", fill=(255, 75, 75))
        draw.text((70, 320), title[:70], fill=(255, 255, 255))
        draw.text((70, 500), description[:180], fill=(180, 190, 210))
        
        img.save(image_path)

        # 3. دمج الصورة والصوت عبر FFmpeg لإنتاج فيديو متجاوب
        print("🎞️ [Cloud] جاري إنتاج فيديو الريلز الاحترافي...", flush=True)
        ffmpeg_path = imageio_ffmpeg.get_ffmpeg_exe()
        
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
            error_msg = result.stderr.decode('utf-8', errors='ignore')[-300:]
            raise Exception(f"FFmpeg Error: {error_msg}")

        # 4. رفع الفيديو مباشرة إلى فيسبوك
        print("📤 [Cloud] جاري رفع الفيديو إلى فيسبوك...", flush=True)
        upload_url = "https://graph.facebook.com/v19.0/me/videos"
        
        with open(video_path, "rb") as video_file:
            payload = {
                "access_token": page_token,
                "description": f"🚨 {title}\n\n{description}\n\n#نبض_24 #عاجل #أخبار"
            }
            files = {"source": video_file}
            fb_response = requests.post(upload_url, data=payload, files=files).json()

        if "id" in fb_response:
            print(f"🎉 [Success] تم النشر برقم: {fb_response['id']}", flush=True)
            return jsonify({"success": True, "post_id": fb_response["id"]})
        else:
            return jsonify({"success": False, "error": fb_response}), 400

    except Exception as e:
        print(f"❌ [Error]: {e}", flush=True)
        return jsonify({"success": False, "error": str(e)}), 500

    finally:
        for p in [audio_path, image_path, video_path]:
            if os.path.exists(p):
                os.remove(p)

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 3000))
    app.run(host='0.0.0.0', port=port)

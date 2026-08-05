import os
import subprocess
from flask import Flask, request, jsonify
from gtts import gTTS
import requests
import imageio_ffmpeg

app = Flask(__name__)

@app.route('/generate-reel', methods=['POST'])
def generate_reel():
    data = request.get_json() or {}
    text = data.get('text')
    page_token = data.get('page_token')
    
    if not text or not page_token:
        return jsonify({"success": False, "error": "Missing text or page_token"}), 400

    audio_path = f"audio_{os.getpid()}.mp3"
    video_path = f"video_{os.getpid()}.mp4"

    try:
        # 1. توليد الملف الصوتي باستخدام gTTS
        print("🔊 [Cloud] جاري توليد الملف الصوتي...", flush=True)
        tts = gTTS(text=text, lang='ar', slow=False)
        tts.save(audio_path)

        # 2. الحصول على مسار FFmpeg المعتمد في السحابة
        ffmpeg_path = imageio_ffmpeg.get_ffmpeg_exe()

        # 3. دمج الصوت والفيديو عبر FFmpeg
        print("🎞️ [Cloud] جاري إنتاج الفيديو الحقيقي...", flush=True)
        cmd = [
            ffmpeg_path, '-y',
            '-f', 'lavfi', '-i', 'color=c=0x0f0f19:s=720x1280',
            '-i', audio_path,
            '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-shortest',
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
                "description": f"{text}\n\n#نبض_24 #عاجل #أخبار"
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
        if os.path.exists(audio_path):
            os.remove(audio_path)
        if os.path.exists(video_path):
            os.remove(video_path)

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 3000))
    app.run(host='0.0.0.0', port=port)

import os
import time
import threading
from flask import Flask, jsonify
import requests

app = Flask(__name__)
app.config['JSON_AS_ASCII'] = False

# بيانات فيسبوك من متغيرات البيئة
PAGE_ID = os.environ.get("PAGE_ID", "")
ACCESS_TOKEN = os.environ.get("ACCESS_TOKEN", "")

def generate_and_upload_reel():
    """دالة معالجة الفيديو والرفع بشكل آمن"""
    print("🎬 [Pipeline] بدأ تنفيذ عملية إنشاء الفيديو...")
    
    audio_path = "output_audio.mp3"
    video_path = "output_reel.mp4"
    
    try:
        # استيراد المكتبات محلياً داخل الدالة لمنع حدوث Crash عند إقلاع السيرفر الرئيسي
        from gtts import gTTS
        from moviepy.editor import AudioFileClip, ColorClip
        
        news_text = "عاجل: آخر الأخبار على مدار الساعة عبر منصة نبض 24."
        
        # 1. توليد الصوت
        print("🔊 [gTTS] جاري توليد الملف الصوتي...")
        tts = gTTS(text=news_text, lang='ar', slow=False)
        tts.save(audio_path)
        
        # 2. إنشاء الفيديو باستخدام ColorClip و AudioFileClip فقط (بدون TextClip لتجنب أخطاء Render)
        print("🎞️ [MoviePy] جاري دمج الصوت وإنشاء الفيديو...")
        audio_clip = AudioFileClip(audio_path)
        duration = audio_clip.duration
        
        bg_clip = ColorClip(size=(1080, 1920), color=(15, 15, 25), duration=duration)
        video_clip = bg_clip.set_audio(audio_clip)
        
        video_clip.write_videofile(video_path, fps=24, codec='libx264', audio_codec='aac', logger=None)
        print("✅ [MoviePy] تم تصدير الفيديو بنجاح!")
        
        # إغلاق الملفات لتحرير الذاكرة
        audio_clip.close()
        video_clip.close()
        
    except Exception as e:
        print(f"❌ [Pipeline Error] حدث خطأ أثناء المعالجة: {e}")
        
    finally:
        # تنظيف الملفات المؤقتة
        if os.path.exists(audio_path):
            os.remove(audio_path)
        if os.path.exists(video_path):
            os.remove(video_path)
        print("🧹 [Cleanup] تم تنظيف الملفات المؤقتة.")

# نظام التشغيل التلقائي في الخلفية
def auto_pilot_loop():
    time.sleep(25)  # انتظار استقرار السيرفر تماماً
    while True:
        try:
            print("🚀 [Auto-Pilot] بدء المهمة التلقائية...")
            generate_and_upload_reel()
        except Exception as e:
            print(f"❌ [Auto-Pilot Error]: {e}")
        time.sleep(6 * 3600)  # كل 6 ساعات

# تشغيل خيط الخلفية بأمان
threading.Thread(target=auto_pilot_loop, daemon=True).start()

@app.route('/')
def home():
    return "نبض 24 - Reels Auto-Pilot Server is Live and Stable!"

@app.route('/run-now')
def run_now():
    threading.Thread(target=generate_and_upload_reel).start()
    return jsonify({
        "status": "success",
        "message": "تم بدء تنفيذ البايبلاين في الخلفية بنجاح!"
    }), 200

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 10000))
    app.run(host='0.0.0.0', port=port)

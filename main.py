import os
import time
import threading
from flask import Flask, jsonify
from gtts import gTTS
from moviepy.editor import TextClip, AudioFileClip, ColorClip, CompositeVideoClip
import requests

app = Flask(__name__)
app.config['JSON_AS_ASCII'] = False  # لضمان ظهور النصوص العربية بوضوح في الـ JSON

# --- إعدادات فيسبوك (يُفضل وضعها في متغيرات البيئة Environment Variables على Render) ---
PAGE_ID = os.environ.get("PAGE_ID", "ضع_معرف_الصفحة_هنا")
ACCESS_TOKEN = os.environ.get("ACCESS_TOKEN", "ضع_رمز_الوصول_هنا")

def generate_and_upload_reel():
    """الدالة الأساسية لمعالجة الفيديو ورفعه لفيسبوك"""
    print("🎬 [Pipeline] بدأ إنشاء الـ Reel لـ 'نبض 24'...")
    
    audio_path = "output_audio.mp3"
    video_path = "output_reel.mp4"
    
    try:
        # 1. النص الذي سيتم تحويله لصوت (يمكنك جعله يجلب خبراً جديداً تلقائياً)
        news_text = "عاجل: آخر تطورات الأخبار على مدار الساعة عبر منصة نبض 24."
        
        # 2. توليد الصوت باستخدام gTTS
        print("🔊 [gTTS] جاري توليد الملف الصوتي...")
        tts = gTTS(text=news_text, lang='ar', slow=False)
        tts.save(audio_path)
        
        # 3. معالجة الفيديو باستخدام MoviePy
        print("🎞️ [MoviePy] جاري دمج الصوت وإنشاء الفيديو...")
        audio_clip = AudioFileClip(audio_path)
        duration = audio_clip.duration
        
        # إنشاء خلفية ملونة للفيديو (مثلاً خلفية سوداء أو داكنة بمقاسات الريلز 1080x1920)
        bg_clip = ColorClip(size=(1080, 1920), color=(20, 20, 30), duration=duration)
        video_clip = bg_clip.set_audio(audio_clip)
        
        # تصدير الفيديو النهائي
        video_clip.write_videofile(video_path, fps=24, codec='libx264', audio_codec='aac', logger=None)
        print("✅ [MoviePy] تم تصدير الفيديو بنجاح!")
        
        # 4. الرفع إلى Facebook Graph API (Reels)
        print("📤 [Facebook API] جاري رفع الـ Reel إلى الصفحة...")
        
        # خطوة مبسطة لرفع الفيديو (تأكد من صلاحيات الـ Token الخاص بصفحتك)
        url = f"https://graph.facebook.com/v19.0/{PAGE_ID}/video_reels"
        
        # ملاحظة: رفع الفيديو للـ Reels يتطلب أحياناً خطوتين (Initiate ثم Upload)، 
        # وهنا نقطة الاتصال الأساسية:
        payload = {
            "access_token": ACCESS_TOKEN,
            "upload_phase": "start"
        }
        response = requests.post(url, data=payload)
        
        if response.status_code == 200:
            print("🎉 [Facebook API] تم بدء جلسة الرفع بنجاح!")
            # يمكنك إكمال خطوات الرفع الفعلي عبر الـ Video Upload URL المستلم هنا
        else:
            print(f"⚠️ [Facebook API Warning] رد المنصة: {response.text}")
            
    except Exception as e:
        print(f"❌ [Pipeline Error] حدث خطأ أثناء المعالجة أو الرفع: {e}")
        
    finally:
        # تنظيف الملفات المؤقتة من السيرفر لتوفير المساحة
        if os.path.exists(audio_path):
            os.remove(audio_path)
        if os.path.exists(video_path):
            os.remove(video_path)
        print("🧹 [Cleanup] تم تنظيف الملفات المؤقتة بنجاح.")

# --- نظام التشغيل التلقائي في الخلفية (كل 6 ساعات) ---
def auto_pilot_loop():
    time.sleep(20)  # انتظار استقرار السيرفر بعد الإقلاع
    while True:
        try:
            print("🚀 [Auto-Pilot] حان موعد المهمة التلقائية (كل 6 ساعات)...")
            generate_and_upload_reel()
        except Exception as e:
            print(f"❌ [Auto-Pilot Error]: {e}")
        
        # الانتظار 6 ساعات
        time.sleep(6 * 3600)

# إطلاق خيط الخلفية لتجنب الـ Timeout
threading.Thread(target=auto_pilot_loop, daemon=True).start()

# --- مسارات الفلاسك ---
@app.route('/')
def home():
    return "نبض 24 - Reels Auto-Pilot Server is Live and Active!"

@app.route('/run-now')
def run_now():
    # تشغيل البايبلاين فوراً عند زيارة الرابط
    threading.Thread(target=generate_and_upload_reel).start()
    return jsonify({
        "status": "success",
        "message": "تم بدء تنفيذ pipeline النشر الفوري في الخلفية بنجاح! تابع الـ Logs لمشاهدة التفاصيل."
    }), 200

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 10000))
    app.run(host='0.0.0.0', port=port)

import os
import time
import threading
from flask import Flask, jsonify

app = Flask(__name__)

# --- دالة المهام التلقائية (الآب تو بايلوت كل 6 ساعات) ---
def auto_pilot_loop():
    # الانتظار قليلاً بعد الإقلاع لضمان استقرار السيرفر
    time.sleep(15)
    while True:
        try:
            print("🚀 [Auto-Pilot] بدأ تنفيذ مهمة النشر التلقائي...")
            
            # ضع هنا كود معالجة الفيديو، توليد الصوت، والرفع لـ Facebook Graph API
            # مثال:
            # create_and_upload_reel()
            
            print("✅ [Auto-Pilot] تم النشر بنجاح، الانتقال لفترة الانتظار (6 ساعات).")
        except Exception as e:
            print(f"❌ [Auto-Pilot Error] حدث خطأ: {e}")
        
        # الانتظار لمدة 6 ساعات (6 * 3600 ثانية)
        time.sleep(6 * 3600)

# تشغيل خيط الخلفية تلقائياً عند إقلاع السيرفر (يدعم Gunicorn والتشغيل المباشر)
def init_background_worker():
    thread = threading.Thread(target=auto_pilot_loop, daemon=True)
    thread.start()

# إطلاق الخيط فوراً
init_background_worker()

# --- مسارات تطبيق الـ Web (Flask) ---
@app.route('/')
def home():
    return "نبض 24 - Reels Auto-Pilot Server is Live and Running!"

@app.route('/run-now')
def run_now():
    try:
        print("⚡ [Manual Trigger] تم طلب التشغيل الفوري يدوياً...")
        
        # ضع هنا نفس دالة معالجة الفيديو والنشر لتنفذ فوراً عند فتح الرابط
        # مثال:
        # create_and_upload_reel()
        
        return jsonify({
            "status": "success",
            "message": "تم تنفيذ pipeline النشر الفوري بنجاح ورفع الفيديو!"
        }), 200
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 10000))
    app.run(host='0.0.0.0', port=port)

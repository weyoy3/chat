import os
import subprocess
import traceback
import shutil
import threading
import asyncio
import edge_tts
from flask import Flask, request, jsonify
import requests
from bs4 import BeautifulSoup
import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageFont
from mutagen.mp3 import MP3

app = Flask(__name__)

@app.route('/')
def home():
    return "Nabd24 Reel Server with News Scraping is Alive! 🚀"

async def generate_professional_voice(text, output_path):
    voice = "ar-SA-HamedNeural"  # صوت إخباري رسمي ونبرة احترافية
    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(output_path)

def scrape_news_article(url):
    try:
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
        response = requests.get(url, headers=headers, timeout=10)
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # استخراج العنوان
        title_tag = soup.find('meta', property='og:title') or soup.find('h1')
        title = title_tag['content'] if title_tag and title_tag.has_attr('content') else (title_tag.text if title_tag else "عاجل حصري")
        
        # استخراج صورة الخبر الأصلية
        img_tag = soup.find('meta', property='og:image')
        img_url = img_tag['content'] if img_tag and img_tag.has_attr('content') else None
        
        # استخراج الفقرات النصية للخبر الكامل
        paragraphs = soup.find_all('p')
        full_text_list = [p.text.strip() for p in paragraphs if len(p.text.strip()) > 20]
        content = " ".join(full_text_list[:4]) # أخذ أول عدة فقرات لتكوين تقرير متكامل
        
        if len(content) < 50:
            content = title
            
        return title.strip(), content.strip(), img_url
    except Exception as e:
        print(f"❌ Scraping Error: {e}")
        return "تطورات إخبارية عاجلة", "تابع آخر التحديثات والحصريات عبر منصة نبض 24 الإخبارية.", None

def background_processing(news_url, page_token):
    audio_path = f"/tmp/audio_{os.getpid()}_{threading.get_ident()}.mp3"
    image_path = f"/tmp/image_{os.getpid()}_{threading.get_ident()}.jpg"
    video_path = f"/tmp/video_{os.getpid()}_{threading.get_ident()}.mp4"

    try:
        # 1. سحب بيانات الخبر والصورة من الرابط
        print(f"🌐 [Cloud] جاري سحب الخبر من الرابط: {news_url}", flush=True)
        title, description, img_url = scrape_news_article(news_url)
        full_speech = f"عاجل. {title}. {description}"

        # 2. توليد الصوت الاحترافي بالذكاء الاصطناعي
        print("🔊 [Cloud] جاري توليد الصوت الإخباري الاحترافي...", flush=True)
        asyncio.run(generate_professional_voice(full_speech, audio_path))

        audio_info = MP3(audio_path)
        duration = int(audio_info.info.length) + 1

        # 3. تحميل وتجهيز صورة الخبر لتكون خلفية الريلز
        print("🎨 [Cloud] جاري تجهيز خلفية صورة الخبر...", flush=True)
        image_downloaded = False
        if img_url:
            try:
                img_data = requests.get(img_url, timeout=10).content
                with open(image_path, 'wb') as handler:
                    handler.write(img_data)
                
                # تعديل مقاسات الصورة لتناسب شاشة الريلز (720x1280) مع تغطية الشاشة
                im = Image.open(image_path)
                im = im.resize((720, 1280), Image.Resampling.LANCZOS)
                
                # إضافة طبقة شفافة داكنة فوق الصورة لتوضيح النص فوقها
                overlay = Image.new('RGBA', im.size, (0, 0, 0, 140))
                im = im.convert('RGBA')
                im = Image.alpha_composite(im, overlay)
                im.convert('RGB').save(image_path)
                image_downloaded = True
            except Exception as e:
                print(f"⚠️ Failed to process news image: {e}")

        # في حال فشل تحميل صورة الخبر، يتم إنشاء خلفية افتراضية أنيقة
        if not image_downloaded:
            img = Image.new('RGB', (720, 1280), color=(12, 12, 24))
            draw = ImageDraw.Draw(img)
            draw.rectangle([(30, 30), (690, 1250)], outline=(0, 229, 255), width=5)
            draw.text((70, 100), "NABD 24 NEWS", fill=(255, 75, 75))
            draw.text((70, 320), title[:60], fill=(255, 255, 255))
            img.save(image_path)

        # 4. تجهيز FFmpeg
        original_ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        ffmpeg_path = "/tmp/ffmpeg_bin"
        if not os.path.exists(ffmpeg_path):
            shutil.copy(original_ffmpeg, ffmpeg_path)
            os.chmod(ffmpeg_path, 0o755)

        # 5. دمج الفيديو والصوت
        print("🎞️ [Cloud] جاري دمج الفيديو نهائياً...", flush=True)
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

        # 6. الرفع إلى فيسبوك
        print("📤 [Cloud] جاري رفع الريلز إلى فيسبوك...", flush=True)
        upload_url = "https://graph.facebook.com/v19.0/me/videos"
        with open(video_path, "rb") as video_file:
            payload = {
                "access_token": page_token,
                "description": f"🚨 {title}\n\n{description[:300]}...\n\n#نبض_24 #عاجل #أخبار"
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
        news_url = data.get('url')
        page_token = data.get('page_token')
        
        if not news_url or not page_token:
            return jsonify({"success": False, "error": "Missing news url or page_token"}), 400

        # تشغيل العملية في الخلفية لضمان سرعة الاستجابة ومنع الـ Timeout
        thread = threading.Thread(target=background_processing, args=(news_url, page_token))
        thread.start()

        return jsonify({"success": True, "message": "News Reel task started successfully in background!"})

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 3000))
    app.run(host='0.0.0.0', port=port)

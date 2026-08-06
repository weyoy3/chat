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

# متغير لتسجيل آخر حالة حدثت في الخلفية لسهولة التتبع من الهاتف
execution_log = "No tasks executed yet."

@app.route('/')
def home():
    return f"Nabd24 Reel Server is Alive! 🚀<br><br><b>Last Execution Log:</b><br><pre>{execution_log}</pre>"

async def generate_professional_voice(text, output_path):
    voice = "ar-SA-HamedNeural"
    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(output_path)

def scrape_news_article(url):
    try:
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        response = requests.get(url, headers=headers, timeout=15)
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # استخراج العنوان بدقة لموقع صدى البلد أو أي موقع إخباري
        title_tag = soup.find('h1') or soup.find('meta', property='og:title')
        title = title_tag.text.strip() if soup.find('h1') else (title_tag.get('content', 'عاجل') if title_tag else "خبر عاجل")
        
        # استخراج صورة الخبر
        img_tag = soup.find('meta', property='og:image')
        img_url = img_tag['content'] if img_tag and img_tag.has_attr('content') else None
        
        # استخراج فقرات الخبر
        paragraphs = soup.find_all('p')
        full_text_list = [p.text.strip() for p in paragraphs if len(p.text.strip()) > 30]
        content = " ".join(full_text_list[:3]) # أخذ أول 3 فقرات رئيسية
        
        if len(content) < 30:
            content = title
            
        return title, content, img_url
    except Exception as e:
        return "تطورات إخبارية عاجلة", f"حدث خطأ أثناء قراءة الرابط: {str(e)}", None

def background_processing(news_url, page_token):
    global execution_log
    audio_path = f"/tmp/audio_{os.getpid()}_{threading.get_ident()}.mp3"
    image_path = f"/tmp/image_{os.getpid()}_{threading.get_ident()}.jpg"
    video_path = f"/tmp/video_{os.getpid()}_{threading.get_ident()}.mp4"

    try:
        execution_log = f"1. Starting scraping for: {news_url}"
        title, description, img_url = scrape_news_article(news_url)
        
        execution_log = f"2. Scraped successfully.\nTitle: {title}\nImage URL: {img_url}"
        full_speech = f"عاجل. {title}. {description}"

        # توليد الصوت
        execution_log += "\n3. Generating professional voice..."
        asyncio.run(generate_professional_voice(full_speech, audio_path))

        audio_info = MP3(audio_path)
        duration = int(audio_info.info.length) + 1

        # تجهيز الصورة كخلفية
        execution_log += "\n4. Processing background image..."
        image_downloaded = False
        if img_url:
            try:
                img_data = requests.get(img_url, timeout=10).content
                with open(image_path, 'wb') as handler:
                    handler.write(img_data)
                
                im = Image.open(image_path)
                im = im.resize((720, 1280), Image.Resampling.LANCZOS)
                overlay = Image.new('RGBA', im.size, (0, 0, 0, 140))
                im = im.convert('RGBA')
                im = Image.alpha_composite(im, overlay)
                im.convert('RGB').save(image_path)
                image_downloaded = True
            except Exception as img_err:
                execution_log += f"\nImage download warning: {img_err}"

        if not image_downloaded:
            img = Image.new('RGB', (720, 1280), color=(12, 12, 24))
            draw = ImageDraw.Draw(img)
            draw.rectangle([(30, 30), (690, 1250)], outline=(0, 229, 255), width=5)
            draw.text((70, 100), "NABD 24 NEWS", fill=(255, 75, 75))
            draw.text((70, 320), title[:60], fill=(255, 255, 255))
            img.save(image_path)

        # إعداد FFmpeg
        original_ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        ffmpeg_path = "/tmp/ffmpeg_bin"
        if not os.path.exists(ffmpeg_path):
            shutil.copy(original_ffmpeg, ffmpeg_path)
            os.chmod(ffmpeg_path, 0o755)

        # دمج الفيديو
        execution_log += "\n5. Merging video with FFmpeg..."
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
            execution_log += f"\n❌ FFmpeg Error: {result.stderr.decode('utf-8', errors='ignore')[-300:]}"
            return

        # الرفع لفيسبوك
        execution_log += "\n6. Uploading to Facebook..."
        upload_url = "https://graph.facebook.com/v19.0/me/videos"
        with open(video_path, "rb") as video_file:
            payload = {
                "access_token": page_token,
                "description": f"🚨 {title}\n\n{description[:300]}...\n\n#نبض_24 #عاجل #أخبار"
            }
            files = {"source": video_file}
            fb_response = requests.post(upload_url, data=payload, files=files).json()
            execution_log += f"\n🎉 Success! FB Response: {fb_response}"

    except Exception as e:
        execution_log += f"\n❌ Critical Error: {traceback.format_exc()}"

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
            return jsonify({"success": False, "error": "Missing url or page_token"}), 400

        thread = threading.Thread(target=background_processing, args=(news_url, page_token))
        thread.start()

        return jsonify({"success": True, "message": "Task started successfully!"})

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 3000))
    app.run(host='0.0.0.0', port=port)

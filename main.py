import os
import random
import threading
import time
from flask import Flask
from gtts import gTTS
from moviepy.editor import AudioFileClip, VideoFileClip
import requests

app = Flask(__name__)

# بيانات التطبيق والتوكن الأساسي
APP_ID = "2208847373297193"
APP_SECRET = "88f87d3c76cf9279dfbea0708794d711"
SHORT_LIVED_TOKEN = (
    "EAAfY71sMZAikBSJQTnV5gFuavjPwbpxI50hAZBXBZAff3MTeT1DbD147Gsy5bPawsiUuAmbLtZAqZAOZCYcbQtgP7fQ3pm7ckjtz7ZB385htvqcmKhyIBPkv745zgYcZBTvZB2GcYyO8u42yhP4e08AXrW9puaCckKZAg6pZCMuv7ToDG5g4TZAp4fR4AtHZBvglXSExJ1ZBjXBwaZBs2rqpDqosvyNmDbRZC1g0TuyUdqRzgbFSrucVbL0s2lQF4eQd55O3fVaKIV0of0ZAdOCp06QrOao9P4Jpb".strip()
)
TARGET_NAME = "نبض 24"

# قاعدة بيانات متكاملة: كل معلومة مع فيديو خلفية حقيقي يعبر عنها
trivia_database = [
    {
        "title": "العسل لا يفسد أبداً",
        "script": (
            "هل تعلم أن العسل الطبيعي هو الطعام الوحيد الذي لا يفسد أبداً؟ وجدت"
            " أواني من العسل في مقابر الفراعنة وعمرها أكثر من ثلاثة آلاف سنة"
            " وكانت صالحة للأكل تماماً!"
        ),
        # فيديو خلفية طبيعي/نحل كمثال
        "video_url": (
            "https://assets.mixkit.co/videos/preview/mixkit-bees-on-a-honeycomb-42994-large.mp4"
        ),
    },
    {
        "title": "قلب الحوت الأزرق",
        "script": (
            "هل تعلم أن قلب الحوت الأزرق يزن حوالي أربع طن، وحجمه يقارب حجم"
            " سيارة صغيرة؟ بل إن شرايينه الرئيسية يمكن أن يسبح فيها طفل صغير بكل"
            " سهولة!"
        ),
        # فيديو خلفية بحر/محيط كمثال
        "video_url": (
            "https://assets.mixkit.co/videos/preview/mixkit-sea-of-clouds-and-blue-sky-4115-large.mp4"
        ),
    },
]


def get_page_credentials():
  accounts_url = f"https://graph.facebook.com/v18.0/me/accounts?access_token={SHORT_LIVED_TOKEN}"
  response = requests.get(accounts_url).json()
  for page in response.get("data", []):
    if page["name"] == TARGET_NAME:
      return page["id"], page["access_token"]
  return None, None


def download_file(url, filename):
  """دالة لتحميل ملفات الفيديو والصوت مؤقتاً"""
  response = requests.get(url, stream=True)
  if response.status_code == 200:
    with open(filename, "wb") as f:
      for chunk in response.iter_content(chunk_size=1024):
        f.write(chunk)
    return True
  return False


def create_reel_video(fact_data, output_filename="reel.mp4"):
  print("🎙️ جاري توليد التعليق الصوتي...")
  audio_path = "temp_audio.mp3"
  tts = gTTS(text=fact_data["script"], lang="ar", slow=False)
  tts.save(audio_path)

  print("📥 جاري تحميل فيديو الخلفية المتوافق مع المعلومة...")
  bg_video_path = "temp_bg.mp4"
  if not download_file(fact_data["video_url"], bg_video_path):
    raise Exception("فشل في تحميل فيديو الخلفية.")

  print("🎬 جاري دمج الصوت مع الفيديو وضبط المدة الزمنية...")
  audio_clip = AudioFileClip(audio_path)
  video_clip = VideoFileClip(bg_video_path)

  # قص أو تكرار الفيديو ليطابق طول التعليق الصوتي تماماً
  if video_clip.duration < audio_clip.duration:
    # لو الفيديو أقصر، يمكن حلقه (Loop) أو تسريعه، هنا نكتفي بضبطه كحد أقصى
    video_clip = video_clip.loop(duration=audio_clip.duration)
  else:
    video_clip = video_clip.subclipped(0, audio_clip.duration)

  # ربط الصوت بالفيديو
  final_clip = video_clip.set_audio(audio_clip)

  # تصدير الفيديو النهائي بمواصفات مناسبة للـ Reels
  final_clip.write_videofile(
      output_filename,
      fps=24,
      codec="libx264",
      audio_codec="aac",
      preset="ultrafast",
      logger=None,
  )

  # تنظيف الملفات المؤقتة
  audio_clip.close()
  video_clip.close()
  final_clip.close()
  if os.path.exists(audio_path):
    os.remove(audio_path)
  if os.path.exists(bg_video_path):
    os.remove(bg_video_path)

  return output_filename


def publish_automated_reel():
  print("--- 🚀 بدء دورة الإنتاج والنشر الآلي المتكاملة ---")
  page_id, page_token = get_page_credentials()

  if not page_id:
    print("⚠️ لم يتم العثور على الصفحة.")
    return

  fact = random.choice(trivia_database)
  video_file_path = create_reel_video(fact)

  url = f"https://graph-video.facebook.com/v18.0/{page_id}/videos"
  with open(video_file_path, "rb") as video_file:
    files = {"source": video_file}
    payload = {
        "description": f"{fact['script']}\n\n#معلومات #هل_تعلم #نبض_24",
        "access_token": page_token,
    }

    print("📤 جاري رفع الـ Reel المتكامل إلى صفحة نبض 24...")
    response = requests.post(url, data=payload, files=files)
    result = response.json()

  print("رد فيسبوك:", result)

  if os.path.exists(video_file_path):
    os.remove(video_file_path)


def automation_loop():
  while True:
    try:
      publish_automated_reel()
    except Exception as e:
      print("حدث خطأ أثناء دورة العمل:", e)
    print("⏳ النظام في وضع السكون لدورة النشر القادمة بعد 6 ساعات...")
    time.sleep(6 * 3600)


@app.route("/")
def home():
  return "نظام الأوتو-بايلوت المتكامل لصفحة نبض 24 يعمل بكفاءة عالية!"


if __name__ == "__main__":
  t = threading.Thread(target=automation_loop, daemon=True)
  t.start()
  app.run(host="0.0.0.0", port=10000)

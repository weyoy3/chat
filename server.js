const express = require('express');
const cors = require('cors');
const ytdlp = require('yt-dlp-exec');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

app.post('/get-video', async (req, res) => {
    const videoUrl = req.body.url;

    if (!videoUrl) {
        return res.status(400).json({ error: 'الرابط مطلوب' });
    }

    try {
        const output = await ytdlp(videoUrl, {
            dumpSingleJson: true,
            noCheckCertificates: true,
            noWarnings: true,
            preferFreeFormats: true,
            addHeader: ['referer:https://www.google.com']
        });

        const formatsList = [];
        
        if (output.formats) {
            output.formats.forEach(f => {
                if (f.vcodec !== 'none' && f.url) {
                    formatsList.push({
                        url: f.url,
                        quality: f.format_note || f.resolution || '720p',
                        ext: f.ext || 'mp4'
                    });
                }
            });
        }

        res.json({
            title: output.title || 'فيديو بدون عنوان',
            thumbnail: output.thumbnail || '',
            duration: output.duration || 0,
            formats: formatsList
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'فشل جلب بيانات الفيديو، تأكد من صحة الرابط.' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

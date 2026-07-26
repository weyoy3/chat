require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// لو JWT_SECRET مش متضاف في Render، نولّد سر مؤقت عشان السيرفر ما يقعش أبدًا
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = require('crypto').randomBytes(48).toString('hex');
  console.warn('⚠️ JWT_SECRET مش موجود — تم توليد سر مؤقت (ستُبطل الجلسات عند كل إعادة تشغيل)');
}

const app = express();
app.use(cors());
app.use(express.json());

// لفّ أي route عشان الأخطاء توصل للمعالج بدل ما توقّع السيرفر
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ===================== الموديلات ===================== */
const User = mongoose.model('User', new mongoose.Schema({
  name: String,
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['admin', 'doctor', 'reception'], default: 'reception' },
}, { timestamps: true }));

const Patient = mongoose.model('Patient', new mongoose.Schema({
  name:      { type: String, required: true, trim: true },
  phone:     { type: String, required: true },
  age:       Number,
  gender:    { type: String, enum: ['ذكر', 'أنثى'] },
  diagnosis: String,
  notes:     String,
}, { timestamps: true }));

const Appointment = mongoose.model('Appointment', new mongoose.Schema({
  patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
  date:    { type: String, required: true },
  time:    { type: String, required: true },
  type:    { type: String, enum: ['كشف جديد', 'متابعة', 'استشارة'], default: 'كشف جديد' },
  status:  { type: String, enum: ['مجدول', 'قيد الانتظار', 'مكتمل', 'ملغي'], default: 'مجدول' },
  notes:   String,
}, { timestamps: true }));

/* ===================== حماية ===================== */
const auth = (req, res, next) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ msg: 'غير مصرح بالدخول' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ msg: 'انتهت الجلسة — سجّل دخول من جديد' }); }
};
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ===================== الدخول ===================== */
app.post('/api/auth/login', wrap(async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (!user || !(await bcrypt.compare(password, user.password)))
    return res.status(401).json({ msg: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  const token = jwt.sign(
    { id: user._id, name: user.name, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
  res.json({ token, user: { name: user.name, role: user.role } });
}));

app.get('/api/auth/me', auth, (req, res) => res.json(req.user));

/* ===================== المرضى ===================== */
app.get('/api/patients', auth, wrap(async (req, res) => {
  const { q } = req.query;
  const filter = q ? { $or: [
    { name: new RegExp(escRe(q), 'i') },
    { phone: new RegExp(escRe(q), 'i') },
    { diagnosis: new RegExp(escRe(q), 'i') },
  ]} : {};
  res.json(await Patient.find(filter).sort('-createdAt'));
}));

app.post('/api/patients', auth, wrap(async (req, res) => {
  res.status(201).json(await Patient.create(req.body));
}));

app.put('/api/patients/:id', auth, wrap(async (req, res) => {
  res.json(await Patient.findByIdAndUpdate(req.params.id, req.body, { new: true }));
}));

app.delete('/api/patients/:id', auth, wrap(async (req, res) => {
  await Patient.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
}));

/* ===================== المواعيد ===================== */
app.get('/api/appointments', auth, wrap(async (req, res) => {
  const { date } = req.query;
  res.json(await Appointment.find(date ? { date } : {}).populate('patient', 'name phone').sort('time'));
}));

app.post('/api/appointments', auth, wrap(async (req, res) => {
  res.status(201).json(await Appointment.create(req.body));
}));

app.patch('/api/appointments/:id/status', auth, wrap(async (req, res) => {
  res.json(await Appointment.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true }));
}));

app.delete('/api/appointments/:id', auth, wrap(async (req, res) => {
  await Appointment.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
}));

/* ===================== الإحصائيات ===================== */
app.get('/api/stats', auth, wrap(async (req, res) => {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const [patients, todayApps] = await Promise.all([
    Patient.countDocuments(),
    Appointment.find({ date: today }),
  ]);
  res.json({
    patients,
    todayTotal: todayApps.length,
    done:      todayApps.filter(a => a.status === 'مكتمل').length,
    waiting:   todayApps.filter(a => a.status === 'قيد الانتظار').length,
    cancelled: todayApps.filter(a => a.status === 'ملغي').length,
  });
}));

/* ===================== تقديم الموقع ===================== */
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ msg: 'مسار غير موجود' });
  res.sendFile(path.join(__dirname, 'index.html'));
});

/* معالج أخطاء عام — يرد برسالة واضحة بدل ما يقع السيرفر */
app.use((err, req, res, next) => {
  console.error('⚠️ خطأ:', err && err.message);
  if (err && err.name === 'CastError') return res.status(400).json({ msg: 'معرف غير صالح' });
  if (err && /mongo|buffering|ECONNREFUSED|topology|getaddrinfo/i.test(err.message))
    return res.status(503).json({ msg: 'قاعدة البيانات غير متصلة حاليًا — حاول بعد لحظات' });
  res.status(500).json({ msg: (err && err.message) || 'حدث خطأ في الخادم' });
});

/* ===================== التشغيل ===================== */
const PORT = process.env.PORT || 10000;

const MONGO_URI =
  process.env.MONGO_URI ||
  process.env.MONGODB_URI ||
  process.env.MONGO_URL ||
  process.env.DATABASE_URL ||
  '';

console.log('🔑 الرابط واصل؟', !!MONGO_URI, '| mongodb+srv؟', MONGO_URI.startsWith('mongodb+srv'));
console.log('🔐 JWT_SECRET موجود؟', !!process.env.JWT_SECRET);

app.listen(PORT, () => console.log(`✅ نبض يعمل على المنفذ ${PORT}`));

async function connectDB(retries = 5) {
  if (!MONGO_URI) { console.error('⛔ متغير قاعدة البيانات فاضي!'); return; }
  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 8000, connectTimeoutMS: 10000 });
    console.log('🍃 متصل بـ MongoDB');
    if (!(await User.findOne({ username: 'admin' }))) {
      await User.create({
        name: 'مدير العيادة', username: 'admin',
        password: await bcrypt.hash('admin123', 10), role: 'admin',
      });
      console.log('👤 حساب افتراضي: admin / admin123');
    }
  } catch (err) {
    console.error('❌ فشل الاتصال:', err.message);
    if (retries > 0) setTimeout(() => connectDB(retries - 1), 5000);
  }
}
connectDB();

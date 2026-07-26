require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

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
app.post('/api/auth/login', async (req, res) => {
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
});

app.get('/api/auth/me', auth, (req, res) => res.json(req.user));

/* ===================== المرضى ===================== */
app.get('/api/patients', auth, async (req, res) => {
  const { q } = req.query;
  const filter = q ? { $or: [
    { name: new RegExp(escRe(q), 'i') },
    { phone: new RegExp(escRe(q), 'i') },
    { diagnosis: new RegExp(escRe(q), 'i') },
  ]} : {};
  res.json(await Patient.find(filter).sort('-createdAt'));
});

app.post('/api/patients', auth, async (req, res) => {
  try { res.status(201).json(await Patient.create(req.body)); }
  catch { res.status(400).json({ msg: 'تأكد من إدخال الاسم ورقم الهاتف' }); }
});

app.put('/api/patients/:id', auth, async (req, res) => {
  res.json(await Patient.findByIdAndUpdate(req.params.id, req.body, { new: true }));
});

app.delete('/api/patients/:id', auth, async (req, res) => {
  await Patient.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

/* ===================== المواعيد ===================== */
app.get('/api/appointments', auth, async (req, res) => {
  const { date } = req.query;
  res.json(await Appointment.find(date ? { date } : {}).populate('patient', 'name phone').sort('time'));
});

app.post('/api/appointments', auth, async (req, res) => {
  try { res.status(201).json(await Appointment.create(req.body)); }
  catch { res.status(400).json({ msg: 'اختر مريضًا وحدد التاريخ والوقت' }); }
});

app.patch('/api/appointments/:id/status', auth, async (req, res) => {
  res.json(await Appointment.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true }));
});

app.delete('/api/appointments/:id', auth, async (req, res) => {
  await Appointment.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

/* ===================== الإحصائيات ===================== */
app.get('/api/stats', auth, async (req, res) => {
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
});

/* ===================== تقديم الموقع ===================== */
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ msg: 'مسار غير موجود' });
  res.sendFile(path.join(__dirname, 'index.html'));
});

/* معالج أخطاء عام */
app.use((err, req, res, next) => {
  console.error(err);
  if (err.name === 'CastError') return res.status(400).json({ msg: 'معرف غير صالح' });
  res.status(500).json({ msg: 'حدث خطأ في الخادم' });
});

/* ===================== التشغيل ===================== */
const PORT = process.env.PORT || 10000;

// يقرأ الرابط بأي اسم حاططه بيه في Render (MONGO_URL أو MONGO_URI أو غيره)
const MONGO_URI =
  process.env.MONGO_URI ||
  process.env.MONGODB_URI ||
  process.env.MONGO_URL ||
  process.env.DATABASE_URL ||
  '';

console.log('🔑 الرابط واصل؟', !!MONGO_URI, '| mongodb+srv؟', MONGO_URI.startsWith('mongodb+srv'));

// 1) نشغّل السيرفر فورًا (عشان Render ما يقولش deploy failed)
app.listen(PORT, () => console.log(`✅ نبض يعمل على المنفذ ${PORT}`));

// 2) نتصل بقاعدة البيانات بعدها (مع إعادة محاولة لو فشل)
async function connectDB(retries = 5) {
  if (!MONGO_URI) {
    console.error('⛔ متغير قاعدة البيانات فاضي! راجع Environment في Render');
    return;
  }
  try {
    await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 10000,
    });
    console.log('🍃 متصل بـ MongoDB');

    if (!(await User.findOne({ username: 'admin' }))) {
      await User.create({
        name: 'مدير العيادة',
        username: 'admin',
        password: await bcrypt.hash('admin123', 10),
        role: 'admin',
      });
      console.log('👤 حساب افتراضي: admin / admin123');
    }
  } catch (err) {
    console.error('❌ فشل الاتصال:', err.message);
    if (retries > 0) {
      console.log(`🔁 إعادة محاولة خلال 5 ثوانٍ… (${retries} متبقية)`);
      setTimeout(() => connectDB(retries - 1), 5000);
    } else {
      console.error('⛔ تأكد من Network Access = 0.0.0.0/0 في Atlas وصحة الرابط');
    }
  }
}
connectDB();

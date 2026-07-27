require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = require('crypto').randomBytes(48).toString('hex');
  console.warn('⚠️ JWT_SECRET مش موجود — تم توليد سر مؤقت');
}

const app = express();
app.use(cors());
app.use(express.json());

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const OID = id => new mongoose.Types.ObjectId(id);
const isDoneExpr = { $cond: [{ $eq: ['$status', 'مكتمل'] }, '$price', 0] };

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
  price:   { type: Number, default: 0 },
  queue:   { type: Number, default: 0 },
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
  const token = jwt.sign({ id: user._id, name: user.name, role: user.role },
    process.env.JWT_SECRET, { expiresIn: '7d' });
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

// ملخص مالي لكل مريض (يُدمج في جدول المرضى)
app.get('/api/patients/finance', auth, wrap(async (req, res) => {
  res.json(await Appointment.aggregate([
    { $match: { status: { $ne: 'ملغي' } } },
    { $group: { _id: '$patient', visits: { $sum: 1 }, paid: { $sum: isDoneExpr } } },
  ]));
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
  res.json(await Appointment.find(date ? { date } : {})
    .populate('patient', 'name phone').sort('queue time'));
}));
app.post('/api/appointments', auth, wrap(async (req, res) => {
  const data = { ...req.body, price: +req.body.price || 0 };
  const last = await Appointment.findOne({ date: data.date }).sort('-queue').select('queue');
  data.queue = (last?.queue || 0) + 1;
  res.status(201).json(await Appointment.create(data));
}));
app.patch('/api/appointments/:id/status', auth, wrap(async (req, res) => {
  res.json(await Appointment.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true }));
}));
app.delete('/api/appointments/:id', auth, wrap(async (req, res) => {
  await Appointment.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
}));

/* ===================== لوحة التحكم ===================== */
app.get('/api/stats', auth, wrap(async (req, res) => {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const [patients, todayApps] = await Promise.all([
    Patient.countDocuments(), Appointment.find({ date: today }),
  ]);
  const sum = arr => arr.reduce((s, a) => s + (+a.price || 0), 0);
  res.json({
    patients,
    todayTotal: todayApps.length,
    done:      todayApps.filter(a => a.status === 'مكتمل').length,
    waiting:   todayApps.filter(a => a.status === 'قيد الانتظار').length,
    cancelled: todayApps.filter(a => a.status === 'ملغي').length,
    todayRevenue: sum(todayApps.filter(a => a.status === 'مكتمل')),
    todayPending: sum(todayApps.filter(a => a.status === 'مجدول' || a.status === 'قيد الانتظار')),
  });
}));

/* ===================== التقارير ===================== */
app.get('/api/reports', auth, wrap(async (req, res) => {
  const d = new Date();
  const fmt = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  const from = req.query.from || fmt(d);
  const to   = req.query.to   || fmt(d);
  const type = req.query.type || '';
  const pid  = req.query.patient || '';

  const match = { date: { $gte: from, $lte: to }, status: { $ne: 'ملغي' } };
  if (type) match.type = type;
  if (pid)  match.patient = OID(pid);

  const pendExpr = { $cond: [{ $in: ['$status', ['مجدول', 'قيد الانتظار']] }, '$price', 0] };
  const doneExpr = { $cond: [{ $eq: ['$status', 'مكتمل'] }, 1, 0] };

  const [agg, list] = await Promise.all([
    Appointment.aggregate([
      { $match: match },
      { $lookup: { from: 'patients', localField: 'patient', foreignField: '_id', as: 'p' } },
      { $unwind: { path: '$p', preserveNullAndEmptyArrays: true } },
      { $facet: {
          totals: [{ $group: { _id: null,
            visits: { $sum: 1 }, paid: { $sum: isDoneExpr },
            pending: { $sum: pendExpr }, doneCount: { $sum: doneExpr } } }],
          byType: [{ $group: { _id: '$type', visits: { $sum: 1 }, paid: { $sum: isDoneExpr } } }],
          byPatient: [
            { $group: { _id: { id: '$patient', name: '$p.name', phone: '$p.phone' }, visits: { $sum: 1 }, paid: { $sum: isDoneExpr } } },
            { $sort: { paid: -1 } },
          ],
      } },
    ]),
    Appointment.find(match).populate('patient', 'name phone').sort('date queue time'),
  ]);

  // ملخص المريض لكل تاريخه (مش بس الفترة)
  let patientInfo = null, patientAll = null;
  if (pid) {
    patientInfo = await Patient.findById(pid).select('name phone');
    const allAgg = await Appointment.aggregate([
      { $match: { patient: OID(pid), status: { $ne: 'ملغي' } } },
      { $group: { _id: null, visits: { $sum: 1 }, paid: { $sum: isDoneExpr } } },
    ]);
    patientAll = allAgg[0] || { visits: 0, paid: 0 };
  }

  res.json({ from, to, agg: agg[0], list, patientInfo, patientAll });
}));

/* ===================== تقديم الموقع ===================== */
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ msg: 'مسار غير موجود' });
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('⚠️ خطأ:', err && err.message);
  if (err && err.name === 'CastError') return res.status(400).json({ msg: 'معرف غير صالح' });
  if (err && /mongo|buffering|ECONNREFUSED|topology|getaddrinfo/i.test(err.message))
    return res.status(503).json({ msg: 'قاعدة البيانات غير متصلة حاليًا — حاول بعد لحظات' });
  res.status(500).json({ msg: (err && err.message) || 'حدث خطأ في الخادم' });
});

/* ===================== التشغيل ===================== */
const PORT = process.env.PORT || 10000;
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI ||
  process.env.MONGO_URL || process.env.DATABASE_URL || '';

console.log('🔑 الرابط واصل؟', !!MONGO_URI, '| mongodb+srv؟', MONGO_URI.startsWith('mongodb+srv'));
console.log('🔐 JWT_SECRET موجود؟', !!process.env.JWT_SECRET);
app.listen(PORT, () => console.log(`✅ نبض يعمل على المنفذ ${PORT}`));

async function connectDB(retries = 5) {
  if (!MONGO_URI) { console.error('⛔ متغير قاعدة البيانات فاضي!'); return; }
  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 8000, connectTimeoutMS: 10000 });
    console.log('🍃 متصل بـ MongoDB');
    if (!(await User.findOne({ username: 'admin' }))) {
      await User.create({ name: 'مدير العيادة', username: 'admin',
        password: await bcrypt.hash('admin123', 10), role: 'admin' });
      console.log('👤 حساب افتراضي: admin / admin123');
    }
  } catch (err) {
    console.error('❌ فشل الاتصال:', err.message);
    if (retries > 0) setTimeout(() => connectDB(retries - 1), 5000);
  }
}
connectDB();

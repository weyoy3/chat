const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const h = fn => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(500).json({ error: e.message }); });

/* ====== الموديلات ====== */
const User = mongoose.model('User', new mongoose.Schema({ name: String, pin: String, role: String }));
const Product = mongoose.model('Product', new mongoose.Schema({
  name: String, barcode: { type: String, index: true }, price: Number, cost: Number,
  stock: Number, category: String, emoji: String, active: { type: Boolean, default: true }
}));
const Order = mongoose.model('Order', new mongoose.Schema({
  number: Number,
  items: [{ product: String, name: String, price: Number, qty: Number }],
  subtotal: Number, discount: Number, tax: Number, total: Number,
  paid: Number, change: Number, method: String, cashier: String
}, { timestamps: true }));

/* ====== الدخول ====== */
app.post('/api/auth/login', h(async (req, res) => {
  const u = await User.findOne({ pin: req.body.pin });
  if (!u) return res.status(401).json({ error: 'bad pin' });
  res.json({ name: u.name, role: u.role });
}));

/* ====== المنتجات ====== */
app.get('/api/products', h(async (_, res) => res.json(await Product.find({ active: true }))));

app.get('/api/products/by-barcode/:code', h(async (req, res) => {
  const p = await Product.findOne({ barcode: req.params.code, active: true });
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json(p);
}));

// إضافة/تحديث بالباركود — يمنع التكرار (upsert)
app.post('/api/products', h(async (req, res) => {
  const doc = {
    name: req.body.name, barcode: req.body.barcode, emoji: req.body.emoji || '🛒',
    category: req.body.category || 'عام',
    price: +req.body.price || 0, cost: +req.body.cost || 0, stock: +req.body.stock || 0, active: true
  };
  const p = await Product.findOneAndUpdate({ barcode: doc.barcode }, { $set: doc }, { new: true, upsert: true });
  res.json(p);
}));

app.put('/api/products/:id', h(async (req, res) =>
  res.json(await Product.findByIdAndUpdate(req.params.id, req.body, { new: true }))));

app.delete('/api/products/:id', h(async (req, res) =>
  res.json(await Product.findByIdAndUpdate(req.params.id, { active: false }))));

/* ====== الفواتير ====== */
app.get('/api/orders', h(async (_, res) =>
  res.json(await Order.find().sort({ createdAt: -1 }).limit(200))));

app.post('/api/orders', h(async (req, res) => {
  const { items, subtotal, discount, tax, total, paid, change, method, cashier } = req.body;
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'no items' });
  const number = 1001 + await Order.countDocuments();
  const order = await Order.create({ number, items, subtotal, discount, tax, total, paid, change, method, cashier });
  // خصم المخزون بدون ما ينزل تحت الصفر
  for (const it of items)
    await Product.updateOne({ _id: it.product, stock: { $gte: it.qty } }, { $inc: { stock: -it.qty } });
  res.json(order);
}));

/* ====== إحصائيات + صحة ====== */
app.get('/api/stats', h(async (_, res) => {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const today = await Order.aggregate([
    { $match: { createdAt: { $gte: start } } },
    { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 }, items: { $sum: { $sum: '$items.qty' } } } }
  ]);
  const days = await Order.aggregate([
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, total: { $sum: '$total' } } },
    { $sort: { _id: -1 } }, { $limit: 7 }
  ]);
  const top = await Order.aggregate([
    { $unwind: '$items' },
    { $group: { _id: '$items.name', qty: { $sum: '$items.qty' } } },
    { $sort: { qty: -1 } }, { $limit: 5 }
  ]);
  res.json({ today: today[0] || { total: 0, count: 0, items: 0 }, days, top });
}));

app.get('/api/health', (_, res) => res.json({ ok: true, db: mongoose.connection.readyState === 1, time: new Date() }));

/* ====== زرع البيانات أول مرة ====== */
async function seed() {
  if (await User.countDocuments() === 0)
    await User.create([
      { name: 'أحمد', pin: '1234', role: 'مدير' },
      { name: 'منى', pin: '1111', role: 'كاشير' }
    ]);
  if (await Product.countDocuments() === 0)
    await Product.create([
      ['إسبريسو','6220001',45,20,40,'مشروبات ساخنة','☕'],['كابتشينو','6220002',55,25,35,'مشروبات ساخنة','☕'],
      ['لاتيه','6220003',60,28,30,'مشروبات ساخنة','🥛'],['شاي بالنعناع','6220004',25,8,50,'مشروبات ساخنة','🍵'],
      ['آيس كوفي','6220007',65,30,28,'مشروبات باردة','🧋'],['عصير برتقال','6220008',40,18,20,'مشروبات باردة','🍊'],
      ['ليموناضة','6220009',30,10,30,'مشروبات باردة','🍋'],['مياه معدنية','6220011',10,5,80,'مشروبات باردة','💧'],
      ['كرواسون','6220013',35,15,22,'مأكولات','🥐'],['كلوب ساندوتش','6220014',75,38,15,'مأكولات','🥪'],
      ['بيتزا','6220015',90,45,12,'مأكولات','🍕'],['برجر','6220016',85,42,18,'مأكولات','🍔'],
      ['تشيز كيك','6220018',70,32,14,'حلويات','🍰'],['براونيز','6220019',55,24,20,'حلويات','🍫'],
      ['شيبسي','6220022',15,9,70,'سوبر ماركت','🥔'],['شيكولاتة','6220023',25,14,44,'سوبر ماركت','🍬'],
    ].map(p => ({ name:p[0], barcode:p[1], price:p[2], cost:p[3], stock:p[4], category:p[5], emoji:p[6] })));
  console.log('✅ Database seeded');
}

const PORT = process.env.PORT || 3000;
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/pos')
  .then(async () => { console.log('✅ MongoDB connected'); await seed(); })
  .catch(e => console.log('⚠️ MongoDB unavailable:', e.message));

app.listen(PORT, () => console.log(`🚀 POS running on port ${PORT}`));

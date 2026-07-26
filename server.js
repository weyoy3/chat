const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const h = fn => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(500).json({ error: e.message }); });

/* ====== الموديلات ====== */
const User = mongoose.model('User', new mongoose.Schema({ name: String, pin: String, role: String }));
const Product = mongoose.model('Product', new mongoose.Schema({
  name: String, barcode: { type: String, index: true }, price: Number, cost: Number,
  stock: Number, category: String, emoji: String, active: { type: Boolean, default: true }
}));
const Order = mongoose.model('Order', new mongoose.Schema({
  number: Number, type: { type: String, default: 'sale' }, origNo: Number, reason: String,
  items: [{ product: String, name: String, price: Number, cost: Number, qty: Number }],
  subtotal: Number, discount: Number, tax: Number, total: Number,
  paid: Number, change: Number, method: String, cashier: String
}, { timestamps: true }));

const Supplier = mongoose.model('Supplier', new mongoose.Schema({
  name: String, phone: String, address: String, terms: String, notes: String,
  active: { type: Boolean, default: true }
}, { timestamps: true }));

const PurchaseOrder = mongoose.model('PurchaseOrder', new mongoose.Schema({
  number: Number, supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' },
  status: { type: String, default: 'draft' }, // draft|sent|partial|received|cancelled
  items: [{ product: String, name: String, ordered: Number, received: Number, cost: Number }],
  subtotal: Number, notes: String,
  payments: [{ amount: Number, method: String, date: Date, note: String }],
  returns: [{ product: String, name: String, qty: Number, cost: Number, date: Date, reason: String }]
}, { timestamps: true }));

/* ====== الدخول ====== */
app.post('/api/auth/login', h(async (req, res) => {
  const u = await User.findOne({ pin: req.body.pin });
  if (!u) return res.status(401).json({ error: 'bad pin' });
  res.json({ name: u.name, role: u.role });
}));

/* ====== المنتجات ====== */
app.get('/api/products', h(async (_, res) => res.json(await Product.find({ active: true }))));
app.post('/api/products', h(async (req, res) => {
  const doc = { name: req.body.name, barcode: req.body.barcode, emoji: req.body.emoji || '🛒',
    category: req.body.category || 'عام', price: +req.body.price || 0, cost: +req.body.cost || 0, stock: +req.body.stock || 0, active: true };
  res.json(await Product.findOneAndUpdate({ barcode: doc.barcode }, { $set: doc }, { new: true, upsert: true }));
}));
app.put('/api/products/:id', h(async (req, res) => res.json(await Product.findByIdAndUpdate(req.params.id, req.body, { new: true }))));
app.delete('/api/products/:id', h(async (req, res) => res.json(await Product.findByIdAndUpdate(req.params.id, { active: false }))));

/* ====== فواتير البيع/المرتجع ====== */
app.get('/api/orders', h(async (_, res) => res.json(await Order.find().sort({ createdAt: -1 }).limit(400))));
app.post('/api/orders', h(async (req, res) => {
  const b = req.body;
  if (!Array.isArray(b.items) || !b.items.length) return res.status(400).json({ error: 'no items' });
  const number = 1001 + await Order.countDocuments();
  const order = await Order.create({ number, type: b.type || 'sale', origNo: b.origNo, reason: b.reason,
    items: b.items, subtotal: b.subtotal, discount: b.discount, tax: b.tax, total: b.total, paid: b.paid, change: b.change, method: b.method, cashier: b.cashier });
  const sign = (b.type === 'refund') ? -1 : 1; // مرتجع بيع = يرجّع للمخزون
  for (const it of b.items)
    await Product.updateOne({ _id: it.product, stock: { $gte: sign > 0 ? it.qty : 0 } }, { $inc: { stock: -sign * it.qty } });
  res.json(order);
}));

/* ====== الموردون ====== */
app.get('/api/suppliers', h(async (_, res) => res.json(await Supplier.find({ active: true }).sort({ name: 1 }))));
app.post('/api/suppliers', h(async (req, res) => res.json(await Supplier.create(req.body))));
app.put('/api/suppliers/:id', h(async (req, res) => res.json(await Supplier.findByIdAndUpdate(req.params.id, req.body, { new: true }))));
app.delete('/api/suppliers/:id', h(async (req, res) => res.json(await Supplier.findByIdAndUpdate(req.params.id, { active: false }))));

/* ====== أوامر الشراء ====== */
app.get('/api/purchase-orders', h(async (_, res) =>
  res.json(await PurchaseOrder.find().sort({ createdAt: -1 }).limit(400).populate('supplier', 'name'))));

app.post('/api/purchase-orders', h(async (req, res) => {
  const b = req.body;
  const number = 5001 + await PurchaseOrder.countDocuments();
  res.json(await PurchaseOrder.create({ number, supplier: b.supplier, status: b.status || 'draft',
    items: b.items, subtotal: b.subtotal, notes: b.notes }));
}));

// استلام — idempotent: يزوّد المخزون بالفرق بين المطلوب والمستلم السابق فقط
app.post('/api/purchase-orders/:id/receive', h(async (req, res) => {
  const po = await PurchaseOrder.findById(req.params.id); if (!po) return res.status(404).json({ error: 'no po' });
  const recv = req.body.received || []; // [{product, qty}] إجمالي المستلم الجديد لكل صنف
  for (const r of recv) {
    const it = po.items.find(x => String(x.product) === String(r.product)); if (!it) continue;
    const newRecv = Math.min(it.ordered, +r.qty || 0);
    const delta = newRecv - (it.received || 0);          // الفرق فقط
    if (delta !== 0) await Product.updateOne({ _id: it.product }, { $inc: { stock: delta } });
    it.received = newRecv;
  }
  const allDone = po.items.every(x => (x.received || 0) >= x.ordered);
  const anyRecv = po.items.some(x => (x.received || 0) > 0);
  po.status = allDone ? 'received' : (anyRecv ? 'partial' : po.status);
  await po.save();
  res.json(po);
}));

// سداد على أمر شراء
app.post('/api/purchase-orders/:id/pay', h(async (req, res) => {
  const po = await PurchaseOrder.findById(req.params.id); if (!po) return res.status(404).json({ error: 'no po' });
  po.payments.push({ amount: +req.body.amount || 0, method: req.body.method || 'cash', date: new Date(), note: req.body.note || '' });
  await po.save(); res.json(po);
}));

// مرتجع لمورد — idempotent عبر سجل returns بـ id؛ يخصم المخزون مرة
app.post('/api/purchase-orders/:id/return', h(async (req, res) => {
  const po = await PurchaseOrder.findById(req.params.id); if (!po) return res.status(404).json({ error: 'no po' });
  const list = req.body.returns || []; // [{product,name,qty,cost,reason, _cid}]
  for (const r of list) {
    if (po.returns.some(x => x._cid && x._cid === r._cid)) continue; // منع التكرار
    await Product.updateOne({ _id: r.product, stock: { $gte: +r.qty || 0 } }, { $inc: { stock: -(+r.qty || 0) } });
    po.returns.push({ product: r.product, name: r.name, qty: +r.qty, cost: +r.cost, date: new Date(), reason: r.reason || '', _cid: r._cid });
  }
  await po.save(); res.json(po);
}));

app.put('/api/purchase-orders/:id/cancel', h(async (req, res) => {
  const po = await PurchaseOrder.findByIdAndUpdate(req.params.id, { status: 'cancelled' }, { new: true });
  res.json(po);
}));

/* ====== صحة ====== */
app.get('/api/health', (_, res) => res.json({ ok: true, db: mongoose.connection.readyState === 1, time: new Date() }));

/* ====== زرع البيانات ====== */
async function seed() {
  if (await User.countDocuments() === 0)
    await User.create([{ name: 'أحمد', pin: '1234', role: 'مدير' }, { name: 'منى', pin: '1111', role: 'كاشير' }]);

  let prods = await Product.find();
  if (prods.length === 0) {
    prods = await Product.create([
      ['إسبريسو','6220001',45,20,40,'مشروبات ساخنة','☕'],['كابتشينو','6220002',55,25,35,'مشروبات ساخنة','☕'],
      ['لاتيه','6220003',60,28,30,'مشروبات ساخنة','🥛'],['شاي بالنعناع','6220004',25,8,50,'مشروبات ساخنة','🍵'],
      ['آيس كوفي','6220007',65,30,28,'مشروبات باردة','🧋'],['عصير برتقال','6220008',40,18,20,'مشروبات باردة','🍊'],
      ['ليموناضة','6220009',30,10,30,'مشروبات باردة','🍋'],['مياه معدنية','6220011',10,5,80,'مشروبات باردة','💧'],
      ['كرواسون','6220013',35,15,22,'مأكولات','🥐'],['بيتزا','6220015',90,45,12,'مأكولات','🍕'],['برجر','6220016',85,42,18,'مأكولات','🍔'],
      ['تشيز كيك','6220018',70,32,14,'حلويات','🍰'],['براونيز','6220019',55,24,20,'حلويات','🍫'],
      ['شيبسي','6220022',15,9,70,'سوبر ماركت','🥔'],['شيكولاتة','6220023',25,14,44,'سوبر ماركت','🍬'],['لبن','6220025',18,11,4,'سوبر ماركت','🥛'],
    ].map(p => ({ name:p[0], barcode:p[1], price:p[2], cost:p[3], stock:p[4], category:p[5], emoji:p[6] })));
  }
  const byName = n => (prods.find(p => p.name === n) || {})._id;

  if (await Supplier.countDocuments() === 0) {
    const [s1, s2, s3] = await Supplier.create([
      { name: 'الأهرام للمشروبات', phone: '01000000001', address: 'القاهرة — مدينة نصر', terms: 'آجل 14 يوم', notes: 'مورد رئيسي للمشروبات' },
      { name: 'المتحدة للألبان', phone: '01000000002', address: 'العبور', terms: 'نقدي عند الاستلام', notes: '' },
      { name: 'مخابز النيل', phone: '01000000003', address: 'الجيزة', terms: 'أسبوعي', notes: 'مخبوزات طازجة يوميًا' },
    ]);
    if (await PurchaseOrder.countDocuments() === 0) {
      await PurchaseOrder.create({
        number: 5001, supplier: s1._id, status: 'partial',
        items: [
          { product: byName('مياه معدنية'), name: 'مياه معدنية', ordered: 100, received: 60, cost: 5 },
          { product: byName('عصير برتقال'), name: 'عصير برتقال', ordered: 40, received: 0, cost: 18 },
        ],
        subtotal: 500 + 720, notes: 'طلب أسبوعي',
        payments: [{ amount: 300, method: 'cash', date: new Date(), note: 'دفعة أولى' }], returns: []
      });
    }
  }
  console.log('✅ Database seeded');
}

const PORT = process.env.PORT || 3000;
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/pos')
  .then(async () => { console.log('✅ MongoDB connected'); await seed(); })
  .catch(e => console.log('⚠️ MongoDB unavailable:', e.message));

app.listen(PORT, () => console.log(`🚀 POS running on port ${PORT}`));

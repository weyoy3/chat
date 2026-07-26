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
  customer: String, customerName: String, pointsEarned: Number, pointsUsed: Number,
  items: [{ product: String, name: String, price: Number, cost: Number, qty: Number }],
  subtotal: Number, discount: Number, loyaltyDiscount: Number, tax: Number, total: Number,
  paid: Number, change: Number, method: String, cashier: String
}, { timestamps: true }));
const Supplier = mongoose.model('Supplier', new mongoose.Schema({
  name: String, phone: String, address: String, terms: String, notes: String, active: { type: Boolean, default: true }
}, { timestamps: true }));
const PurchaseOrder = mongoose.model('PurchaseOrder', new mongoose.Schema({
  number: Number, supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' },
  status: { type: String, default: 'draft' },
  items: [{ product: String, name: String, ordered: Number, received: Number, cost: Number }],
  subtotal: Number, notes: String,
  payments: [{ amount: Number, method: String, date: Date, note: String }],
  returns: [{ product: String, name: String, qty: Number, cost: Number, date: Date, reason: String }]
}, { timestamps: true }));
const Customer = mongoose.model('Customer', new mongoose.Schema({
  name: String, phone: { type: String, index: true }, points: { type: Number, default: 0 },
  totalPoints: { type: Number, default: 0 }, level: { type: String, default: 'برونزي' },
  totalSpent: { type: Number, default: 0 }, visits: { type: Number, default: 0 },
  history: [{ type: String, at: Date, amount: Number, points: Number, ref: String }],
  active: { type: Boolean, default: true }
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
  const d = { name: req.body.name, barcode: req.body.barcode, emoji: req.body.emoji || '🛒',
    category: req.body.category || 'عام', price: +req.body.price || 0, cost: +req.body.cost || 0, stock: +req.body.stock || 0, active: true };
  res.json(await Product.findOneAndUpdate({ barcode: d.barcode }, { $set: d }, { new: true, upsert: true }));
}));
app.put('/api/products/:id', h(async (req, res) => res.json(await Product.findByIdAndUpdate(req.params.id, req.body, { new: true }))));
app.delete('/api/products/:id', h(async (req, res) => res.json(await Product.findByIdAndUpdate(req.params.id, { active: false }))));

/* ====== البيع/المرتجع ====== */
app.get('/api/orders', h(async (_, res) => res.json(await Order.find().sort({ createdAt: -1 }).limit(400))));
app.post('/api/orders', h(async (req, res) => {
  const b = req.body;
  if (!Array.isArray(b.items) || !b.items.length) return res.status(400).json({ error: 'no items' });
  const number = 1001 + await Order.countDocuments();
  const order = await Order.create({ number, type: b.type || 'sale', origNo: b.origNo, reason: b.reason,
    customer: b.customer, customerName: b.customerName, pointsEarned: b.pointsEarned, pointsUsed: b.pointsUsed,
    items: b.items, subtotal: b.subtotal, discount: b.discount, loyaltyDiscount: b.loyaltyDiscount, tax: b.tax, total: b.total,
    paid: b.paid, change: b.change, method: b.method, cashier: b.cashier });
  const sign = (b.type === 'refund') ? -1 : 1;
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
app.get('/api/purchase-orders', h(async (_, res) => res.json(await PurchaseOrder.find().sort({ createdAt: -1 }).limit(400).populate('supplier', 'name'))));
app.post('/api/purchase-orders', h(async (req, res) => {
  const b = req.body; const number = 5001 + await PurchaseOrder.countDocuments();
  res.json(await PurchaseOrder.create({ number, supplier: b.supplier, status: b.status || 'draft', items: b.items, subtotal: b.subtotal, notes: b.notes }));
}));
app.post('/api/purchase-orders/:id/receive', h(async (req, res) => {
  const po = await PurchaseOrder.findById(req.params.id); if (!po) return res.status(404).json({ error: 'no po' });
  for (const r of (req.body.received || [])) {
    const it = po.items.find(x => String(x.product) === String(r.product)); if (!it) continue;
    const nr = Math.min(it.ordered, +r.qty || 0); const delta = nr - (it.received || 0);
    if (delta !== 0) await Product.updateOne({ _id: it.product }, { $inc: { stock: delta } });
    it.received = nr;
  }
  const all = po.items.every(x => (x.received || 0) >= x.ordered); const any = po.items.some(x => (x.received || 0) > 0);
  po.status = all ? 'received' : (any ? 'partial' : po.status); await po.save(); res.json(po);
}));
app.post('/api/purchase-orders/:id/pay', h(async (req, res) => {
  const po = await PurchaseOrder.findById(req.params.id); if (!po) return res.status(404).json({ error: 'no po' });
  po.payments.push({ amount: +req.body.amount || 0, method: req.body.method || 'cash', date: new Date(), note: req.body.note || '' });
  await po.save(); res.json(po);
}));
app.post('/api/purchase-orders/:id/return', h(async (req, res) => {
  const po = await PurchaseOrder.findById(req.params.id); if (!po) return res.status(404).json({ error: 'no po' });
  for (const r of (req.body.returns || [])) {
    if (po.returns.some(x => x._cid && x._cid === r._cid)) continue;
    await Product.updateOne({ _id: r.product, stock: { $gte: +r.qty || 0 } }, { $inc: { stock: -(+r.qty || 0) } });
    po.returns.push({ product: r.product, name: r.name, qty: +r.qty, cost: +r.cost, date: new Date(), reason: r.reason || '', _cid: r._cid });
  }
  await po.save(); res.json(po);
}));
app.put('/api/purchase-orders/:id/cancel', h(async (req, res) => res.json(await PurchaseOrder.findByIdAndUpdate(req.params.id, { status: 'cancelled' }, { new: true }))));

/* ====== العملاء ====== */
app.get('/api/customers', h(async (_, res) => res.json(await Customer.find({ active: true }).sort({ totalSpent: -1 }))));
app.post('/api/customers', h(async (req, res) => res.json(await Customer.create({ name: req.body.name, phone: req.body.phone || '', notes: req.body.notes || '' }))));
app.put('/api/customers/:id', h(async (req, res) => res.json(await Customer.findByIdAndUpdate(req.params.id, req.body, { new: true }))));
app.delete('/api/customers/:id', h(async (req, res) => res.json(await Customer.findByIdAndUpdate(req.params.id, { active: false }))));
// ولاء: نقاط/إنفاق/زيارة + سجل — idempotent عبر ref
app.post('/api/customers/:id/loyalty', h(async (req, res) => {
  const c = await Customer.findById(req.params.id); if (!c) return res.status(404).json({ error: 'no customer' });
  const b = req.body;
  if (b.ref && c.history.some(x => x.ref === b.ref)) return res.json(c); // منع التكرار
  c.history = c.history || [];
  if (b.pointsUsed) { c.points = Math.max(0, c.points - b.pointsUsed); c.history.push({ type: 'redeem', at: new Date(), points: b.pointsUsed, ref: b.ref }); }
  if (b.pointsEarned) { c.points += b.pointsEarned; c.totalPoints += b.pointsEarned; c.history.push({ type: 'earn', at: new Date(), points: b.pointsEarned, amount: b.spend || 0, ref: b.ref }); }
  if (b.spend) { c.totalSpent += b.spend; c.visits += 1; }
  c.level = levelFor(c.totalPoints);
  await c.save(); res.json(c);
}));

/* ====== صحة ====== */
app.get('/api/health', (_, res) => res.json({ ok: true, db: mongoose.connection.readyState === 1, time: new Date() }));

/* ====== مستويات ====== */
function levelFor(tp){ return tp >= 5000 ? 'بلاتيني' : tp >= 2000 ? 'ذهبي' : tp >= 500 ? 'فضي' : 'برونزي'; }

/* ====== زرع ====== */
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
    const [s1] = await Supplier.create([
      { name: 'الأهرام للمشروبات', phone: '01000000001', address: 'مدينة نصر', terms: 'آجل 14 يوم', notes: 'مورد رئيسي' },
      { name: 'المتحدة للألبان', phone: '01000000002', address: 'العبور', terms: 'نقدي عند الاستلام', notes: '' },
      { name: 'مخابز النيل', phone: '01000000003', address: 'الجيزة', terms: 'أسبوعي', notes: 'مخبوزات طازجة' },
    ]);
    if (await PurchaseOrder.countDocuments() === 0)
      await PurchaseOrder.create({ number: 5001, supplier: s1._id, status: 'partial',
        items: [{ product: byName('مياه معدنية'), name: 'مياه معدنية', ordered: 100, received: 60, cost: 5 },
                { product: byName('عصير برتقال'), name: 'عصير برتقال', ordered: 40, received: 0, cost: 18 }],
        subtotal: 1220, notes: 'طلب أسبوعي', payments: [{ amount: 300, method: 'cash', date: new Date(), note: 'دفعة أولى' }], returns: [] });
  }
  if (await Customer.countDocuments() === 0) {
    await Customer.create([
      { name: 'سارة محمود', phone: '01112223344', points: 320, totalPoints: 1240, level: 'فضي', totalSpent: 4800, visits: 38,
        history: [{ type: 'earn', at: new Date(Date.now()-864e5), points: 45, amount: 450 }, { type: 'redeem', at: new Date(Date.now()-3*864e5), points: 100 }] },
      { name: 'خالد إبراهيم', phone: '01155667788', points: 2150, totalPoints: 6300, level: 'بلاتيني', totalSpent: 21000, visits: 142,
        history: [{ type: 'earn', at: new Date(Date.now()-2*864e5), points: 180, amount: 1200 }] },
    ]);
  }
  console.log('✅ Database seeded');
}

const PORT = process.env.PORT || 3000;
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/pos')
  .then(async () => { console.log('✅ MongoDB connected'); await seed(); })
  .catch(e => console.log('⚠️ MongoDB unavailable:', e.message));
app.listen(PORT, () => console.log(`🚀 POS running on port ${PORT}`));

/* =====================================================================
   شات عربي — المرحلة 2 (ملف واحد) — نسخة مُصلَّحة
   إصلاح: nameCgrad → Schema.Types.Mixed  +  مرونة أسماء الـ env
   ===================================================================== */
'use strict';
require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

/* ----------------------------- البيئة ----------------------------- */
const ENV = {
  port: process.env.PORT || 10000,
  // يقرأ MONGO_URI أو MONGODB_URI (تغطية للاسمين)
  mongoUri: process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/arabicchat',
  // يقرأ JWT_SECRET أو SESSION_SECRET (تغطية للاسمين)
  secret: process.env.JWT_SECRET || process.env.SESSION_SECRET || 'dev_secret_change_me_please_1234567890',
  clientUrl: process.env.CLIENT_URL || '*',
  env: process.env.NODE_ENV || 'development',
};
if (ENV.env === 'production' && ENV.secret.startsWith('dev_secret_')) {
  console.warn('⚠️ غيّر JWT_SECRET / SESSION_SECRET في الإنتاج.');
}

/* --------------------------- أدوات عامة --------------------------- */
const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const clean = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => MAP[c]);
const safeName = (s) => clean(String(s || '').replace(/\s+/g, ' ').trim()).slice(0, 24);
const safeText = (s) => clean(String(s || '').replace(/\s+$/g, '')).slice(0, 600);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, parseInt(n) || 0));
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

// توليد التدرج المخصص — مطابق للموقع الأصلي [217,127,336]
function buildCgrad(c0, c1, c2, type) {
  const ok = (x) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(x || ''));
  if (!ok(c0) || !ok(c1) || !ok(c2)) return '';
  if (type === 'm') {
    const d = [217, 127, 336], c = [c2, c0, c1];
    return c.map((col, i) => `linear-gradient(${d[i]}deg, ${col}, rgba(255,0,0,0) 70.71%)`).join(',');
  }
  const c = [c2, c1, c0];
  return `linear-gradient(to ${type === 'h' ? 'left' : 'top'}, ${c.join(',')})`;
}

/* --------------------- نظام الرتب --------------------- */
const RANKS = [
  { level: 0,  name: 'زائر',        icon: '',  color: '#8fa6b0', min: 0,    staff: false },
  { level: 1,  name: 'عضو',         icon: '•', color: '#59b300', min: 0,    staff: false },
  { level: 2,  name: 'عضو نشط',     icon: '✦', color: '#00a651', min: 250,  staff: false },
  { level: 3,  name: 'عضو مشارك',   icon: '✦', color: '#009688', min: 700,  staff: false },
  { level: 5,  name: 'عضو متألق',   icon: '✷', color: '#3366ff', min: 1800, staff: false },
  { level: 8,  name: 'عضو ذهبي',    icon: '❂', color: '#e6a817', min: 4500, staff: false },
  { level: 12, name: 'مشرف',        icon: '🛡', color: '#0891b2', min: 0,    staff: true  },
  { level: 20, name: 'مشرف أول',    icon: '🛡', color: '#0e7490', min: 0,    staff: true  },
  { level: 99, name: 'مدير',        icon: '👑', color: '#d4a017', min: 0,    staff: true  },
];
const rankInfo = (lv) => RANKS.find((r) => r.level === lv) || RANKS[0];
const AUTO_RANKS = RANKS.filter((r) => !r.staff);
function autoRankFor(points) {
  let lv = 1;
  for (const r of AUTO_RANKS) if (points >= r.min && r.level > lv && !r.staff) lv = r.level;
  return lv;
}
const nextAutoThreshold = (lv) => {
  const i = AUTO_RANKS.findIndex((r) => r.level === lv);
  const nx = AUTO_RANKS[i + 1];
  return nx && !nx.staff ? nx.min : null;
};

/* ------------------------------ المودلات ------------------------------ */
const { Schema, model } = mongoose;

const userSchema = new Schema({
  username: { type: String, required: true, unique: true, trim: true },
  usernameLower: { type: String, required: true, unique: true, index: true },
  passHash: { type: String, required: true },
  rank: { type: Number, default: 1 },
  points: { type: Number, default: 100 },
  nameColor: { type: Number, default: 14 },
  nameGrad: { type: Number, default: 0 },
  nameFont: { type: Number, default: 0 },
  // ✅ الإصلاح: Mixed بدل nested object (الـ key الداخلية "type" كانت بتلخبط Mongoose)
  nameCgrad: { type: Schema.Types.Mixed, default: null },
  mood: { type: String, default: '', maxlength: 80 },
  country: { type: String, default: '' },
  gender: { type: Number, default: 0 },
  age: { type: Number, default: 0 },
  avatarId: { type: String, default: '' },
  avatarMime: { type: String, default: 'image/png' },
  bio: { type: String, default: '', maxlength: 300 },
  fingerprints: [{ type: String }],
  priv: {
    points: { type: Number, default: 1 }, media: { type: Number, default: 1 },
    friends: { type: Number, default: 1 }, talk: { type: Number, default: 1 },
  },
  lastSeen: Date,
}, { timestamps: true });

const roomSchema = new Schema({
  slug: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  icon: { type: String, default: '🌍' },
  topic: { type: String, default: '' },
  accent: { type: String, default: 'rgba(3,173,216,0.74)' },
  bgImage: { type: String, default: '' },
  locked: { type: Boolean, default: false },
  password: { type: String, default: '' },
  minRank: { type: Number, default: 0 },
}, { timestamps: true });

const messageSchema = new Schema({
  room: { type: Schema.Types.ObjectId, ref: 'Room', required: true, index: true },
  sid: { type: String, default: '' },
  userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  name: { type: String, required: true },
  color: { type: Number, default: 14 },
  grad: { type: Number, default: 0 },
  font: { type: Number, default: 0 },
  cgrad: { type: String, default: '' },
  rank: { type: Number, default: 0 },
  avatarId: { type: String, default: '' },
  text: { type: String, required: true },
  mentions: [{ type: String }],
  kind: { type: String, enum: ['msg', 'join', 'leave', 'sys', 'rankup', 'mod'], default: 'msg' },
}, { timestamps: true });
messageSchema.index({ room: 1, createdAt: -1 });
messageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

const privSchema = new Schema({
  conv: { type: String, required: true, index: true },
  from: { type: String, required: true }, to: { type: String, required: true },
  fromId: { type: String, default: '' }, toId: { type: String, default: '' },
  text: { type: String, required: true }, read: { type: Boolean, default: false },
}, { timestamps: true });
privSchema.index({ conv: 1, createdAt: -1 });

const wallSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true }, color: { type: Number, default: 14 },
  text: { type: String, required: true, maxlength: 2000 },
  likes: [{ type: String }],
  comments: [{ name: String, color: Number, text: String, at: { type: Date, default: Date.now } }],
}, { timestamps: true });
wallSchema.index({ createdAt: -1 });

const notifySchema = new Schema({
  userId: { type: String, required: true, index: true },
  type: { type: String, enum: ['mention', 'pm', 'gift', 'rankup', 'friend', 'mod'], required: true },
  from: { type: String, default: '' }, text: { type: String, default: '' },
  read: { type: Boolean, default: false },
}, { timestamps: true });
notifySchema.index({ userId: 1, createdAt: -1 });

const muteSchema = new Schema({
  name: { type: String, required: true }, room: { type: String, required: true },
  by: String, until: { type: Date, required: true, index: true },
});
const banSchema = new Schema({
  name: { type: String, required: true }, room: { type: String, default: '' },
  by: String, at: { type: Date, default: Date.now },
});
const reportSchema = new Schema({
  from: String, target: String, reason: String, extra: String, room: String,
  at: { type: Date, default: Date.now },
});

const User = model('User', userSchema);
const Room = model('Room', roomSchema);
const Message = model('Message', messageSchema);
const Priv = model('Priv', privSchema);
const Wall = model('Wall', wallSchema);
const Notify = model('Notify', notifySchema);
const Mute = model('Mute', muteSchema);
const Ban = model('Ban', banSchema);
const Report = model('Report', reportSchema);

/* --------------------------- Presence (ذاكرة) --------------------------- */
const presence = (() => {
  const people = new Map();
  const rooms = new Map();
  return {
    join(p) { people.set(p.sid, p); if (!rooms.has(p.room)) rooms.set(p.room, new Set()); rooms.get(p.room).add(p.sid); },
    leave(sid) {
      const p = people.get(sid); if (!p) return null; people.delete(sid);
      const set = rooms.get(p.room); if (set) { set.delete(sid); if (!set.size) rooms.delete(p.room); } return p;
    },
    get(sid) { return people.get(sid); },
    setTyping(sid, on) { const p = people.get(sid); if (p) p.typing = !!on; },
    setRank(sid, rank) { const p = people.get(sid); if (p) p.rank = rank; },
    list(room) {
      const set = rooms.get(room); if (!set) return [];
      return [...set].map((s) => people.get(s)).filter(Boolean).map((p) => ({
        sid: p.sid, name: p.name, color: p.color, grad: p.grad, font: p.font, cgrad: p.cgrad,
        rank: p.rank, avatarId: p.avatarId, mood: p.mood, typing: !!p.typing,
      }));
    },
    count(room) { return rooms.get(room)?.size || 0; },
    findSidByName(room, name) {
      const set = rooms.get(room); if (!set) return null;
      for (const s of set) { const p = people.get(s); if (p && p.name === name) return s; } return null;
    },
    sidForUser(uid) {
      if (!uid) return null;
      for (const [, p] of people) if (p.userId === String(uid)) return p.sid;
      return null;
    },
    fingerprintConflict(fp, userId) {
      if (!fp) return null;
      for (const [, p] of people) {
        if (p.fp === fp && String(p.userId || '') !== String(userId || '')) return p.name;
      }
      return null;
    },
  };
})();

/* ----------------------------- الحماية ----------------------------- */
const WORDS = [];
const hasBlocked = (t) => { const l = t.toLowerCase(); return WORDS.some((w) => l.includes(w.toLowerCase())); };

const flood = new Map();
function checkFlood(sid, burst = 3, win = 4000, mute = 6000) {
  const t = Date.now(); let a = (flood.get(sid) || []).filter((x) => t - x < win);
  if (a.length >= burst) { flood.set(sid, a); return { blocked: true, muteMs: mute }; }
  a.push(t); flood.set(sid, a); return { blocked: false };
}

const MOD_UA = /puffin|maxthon|seamonkey|lunascape|iron|slimjet/i;

function behaviorScore(b) {
  if (!b || typeof b !== 'object') return 100;
  const moves = b.moves || 0, keys = b.keys || 0, clicks = b.clicks || 0, dt = b.dt || 0;
  const human = moves + keys + clicks;
  if (human < 3 && dt < 4000) return 90;
  if (human < 8) return 45;
  return 5;
}

/* --------------------- Mute/Ban cache --------------------- */
const muteCache = new Map();
const banCache = new Set();
const mk = (name, room) => `${(name || '').toLowerCase()}::${room || ''}`;
async function loadModCache() {
  const now = new Date();
  const ms = await Mute.find({ until: { $gt: now } });
  muteCache.clear(); ms.forEach((m) => muteCache.set(mk(m.name, m.room), m.until.getTime()));
  const bs = await Ban.find();
  banCache.clear(); bs.forEach((b) => { banCache.add(mk(b.name, b.room)); if (!b.room) banCache.add(mk(b.name, '*')); });
}
function isMuted(name, room) {
  const u = muteCache.get(mk(name, room));
  if (u && u > Date.now()) return true;
  if (u) muteCache.delete(mk(name, room));
  return false;
}
function isBanned(name, room) {
  return banCache.has(mk(name, room)) || banCache.has(mk(name, '*'));
}
async function addMute(name, room, minutes, by) {
  const until = new Date(Date.now() + minutes * 60000);
  await Mute.deleteMany({ name, room });
  await Mute.create({ name, room, by, until });
  muteCache.set(mk(name, room), until.getTime());
}
async function removeMute(name, room) { await Mute.deleteMany({ name, room }); muteCache.delete(mk(name, room)); }
async function addBan(name, room, by) {
  await Ban.deleteMany({ name, room }); await Ban.create({ name, room, by });
  banCache.add(mk(name, room)); if (!room) banCache.add(mk(name, '*'));
}
async function removeBan(name, room) {
  await Ban.deleteMany({ name, room }); banCache.delete(mk(name, room)); banCache.delete(mk(name, '*'));
}
setInterval(() => {
  const now = Date.now();
  for (const [k, u] of muteCache) if (u <= now) muteCache.delete(k);
}, 60000);

/* --------------------------- مساعدة الهوية --------------------------- */
function styleOf(u) {
  return {
    color: u.nameColor || u.color || 14,
    grad: u.nameGrad || u.grad || 0,
    font: u.nameFont || u.font || 0,
    cgrad: u.nameCgrad ? buildCgrad(u.nameCgrad.c0, u.nameCgrad.c1, u.nameCgrad.c2, u.nameCgrad.type) : (u.cgrad || ''),
    rank: u.rank || 0, avatarId: u.avatarId || '', mood: u.mood || '',
  };
}
const makeToken = (uid) => jwt.sign({ uid: String(uid) }, ENV.secret, { expiresIn: '30d' });
async function userFromToken(token) {
  if (!token) return null;
  try { const d = jwt.verify(token, ENV.secret); return await User.findById(d.uid).lean(); }
  catch (e) { return null; }
}
function publicUser(u) {
  const ri = rankInfo(u.rank);
  const nx = nextAutoThreshold(u.rank);
  return {
    id: String(u._id), username: u.username, rank: u.rank, points: u.points,
    rankName: ri.name, rankIcon: ri.icon, rankColor: ri.color, staff: ri.staff,
    nextRankPts: nx, nameColor: u.nameColor, nameGrad: u.nameGrad, nameFont: u.nameFont,
    nameCgrad: u.nameCgrad || null, mood: u.mood, country: u.country, gender: u.gender,
    age: u.age, avatar: u.avatarId ? `/api/avatar/${u.avatarId}` : '', bio: u.bio, priv: u.priv,
  };
}

/* ----------------------------- GridFS للأفاتار ----------------------------- */
let bucket = null;
function getBucket() {
  if (!bucket) bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'avatars', chunkSizeBytes: 64 * 1024 });
  return bucket;
}
async function storeAvatar(buffer, mime) {
  const id = new mongoose.Types.ObjectId();
  const stream = getBucket().openUploadStreamWithId(id, 'av', { metadata: { mime } });
  stream.end(buffer);
  await new Promise((res, rej) => { stream.on('finish', res); stream.on('error', rej); });
  return String(id);
}
async function deleteAvatar(id) {
  try { await getBucket().delete(new mongoose.Types.ObjectId(id)); } catch (e) {}
}

/* ============================== EXPRESS ============================== */
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: ENV.clientUrl, methods: ['GET', 'POST'] },
  pingTimeout: 60000, pingInterval: 25000,
});
app.use(cors({ origin: ENV.clientUrl }));
app.use(express.json({ limit: '6mb' }));

app.get(['/', '/index.html'], (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/health', (req, res) => res.json({ ok: true, t: Date.now(), online: presence.count('general') }));

/* --------------------------- REST: المصادقة --------------------------- */
app.post('/api/auth/register', async (req, res) => {
  try {
    const username = safeName(req.body.username); const password = String(req.body.password || '');
    if (username.length < 3) return res.status(400).json({ err: 'الاسم لازم 3 حروف على الأقل.' });
    if (password.length < 4) return res.status(400).json({ err: 'كلمة المرور قصيرة.' });
    const lower = username.toLowerCase();
    if (await User.findOne({ usernameLower: lower })) return res.status(409).json({ err: 'الاسم مستخدم قبل كده.' });
    const passHash = await bcrypt.hash(password, 10);
    const u = await User.create({ username, usernameLower: lower, passHash, nameColor: clamp(req.body.color, 1, 24) || 14 });
    res.json({ ok: true, token: makeToken(u._id), user: publicUser(u) });
  } catch (e) { res.status(500).json({ err: 'خطأ في التسجيل.' }); }
});
app.post('/api/auth/login', async (req, res) => {
  try {
    const lower = safeName(req.body.username).toLowerCase(); const password = String(req.body.password || '');
    const u = await User.findOne({ usernameLower: lower });
    if (!u || !(await bcrypt.compare(password, u.passHash))) return res.status(401).json({ err: 'اسم أو كلمة مرور غلط.' });
    await User.updateOne({ _id: u._id }, { lastSeen: new Date() });
    res.json({ ok: true, token: makeToken(u._id), user: publicUser(u) });
  } catch (e) { res.status(500).json({ err: 'خطأ في الدخول.' }); }
});

/* --------------------------- REST: الغرف + polling --------------------------- */
app.get('/api/rooms', async (req, res) => {
  const rooms = await Room.find().sort({ name: 1 }).lean();
  res.json(rooms.map((r) => ({ slug: r.slug, name: r.name, icon: r.icon, topic: r.topic, accent: r.accent, locked: r.locked, minRank: r.minRank, online: presence.count(r.slug) })));
});
app.get('/api/chat/log', async (req, res) => {
  try {
    const slug = req.query.room || 'general'; const since = req.query.since ? new Date(req.query.since) : new Date(0);
    const room = await Room.findOne({ slug }); if (!room) return res.json({ logs: [], users: [], count: 0 });
    const logs = await Message.find({ room: room._id, createdAt: { $gt: since } }).sort({ createdAt: 1 }).limit(120).lean();
    res.json({ room: slug, logs: logs.map(toClientMsg), users: presence.list(slug), count: presence.count(slug) });
  } catch (e) { res.status(500).json({ logs: [], users: [], count: 0 }); }
});

/* --------------------------- REST: الأفاتار (GridFS) --------------------------- */
app.post('/api/avatar/upload', async (req, res) => {
  try {
    const u = await userFromToken(req.headers['x-token']);
    if (!u) return res.status(401).json({ err: 'سجل دخول الأول.' });
    const dataUrl = String(req.body.dataUrl || '');
    const m = dataUrl.match(/^data:(image\/(png|jpe?g|webp|gif));base64,(.+)$/);
    if (!m) return res.status(400).json({ err: 'صيغة صورة غير مدعومة.' });
    const buf = Buffer.from(m[3], 'base64');
    if (buf.length > 4 * 1024 * 1024) return res.status(400).json({ err: 'الصورة كبيرة جداً (الحد 4 ميجا).' });
    if (u.avatarId) await deleteAvatar(u.avatarId);
    const id = await storeAvatar(buf, m[1]);
    await User.updateOne({ _id: u._id }, { $set: { avatarId: id, avatarMime: m[1] } });
    res.json({ ok: true, avatar: `/api/avatar/${id}` });
  } catch (e) { res.status(500).json({ err: 'فشل رفع الصورة.' }); }
});
app.get('/api/avatar/:id', async (req, res) => {
  try {
    const u = await User.findOne({ avatarId: req.params.id }).select('avatarMime').lean();
    res.set('Content-Type', (u && u.avatarMime) || 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    const stream = getBucket().openDownloadStream(new mongoose.Types.ObjectId(req.params.id));
    stream.on('error', () => res.status(404).end());
    stream.pipe(res);
  } catch (e) { res.status(404).end(); }
});

/* --------------------------- REST: حفظ الإعدادات --------------------------- */
app.post('/api/me/update', async (req, res) => {
  try {
    const u = await userFromToken(req.headers['x-token']); if (!u) return res.status(401).json({ err: 'غير مسجل دخول.' });
    const b = req.body || {}; const upd = {};
    if (b.nameColor != null) upd.nameColor = clamp(b.nameColor, 1, 24);
    if (b.nameGrad != null) upd.nameGrad = clamp(b.nameGrad, 0, 80);
    if (b.nameFont != null) upd.nameFont = clamp(b.nameFont, 0, 13);
    if (b.nameCgrad) { const cg = b.nameCgrad; upd.nameCgrad = { c0: cg.c0, c1: cg.c1, c2: cg.c2, type: ['m', 'h', 'v'].includes(cg.type) ? cg.type : 'm' }; }
    if (b.clearCgrad) upd.nameCgrad = null;
    if (typeof b.mood === 'string') upd.mood = clean(b.mood).slice(0, 80);
    if (typeof b.bio === 'string') upd.bio = clean(b.bio).slice(0, 300);
    if (typeof b.country === 'string') upd.country = clean(b.country).slice(0, 40);
    if (b.gender != null) upd.gender = clamp(b.gender, 0, 3);
    if (b.age != null) upd.age = clamp(b.age, 0, 99);
    if (b.priv && typeof b.priv === 'object') {
      upd['priv.points'] = clamp(b.priv.points, 0, 2); upd['priv.media'] = clamp(b.priv.media, 0, 2);
      upd['priv.friends'] = clamp(b.priv.friends, 0, 2); upd['priv.talk'] = clamp(b.priv.talk, 0, 2);
    }
    await User.updateOne({ _id: u._id }, { $set: upd });
    const fresh = await User.findById(u._id).lean();
    res.json({ ok: true, user: publicUser(fresh) });
  } catch (e) { res.status(500).json({ err: 'خطأ في الحفظ.' }); }
});

/* --------------------------- REST: الحائط --------------------------- */
app.get('/api/wall', async (req, res) => {
  const posts = await Wall.find().sort({ createdAt: -1 }).limit(40).lean();
  res.json(posts.map((p) => ({ ...p, id: String(p._id), likesCount: p.likes.length, commentsCount: p.comments.length })));
});
app.post('/api/wall', async (req, res) => {
  const u = await userFromToken(req.headers['x-token']); if (!u) return res.status(401).json({ err: 'سجل دخول عشان تنشر.' });
  const text = safeText(req.body.text); if (!text) return res.status(400).json({ err: 'منشور فاضي.' });
  const st = styleOf(u);
  const p = await Wall.create({ userId: u._id, name: u.username, color: st.color, text });
  res.json({ ok: true, post: { ...p.toObject(), id: String(p._id), likesCount: 0, commentsCount: 0 } });
});
app.post('/api/wall/like', async (req, res) => {
  const u = await userFromToken(req.headers['x-token']); if (!u) return res.status(401).json({ err: 'login' });
  const key = String(u._id); const p = await Wall.findById(req.body.id); if (!p) return res.status(404).json({ err: 'nf' });
  const i = p.likes.indexOf(key); if (i >= 0) p.likes.splice(i, 1); else p.likes.push(key); await p.save();
  res.json({ ok: true, liked: i < 0, likesCount: p.likes.length });
});
app.post('/api/wall/comment', async (req, res) => {
  const u = await userFromToken(req.headers['x-token']); if (!u) return res.status(401).json({ err: 'login' });
  const text = safeText(req.body.text); if (!text) return res.status(400).json({ err: 'empty' });
  const st = styleOf(u); const p = await Wall.findById(req.body.id); if (!p) return res.status(404).json({ err: 'nf' });
  p.comments.push({ name: u.username, color: st.color, text }); await p.save();
  res.json({ ok: true, commentsCount: p.comments.length, comment: p.comments[p.comments.length - 1] });
});

/* --------------------------- REST: الإشعارات --------------------------- */
app.get('/api/notify', async (req, res) => {
  const u = await userFromToken(req.headers['x-token']); if (!u) return res.status(401).json({ err: 'login' });
  const list = await Notify.find({ userId: String(u._id) }).sort({ createdAt: -1 }).limit(30).lean();
  const unread = await Notify.countDocuments({ userId: String(u._id), read: false });
  res.json({ list: list.map((n) => ({ ...n, id: String(n._id) })), unread });
});
app.post('/api/notify/read', async (req, res) => {
  const u = await userFromToken(req.headers['x-token']); if (!u) return res.status(401).json({ err: 'login' });
  if (req.body.id) await Notify.updateOne({ _id: req.body.id, userId: String(u._id) }, { read: true });
  else await Notify.updateMany({ userId: String(u._id) }, { read: true });
  const unread = await Notify.countDocuments({ userId: String(u._id), read: false });
  res.json({ ok: true, unread });
});

/* ============================== SOCKET ============================== */
function toClientMsg(m) {
  return {
    id: String(m._id), sid: m.sid, userId: m.userId ? String(m.userId) : null,
    name: m.name, color: m.color, grad: m.grad, font: m.font, cgrad: m.cgrad,
    rank: m.rank, avatar: m.avatarId ? `/api/avatar/${m.avatarId}` : '',
    text: m.text, mentions: m.mentions || [], kind: m.kind, t: m.createdAt,
  };
}
async function pushNotify(userId, type, from, text) {
  if (!userId) return;
  const doc = await Notify.create({ userId: String(userId), type, from, text });
  const sid = presence.sidForUser(userId);
  if (sid) io.to(sid).emit('notify:new', { id: String(doc._id), type, from, text, t: doc.createdAt });
}

io.on('connection', (socket) => {
  let me = null;

  socket.on('join', async (payload = {}, ack) => {
    try {
      const slug = payload.room || 'general';
      const room = await Room.findOne({ slug }); if (!room) return socket.emit('error', { msg: 'الغرفة مش موجودة.' });
      const u = await userFromToken(payload.token);
      const fp = String(payload.fp || '').slice(0, 64);
      const modBrowser = !!payload.modBrowser || MOD_UA.test(String(payload.ua || ''));

      const guestName = safeName(payload.name) || 'ضيف';
      if (!u && isBanned(guestName, slug)) return socket.emit('error', { msg: 'أنت محظور من هذه الغرفة.' });

      const st = u ? styleOf(u) : {
        color: clamp(payload.color, 1, 24) || 14, grad: clamp(payload.grad, 0, 80), font: clamp(payload.font, 0, 13),
        cgrad: buildCgrad(payload.cgrad?.c0, payload.cgrad?.c1, payload.cgrad?.c2, payload.cgrad?.type),
        rank: 0, avatarId: '', mood: clean(payload.mood || '').slice(0, 80),
      };
      const name = u ? u.username : guestName;
      if (room.locked && room.password && room.password !== String(payload.pass || '')) return socket.emit('error', { msg: 'الغرفة دي مقفولة بكلمة سر.' });

      let fpWarn = null;
      if (u && fp) {
        const conflict = presence.fingerprintConflict(fp, u._id);
        if (conflict) fpWarn = `تنبيه: نفس الجهاز مسجّل دخول باسم "${conflict}" حالياً.`;
        const fps = (u.fingerprints || []).filter((x) => x !== fp); fps.unshift(fp);
        await User.updateOne({ _id: u._id }, { $set: { fingerprints: fps.slice(0, 5), lastSeen: new Date() } });
      }

      me = { sid: socket.id, userId: u ? String(u._id) : null, name, room: room.slug, since: Date.now(), fp, modBrowser, ...st };
      socket.join(room.slug); presence.join(me);

      socket.emit('self:id', socket.id);
      socket.emit('room:info', { slug: room.slug, name: room.name, icon: room.icon, accent: room.accent, topic: room.topic, bgImage: room.bgImage });
      if (u) socket.emit('self:user', publicUser(u));
      if (modBrowser) socket.emit('chat:system', { text: '⚠️ متصفحك معدّل أو غير معتاد — بعض الوظائف قد تُقيّد لحماية الغرفة.', warn: true });
      if (fpWarn) socket.emit('chat:system', { text: '🛡️ ' + fpWarn, warn: true });

      if (u) {
        const unread = await Notify.countDocuments({ userId: String(u._id), read: false });
        socket.emit('notify:count', unread);
      }

      const joinDoc = await Message.create({ room: room._id, sid: socket.id, userId: me.userId, name, text: 'انضم للغرفة', kind: 'join', ...st });
      io.to(room.slug).emit('chat:message', toClientMsg(joinDoc));
      io.to(room.slug).emit('presence:list', presence.list(room.slug));
      const last = await Message.find({ room: room._id }).sort({ createdAt: -1 }).limit(50).lean();
      socket.emit('chat:history', { room: room.slug, logs: last.reverse().map(toClientMsg) });
      if (typeof ack === 'function') ack({ ok: true });
    } catch (e) { socket.emit('error', { msg: 'تعذّر الدخول.' }); }
  });

  socket.on('chat:send', async (payload = {}, ack) => {
    if (!me) return;
    const text = safeText(payload.text); if (!text) return;

    if (isBanned(me.name, me.room)) return socket.emit('chat:system', { text: '⛔ أنت محظور من هذه الغرفة.', warn: true });
    if (isMuted(me.name, me.room)) return socket.emit('chat:system', { text: '🔇 أنت مكتوم مؤقتاً في هذه الغرفة.', warn: true });

    if (text.startsWith('/')) { const handled = await handleCommand(text, me, socket); if (handled) return typeof ack === 'function' && ack({ ok: true, cmd: true }); }

    const f = checkFlood(me.sid);
    if (f.blocked) { socket.emit('chat:system', { text: '⚠️ مهلاً، بتكتب بسرعة زيادة — تم كتمك مؤقتاً.', warn: true }); return typeof ack === 'function' && ack({ ok: false, reason: 'flood' }); }
    if (hasBlocked(text)) { socket.emit('chat:system', { text: '⚠️ عفواً، الرسالة فيها كلمات غير مسموحة في الغرف العامة.', warn: true }); return typeof ack === 'function' && ack({ ok: false, reason: 'blocked' }); }

    const room = await Room.findOne({ slug: me.room }); if (!room) return;

    const mentionNames = [...new Set((text.match(/@([\u0600-\u06FF\w_]{2,24})/g) || []).map((x) => x.slice(1)))];

    const doc = await Message.create({
      room: room._id, sid: me.sid, userId: me.userId, name: me.name, text, kind: 'msg', mentions: mentionNames,
      color: me.color, grad: me.grad, font: me.font, cgrad: me.cgrad, rank: me.rank, avatarId: me.avatarId,
    });
    presence.setTyping(me.sid, false);
    io.to(me.room).emit('chat:message', toClientMsg(doc));
    if (typeof ack === 'function') ack({ ok: true, id: String(doc._id) });

    if (me.userId) {
      const gain = rnd(2, 4) + (mentionNames.length ? 1 : 0);
      const u = await User.findById(me.userId);
      if (u) {
        const oldRank = u.rank; const newPts = u.points + gain;
        const newRank = rankInfo(oldRank).staff ? oldRank : Math.max(oldRank, autoRankFor(newPts));
        await User.updateOne({ _id: u._id }, { $set: { points: newPts, rank: newRank } });
        me.rank = newRank; presence.setRank(me.sid, newRank);
        socket.emit('points:update', { points: newPts, rank: newRank, next: nextAutoThreshold(newRank), gained: gain });
        if (newRank !== oldRank) {
          const ri = rankInfo(newRank);
          const up = await Message.create({ room: room._id, sid: me.sid, userId: me.userId, name: me.name, text: `ترقّى إلى ${ri.name} ${ri.icon}`, kind: 'rankup', color: me.color, grad: me.grad, font: me.font, cgrad: me.cgrad, rank: newRank, avatarId: me.avatarId });
          io.to(me.room).emit('chat:message', toClientMsg(up));
          socket.emit('rank:up', { rank: newRank, name: ri.name, icon: ri.icon, color: ri.color });
          await pushNotify(me.userId, 'rankup', 'النظام', `مبروك! ترقّيت إلى ${ri.name}.`);
        }
      }
    }

    for (const mn of mentionNames) {
      const target = await User.findOne({ usernameLower: mn.toLowerCase() }).select('_id username').lean();
      if (target && String(target._id) !== me.userId) {
        await pushNotify(target._id, 'mention', me.name, `ذكرك في ${room.name}: ${text.slice(0, 60)}`);
      }
    }
  });

  let typingTimer = null;
  socket.on('chat:typing', (on) => {
    if (!me) return;
    presence.setTyping(me.sid, !!on);
    socket.to(me.room).emit('chat:typing', { sid: me.sid, name: me.name, on: !!on });
    clearTimeout(typingTimer);
    if (on) typingTimer = setTimeout(() => { presence.setTyping(me.sid, false); socket.to(me.room).emit('chat:typing', { sid: me.sid, name: me.name, on: false }); }, 2500);
  });

  socket.on('private:open', async ({ name } = {}) => {
    if (!me || !name) return;
    const conv = makeConv(me.name, name);
    const hist = await Priv.find({ conv }).sort({ createdAt: 1 }).limit(60).lean();
    await Priv.updateMany({ conv, to: me.name, read: false }, { read: true });
    socket.emit('private:history', { with: name, conv, msgs: hist.map((m) => ({ id: String(m._id), from: m.from, to: m.to, text: m.text, t: m.createdAt, mine: m.from === me.name })) });
  });

  socket.on('private:send', async ({ to, text, behavior } = {}, ack) => {
    if (!me || !to) return;
    const t = safeText(text); if (!t) return;
    const score = behaviorScore(behavior);
    if (score >= 90) { socket.emit('chat:system', { text: '🤖 للحماية: حرّك الماوس أو اكتب يدوياً قبل إرسال الخاص.', warn: true }); return typeof ack === 'function' && ack({ ok: false, reason: 'bot' }); }
    const f = checkFlood(me.sid, 4, 3000, 4000);
    if (f.blocked) return socket.emit('chat:system', { text: '⚠️ تم كتمك مؤقتاً في الخاص.', warn: true });
    const conv = makeConv(me.name, to);
    const targetUser = await User.findOne({ usernameLower: to.toLowerCase() }).select('_id').lean();
    const meUser = me.userId ? await User.findById(me.userId).select('_id').lean() : null;
    const doc = await Priv.create({ conv, from: me.name, to, fromId: meUser ? String(meUser._id) : '', toId: targetUser ? String(targetUser._id) : '', text: t });
    const packet = { id: String(doc._id), from: me.name, to, text: t, t: doc.createdAt };
    socket.emit('private:message', { ...packet, mine: true });
    const targetSid = presence.findSidByName(me.room, to);
    if (targetSid) io.to(targetSid).emit('private:message', { ...packet, mine: false, from: me.name });
    else if (targetUser) await pushNotify(targetUser._id, 'pm', me.name, `رسالة خاصة: ${t.slice(0, 50)}`);
    if (typeof ack === 'function') ack({ ok: true, id: String(doc._id) });
  });

  socket.on('room:switch', async ({ room, pass } = {}, ack) => {
    if (!me) return;
    const oldRoom = me.room; const r = await Room.findOne({ slug: room }); if (!r) return socket.emit('error', { msg: 'الغرفة مش موجودة.' });
    if (isBanned(me.name, r.slug)) return socket.emit('error', { msg: 'أنت محظور من هذه الغرفة.' });
    if (r.locked && r.password && r.password !== String(pass || '')) return socket.emit('error', { msg: 'كلمة سر غلط.' });
    socket.leave(oldRoom); presence.leave(me.sid);
    const oldR = await Room.findOne({ slug: oldRoom });
    if (oldR) {
      const ld = await Message.create({ room: oldR._id, sid: me.sid, name: me.name, text: 'غادر الغرفة', kind: 'leave', color: me.color, grad: me.grad, font: me.font, cgrad: me.cgrad, rank: me.rank, avatarId: me.avatarId });
      io.to(oldRoom).emit('chat:message', toClientMsg(ld)); io.to(oldRoom).emit('presence:list', presence.list(oldRoom));
    }
    me.room = r.slug; me.since = Date.now(); socket.join(r.slug); presence.join(me);
    socket.emit('room:info', { slug: r.slug, name: r.name, icon: r.icon, accent: r.accent, topic: r.topic, bgImage: r.bgImage });
    const jd = await Message.create({ room: r._id, sid: me.sid, userId: me.userId, name: me.name, text: 'انضم للغرفة', kind: 'join', color: me.color, grad: me.grad, font: me.font, cgrad: me.cgrad, rank: me.rank, avatarId: me.avatarId });
    io.to(r.slug).emit('chat:message', toClientMsg(jd)); io.to(r.slug).emit('presence:list', presence.list(r.slug));
    const last = await Message.find({ room: r._id }).sort({ createdAt: -1 }).limit(50).lean();
    socket.emit('chat:history', { room: r.slug, logs: last.reverse().map(toClientMsg) });
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('disconnect', async () => {
    const p = presence.leave(socket.id); flood.delete(socket.id); if (!p) return;
    const room = await Room.findOne({ slug: p.room }); if (!room) return;
    const ld = await Message.create({ room: room._id, sid: p.sid, userId: p.userId, name: p.name, text: 'غادر الغرفة', kind: 'leave', color: p.color, grad: p.grad, font: p.font, cgrad: p.cgrad, rank: p.rank, avatarId: p.avatarId });
    io.to(p.room).emit('chat:message', toClientMsg(ld)); io.to(p.room).emit('presence:list', presence.list(p.room));
  });

  /* --------------------------- أوامر الإشراف --------------------------- */
  async function handleCommand(text, me, socket) {
    const ri = rankInfo(me.rank);
    const staff = ri.staff || me.rank >= 12;
    const parts = text.trim().split(/\s+/); const cmd = parts[0].toLowerCase();
    const atName = (parts[1] || '').replace(/^@/, '');
    const emitSys = (t, kind = 'mod') => io.to(me.room).emit('chat:message', { id: 's' + Date.now(), sid: 'sys', name: 'النظام', color: 13, rank: 99, text: t, kind, t: new Date() });

    if (cmd === '/topic') {
      if (!staff) { socket.emit('chat:system', { text: '🛡️ الأمر ده للمشرفين فقط.', warn: true }); return true; }
      const tp = clean(text.replace(/^\/topic\s*/i, '')).slice(0, 140);
      await Room.updateOne({ slug: me.room }, { topic: tp });
      io.to(me.room).emit('room:topic', { topic: tp }); emitSys(`📌 موضوع الغرفة تغيّر: ${tp}`); return true;
    }
    if (!atName) return false;
    if (cmd === '/kick') {
      if (!staff) { socket.emit('chat:system', { text: '🛡️ للمشرفين فقط.', warn: true }); return true; }
      const sid = presence.findSidByName(me.room, atName);
      if (sid) { io.to(sid).emit('chat:system', { text: `👢 تم طردك من الغرفة بواسطة ${me.name}.`, warn: true }); io.sockets.sockets.get(sid)?.leave(me.room); }
      emitSys(`👢 ${me.name} طرد ${atName} من الغرفة.`); return true;
    }
    if (cmd === '/mute') {
      if (!staff) { socket.emit('chat:system', { text: '🛡️ للمشرفين فقط.', warn: true }); return true; }
      const mins = clamp(parts[2] || 5, 1, 1440);
      await addMute(atName, me.room, mins, me.name);
      emitSys(`🔇 ${me.name} كتم ${atName} لمدة ${mins} دقيقة.`); return true;
    }
    if (cmd === '/unmute') {
      if (!staff) { socket.emit('chat:system', { text: '🛡️ للمشرفين فقط.', warn: true }); return true; }
      await removeMute(atName, me.room); emitSys(`🔊 ${me.name} فكّ كتم ${atName}.`); return true;
    }
    if (cmd === '/ban') {
      if (me.rank < 20 && !ri.staff) { socket.emit('chat:system', { text: '🛡️ الحظر للمشرفين الأوائل/المديرين.', warn: true }); return true; }
      await addBan(atName, me.room, me.name);
      const sid = presence.findSidByName(me.room, atName); if (sid) io.sockets.sockets.get(sid)?.leave(me.room);
      emitSys(`⛔ ${me.name} حظر ${atName} من الغرفة.`); return true;
    }
    if (cmd === '/unban') {
      if (me.rank < 20 && !ri.staff) { socket.emit('chat:system', { text: '🛡️ للمشرفين الأوائل/المديرين.', warn: true }); return true; }
      await removeBan(atName, me.room); emitSys(`✅ ${me.name} فكّ حظر ${atName}.`); return true;
    }
    if (cmd === '/gift') {
      const amt = clamp(parts[2] || 50, 1, 5000);
      if (!me.userId) { socket.emit('chat:system', { text: '🎁 الإهداء للمسجلين فقط.', warn: true }); return true; }
      const giver = await User.findById(me.userId);
      if (!giver || giver.points < amt) { socket.emit('chat:system', { text: `🎁 نقاطك مش كفاية (عندك ${giver ? giver.points : 0}).`, warn: true }); return true; }
      const recv = await User.findOne({ usernameLower: atName.toLowerCase() });
      if (!recv) { socket.emit('chat:system', { text: '🎁 العضو ده مش موجود.', warn: true }); return true; }
      if (String(recv._id) === me.userId) { socket.emit('chat:system', { text: '🎁 ما تقدرش تهدي لنفسك.', warn: true }); return true; }
      await User.updateOne({ _id: giver._id }, { $inc: { points: -amt } });
      const recvNew = await User.findByIdAndUpdate(recv._id, { $inc: { points: amt } }, { new: true });
      const recvRank = rankInfo(recvNew.rank).staff ? recvNew.rank : Math.max(recvNew.rank, autoRankFor(recvNew.points));
      if (recvRank !== recvNew.rank) await User.updateOne({ _id: recv._id }, { rank: recvRank });
      socket.emit('points:update', { points: giver.points - amt, rank: giver.rank, next: nextAutoThreshold(giver.rank), gained: -amt });
      emitSys(`🎁 ${me.name} أهدى ${amt} نقطة إلى ${atName}.`);
      await pushNotify(recv._id, 'gift', me.name, `أهداك ${amt} نقطة 🎁`);
      const rsid = presence.sidForUser(recv._id); if (rsid) io.to(rsid).emit('points:update', { points: recvNew.points, rank: recvRank, next: nextAutoThreshold(recvRank), gained: amt });
      return true;
    }
    return false;
  }
});

function makeConv(a, b) { return [a, b].sort((x, y) => x.localeCompare(y)).join('::'); }
setInterval(() => io.emit('ping:beat', Date.now()), 25000);

/* ----------------------------- Seed + بدء ----------------------------- */
const SEED_ROOMS = [
  { slug: 'general', name: 'الدردشة العامة', icon: '🌍', topic: 'أهلاً بالجميع 🌹', accent: 'rgba(3,173,216,0.74)' },
  { slug: 'friends', name: 'التعارف والصداقة', icon: '🤝', topic: 'تعارف محترم فقط', accent: 'rgba(116,178,14,0.72)' },
  { slug: 'whispers', name: 'همس القلوب', icon: '💞', topic: 'كلام من القلب', accent: 'rgba(230,90,140,0.7)', locked: true, password: '1234' },
  { slug: 'poetry', name: 'الشعر والخواطر', icon: '✒️', topic: 'قل ما تشعر به', accent: 'rgba(230,168,23,0.72)' },
  { slug: 'religion', name: 'الغرفة الدينية', icon: '🕌', topic: 'ذكر وطمأنينة', accent: 'rgba(8,145,178,0.72)' },
];
async function seed() {
  for (const r of SEED_ROOMS) await Room.updateOne({ slug: r.slug }, { $set: r }, { upsert: true });
  if ((await Wall.countDocuments()) === 0) {
    await Wall.create([
      { userId: new mongoose.Types.ObjectId(), name: 'الإدارة', color: 13, text: 'مرحباً بكم في الحائط — استخدموا /topic و /gift و /mute بحكمة 🌹' },
      { userId: new mongoose.Types.ObjectId(), name: 'نجم_الليل', color: 14, text: 'كل رسالة بتديك نقاط وترقّي رتبتك ✨ جرّب @صديقك' },
    ]);
  }
}

mongoose.connection.on('connected', () => console.log('🍃 Mongo متصل:', mongoose.connection.host));
mongoose.connection.on('error', (e) => console.error('⚠️ Mongo:', e.message));

mongoose.connect(ENV.mongoUri, { serverSelectionTimeoutMS: 8000 })
  .then(async () => {
    await seed(); await loadModCache();
    server.listen(ENV.port, () => console.log(`🚀 شغال على ${ENV.port} — ${ENV.env}`));
  })
  .catch((e) => { console.error('فشل البدء:', e.message); process.exit(1); });

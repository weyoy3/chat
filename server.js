require('dotenv').config();
const express = require('express');
const http = require('http');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, pingTimeout: 15000, pingInterval: 5000 });
app.use(express.json());
app.use(express.static(__dirname));

const ROOM = 'general';

/* ============ الألوان (مطابقة بين السيرفر والواجهة) ============ */
const NAME_COLORS = ['#3b82f6','#16a34a','#8b5cf6','#f97316','#e3a857','#ef4444','#06b6d4','#ec4899','#10b981','#f59e0b','#6366f1','#14b8a6'];
function colorFor(name){ let h=0; const s=String(name||''); for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0; return NAME_COLORS[h % NAME_COLORS.length]; }

/* ============ الرتب (تلقائية من النقاط) ============ */
function rankFromPoints(p){ return Math.min(99, 1 + Math.floor((p||0)/100)); }
function tierLabel(role, rank){
  if (role === 'admin') return 'مشرف';
  if (rank >= 50) return 'عضو ذهبي';
  if (rank >= 30) return 'عضو فضي';
  if (rank >= 15) return 'عضو برونزي';
  if (rank >= 8)  return 'عضو نشيط';
  if (rank >= 3)  return 'عضو مشارك';
  return 'عضو';
}
function joinText(role, rank){
  if (role === 'admin') return 'انضم للغرفة (# مشرف #)';
  if (role === 'guest') return 'انضم للغرفة (# زائر #)';
  return 'انضم للغرفة (# ' + tierLabel('member', rank) + ' رتبة ' + rank + ' #)';
}

/* ============ النماذج ============ */
const userSchema = new mongoose.Schema({
  username:   { type: String, required: true, unique: true, index: true, trim: true },
  email:      { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
  passwordHash:{ type: String, required: true },
  age:        { type: Number, default: null },
  gender:     { type: String, default: '' },
  bio:        { type: String, default: '', maxlength: 200 },
  color:      { type: String, default: '' },
  role:       { type: String, default: 'member' },   // member | admin
  points:     { type: Number, default: 0 },
  authToken:  { type: String, index: true },
  lastSeen:   { type: Date, default: Date.now },
  createdAt:  { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const messageSchema = new mongoose.Schema({
  room:        { type: String, index: true, default: ROOM },
  senderId:    { type: String, index: true },
  senderName:  { type: String, default: '' },
  senderColor: { type: String, default: '' },
  senderRole:  { type: String, default: 'guest' },
  senderGender:{ type: String, default: '' },
  kind:        { type: String, default: 'msg' },     // msg | join
  mentions:    { type: [String], default: [] },
  text:        { type: String, maxlength: 2000 },
  createdAt:   { type: Date, default: Date.now }
});
messageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60*60*24*30 });
const Message = mongoose.model('Message', messageSchema);

const pmSchema = new mongoose.Schema({
  from: { type: String, index: true },
  to:   { type: String, index: true },
  text: { type: String, maxlength: 2000 },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
pmSchema.index({ from: 1, to: 1, createdAt: -1 });
pmSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60*60*24*90 });
const PM = mongoose.model('PM', pmSchema);

const reportSchema = new mongoose.Schema({
  reporter: { type: String, default: '' },
  reported: { type: String, index: true },
  reason:   { type: String, default: '' },
  createdAt:{ type: Date, default: Date.now }
});
reportSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60*60*24*90 });
const Report = mongoose.model('Report', reportSchema);

/* ============ DB ============ */
function dbOk(){ return mongoose.connection.readyState === 1; }
(async () => {
  if (!process.env.MONGO_URL) { console.warn('[chat-masr] MONGO_URL غير موجود — شغّال بدون قاعدة بيانات.'); return; }
  try { await mongoose.connect(process.env.MONGO_URL); console.log('[chat-masr] MongoDB متصل ✓'); }
  catch (e) { console.error('[chat-masr] خطأ اتصال MongoDB:', e.message); }
})();
const saveMsg = (m) => dbOk() && Message.create(m).catch(()=>{});
const savePm  = (m) => dbOk() ? PM.create(m).catch(()=>null) : null;
const saveReport = (r) => dbOk() && Report.create(r).catch(()=>{});

/* ============ إحصائيات حيّة ============ */
function countOnline(){
  let total=0, mem=0;
  for (const [,s] of io.sockets.sockets) if (s.connected && s.data.user){ total++; if (s.data.user.role==='member') mem++; }
  return { total, mem, guests: Math.max(0, total-mem) };
}
async function computeStats(){
  const o = countOnline(); let members=0, today=0;
  if (dbOk()){
    try {
      members = await User.countDocuments();
      const now=new Date(), cairo=new Date(now.getTime()+2*3600000);
      const startUtc=new Date(Date.UTC(cairo.getUTCFullYear(),cairo.getUTCMonth(),cairo.getUTCDate()) - 2*3600000);
      today = await Message.countDocuments({ createdAt:{ $gte:startUtc } });
    } catch(e){}
  }
  return { online:o.total, members, guests:o.guests, today };
}
setInterval(() => { computeStats().then(s => io.emit('live_stats', s)).catch(()=>{}); }, 4000);

/* ============ API (للـ Landing) ============ */
app.get('/api/stats', async (req,res) => { try { res.json(await computeStats()); } catch(e){ res.json({online:0,members:0,guests:0,today:0}); } });
app.get('/api/latest', async (req,res) => {
  if (!dbOk()) return res.json([]);
  try { const us = await User.find({}, { username:1, color:1, createdAt:1 }).sort({ createdAt:-1 }).limit(8); res.json(us.map(u=>({username:u.username,color:u.color,createdAt:u.createdAt}))); }
  catch(e){ res.json([]); }
});

/* ============ أدوات ============ */
const newToken = () => crypto.randomBytes(24).toString('hex');
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v||'');
function escRe(s){ return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }

const activeNames = new Map();   // lower -> {pid,name}
const pidSockets  = new Map();   // pid -> Set<socketId>
function regPid(pid, sid){ if(!pidSockets.has(pid)) pidSockets.set(pid,new Set()); pidSockets.get(pid).add(sid); }
function reserveName(desired, pid, sid){
  regPid(pid, sid);
  let base = (desired||'').trim().replace(/\s+/g,' '); if (base.length<2) base = 'ضيف_'+Math.floor(1000+Math.random()*9000);
  const tryOne = (n) => { const low=n.toLowerCase(); const cur=activeNames.get(low); if(!cur){ activeNames.set(low,{pid,name:n}); return n; } if(cur.pid===pid) return n; return null; };
  let got = tryOne(base); if (got) return { name:got, renamed: got.toLowerCase()!==base.toLowerCase() };
  for (let i=2;i<300;i++){ got=tryOne(base+i); if(got) return { name:got, renamed:true }; }
  const fb = base+String(sid).slice(0,4); activeNames.set(fb.toLowerCase(),{pid,name:fb}); return { name:fb, renamed:true };
}
function releaseSocket(sid){ for(const [,set] of pidSockets) set.delete(sid); for(const [pid,set] of pidSockets) if(set.size===0) pidSockets.delete(pid); }
setInterval(() => {
  for (const [pid,set] of pidSockets){ for(const sid of [...set]){ const s=io.sockets.sockets.get(sid); if(!s||!s.connected) set.delete(sid); } if(set.size===0) pidSockets.delete(pid); }
  for (const [low,info] of activeNames){ const set=pidSockets.get(info.pid); if(!set||set.size===0) activeNames.delete(low); }
}, 20000);

function findOnline(name){ for(const [,s] of io.sockets.sockets) if(s.connected && s.data.user && s.data.user.name===name) return s.data.user; return null; }
function socketsFor(name){ const a=[]; for(const [,s] of io.sockets.sockets) if(s.connected && s.data.user && s.data.user.name===name) a.push(s); return a; }
function roomUsers(){
  const s = io.sockets.adapter.rooms.get(ROOM); if(!s) return [];
  const list=[];
  for(const sid of s){ const sock=io.sockets.sockets.get(sid); if(sock&&sock.data.user){ const u=sock.data.user; const rk=u.role==='member'?rankFromPoints(u.points):0; list.push({name:u.name,color:u.color,role:u.role,gender:u.gender||'',rank:rk,tier:tierLabel(u.role,rk),online:true}); } }
  return list;
}
function emitUsers(){ io.to(ROOM).emit('room_users', roomUsers()); }

function findMentions(text, senderPid){
  const found=[];
  for(const [low,info] of activeNames){ if(info.pid===senderPid) continue; if(found.some(f=>f.toLowerCase()===low)) continue; if(new RegExp('^'+escRe(info.name)+'($|[^\\u0600-\\u06FF\\w])').test(text)) found.push(info.name); }
  return found;
}

async function loadHistory(){
  if(!dbOk()) return [];
  try {
    const docs = await Message.find({ room:ROOM }).sort({ createdAt:-1 }).limit(120);
    const all = docs.reverse().map(d => ({ kind:d.kind||'msg', text:d.text, mentions:d.mentions||[], senderName:d.senderName, senderColor:d.senderColor, senderRole:d.senderRole, senderGender:d.senderGender, time:d.createdAt.getTime() }));
    const names = [...new Set(all.filter(m=>m.kind!=='join'&&m.senderRole==='member').map(m=>m.senderName))];
    const map={};
    if(names.length){ try{ const us=await User.find({username:{$in:names}},{username:1,points:1}); us.forEach(u=>map[u.username]=u.points||0); }catch(e){} }
    all.forEach(m=>{ if(m.kind!=='join'&&m.senderRole==='member'){ const rk=rankFromPoints(map[m.senderName]||0); m.senderRank=rk; m.senderTier=tierLabel('member',rk); } else { m.senderRank=0; m.senderTier=''; } });
    return all;
  } catch(e){ return []; }
}

/* ============ Socket ============ */
io.on('connection', (socket) => {
  socket.data.user=null; socket.data.pid=null; socket.data.lastMsg=0; socket.data.currentRoom=null;

  socket.on('auth_check', async (token) => {
    if(typeof token!=='string'||!dbOk()) return socket.emit('auth_fail');
    try {
      const u = await User.findOne({ authToken:token }); if(!u) return socket.emit('auth_fail');
      const pid=String(u._id); const {name}=reserveName(u.username,pid,socket.id); socket.data.pid=pid;
      u.lastSeen=new Date(); u.save().catch(()=>{});
      const rk=rankFromPoints(u.points||0);
      socket.data.user={ id:pid, name, role:u.role, color:u.color||colorFor(name), gender:u.gender||'', points:u.points||0 };
      socket.emit('auth_ok',{ name, role:u.role, color:u.color||colorFor(name), gender:u.gender||'', points:u.points||0, rank:rk, tier:tierLabel(u.role,rk) });
    } catch(e){ socket.emit('auth_fail'); }
  });

  socket.on('register', async (d) => {
    if(!d||typeof d!=='object') return;
    const username=(d.username||'').trim(), email=(d.email||'').trim().toLowerCase(), password=d.password||'';
    const age=parseInt(d.age,10), gender=(d.gender||'').trim();
    if(username.length<3||username.length>20) return socket.emit('register_err',{msg:'اسم المستخدم 3–20 حرف.'});
    if(!isEmail(email)) return socket.emit('register_err',{msg:'بريد إلكتروني غير صالح.'});
    if(password.length<8) return socket.emit('register_err',{msg:'كلمة المرور 8 أحرف على الأقل.'});
    if(!dbOk()) return socket.emit('register_err',{msg:'قاعدة البيانات غير متصلة.'});
    try {
      if(await User.findOne({$or:[{email},{username}]})) return socket.emit('register_err',{msg:'البريد أو الاسم مستخدم بالفعل.'});
      const color=colorFor(username);
      const u=await User.create({ username, email, passwordHash:await bcrypt.hash(password,10), age:isNaN(age)?null:age, gender, color, role:'member', points:0, authToken:newToken() });
      const pid=String(u._id); reserveName(username,pid,socket.id); socket.data.pid=pid;
      socket.data.user={ id:pid, name:username, role:'member', color, gender, points:0 };
      io.emit('new_member',{ username, color, createdAt:u.createdAt });
      socket.emit('register_ok',{ token:u.authToken, user:{ name:username, role:'member', color, gender, points:0, rank:1, tier:'عضو' } });
    } catch(e){ socket.emit('register_err',{msg:'حدث خطأ أثناء التسجيل.'}); }
  });

  socket.on('login', async (d) => {
    if(!d||typeof d!=='object') return;
    const email=(d.email||'').trim().toLowerCase(), password=d.password||'';
    if(!isEmail(email)||!password) return socket.emit('login_err',{msg:'أدخل البريد وكلمة المرور.'});
    if(!dbOk()) return socket.emit('login_err',{msg:'قاعدة البيانات غير متصلة.'});
    try {
      const u=await User.findOne({email}); if(!u) return socket.emit('login_err',{msg:'البريد أو كلمة المرور غير صحيحة.'});
      if(!(await bcrypt.compare(password,u.passwordHash))) return socket.emit('login_err',{msg:'البريد أو كلمة المرور غير صحيحة.'});
      u.authToken=newToken(); u.lastSeen=new Date(); await u.save();
      const pid=String(u._id); const {name}=reserveName(u.username,pid,socket.id); socket.data.pid=pid;
      const rk=rankFromPoints(u.points||0);
      socket.data.user={ id:pid, name, role:u.role, color:u.color||colorFor(name), gender:u.gender||'', points:u.points||0 };
      socket.emit('login_ok',{ token:u.authToken, user:{ name, role:u.role, color:u.color||colorFor(name), gender:u.gender||'', points:u.points||0, rank:rk, tier:tierLabel(u.role,rk) } });
    } catch(e){ socket.emit('login_err',{msg:'حدث خطأ أثناء الدخول.'}); }
  });

  socket.on('guest_login', (d) => {
    const raw=(d&&d.name||'').trim(), age=d?parseInt(d.age,10):NaN, gender=d?(d.gender||'').trim():'';
    let pid=(d&&d.guestId||'').trim(); if(!pid) pid='g_'+crypto.randomBytes(8).toString('hex');
    const {name,renamed}=reserveName(raw,pid,socket.id); socket.data.pid=pid; const color=colorFor(name);
    socket.data.user={ id:socket.id, name, role:'guest', color, gender, age:isNaN(age)?null:age, points:0 };
    socket.emit('guest_ok',{ user:{ name, role:'guest', color, gender, points:0, rank:0, tier:'زائر' }, renamed, guestId:pid });
  });

  const authed = () => !!socket.data.user;

  socket.on('join_room', async (payload) => {
    if(!authed()) return;
    const isReload = !!(payload && payload.isReload);
    const isRejoin = socket.data.currentRoom===ROOM;
    socket.join(ROOM); socket.data.currentRoom=ROOM;
    const u=socket.data.user;
    if(!isRejoin && !isReload){
      const rk=u.role==='member'?rankFromPoints(u.points):0;
      socket.to(ROOM).emit('user_joined',{ name:u.name, color:u.color, role:u.role, gender:u.gender||'', rank:rk, tier:tierLabel(u.role,rk) });
      await saveMsg({ room:ROOM, senderId:socket.id, senderName:u.name, senderColor:u.color, senderRole:u.role, senderGender:u.gender||'', kind:'join', text:'', mentions:[] });
    }
    const history = await loadHistory();
    socket.emit('joined_room',{ room:{ id:ROOM, name:'الغرفة العامة' }, history });
    emitUsers();
  });

  socket.on('leave_room', () => {
    if(!authed()) return;
    if(socket.data.currentRoom){ socket.leave(ROOM); socket.data.currentRoom=null; }
    socket.emit('left_room');
  });

  socket.on('request_users', () => { if(authed()) socket.emit('room_users', roomUsers()); });

  socket.on('message', (msg) => {
    if(!authed()||typeof msg!=='string') return;
    const text=msg.trim().slice(0,1000); if(!text||!socket.data.currentRoom) return;
    const now=Date.now(); if(now-socket.data.lastMsg<400) return; socket.data.lastMsg=now;
    const u=socket.data.user;
    let rk=0, tier='';
    if(u.role==='member'){ u.points=(u.points||0)+10; rk=rankFromPoints(u.points); tier=tierLabel('member',rk); if(dbOk()) User.updateOne({_id:u.id},{$inc:{points:10},$set:{lastSeen:new Date()}}).catch(()=>{}); }
    else { tier=tierLabel(u.role,0); }
    const mentions=findMentions(text, socket.data.pid);
    saveMsg({ room:ROOM, senderId:socket.id, senderName:u.name, senderColor:u.color, senderRole:u.role, senderGender:u.gender||'', kind:'msg', text, mentions });
    io.to(ROOM).emit('message',{ text, senderId:socket.id, senderName:u.name, senderColor:u.color, senderRole:u.role, senderGender:u.gender||'', mentions, time:now, senderRank:rk, senderTier:tier });
  });

  socket.on('typing', () => { if(authed()&&socket.data.currentRoom) socket.to(ROOM).emit('typing',{name:socket.data.user.name}); });
  socket.on('stop_typing', () => { if(authed()&&socket.data.currentRoom) socket.to(ROOM).emit('stop_typing',{name:socket.data.user.name}); });

  /* ---- البروفايل ---- */
  socket.on('profile_get', async (name) => {
    const nm=(name||'').trim(); if(!nm) return socket.emit('profile_data',null);
    if(dbOk()){ const u=await User.findOne({username:nm}).catch(()=>null); if(u){ const rk=rankFromPoints(u.points||0); return socket.emit('profile_data',{ name:u.username, role:u.role, gender:u.gender||'', age:u.age, bio:u.bio||'', color:u.color||colorFor(nm), points:u.points||0, rank:rk, tier:tierLabel(u.role,rk), joinedAt:u.createdAt?u.createdAt.getTime():null, lastSeen:u.lastSeen?u.lastSeen.getTime():null, online:!!findOnline(nm) }); } }
    const on=findOnline(nm); if(on){ return socket.emit('profile_data',{ name:on.name, role:on.role, gender:on.gender||'', age:on.age||null, bio:'', color:on.color, points:0, rank:0, tier:tierLabel(on.role,0), joinedAt:null, lastSeen:null, online:true }); }
    socket.emit('profile_data',null);
  });

  socket.on('profile_update', async (d) => {
    if(!authed()||socket.data.user.role==='guest'||!dbOk()) return socket.emit('profile_update_err',{msg:'غير متاح للزوار.'});
    const u=await User.findById(socket.data.user.id).catch(()=>null); if(!u) return;
    const gender=(d&&d.gender||'').trim(), bio=(d&&d.bio||'').trim().slice(0,200); const age=d&&d.age!==''&&d.age!=null?parseInt(d.age,10):u.age;
    u.gender=gender; u.bio=bio; if(!isNaN(age)&&age>=18) u.age=age; await u.save().catch(()=>{});
    socket.data.user.gender=gender;
    socket.emit('profile_updated',{ gender, bio, age:u.age, color:u.color });
    if(socket.data.currentRoom) emitUsers();
  });

  /* ---- الرسائل الخاصة ---- */
  socket.on('pm_send', async (d) => {
    if(!authed()) return;
    const to=(d&&d.to||'').trim(), text=(d&&d.text||'').trim().slice(0,1000); if(!to||!text||to===socket.data.user.name) return;
    const doc = await savePm({ from:socket.data.user.name, to, text });
    const id = doc?String(doc._id):('t'+Date.now()), time = doc?doc.createdAt.getTime():Date.now();
    const m={ id, from:socket.data.user.name, to, text, time, read:false };
    socket.emit('pm_sent', m);
    socketsFor(to).forEach(s => s.emit('pm_receive', m));
  });

  socket.on('pm_list', async () => {
    if(!authed()||!dbOk()) return socket.emit('pm_list_data',[]);
    const me=socket.data.user.name;
    try {
      const docs = await PM.aggregate([
        { $match:{ $or:[{from:me},{to:me}] } },
        { $sort:{ createdAt:-1 } },
        { $group:{ _id:{ $cond:[{ $eq:['$from',me] },'$to','$from'] }, lastText:{ $first:'$text' }, lastFrom:{ $first:'$from' }, lastTime:{ $first:'$createdAt' }, unread:{ $sum:{ $cond:[{ $and:[{ $eq:['$to',me] },{ $eq:['$read',false] }] },1,0] } } }
      ]);
      const names=docs.map(x=>x._id);
      const us=await User.find({username:{$in:names}},{username:1,gender:1,color:1}).catch(()=>[]);
      const um={}; us.forEach(u=>um[u.username]=u);
      const list=docs.map(x=>{ const u=um[x._id]; const on=!!findOnline(x._id); const role=u?'member':(on?findOnline(x._id).role:'guest'); return { name:x._id, color:u?(u.color||colorFor(x._id)):colorFor(x._id), role, gender:u?(u.gender||''):'', lastText:x.lastText, lastFrom:x.lastFrom, lastTime:x.lastTime.getTime(), unread:x.unread||0 }; }).sort((a,b)=>b.lastTime-a.lastTime);
      socket.emit('pm_list_data', list);
    } catch(e){ socket.emit('pm_list_data',[]); }
  });

  socket.on('pm_history', async (d) => {
    if(!authed()||!dbOk()) return socket.emit('pm_history_data',{ with:(d&&d.with||''), msgs:[] });
    const w=(d&&d.with||'').trim(), me=socket.data.user.name; if(!w) return;
    try { const docs=await PM.find({$or:[{from:me,to:w},{from:w,to:me}]}).sort({createdAt:1}).limit(300); socket.emit('pm_history_data',{ with:w, msgs:docs.map(x=>({id:String(x._id),from:x.from,to:x.to,text:x.text,time:x.createdAt.getTime(),read:x.read})) }); }
    catch(e){ socket.emit('pm_history_data',{ with:w, msgs:[] }); }
  });

  socket.on('pm_open', async (d) => {
    if(!authed()||!dbOk()) return;
    const w=(d&&d.with||'').trim(), me=socket.data.user.name; if(!w) return;
    await PM.updateMany({from:w,to:me,read:false},{read:true}).catch(()=>{});
    socketsFor(w).forEach(s=>s.emit('pm_read',{by:me}));
  });

  socket.on('report', (d) => { if(!authed()) return; const r=(d&&d.name||'').trim(); if(!r||r===socket.data.user.name) return; saveReport({reporter:socket.data.user.name,reported:r,reason:(d&&d.reason||'')}); socket.emit('report_ok'); });

  socket.on('disconnect', () => {
    const u=socket.data.user;
    if(u){ io.to(ROOM).emit('user_left',{ name:u.name, color:u.color, role:u.role, gender:u.gender||'' }); if(dbOk()&&u.role==='member') User.updateOne({_id:u.id},{lastSeen:new Date()}).catch(()=>{}); }
    if(socket.data.currentRoom) emitUsers();
    releaseSocket(socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('[chat-masr] شغّال على المنفذ ' + PORT));

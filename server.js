/* ============================================================
   SS COMPUTER CENTRE — COMPLETE BACKEND (FIXED)
   ============================================================ */

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const path = require('path');
const axios = require('axios');

/* ---------- ENV CONFIG ---------- */
const CONFIG = {
  PORT: process.env.PORT || 5000,
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb+srv://codingboss786_db_user:387ZWnEv6U1bqki2@cluster0.jhli7kl.mongodb.net/ss_computer_centre?retryWrites=true&w=majority&appName=Cluster0',
  JWT_SECRET: process.env.JWT_SECRET || 'ss_computer_centre_secret_2025_change_this',
  JWT_EXPIRE: '7d',
  ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'ssAdmin@2025',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || ''
};

/* ============================================================
   MODELS
   ============================================================ */

const Registration = mongoose.model('Registration', new mongoose.Schema({
  name:          { type: String, required: true, trim: true },
  email:         { type: String, required: true, lowercase: true, trim: true },
  phone:         { type: String, required: true, trim: true },
  course:        { type: String, required: true },
  branch:        { type: String, required: true },
  mode:          { type: String, default: 'Offline (Classroom)' },
  batch:         { type: String, default: '' },
  qualification: { type: String, default: '' },
  message:       { type: String, default: '' },
  status:        { type: String, enum: ['new', 'contacted', 'enrolled', 'rejected'], default: 'new' },
  ipAddress:     { type: String, default: '' }
}, { timestamps: true }));

const Lead = mongoose.model('Lead', new mongoose.Schema({
  name:     { type: String, required: true, trim: true },
  email:    { type: String, required: true, lowercase: true, trim: true },
  phone:    { type: String, required: true, trim: true },
  course:   { type: String, default: '' },
  branch:   { type: String, default: '' },
  source:   { type: String, default: 'popup' },
  status:   { type: String, enum: ['new', 'contacted', 'converted', 'lost'], default: 'new' },
  ipAddress:{ type: String, default: '' }
}, { timestamps: true }));

const Contact = mongoose.model('Contact', new mongoose.Schema({
  name:    { type: String, required: true, trim: true },
  email:   { type: String, required: true, lowercase: true, trim: true },
  phone:   { type: String, required: true, trim: true },
  subject: { type: String, default: '' },
  message: { type: String, required: true },
  status:  { type: String, enum: ['unread', 'read', 'replied'], default: 'unread' }
}, { timestamps: true }));

const Newsletter = mongoose.model('Newsletter', new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true }
}, { timestamps: true }));

const ChatLog = mongoose.model('ChatLog', new mongoose.Schema({
  sessionId: { type: String, required: true, index: true },
  name:      { type: String, default: '' },
  phone:     { type: String, default: '' },
  messages: [{
    role:      { type: String, enum: ['user', 'bot'], required: true },
    text:      { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
  }],
  isLead: { type: Boolean, default: false }
}, { timestamps: true }));

/* ============================================================
   MIDDLEWARE — FIXED for Cloud Shell proxy
   ============================================================ */

const protectAdmin = (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    let token = header.startsWith('Bearer ') ? header.slice(7) : null;

    // Query param से token लो (Cloud Shell proxy safe)
    if (!token && req.query._t) token = String(req.query._t);

    if (!token) {
      return res.status(401).json({ success: false, message: 'Not authorized. Please login.' });
    }
    req.admin = jwt.verify(token, CONFIG.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token. Please login again.' });
  }
};

const errorHandler = (err, req, res, next) => {
  console.error('❌', err.message);
  if (err.name === 'ValidationError') {
    const msgs = Object.values(err.errors).map(e => e.message);
    return res.status(400).json({ success: false, message: msgs.join(', ') });
  }
  if (err.code === 11000) {
    return res.status(400).json({ success: false, message: 'Duplicate entry — already exists.' });
  }
  res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Server error' });
};

const isValidEmail = (email) => /^\S+@\S+\.\S+$/.test(email);
const isPhone10 = (p) => String(p).replace(/\D/g, '').length === 10;

/* ============================================================
   APP
   ============================================================ */

const app = express();

/* 🔧 Cloud Shell proxy के लिए ज़रूरी */
app.set('trust proxy', 1);

/* 🔧 CORS — explicit, proxy-friendly */
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Admin-Token', 'Accept'],
  exposedHeaders: ['Content-Type'],
  credentials: false,
  optionsSuccessStatus: 200
}));

/* 🔧 OPTIONS preflight handler — Cloud Shell के लिए ज़रूरी */
app.options('*', cors());

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

/* 🔧 Rate limiting — proxy-friendly */
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false, xForwardedForHeader: false }
}));
app.use('/api/chat', rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  validate: { trustProxy: false, xForwardedForHeader: false }
}));

/* Serve frontend */
app.use(express.static(path.join(__dirname, '..', 'Frontend')));
app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.use(express.static(path.join(__dirname, '..')));
app.use(express.static(__dirname));

/* ============================================================
   PUBLIC ROUTES
   ============================================================ */

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: '🚀 SS Computer Centre API running', time: new Date().toISOString() });
});

/* Registration */
app.post('/api/registration', async (req, res, next) => {
  try {
    const { name, email, phone, course, branch, mode, batch, qualification, message } = req.body;
    if (!name || !email || !phone || !course || !branch)
      return res.status(400).json({ success: false, message: 'Please fill all required fields.' });
    if (!isValidEmail(email))
      return res.status(400).json({ success: false, message: 'Invalid email address.' });
    if (!isPhone10(phone))
      return res.status(400).json({ success: false, message: 'Phone must be 10 digits.' });

    const reg = await Registration.create({
      name: name.trim(), email: email.trim(),
      phone: String(phone).replace(/\D/g, ''),
      course, branch, mode, batch, qualification,
      message: message || '', ipAddress: req.ip
    });
    res.status(201).json({ success: true, message: '🎉 Registration successful!', data: reg });
  } catch (err) { next(err); }
});

/* Contact */
app.post('/api/contact', async (req, res, next) => {
  try {
    const { name, email, phone, subject, message } = req.body;
    if (!name || !email || !phone || !message)
      return res.status(400).json({ success: false, message: 'Please fill all required fields.' });
    if (!isValidEmail(email))
      return res.status(400).json({ success: false, message: 'Invalid email.' });
    if (!isPhone10(phone))
      return res.status(400).json({ success: false, message: 'Phone must be 10 digits.' });

    const c = await Contact.create({
      name: name.trim(), email: email.trim(),
      phone: String(phone).replace(/\D/g, ''),
      subject: subject || '', message: message.trim()
    });
    res.status(201).json({ success: true, message: '✅ Message sent!', data: c });
  } catch (err) { next(err); }
});

/* Lead */
app.post('/api/lead', async (req, res, next) => {
  try {
    const { name, email, phone, course, branch, source } = req.body;
    if (!name || !email || !phone)
      return res.status(400).json({ success: false, message: 'Name, email & phone required.' });
    if (!isValidEmail(email))
      return res.status(400).json({ success: false, message: 'Invalid email.' });
    if (!isPhone10(phone))
      return res.status(400).json({ success: false, message: 'Phone must be 10 digits.' });

    const lead = await Lead.create({
      name: name.trim(), email: email.trim(),
      phone: String(phone).replace(/\D/g, ''),
      course: course || '', branch: branch || '',
      source: source || 'popup', ipAddress: req.ip
    });
    res.status(201).json({ success: true, message: '🎉 Demo request received!', data: lead });
  } catch (err) { next(err); }
});

/* Newsletter */
app.post('/api/newsletter', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email || !isValidEmail(email))
      return res.status(400).json({ success: false, message: 'Valid email required.' });
    const exists = await Newsletter.findOne({ email: email.toLowerCase() });
    if (exists) return res.status(200).json({ success: true, message: '✅ Already subscribed!' });
    await Newsletter.create({ email: email.toLowerCase() });
    res.status(201).json({ success: true, message: '🎉 Subscribed successfully!' });
  } catch (err) { next(err); }
});

/* ============================================================
   AI CHATBOT
   ============================================================ */

const CHAT_RULES = [
  { regex: /(hi|hello|hey|namaste|नमस्ते)/i, reply: "Hello! 👋 Welcome to SS Computer Centre. How can I help?\n\n• Courses?\n• Fees?\n• Free Demo?\n• Branch location?" },
  { regex: /(course|class|learn|training|कोर्स)/i, reply: "📚 We offer 12 courses:\n\n💻 RS-CIT, BCC\n📊 Tally ERP 9 & Prime\n📝 Office, Excel, Word, Typing\n🗣️ English Spoken & Handwriting\n🌐 Web Development & Designing\n🤖 AI (Artificial Intelligence)" },
  { regex: /(fee|price|cost|charge|kitna|कीमत|फीस)/i, reply: "💰 Fee Range:\n• ₹800 — Typing\n• ₹1,500 — Handwriting\n• ₹3,000–₹4,500 — RS-CIT, BCC, Office\n• ₹6,500–₹9,000 — Web Design/Dev\n• ₹10,000 — AI Course\n\n✅ Easy instalments available!" },
  { regex: /(demo|trial|free|फ्री|डेमो)/i, reply: "🎉 We offer a FREE demo class! Click 'Book Free Demo' or fill registration form." },
  { regex: /(address|location|branch|where|pata|पता)/i, reply: "📍 2 Branches:\n1️⃣ S.S Centre (Sumer City)\n2️⃣ Star Computer Centre\n\n🕘 Mon–Sat 8 AM – 8 PM\n📞 +91 98765 43210" },
  { regex: /(time|timing|batch|schedule|समय)/i, reply: "⏰ Batch timings:\n• Morning: 8–11 AM\n• Afternoon: 12–3 PM\n• Evening: 4–8 PM\n• Weekend: Sat–Sun" },
  { regex: /(placement|job|salary|career|नौकरी)/i, reply: "💼 92% placement rate!\n\n• Resume building\n• Mock interviews\n• Direct referrals to 40+ companies" },
  { regex: /(rscit|rs-cit)/i, reply: "🎓 RS-CIT — Govt. recognised! Duration: 3 months, Fee: ₹3,500." },
  { regex: /(tally|account|gst|erp)/i, reply: "📊 Tally ERP 9 & Prime — 2 months, ₹4,000." },
  { regex: /(web|dev|design|html|css|javascript)/i, reply: "🌐 Web Development — 6 months, ₹9,000\n🎨 Web Designing — 4 months, ₹6,500" },
  { regex: /(ai|artificial|intelligence|ml|chatgpt)/i, reply: "🤖 AI Course — 4 months, ₹10,000." },
  { regex: /(english|spoken|handwriting)/i, reply: "🗣️ English Spoken — 3 months, ₹4,000\n✍️ Handwriting — 1 month, ₹1,500" },
  { regex: /(thank|shukriya|dhanyavad)/i, reply: "You're welcome! 😊" },
  { regex: /(bye|goodbye|exit)/i, reply: "Goodbye! 👋 Best of luck!" }
];

app.post('/api/chat', async (req, res, next) => {
  try {
    const { sessionId, message, name } = req.body;
    if (!sessionId || !message)
      return res.status(400).json({ success: false, message: 'sessionId and message required.' });

    let botReply = '';

    if (CONFIG.OPENAI_API_KEY) {
      try {
        const r = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          {
            model: 'gpt-3.5-turbo',
            messages: [
              { role: 'system', content: 'You are the assistant of SS Computer Centre (IT training institute in Rajasthan). Reply in Hindi or English.' },
              { role: 'user', content: message }
            ],
            max_tokens: 250, temperature: 0.7
          },
          { headers: { Authorization: `Bearer ${CONFIG.OPENAI_API_KEY}` }, timeout: 8000 }
        );
        botReply = r.data.choices[0].message.content.trim();
      } catch (e) { console.warn('⚠️ OpenAI failed, using rules'); }
    }

    if (!botReply) {
      const rule = CHAT_RULES.find(r => r.regex.test(message));
      botReply = rule ? rule.reply
        : "I can help with courses, fees, batches, branches and placement info.";
    }

    let log = await ChatLog.findOne({ sessionId });
    if (!log) log = new ChatLog({ sessionId, name: name || '', messages: [] });
    if (name && !log.name) log.name = name;
    log.messages.push({ role: 'user', text: message });
    log.messages.push({ role: 'bot',  text: botReply });
    await log.save();

    res.json({ success: true, reply: botReply });
  } catch (err) { next(err); }
});

/* ============================================================
   ADMIN ROUTES
   ============================================================ */

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username !== CONFIG.ADMIN_USERNAME || password !== CONFIG.ADMIN_PASSWORD)
    return res.status(401).json({ success: false, message: 'Invalid credentials.' });
  const token = jwt.sign({ username, role: 'admin' }, CONFIG.JWT_SECRET, { expiresIn: CONFIG.JWT_EXPIRE });
  res.json({ success: true, token, username });
});

app.get('/api/admin/stats', protectAdmin, async (req, res, next) => {
  try {
    const [registrations, leads, contacts, newsletter, chats] = await Promise.all([
      Registration.countDocuments(), Lead.countDocuments(),
      Contact.countDocuments(), Newsletter.countDocuments(), ChatLog.countDocuments()
    ]);
    const newRegistrations = await Registration.countDocuments({ status: 'new' });
    const newLeads = await Lead.countDocuments({ status: 'new' });
    const unreadContacts = await Contact.countDocuments({ status: 'unread' });

    const topCourses = await Registration.aggregate([
      { $group: { _id: '$course', count: { $sum: 1 } } },
      { $sort: { count: -1 } }, { $limit: 5 }
    ]);

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentActivity = await Registration.aggregate([
      { $match: { createdAt: { $gte: sevenDaysAgo } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);

    res.json({
      success: true,
      data: {
        totals: { registrations, leads, contacts, newsletter, chats },
        pending: { newRegistrations, newLeads, unreadContacts },
        topCourses, recentActivity
      }
    });
  } catch (err) { next(err); }
});

/* Registrations */
app.get('/api/admin/registrations', protectAdmin, async (req, res, next) => {
  try {
    const regs = await Registration.find().sort({ createdAt: -1 });
    res.json({ success: true, total: regs.length, data: regs });
  } catch (err) { next(err); }
});
app.put('/api/admin/registrations/:id', protectAdmin, async (req, res, next) => {
  try {
    const r = await Registration.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!r) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: r });
  } catch (err) { next(err); }
});
app.delete('/api/admin/registrations/:id', protectAdmin, async (req, res, next) => {
  try { await Registration.findByIdAndDelete(req.params.id); res.json({ success: true }); }
  catch (err) { next(err); }
});

/* Leads */
app.get('/api/admin/leads', protectAdmin, async (req, res, next) => {
  try {
    const leads = await Lead.find().sort({ createdAt: -1 });
    res.json({ success: true, total: leads.length, data: leads });
  } catch (err) { next(err); }
});
app.put('/api/admin/leads/:id', protectAdmin, async (req, res, next) => {
  try {
    const l = await Lead.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, data: l });
  } catch (err) { next(err); }
});
app.delete('/api/admin/leads/:id', protectAdmin, async (req, res, next) => {
  try { await Lead.findByIdAndDelete(req.params.id); res.json({ success: true }); }
  catch (err) { next(err); }
});

/* Contacts */
app.get('/api/admin/contacts', protectAdmin, async (req, res, next) => {
  try {
    const c = await Contact.find().sort({ createdAt: -1 });
    res.json({ success: true, data: c });
  } catch (err) { next(err); }
});
app.put('/api/admin/contacts/:id', protectAdmin, async (req, res, next) => {
  try {
    const c = await Contact.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, data: c });
  } catch (err) { next(err); }
});
app.delete('/api/admin/contacts/:id', protectAdmin, async (req, res, next) => {
  try { await Contact.findByIdAndDelete(req.params.id); res.json({ success: true }); }
  catch (err) { next(err); }
});

/* Newsletter */
app.get('/api/admin/newsletter', protectAdmin, async (req, res, next) => {
  try {
    const n = await Newsletter.find().sort({ createdAt: -1 });
    res.json({ success: true, total: n.length, data: n });
  } catch (err) { next(err); }
});
app.delete('/api/admin/newsletter/:id', protectAdmin, async (req, res, next) => {
  try { await Newsletter.findByIdAndDelete(req.params.id); res.json({ success: true }); }
  catch (err) { next(err); }
});

/* Chats */
app.get('/api/admin/chats', protectAdmin, async (req, res, next) => {
  try {
    const c = await ChatLog.find().sort({ updatedAt: -1 }).limit(200);
    res.json({ success: true, total: c.length, data: c });
  } catch (err) { next(err); }
});

/* ============================================================
   ERROR + START
   ============================================================ */

app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.originalUrl}` });
});
app.use(errorHandler);

(async () => {
  try {
    await mongoose.connect(CONFIG.MONGODB_URI);
    console.log(`✅ MongoDB Connected: ${mongoose.connection.host}`);
    console.log(`📊 Database: ${mongoose.connection.name}`);

    app.listen(CONFIG.PORT, () => {
      console.log(`\n🚀 Server running on http://localhost:${CONFIG.PORT}`);
      console.log(`📡 API base: http://localhost:${CONFIG.PORT}/api`);
      console.log(`👨‍💼 Admin: ${CONFIG.ADMIN_USERNAME} / ${CONFIG.ADMIN_PASSWORD}\n`);
    });
  } catch (err) {
    console.error('❌ Startup error:', err.message);
    process.exit(1);
  }
})();
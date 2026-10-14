const express = require('express');
const session = require('express-session');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-this-session-secret-before-deploying';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Gazeta@2026Change';

function loadData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return { users: [], messages: [], requests: [], station: { online: false, nowPlaying: 'Programação automática GAZETA FM', dj: null } }; }
}
let db = loadData();
function saveData() { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }
async function ensureAdmin() {
  const exists = db.users.some(u => u.username.toLowerCase() === ADMIN_USER.toLowerCase());
  if (!exists) {
    db.users.push({ id: cryptoId(), username: ADMIN_USER, email: '', passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 12), role: 'admin', status: 'approved', createdAt: new Date().toISOString() });
    saveData();
    console.log(`Conta principal criada: ${ADMIN_USER}. Configure uma senha forte por variável de ambiente.`);
  }
}
function cryptoId() { return require('crypto').randomBytes(12).toString('hex'); }
function publicUser(u) { return { id: u.id, username: u.username, email: u.email, role: u.role, status: u.status, createdAt: u.createdAt }; }
function currentUser(req) { return db.users.find(u => u.id === req.session.userId); }
function requireLogin(req, res, next) { const u = currentUser(req); if (!u) return res.status(401).json({ error: 'Entre na sua conta para continuar.' }); if (u.status !== 'approved') return res.status(403).json({ error: 'Sua conta ainda não foi aprovada.' }); req.user = u; next(); }
function requireStaff(req, res, next) { requireLogin(req, res, () => { if (!['admin', 'director', 'broadcaster'].includes(req.user.role)) return res.status(403).json({ error: 'Acesso exclusivo à equipe da rádio.' }); next(); }); }
function requireManagement(req, res, next) { requireLogin(req, res, () => { if (!['admin', 'director'].includes(req.user.role)) return res.status(403).json({ error: 'Acesso exclusivo à administração e diretoria.' }); next(); }); }
app.use(express.json({ limit: '1mb' }));
app.use(session({ secret: SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 } }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', (req, res) => res.json({ station: db.station, listenerFeaturesEnabled: !!db.station.online, nowPlaying: db.station.nowPlaying }));
app.get('/api/me', (req, res) => { const u = currentUser(req); res.json({ user: u ? publicUser(u) : null }); });
app.post('/api/register', async (req, res) => {
  const { username, email, password, accountType } = req.body || {};
  if (!username || !email || !password) return res.status(400).json({ error: 'Preencha usuário, e-mail e senha.' });
  if (String(username).trim().length < 3 || String(password).length < 8) return res.status(400).json({ error: 'O usuário precisa ter 3 caracteres e a senha, no mínimo 8.' });
  if (!/^\S+@\S+\.\S+$/.test(String(email))) return res.status(400).json({ error: 'Informe um e-mail válido.' });
  if (db.users.some(u => u.username.toLowerCase() === String(username).trim().toLowerCase())) return res.status(409).json({ error: 'Esse usuário já existe.' });
  if (db.users.some(u => u.email.toLowerCase() === String(email).trim().toLowerCase())) return res.status(409).json({ error: 'Esse e-mail já está cadastrado.' });
  const type = accountType === 'broadcaster' ? 'broadcaster' : 'listener';
  const user = { id: cryptoId(), username: String(username).trim(), email: String(email).trim(), passwordHash: await bcrypt.hash(String(password), 12), role: type, status: type === 'broadcaster' ? 'pending' : 'approved', createdAt: new Date().toISOString() };
  db.users.push(user); saveData();
  if (type === 'listener') { req.session.userId = user.id; return res.status(201).json({ user: publicUser(user), message: 'Conta criada com sucesso!' }); }
  io.emit('admin:update');
  res.status(201).json({ message: 'Solicitação enviada! Aguarde a aprovação da administração.' });
});
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  const user = db.users.find(u => u.username.toLowerCase() === String(username || '').trim().toLowerCase());
  if (!user || !(await bcrypt.compare(String(password || ''), user.passwordHash))) return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
  if (user.status === 'pending') return res.status(403).json({ error: 'Sua solicitação ainda está aguardando aprovação.' });
  if (user.status === 'rejected') return res.status(403).json({ error: 'Sua solicitação de locutor foi recusada. Fale com a diretoria.' });
  req.session.userId = user.id; res.json({ user: publicUser(user), message: 'Login realizado.' });
});
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ message: 'Você saiu da conta.' })));
app.get('/api/messages', (req, res) => res.json({ messages: db.messages.slice(-100) }));
app.post('/api/messages', requireLogin, (req, res) => {
  if (!db.station.online && req.user.role === 'listener') return res.status(409).json({ error: 'O chat fica disponível quando a rádio está ao vivo.' });
  const text = String(req.body.text || '').trim(); if (!text || text.length > 500) return res.status(400).json({ error: 'A mensagem deve ter entre 1 e 500 caracteres.' });
  const message = { id: cryptoId(), username: req.user.username, text, at: new Date().toISOString(), role: req.user.role };
  db.messages.push(message); db.messages = db.messages.slice(-300); saveData(); io.emit('chat:message', message); res.status(201).json({ message });
});
app.get('/api/requests', requireLogin, (req, res) => {
  if (req.user.role === 'listener' && !db.station.online) return res.status(409).json({ error: 'Os pedidos de música ficam disponíveis quando a rádio está ao vivo.' });
  res.json({ requests: db.requests.slice(-100), canManage: ['admin','director','broadcaster'].includes(req.user.role) });
});
app.post('/api/requests', requireLogin, (req, res) => {
  if (req.user.role === 'listener' && !db.station.online) return res.status(409).json({ error: 'Os pedidos de música ficam disponíveis quando a rádio está ao vivo.' });
  const song = String(req.body.song || '').trim(); const artist = String(req.body.artist || '').trim();
  if (!song) return res.status(400).json({ error: 'Informe o nome da música.' });
  const item = { id: cryptoId(), song: song.slice(0,120), artist: artist.slice(0,120), username: req.user.username, status: 'pending', at: new Date().toISOString() };
  db.requests.push(item); saveData(); io.emit('requests:update'); res.status(201).json({ request: item });
});
app.patch('/api/requests/:id', requireStaff, (req, res) => {
  const item = db.requests.find(r => r.id === req.params.id); if (!item) return res.status(404).json({ error: 'Pedido não encontrado.' });
  const allowed = ['pending','accepted','played','rejected']; if (!allowed.includes(req.body.status)) return res.status(400).json({ error: 'Estado inválido.' });
  item.status = req.body.status; saveData(); io.emit('requests:update'); res.json({ request: item });
});
app.get('/api/admin/users', requireManagement, (req, res) => res.json({ users: db.users.filter(u => u.role === 'broadcaster' || u.role === 'director').map(publicUser) }));
app.patch('/api/admin/users/:id', requireManagement, (req, res) => {
  const target = db.users.find(u => u.id === req.params.id); if (!target) return res.status(404).json({ error: 'Conta não encontrada.' });
  if (!['approved','rejected'].includes(req.body.status)) return res.status(400).json({ error: 'Decisão inválida.' });
  target.status = req.body.status; if (req.body.status === 'approved') target.role = req.body.role === 'director' && req.user.role === 'admin' ? 'director' : 'broadcaster'; saveData(); io.emit('admin:update'); res.json({ user: publicUser(target), message: `Conta ${target.status === 'approved' ? 'aprovada' : 'recusada'}.` });
});
app.post('/api/station/takeover', requireStaff, (req, res) => {
  db.station.online = true; db.station.dj = req.user.username; db.station.startedAt = new Date().toISOString(); saveData(); io.emit('station:update', db.station); res.json({ station: db.station, message: 'Estado do painel atualizado. A transmissão de áudio real será integrada na próxima etapa.' });
});
app.post('/api/station/return-auto', requireStaff, (req, res) => {
  db.station.online = false; db.station.dj = null; db.station.startedAt = null; db.station.nowPlaying = 'Programação automática GAZETA FM'; saveData(); io.emit('station:update', db.station); res.json({ station: db.station, message: 'Estado atualizado para programação automática. O Auto DJ real será integrado na próxima etapa.' });
});
app.post('/api/station/now-playing', requireStaff, (req, res) => { db.station.nowPlaying = String(req.body.title || 'Programação automática GAZETA FM').slice(0,180); saveData(); io.emit('station:update', db.station); res.json({ station: db.station }); });

io.on('connection', socket => { socket.emit('station:update', db.station); });
ensureAdmin().then(() => server.listen(PORT, () => console.log(`GAZETA FM disponível na porta ${PORT}`)));

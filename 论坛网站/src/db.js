'use strict';

/**
 * 数据访问层：基于 Node 内置 node:sqlite（无需 npm install）
 * 所有用户数据、帖子、会话、验证码、广告位都持久化在 data/forum.db
 */

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (e) {
  console.error('\n[致命] 当前 Node 版本不支持内置 SQLite 模块。');
  console.error('       本项目需要 Node.js v22.5 或更高版本（推荐 v22 LTS / v24）。');
  console.error(`       当前版本：${process.version}\n`);
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_PATH = path.join(DATA_DIR, 'forum.db');

for (const dir of [DATA_DIR, UPLOAD_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

/* ------------------------------------------------------------------ */
/* 建表                                                                */
/* ------------------------------------------------------------------ */

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL,
  email_lower   TEXT NOT NULL UNIQUE,
  nickname      TEXT NOT NULL UNIQUE,
  pass_salt     TEXT NOT NULL,
  pass_hash     TEXT NOT NULL,
  bio           TEXT NOT NULL DEFAULT '',
  avatar_color  TEXT NOT NULL DEFAULT '#4f7cff',
  role          TEXT NOT NULL DEFAULT 'user',
  status        TEXT NOT NULL DEFAULT 'active',
  is_system     INTEGER NOT NULL DEFAULT 0,
  post_count    INTEGER NOT NULL DEFAULT 0,
  reply_count   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip         TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS codes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email_lower TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  salt        TEXT NOT NULL,
  purpose     TEXT NOT NULL DEFAULT 'register',
  ip          TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  consumed_at TEXT,
  attempts    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_codes_email ON codes(email_lower, purpose, created_at);
CREATE INDEX IF NOT EXISTS idx_codes_ip ON codes(ip, created_at);

CREATE TABLE IF NOT EXISTS topics (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon        TEXT NOT NULL DEFAULT '',
  color       TEXT NOT NULL DEFAULT '#4f7cff',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  post_count  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS posts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id       INTEGER NOT NULL REFERENCES topics(id),
  title          TEXT NOT NULL,
  content        TEXT NOT NULL,
  views          INTEGER NOT NULL DEFAULT 0,
  reply_count    INTEGER NOT NULL DEFAULT 0,
  like_count     INTEGER NOT NULL DEFAULT 0,
  is_top         INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'published',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  last_reply_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_posts_topic ON posts(topic_id, created_at);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at);
CREATE INDEX IF NOT EXISTS idx_posts_hot ON posts(reply_count, views);

CREATE TABLE IF NOT EXISTS replies (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  like_count INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'published',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_replies_post ON replies(post_id, created_at);

CREATE TABLE IF NOT EXISTS likes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id   INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  UNIQUE(user_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_likes_target ON likes(target_type, target_id);

CREATE TABLE IF NOT EXISTS ads (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slot_key     TEXT NOT NULL UNIQUE,
  slot_name    TEXT NOT NULL,
  position     TEXT NOT NULL DEFAULT 'sidebar',
  advertiser   TEXT NOT NULL DEFAULT '',
  title        TEXT NOT NULL DEFAULT '',
  subtitle     TEXT NOT NULL DEFAULT '',
  price        TEXT NOT NULL DEFAULT '',
  wechat_id    TEXT NOT NULL DEFAULT '',
  wechat_image TEXT NOT NULL DEFAULT '',
  note         TEXT NOT NULL DEFAULT '',
  enabled      INTEGER NOT NULL DEFAULT 1,
  clicks       INTEGER NOT NULL DEFAULT 0,
  impressions  INTEGER NOT NULL DEFAULT 0,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ad_clicks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ad_id      INTEGER NOT NULL,
  slot_key   TEXT NOT NULL DEFAULT '',
  ip         TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ad_clicks_ad ON ad_clicks(ad_id, created_at);

CREATE TABLE IF NOT EXISTS mail_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  to_email   TEXT NOT NULL,
  subject    TEXT NOT NULL DEFAULT '',
  purpose    TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL,
  error      TEXT NOT NULL DEFAULT '',
  message_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mail_created ON mail_log(created_at);

CREATE TABLE IF NOT EXISTS rate_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket     TEXT NOT NULL,
  bucket_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate ON rate_log(bucket, bucket_key, created_at);

CREATE TABLE IF NOT EXISTS uploads (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  filename    TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime        TEXT NOT NULL DEFAULT '',
  size        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);

/* ------------------------------------------------------------------ */
/* 基础工具                                                            */
/* ------------------------------------------------------------------ */

const nowIso = () => new Date().toISOString();

const AVATAR_COLORS = [
  '#4f7cff', '#7c5cff', '#ff6b9a', '#ff8f4d',
  '#22b07d', '#0ea5e9', '#e0467c', '#8b5cf6',
  '#14b8a6', '#f59e0b', '#ef4444', '#6366f1',
];

function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), s, 64).toString('hex');
  return { salt: s, hash };
}

function verifyPassword(password, salt, expectedHash) {
  try {
    const actual = crypto.scryptSync(String(password), salt, 64);
    const expected = Buffer.from(expectedHash, 'hex');
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
  } catch (_) {
    return false;
  }
}

function hashToken(token, salt) {
  return crypto.createHmac('sha256', salt).update(String(token)).digest('hex');
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function pickAvatarColor(seedText) {
  let sum = 0;
  for (const ch of String(seedText)) sum = (sum * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

/* ------------------------------------------------------------------ */
/* 限流                                                                */
/* ------------------------------------------------------------------ */

function countInWindow(bucket, key, seconds) {
  const since = new Date(Date.now() - seconds * 1000).toISOString();
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM rate_log WHERE bucket = ? AND bucket_key = ? AND created_at >= ?')
    .get(bucket, key, since);
  return row ? Number(row.n) : 0;
}

function recordHit(bucket, key) {
  db.prepare('INSERT INTO rate_log (bucket, bucket_key, created_at) VALUES (?, ?, ?)').run(bucket, key, nowIso());
}

/** 清理 7 天前的限流与点击日志，避免表无限膨胀 */
function purgeOldLogs() {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  try {
    db.prepare('DELETE FROM rate_log WHERE created_at < ?').run(since);
    db.prepare('DELETE FROM ad_clicks WHERE created_at < ?').run(since);
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowIso());
    db.prepare('DELETE FROM codes WHERE created_at < ?').run(since);
  } catch (e) {
    console.warn('[warn] 清理旧日志失败:', e.message);
  }
}

/* ------------------------------------------------------------------ */
/* 用户                                                                */
/* ------------------------------------------------------------------ */

function findUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email_lower = ?').get(normalizeEmail(email)) || null;
}

function findUserByNickname(nickname) {
  return db.prepare('SELECT * FROM users WHERE nickname = ?').get(String(nickname || '').trim()) || null;
}

function findUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id)) || null;
}

function createUser({ email, nickname, password, role = 'user', isSystem = 0, bio = '' }) {
  const { salt, hash } = hashPassword(password);
  const emailLower = normalizeEmail(email);
  // 第一个真实注册的账号自动成为站长，否则无人能进入后台配置广告微信号
  let finalRole = role;
  if (isSystem === 0 && role === 'user') {
    const n = Number(db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_system = 0').get().n);
    if (n === 0) {
      finalRole = 'admin';
      console.log(`[info] 首位注册用户 ${nickname} 已自动设为站长（可访问 #/admin 后台）`);
    }
  }
  const info = db
    .prepare(`INSERT INTO users
      (email, email_lower, nickname, pass_salt, pass_hash, bio, avatar_color, role, status, is_system, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
    .run(emailLower, emailLower, String(nickname).trim(), salt, hash, bio, pickAvatarColor(nickname), finalRole, isSystem, nowIso());
  return findUserById(info.lastInsertRowid);
}

function updateUserPassword(userId, newPassword) {
  const { salt, hash } = hashPassword(newPassword);
  db.prepare('UPDATE users SET pass_salt = ?, pass_hash = ? WHERE id = ?').run(salt, hash, Number(userId));
}

function touchLogin(userId) {
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), Number(userId));
}

function updateUserBio(userId, bio) {
  db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(String(bio || '').slice(0, 200), Number(userId));
}

function setUserStatus(userId, status) {
  db.prepare('UPDATE users SET status = ? WHERE id = ? AND is_system = 0')
    .run(status === 'banned' ? 'banned' : 'active', Number(userId));
}

function bumpCounter(userId, column, delta = 1) {
  const allowed = new Set(['post_count', 'reply_count']);
  if (!allowed.has(column)) return;
  db.prepare(`UPDATE users SET ${column} = MAX(0, ${column} + ?) WHERE id = ?`).run(delta, Number(userId));
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    nickname: u.nickname,
    bio: u.bio,
    avatarColor: u.avatar_color,
    role: u.role,
    postCount: u.post_count,
    replyCount: u.reply_count,
    createdAt: u.created_at,
    lastLoginAt: u.last_login_at,
  };
}

function listUsers(limit = 50, offset = 0) {
  return db
    .prepare(`SELECT * FROM users WHERE is_system = 0 ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(Number(limit), Number(offset))
    .map(publicUser);
}

function countUsers() {
  const row = db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_system = 0').get();
  return row ? Number(row.n) : 0;
}

/** 公开资料：不含邮箱、密码等隐私字段，供他人访问用户主页使用 */
function getPublicProfile(userId) {
  const u = findUserById(userId);
  if (!u) return null;
  const replyRow = db.prepare(`SELECT COUNT(*) AS n FROM replies WHERE user_id = ? AND status = 'published'`).get(Number(userId));
  return {
    id: u.id,
    nickname: u.nickname,
    bio: u.bio,
    avatarColor: u.avatar_color,
    role: u.role,
    postCount: u.post_count,
    replyCount: replyRow ? Number(replyRow.n) : 0,
    createdAt: u.created_at,
    lastActiveAt: u.last_login_at,
  };
}

/* ------------------------------------------------------------------ */
/* 会话                                                                */
/* ------------------------------------------------------------------ */

const SESSION_PEPPER = (() => {
  const pepperPath = path.join(DATA_DIR, '.session_pepper');
  try {
    if (fs.existsSync(pepperPath)) return fs.readFileSync(pepperPath, 'utf8').trim();
  } catch (_) { /* 忽略 */ }
  const p = randomToken(32);
  try {
    fs.writeFileSync(pepperPath, p, { mode: 0o600 });
  } catch (_) { /* 只读环境下降级为内存值 */ }
  return p;
})();

function createSession(userId, ip, userAgent, ttlDays = 7) {
  const raw = randomToken(32);
  const id = hashToken(raw, SESSION_PEPPER);
  const expires = new Date(Date.now() + ttlDays * 24 * 3600 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (id, user_id, ip, user_agent, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, Number(userId), String(ip || '').slice(0, 64), String(userAgent || '').slice(0, 256), nowIso(), expires);
  return { rawToken: raw, expiresAt: expires };
}

function getSession(rawToken) {
  if (!rawToken) return null;
  const id = hashToken(rawToken, SESSION_PEPPER);
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    return null;
  }
  const user = findUserById(row.user_id);
  if (!user || user.status !== 'active') return null;
  return { session: row, user };
}

function destroySession(rawToken) {
  if (!rawToken) return;
  db.prepare('DELETE FROM sessions WHERE id = ?').run(hashToken(rawToken, SESSION_PEPPER));
}

function destroyUserSessions(userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(Number(userId));
}

/* ------------------------------------------------------------------ */
/* 邮箱验证码                                                          */
/* ------------------------------------------------------------------ */

function createCode(email, code, purpose, ip, ttlMinutes) {
  const salt = crypto.randomBytes(12).toString('hex');
  const expires = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
  db.prepare(`INSERT INTO codes (email_lower, code_hash, salt, purpose, ip, created_at, expires_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(normalizeEmail(email), hashToken(code, salt), salt, purpose, String(ip || '').slice(0, 64), nowIso(), expires);
}

function findActiveCode(email, purpose) {
  return (
    db.prepare(`SELECT * FROM codes
                WHERE email_lower = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > ?
                ORDER BY id DESC LIMIT 1`)
      .get(normalizeEmail(email), purpose, nowIso()) || null
  );
}

function verifyCode(email, purpose, inputCode) {
  const row = findActiveCode(email, purpose);
  if (!row) return { ok: false, reason: '验证码不存在或已过期，请重新获取' };
  if (row.attempts >= 5) {
    db.prepare('UPDATE codes SET consumed_at = ? WHERE id = ?').run(nowIso(), row.id);
    return { ok: false, reason: '验证码错误次数过多，请重新获取' };
  }
  db.prepare('UPDATE codes SET attempts = attempts + 1 WHERE id = ?').run(row.id);
  const ok = hashToken(String(inputCode || '').trim(), row.salt) === row.code_hash;
  if (!ok) return { ok: false, reason: '验证码不正确，请检查后重新输入' };
  db.prepare('UPDATE codes SET consumed_at = ? WHERE id = ?').run(nowIso(), row.id);
  return { ok: true };
}

function latestCodeTime(email, purpose) {
  const row = db.prepare(`SELECT created_at FROM codes
                          WHERE email_lower = ? AND purpose = ?
                          ORDER BY id DESC LIMIT 1`).get(normalizeEmail(email), purpose);
  return row ? new Date(row.created_at).getTime() : 0;
}

function logMail(toEmail, subject, purpose, status, error, messageId) {
  db.prepare(`INSERT INTO mail_log (to_email, subject, purpose, status, error, message_id, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(normalizeEmail(toEmail), String(subject || '').slice(0, 200), purpose, status,
         String(error || '').slice(0, 500), String(messageId || ''), nowIso());
}

function recentMailLog(limit = 30) {
  return db.prepare('SELECT * FROM mail_log ORDER BY id DESC LIMIT ?').all(Number(limit)).map((r) => ({
    id: r.id, to: r.to_email, subject: r.subject, purpose: r.purpose,
    status: r.status, error: r.error, createdAt: r.created_at,
  }));
}

/* ------------------------------------------------------------------ */
/* 话题                                                                */
/* ------------------------------------------------------------------ */

function listTopics() {
  return db.prepare('SELECT * FROM topics ORDER BY sort_order ASC, id ASC').all().map((t) => ({
    id: t.id, slug: t.slug, name: t.name, description: t.description,
    icon: t.icon, color: t.color, postCount: t.post_count,
  }));
}

function findTopic(idOrSlug) {
  const v = idOrSlug;
  if (typeof v === 'number' || /^\d+$/.test(String(v))) {
    return db.prepare('SELECT * FROM topics WHERE id = ?').get(Number(v)) || null;
  }
  return db.prepare('SELECT * FROM topics WHERE slug = ?').get(String(v)) || null;
}

function refreshTopicCount(topicId) {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM posts WHERE topic_id = ? AND status = 'published'`).get(Number(topicId));
  db.prepare('UPDATE topics SET post_count = ? WHERE id = ?').run(row ? Number(row.n) : 0, Number(topicId));
}

/* ------------------------------------------------------------------ */
/* 帖子与回复                                                          */
/* ------------------------------------------------------------------ */

function listPosts({ topicId = null, keyword = '', sort = 'new', page = 1, pageSize = 10, userId = null } = {}) {
  const where = ["p.status = 'published'"];
  const params = [];

  if (topicId) {
    where.push('p.topic_id = ?');
    params.push(Number(topicId));
  }
  if (keyword) {
    where.push('(p.title LIKE ? OR p.content LIKE ? OR u.nickname LIKE ?)');
    const like = `%${String(keyword).replace(/[%_]/g, '')}%`;
    params.push(like, like, like);
  }
  if (userId) {
    where.push('p.user_id = ?');
    params.push(Number(userId));
  }

  const whereSql = 'WHERE ' + where.join(' AND ');
  const orderSql =
    sort === 'hot'
      ? 'ORDER BY p.is_top DESC, (p.reply_count * 3 + p.like_count * 2 + p.views) DESC, p.created_at DESC'
      : sort === 'replied'
        ? 'ORDER BY p.is_top DESC, COALESCE(p.last_reply_at, p.created_at) DESC'
        : 'ORDER BY p.is_top DESC, p.created_at DESC';

  const total = Number(db.prepare(`SELECT COUNT(*) AS n FROM posts p JOIN users u ON u.id = p.user_id ${whereSql}`).get(...params).n);
  const safePage = Math.max(1, Number(page) || 1);
  const safeSize = Math.min(50, Math.max(1, Number(pageSize) || 10));
  const rows = db
    .prepare(`SELECT p.*, u.nickname AS author_name, u.avatar_color AS author_color, u.role AS author_role,
                     t.name AS topic_name, t.slug AS topic_slug, t.color AS topic_color
              FROM posts p
              JOIN users u ON u.id = p.user_id
              JOIN topics t ON t.id = p.topic_id
              ${whereSql} ${orderSql} LIMIT ? OFFSET ?`)
    .all(...params, safeSize, (safePage - 1) * safeSize);

  const likedIds = userId
    ? new Set(
        db.prepare(`SELECT target_id FROM likes WHERE user_id = ? AND target_type = 'post'`).all(Number(userId)).map((r) => r.target_id)
      )
    : new Set();

  return {
    total,
    page: safePage,
    pageSize: safeSize,
    totalPages: Math.max(1, Math.ceil(total / safeSize)),
    items: rows.map((p) => ({
      id: p.id,
      title: p.title,
      excerpt: p.content.replace(/\s+/g, ' ').trim().slice(0, 140),
      views: p.views,
      replyCount: p.reply_count,
      likeCount: p.like_count,
      isTop: !!p.is_top,
      createdAt: p.created_at,
      lastReplyAt: p.last_reply_at,
      author: { id: p.user_id, nickname: p.author_name, avatarColor: p.author_color, role: p.author_role },
      topic: { id: p.topic_id, name: p.topic_name, slug: p.topic_slug, color: p.topic_color },
      liked: likedIds.has(p.id),
    })),
  };
}

function findPost(id) {
  return db.prepare('SELECT * FROM posts WHERE id = ?').get(Number(id)) || null;
}

function getPostDetail(id, userId) {
  const p = db
    .prepare(`SELECT p.*, u.nickname AS author_name, u.avatar_color AS author_color, u.role AS author_role, u.bio AS author_bio,
                     u.post_count AS author_posts, u.created_at AS author_joined,
                     t.name AS topic_name, t.slug AS topic_slug, t.color AS topic_color
              FROM posts p JOIN users u ON u.id = p.user_id JOIN topics t ON t.id = p.topic_id
              WHERE p.id = ?`)
    .get(Number(id));
  if (!p) return null;

  const likedIds = userId
    ? new Set(db.prepare(`SELECT target_id FROM likes WHERE user_id = ? AND target_type = 'reply'`).all(Number(userId)).map((r) => r.target_id))
    : new Set();

  const replies = db
    .prepare(`SELECT r.*, u.nickname AS author_name, u.avatar_color AS author_color, u.role AS author_role
              FROM replies r JOIN users u ON u.id = r.user_id
              WHERE r.post_id = ? AND r.status = 'published' ORDER BY r.created_at ASC LIMIT 500`)
    .all(Number(id))
    .map((r) => ({
      id: r.id,
      content: r.content,
      likeCount: r.like_count,
      createdAt: r.created_at,
      author: { id: r.user_id, nickname: r.author_name, avatarColor: r.author_color, role: r.author_role },
      liked: likedIds.has(r.id),
    }));

  const postLiked = userId
    ? !!db.prepare(`SELECT 1 FROM likes WHERE user_id = ? AND target_type = 'post' AND target_id = ?`).get(Number(userId), Number(id))
    : false;

  return {
    id: p.id,
    title: p.title,
    content: p.content,
    views: p.views,
    replyCount: p.reply_count,
    likeCount: p.like_count,
    isTop: !!p.is_top,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    canEdit: userId ? Number(userId) === p.user_id : false,
    author: {
      id: p.user_id, nickname: p.author_name, avatarColor: p.author_color, role: p.author_role,
      bio: p.author_bio, postCount: p.author_posts, joinedAt: p.author_joined,
    },
    topic: { id: p.topic_id, name: p.topic_name, slug: p.topic_slug, color: p.topic_color },
    liked: postLiked,
    replies,
  };
}

function createPost({ userId, topicId, title, content }) {
  const t = nowIso();
  const info = db
    .prepare(`INSERT INTO posts (user_id, topic_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(Number(userId), Number(topicId), String(title).trim(), String(content), t, t);
  db.prepare('UPDATE posts SET topic_id = ? WHERE id = ?').run(Number(topicId), info.lastInsertRowid);
  refreshTopicCount(topicId);
  bumpCounter(userId, 'post_count', 1);
  return findPost(info.lastInsertRowid);
}

function updatePost(postId, { title, content, topicId }) {
  const old = findPost(postId);
  if (!old) return null;
  const t = nowIso();
  db.prepare('UPDATE posts SET title = ?, content = ?, topic_id = ?, updated_at = ? WHERE id = ?')
    .run(String(title).trim(), String(content), Number(topicId), t, Number(postId));
  if (Number(topicId) !== Number(old.topic_id)) {
    refreshTopicCount(old.topic_id);
    refreshTopicCount(topicId);
  }
  return findPost(postId);
}

function deletePost(postId) {
  const old = findPost(postId);
  if (!old) return false;
  db.prepare('DELETE FROM posts WHERE id = ?').run(Number(postId));
  refreshTopicCount(old.topic_id);
  bumpCounter(old.user_id, 'post_count', -1);
  return true;
}

function increaseViews(postId) {
  db.prepare('UPDATE posts SET views = views + 1 WHERE id = ?').run(Number(postId));
}

function listReplies(postId) {
  return db.prepare(`SELECT * FROM replies WHERE post_id = ? AND status = 'published' ORDER BY created_at ASC`).all(Number(postId));
}

function createReply({ postId, userId, content }) {
  const t = nowIso();
  const info = db.prepare('INSERT INTO replies (post_id, user_id, content, created_at) VALUES (?, ?, ?, ?)')
    .run(Number(postId), Number(userId), String(content), t);
  db.prepare('UPDATE posts SET reply_count = reply_count + 1, last_reply_at = ? WHERE id = ?').run(t, Number(postId));
  bumpCounter(userId, 'reply_count', 1);
  return db.prepare('SELECT * FROM replies WHERE id = ?').get(info.lastInsertRowid);
}

function deleteReply(replyId) {
  const r = db.prepare('SELECT * FROM replies WHERE id = ?').get(Number(replyId));
  if (!r) return false;
  db.prepare('DELETE FROM replies WHERE id = ?').run(Number(replyId));
  db.prepare('UPDATE posts SET reply_count = MAX(0, reply_count - 1) WHERE id = ?').run(Number(r.post_id));
  bumpCounter(r.user_id, 'reply_count', -1);
  return true;
}

function findReplyRow(replyId) {
  return db.prepare('SELECT * FROM replies WHERE id = ?').get(Number(replyId)) || null;
}

function getLikeCount(targetType, targetId) {
  const table = targetType === 'post' ? 'posts' : 'replies';
  const row = db.prepare(`SELECT like_count AS n FROM ${table} WHERE id = ?`).get(Number(targetId));
  return row ? Number(row.n) : 0;
}

function listLikedIds(userId, targetType) {
  return new Set(
    db.prepare('SELECT target_id FROM likes WHERE user_id = ? AND target_type = ?')
      .all(Number(userId), targetType).map((r) => r.target_id)
  );
}

function toggleLike(userId, targetType, targetId) {
  if (!['post', 'reply'].includes(targetType)) return { ok: false, reason: '不支持的点赞对象' };
  const table = targetType === 'post' ? 'posts' : 'replies';
  const target = db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(Number(targetId));
  if (!target) return { ok: false, reason: '内容不存在' };

  const existing = db.prepare('SELECT id FROM likes WHERE user_id = ? AND target_type = ? AND target_id = ?')
    .get(Number(userId), targetType, Number(targetId));

  if (existing) {
    db.prepare('DELETE FROM likes WHERE id = ?').run(existing.id);
    db.prepare(`UPDATE ${table} SET like_count = MAX(0, like_count - 1) WHERE id = ?`).run(Number(targetId));
    return { ok: true, liked: false };
  }
  db.prepare('INSERT INTO likes (user_id, target_type, target_id, created_at) VALUES (?, ?, ?, ?)')
    .run(Number(userId), targetType, Number(targetId), nowIso());
  db.prepare(`UPDATE ${table} SET like_count = like_count + 1 WHERE id = ?`).run(Number(targetId));
  return { ok: true, liked: true };
}

/* ------------------------------------------------------------------ */
/* 广告招商位                                                          */
/* ------------------------------------------------------------------ */

function listAds({ enabledOnly = false } = {}) {
  const sql = enabledOnly
    ? 'SELECT * FROM ads WHERE enabled = 1 ORDER BY sort_order ASC, id ASC'
    : 'SELECT * FROM ads ORDER BY sort_order ASC, id ASC';
  return db.prepare(sql).all().map((a) => ({
    id: a.id, slotKey: a.slot_key, slotName: a.slot_name, position: a.position,
    advertiser: a.advertiser, title: a.title, subtitle: a.subtitle, price: a.price,
    wechatId: a.wechat_id, wechatImage: a.wechat_image, note: a.note,
    enabled: !!a.enabled, clicks: a.clicks, impressions: a.impressions, updatedAt: a.updated_at,
  }));
}

function updateAd(id, patch) {
  const fields = {
    advertiser: 'advertiser', title: 'title', subtitle: 'subtitle', price: 'price',
    wechatId: 'wechat_id', wechatImage: 'wechat_image', note: 'note',
  };
  const sets = [];
  const params = [];
  for (const [k, col] of Object.entries(fields)) {
    if (patch[k] !== undefined) { sets.push(`${col} = ?`); params.push(String(patch[k])); }
  }
  if (patch.enabled !== undefined) { sets.push('enabled = ?'); params.push(patch.enabled ? 1 : 0); }
  if (!sets.length) return null;
  sets.push('updated_at = ?'); params.push(nowIso());
  params.push(Number(id));
  db.prepare(`UPDATE ads SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return db.prepare('SELECT * FROM ads WHERE id = ?').get(Number(id));
}

function recordAdClick(id, slotKey, ip, userAgent) {
  db.prepare('UPDATE ads SET clicks = clicks + 1 WHERE id = ?').run(Number(id));
  db.prepare('INSERT INTO ad_clicks (ad_id, slot_key, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(Number(id), String(slotKey || ''), String(ip || '').slice(0, 64), String(userAgent || '').slice(0, 256), nowIso());
}

function recordAdImpressions(slotKeys) {
  if (!Array.isArray(slotKeys) || !slotKeys.length) return;
  const stmt = db.prepare('UPDATE ads SET impressions = impressions + 1 WHERE slot_key = ? AND enabled = 1');
  for (const k of slotKeys) stmt.run(String(k));
}

/* ------------------------------------------------------------------ */
/* 站点统计                                                            */
/* ------------------------------------------------------------------ */

function siteStats() {
  const q = (sql) => { const r = db.prepare(sql).get(); return r ? Number(Object.values(r)[0]) : 0; };
  return {
    users: q('SELECT COUNT(*) AS n FROM users WHERE is_system = 0'),
    posts: q("SELECT COUNT(*) AS n FROM posts WHERE status = 'published'"),
    replies: q("SELECT COUNT(*) AS n FROM replies WHERE status = 'published'"),
    topics: q('SELECT COUNT(*) AS n FROM topics'),
    adClicks: q('SELECT COUNT(*) AS n FROM ad_clicks'),
  };
}

function hotPosts(limit = 5) {
  return db.prepare(`SELECT p.id, p.title, p.reply_count, p.views, t.name AS topic_name, t.color AS topic_color
                     FROM posts p JOIN topics t ON t.id = p.topic_id
                     WHERE p.status = 'published'
                     ORDER BY (p.reply_count * 3 + p.like_count * 2 + p.views) DESC, p.created_at DESC
                     LIMIT ?`)
    .all(Number(limit))
    .map((p) => ({ id: p.id, title: p.title, replyCount: p.reply_count, views: p.views, topicName: p.topic_name, topicColor: p.topic_color }));
}

function latestUsers(limit = 6) {
  return db.prepare('SELECT * FROM users WHERE is_system = 0 ORDER BY created_at DESC LIMIT ?')
    .all(Number(limit)).map(publicUser);
}

/* ------------------------------------------------------------------ */
/* 文件上传登记                                                        */
/* ------------------------------------------------------------------ */

function recordUpload({ userId, filename, storedName, mime, size }) {
  const info = db.prepare('INSERT INTO uploads (user_id, filename, stored_name, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(Number(userId), String(filename).slice(0, 200), storedName, String(mime || ''), Number(size) || 0, nowIso());
  return info.lastInsertRowid;
}

function listUploads(limit = 50) {
  return db.prepare('SELECT * FROM uploads ORDER BY id DESC LIMIT ?').all(Number(limit)).map((u) => ({
    id: u.id, userId: u.user_id, filename: u.filename, storedName: u.stored_name,
    mime: u.mime, size: u.size, createdAt: u.created_at,
  }));
}

/* ------------------------------------------------------------------ */
/* 设置                                                                */
/* ------------------------------------------------------------------ */

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(String(key));
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(String(key), String(value), nowIso());
}

/* ------------------------------------------------------------------ */
/* 初始化种子数据                                                      */
/* ------------------------------------------------------------------ */

const DEFAULT_TOPICS = [
  { slug: 'announce', name: '站务公告', icon: '📢', color: '#ef4444', description: '官方通知、规则更新与版本说明', sort: 1 },
  { slug: 'tech', name: '技术讨论', icon: '💻', color: '#4f7cff', description: '编程、架构、工具链与踩坑记录', sort: 2 },
  { slug: 'life', name: '生活日常', icon: '🌿', color: '#22b07d', description: '吃喝玩乐、随手记录与日常闲聊', sort: 3 },
  { slug: 'creative', name: '创意设计', icon: '🎨', color: '#8b5cf6', description: '设计作品、灵感分享与审美讨论', sort: 4 },
  { slug: 'career', name: '职场交流', icon: '💼', color: '#f59e0b', description: '求职面试、职业发展与行业观察', sort: 5 },
  { slug: 'study', name: '学习成长', icon: '📚', color: '#0ea5e9', description: '读书笔记、学习方法与自律打卡', sort: 6 },
  { slug: 'qa', name: '互助问答', icon: '❓', color: '#14b8a6', description: '有问题尽管问，社区帮你一起想办法', sort: 7 },
  { slug: 'free', name: '自由灌水', icon: '🫧', color: '#ff6b9a', description: '不设主题的轻松角落', sort: 8 },
];

const DEFAULT_ADS = [
  {
    slot_key: 'top_banner', slot_name: '首页顶部横幅', position: 'banner', sort_order: 1,
    advertiser: '虚位以待', title: '首页顶部横幅广告位', subtitle: '全站曝光量最高的黄金位置，728×90 横幅',
    price: '招商中 · 价格面议',
  },
  {
    slot_key: 'sidebar_rect', slot_name: '侧栏推荐位', position: 'sidebar', sort_order: 2,
    advertiser: '虚位以待', title: '侧栏矩形推荐位', subtitle: '常驻右侧，随页面滚动持续可见，300×250',
    price: '招商中 · 价格面议',
  },
  {
    slot_key: 'infeed', slot_name: '帖子列表内嵌', position: 'infeed', sort_order: 3,
    advertiser: '虚位以待', title: '列表信息流内嵌位', subtitle: '自然融入帖子流，原生感强、点击率高',
    price: '招商中 · 价格面议',
  },
  {
    slot_key: 'footer_bar', slot_name: '底部通栏', position: 'footer', sort_order: 4,
    advertiser: '虚位以待', title: '页脚通栏广告位', subtitle: '覆盖全部页面底部，适合品牌长期露出',
    price: '招商中 · 价格面议',
  },
];

const SEED_POSTS = [
  {
    topic: 'announce', title: '欢迎来到青柚社区 · 发帖前请花一分钟看完',
    content: `欢迎来到青柚社区！\n\n这是一个真实运行的动态论坛：你的账号、帖子、回复都存在服务器本地的数据库文件里，关掉浏览器也不会丢。\n\n【怎么开始】\n1. 点右上角「注册」，输入你的邮箱，收到 6 位验证码后填写昵称和密码即可。\n2. 登录后就能发帖、回复、点赞。\n3. 首页左侧可以按话题筛选，也支持关键词搜索和「最新 / 最热」排序。\n\n【几条基本约定】\n· 请友善表达，不人身攻击，不发布违法违规内容。\n· 广告请走招商位，不要在帖子区硬广刷屏。\n· 发帖前先用搜索看看有没有人聊过同样的话题。\n\n【关于广告招商】\n页面上有四个招商位（顶部横幅、侧栏推荐、列表内嵌、底部通栏），点击任意一个都能看到联系微信名片。如果你是站长本人，可以在 config.json 里改成自己的微信号，并把 public/assets/wechat-card.svg 换成你的真实名片图。\n\n祝聊得开心。`,
    top: 1,
  },
  {
    topic: 'announce', title: '邮箱验证码收不到？先看这三条',
    content: `注册或登录时需要邮箱验证码，如果一直收不到，通常是下面几种情况：\n\n1. 站长还没配置发信邮箱\n打开项目根目录的 config.json，在 smtp 段填入你的 QQ 邮箱地址和【授权码】（注意不是 QQ 密码）。授权码在 mail.qq.com → 设置 → 账户 → 开启 POP3/SMTP 服务里生成。填好后重启服务即可。\n\n2. 邮件进了垃圾箱\nQQ 邮箱发出的第一封邮件有时会被归到「垃圾邮件」，先去那里翻一下，并把发件地址加入白名单。\n\n3. 触发频率限制\n同一个邮箱 60 秒内只能发一次，每小时最多 5 次。等一会儿再试。\n\n本地测试小技巧：config.json 里 security.devModeFallback 为 true 时，验证码会直接打印在启动窗口（服务端控制台）里，同时写入 data/dev-codes.log。没有真实邮箱也能完整跑通注册流程。正式对外部署前记得把它改成 false。`,
  },
  {
    topic: 'tech', title: '这个论坛为什么一个 npm 包都不用装',
    content: `整理一下本站的技术选型，给同样想做「零依赖小项目」的人参考：\n\n· 后端：Node.js 内置 http 模块手写路由，不用 express。\n· 数据库：Node 22 起内置的 node:sqlite（DatabaseSync），不用 better-sqlite3，也不用装 MySQL。\n· 发信：用内置 tls / net 手写了一个极简 SMTP 客户端，实现 EHLO → AUTH LOGIN → MAIL FROM → RCPT TO → DATA 全流程，不用 nodemailer。\n· 密码：crypto.scryptSync 加盐哈希，比对用 timingSafeEqual 防时序攻击。\n· 会话：Cookie 里放随机 token，服务端只存它的 HMAC 摘要，即使数据库泄露也无法反推 token。\n· 前端：原生 HTML + CSS + JS，无框架无构建步骤。\n\n好处很直接：clone 下来双击 bat 就能跑，换机器不用担心 node_modules 编译失败。代价是有些轮子要自己写，比如 SMTP 的多行响应解析（第 4 个字符是空格才代表响应结束）这种细节。\n\n如果你打算二次开发，src/ 下按职责分了文件：db.js 数据层、smtp.js 发信、routes.js 接口、server.js 入口。欢迎在楼下补充你的方案。`,
  },
  {
    topic: 'qa', title: '提问的智慧：怎样发帖更容易得到回答',
    content: `发问之前，先把这几件事说清楚，回答质量会高很多：\n\n【标题】\n用一句话概括问题本身，而不是「急！在线等」「救命」。\n反例：程序报错了怎么办\n正例：Node 里 require('node:sqlite') 报 Cannot find module，v20 该怎么处理\n\n【正文】\n1. 你想达成什么目标（不只是你尝试的手段）。\n2. 你已经试过哪些方法，结果分别是什么。\n3. 完整的报错信息或截图，别只贴最后一行。\n4. 环境信息：操作系统、版本号、相关配置。\n\n【心态】\n· 没人有义务回答你，把问题描述清楚是对回答者最基本的尊重。\n· 得到答案后回来补一句「已解决，原因是……」，这份帖子就成了后来人的资料。\n\n版务提醒：同一问题不要在多个话题重复发帖，选最贴近的一个话题发一次就好。`,
  },
  {
    topic: 'life', title: '开个长期帖：记录你今天的三件小事',
    content: `规则很简单，每天来楼下回复三条：\n\n1. 今天吃到的好东西\n2. 今天做完的一件正事\n3. 今天让你笑了一下的瞬间\n\n不用写得多漂亮，一句话就行。这个帖的意义不在于内容本身，而在于「回头翻」——三个月后你往上翻几十页，会发现自己其实过得挺具体的。\n\n我先来：\n1. 楼下便利店的关东煮，萝卜炖得刚好。\n2. 把拖了两周的数据库备份脚本写完了。\n3. 遛狗时被一只柯基主动碰了碰手。`,
  },
  {
    topic: 'career', title: '面试被问「你有什么想问我们的」，到底该问什么',
    content: `这一问不是客套，是真在考察你。分享几个我觉得值得问的方向：\n\n【问团队与工作方式】\n· 这个岗位入职后前三个月，最重要的一件事是什么？\n· 团队现在最大的技术债或者流程痛点是什么？\n· 代码评审 / 需求评审是怎么走的？\n\n【问成长】\n· 团队里做得最好的人，通常具备什么共同特质？\n· 有没有内部的技术分享或轮岗机制？\n\n【问现实】\n· 加班的真实情况（问「最近一个月大概几点下班」比问「加不加班」有用得多）。\n· 试用期的考核标准具体是什么。\n\n【别问的】\n· 官网首页就能查到的公司信息。\n· 一面就问薪资结构细节和调薪频率（放到 HR 面或 offer 沟通阶段）。\n\n核心逻辑：你问的问题，暴露了你平时在想什么。欢迎楼下补充你的高频问题。`,
  },
];

function seed() {
  // 话题
  if (Number(db.prepare('SELECT COUNT(*) AS n FROM topics').get().n) === 0) {
    const stmt = db.prepare('INSERT INTO topics (slug, name, description, icon, color, sort_order) VALUES (?, ?, ?, ?, ?, ?)');
    for (const t of DEFAULT_TOPICS) stmt.run(t.slug, t.name, t.description, t.icon, t.color, t.sort);
  }

  // 广告位
  if (Number(db.prepare('SELECT COUNT(*) AS n FROM ads').get().n) === 0) {
    const stmt = db.prepare(`INSERT INTO ads
      (slot_key, slot_name, position, advertiser, title, subtitle, price, sort_order, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const a of DEFAULT_ADS) stmt.run(a.slot_key, a.slot_name, a.position, a.advertiser, a.title, a.subtitle, a.price, a.sort_order, nowIso());
  }

  // 系统账号 + 示例帖子（只在完全空库时执行一次）
  if (Number(db.prepare('SELECT COUNT(*) AS n FROM posts').get().n) === 0) {
    let sys = db.prepare('SELECT * FROM users WHERE is_system = 1').get();
    if (!sys) {
      sys = createUser({
        email: 'system@forum.local',
        nickname: '社区小助手',
        password: randomToken(24), // 随机且不可知，该账号无法被登录
        role: 'admin',
        isSystem: 1,
        bio: '官方账号，负责发布站务公告。',
      });
    }
    for (const p of SEED_POSTS) {
      const topic = findTopic(p.topic);
      if (!topic) continue;
      const t = nowIso();
      db.prepare(`INSERT INTO posts (user_id, topic_id, title, content, is_top, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(sys.id, topic.id, p.title, p.content, p.top ? 1 : 0, t, t);
      refreshTopicCount(topic.id);
    }
    db.prepare('UPDATE users SET post_count = ? WHERE id = ?')
      .run(SEED_POSTS.length, sys.id);
  }
}

seed();
purgeOldLogs();

module.exports = {
  ROOT, DATA_DIR, UPLOAD_DIR, DB_PATH,
  nowIso, hashPassword, verifyPassword, hashToken, randomToken, pickAvatarColor, normalizeEmail,
  countInWindow, recordHit, purgeOldLogs,
  findUserByEmail, findUserByNickname, findUserById, createUser, updateUserPassword,
  updateUserBio, setUserStatus,
  touchLogin, bumpCounter, publicUser, listUsers, countUsers, getPublicProfile,
  createSession, getSession, destroySession, destroyUserSessions,
  createCode, verifyCode, latestCodeTime, logMail, recentMailLog,
  listTopics, findTopic, refreshTopicCount,
  listPosts, findPost, getPostDetail, createPost, updatePost, deletePost, increaseViews,
  listReplies, createReply, deleteReply, toggleLike,
  findReplyRow, getLikeCount, listLikedIds,
  listAds, updateAd, recordAdClick, recordAdImpressions,
  siteStats, hotPosts, latestUsers,
  recordUpload, listUploads, getSetting, setSetting,
};

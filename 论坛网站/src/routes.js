'use strict';

/**
 * HTTP 接口层：路由、参数校验、鉴权、验证码下发、广告点击、文件上传
 * 只依赖 Node 内置模块。
 */

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const store = require('./db.js');
const { sendMail, buildCodeMail } = require('./smtp.js');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.md': 'text/markdown; charset=utf-8',
};

const COOKIE_NAME = 'forum_sid';

/* ------------------------------------------------------------------ */
/* 通用响应与解析                                                      */
/* ------------------------------------------------------------------ */

function json(res, status, payload, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  }, extraHeaders));
  res.end(body);
}

const ok = (res, data = {}, extra) => json(res, 200, Object.assign({ ok: true }, data), extra);
const fail = (res, message, status = 400, code = 'BAD_REQUEST') =>
  json(res, status, { ok: false, error: message, code });

async function readBody(req, limitBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(Object.assign(new Error('请求体过大'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req, limitBytes = 512 * 1024) {
  const buf = await readBody(req, limitBytes);
  if (!buf.length) return {};
  try {
    const parsed = JSON.parse(buf.toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch (_) {
    throw Object.assign(new Error('请求格式不是合法 JSON'), { status: 400 });
  }
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 1) continue;
    const k = part.slice(0, idx).trim();
    let v = part.slice(idx + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    out[k] = decodeURIComponent(v);
  }
  return out;
}

function sessionCookie(token, maxAgeSeconds) {
  const parts = [`${COOKIE_NAME}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  parts.push(maxAgeSeconds > 0 ? `Max-Age=${maxAgeSeconds}` : 'Max-Age=0');
  return parts.join('; ');
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim().slice(0, 45);
  return (req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : '').slice(0, 45);
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 生成 6 位纯数字验证码（避免 0/O、1/l 混淆） */
function makeCode(len = 6) {
  const digits = '23456789';
  let out = '';
  const bytes = crypto.randomBytes(len * 2);
  for (let i = 0; i < len; i++) out += digits[bytes[i] % digits.length];
  return out;
}

const isEmail = (v) => /^[^\s@,;:<>()[\]\\]+@[^\s@.,;:<>()[\]\\]+(\.[^\s@.,;:<>()[\]\\]+)+$/.test(String(v || '').trim());

function validateNickname(name, min, max) {
  const lo = Number.isFinite(Number(min)) ? Number(min) : 2;
  const hi = Number.isFinite(Number(max)) ? Number(max) : 20;
  const n = String(name || '').trim();
  if (n.length < lo || n.length > hi) return `昵称长度需在 ${lo}～${hi} 个字符之间`;
  if (/[\u0000-\u001f<>"/\\`]/.test(n)) return '昵称不能包含 < > " / \\ 等字符';
  if (/^(admin|root|system|管理员|站长)$/i.test(n)) return '该昵称为系统保留，请换一个';
  return null;
}

function validatePassword(pw, min) {
  const p = String(pw || '');
  if (p.length < min) return `密码至少 ${min} 位`;
  if (p.length > 72) return '密码过长（最多 72 位）';
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) return '密码需同时包含字母和数字';
  if (/\s/.test(p)) return '密码不能包含空格';
  return null;
}

function currentUser(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return null;
  return store.getSession(token);
}

function requireUser(req, res) {
  const sess = currentUser(req);
  if (!sess) {
    fail(res, '请先登录后再操作', 401, 'UNAUTHORIZED');
    return null;
  }
  return sess;
}

/* ------------------------------------------------------------------ */
/* 验证码下发                                                          */
/* ------------------------------------------------------------------ */

let CONFIG = null;
function setConfig(cfg) { CONFIG = cfg; }

function smtpConfigured() {
  const s = CONFIG && CONFIG.smtp;
  if (!s || s.enabled === false) return false;
  if (!s.user || !s.pass) return false;
  if (/your_qq_number|在这里粘贴/.test(`${s.user}${s.pass}`)) return false;
  return isEmail(s.user);
}

async function sendVerificationCode(res, { email, purpose, cfg, ip }) {
  const sec = cfg.security || {};
  const emailLower = store.normalizeEmail(email);

  const last = store.latestCodeTime(emailLower, purpose);
  const interval = Number(sec.codeResendIntervalSeconds || 60);
  if (last && Date.now() - last < interval * 1000) {
    const wait = Math.ceil((interval * 1000 - (Date.now() - last)) / 1000);
    return fail(res, `发送太频繁，请 ${wait} 秒后再试`, 429, 'RATE_LIMITED');
  }

  const perEmail = store.countInWindow('code_email', emailLower, 3600);
  if (perEmail >= Number(sec.maxCodesPerHourPerEmail || 5)) {
    return fail(res, '该邮箱本小时获取验证码次数已达上限，请一小时后再试', 429, 'RATE_LIMITED');
  }
  const perIp = store.countInWindow('code_ip', ip, 3600);
  if (perIp >= Number(sec.maxCodesPerHourPerIp || 20)) {
    return fail(res, '当前网络获取验证码次数过多，请稍后再试', 429, 'RATE_LIMITED');
  }

  const code = makeCode(Number(sec.codeLength || 6));
  const ttl = Number(sec.codeTtlMinutes || 10);
  store.createCode(emailLower, code, purpose, ip, ttl);
  store.recordHit('code_email', emailLower);
  store.recordHit('code_ip', ip);

  const mail = buildCodeMail((cfg.site && cfg.site.name) || '论坛', code, ttl);
  const siteName = (cfg.site && cfg.site.name) || '论坛';
  // 真实邮件标题带验证码，便于用户在收件箱一眼看到；日志标题脱敏，避免验证码明文落库
  const subject = `【${siteName}】你的验证码是 ${code}`;
  const logSubject = `【${siteName}】邮箱验证码（${purpose === 'login' ? '登录' : '注册'}）`;

  // 开发模式：SMTP 未配置时把验证码输出到服务端控制台与日志文件，保证流程可测
  if (!smtpConfigured() || CONFIG.smtp.enabled === false) {
    if (sec.devModeFallback === false) {
      store.logMail(emailLower, logSubject, purpose, 'skipped', 'SMTP 未配置且已关闭开发回退', '');
      return fail(res, '邮件服务尚未配置，请联系站长在 config.json 填入 QQ 邮箱授权码', 503, 'SMTP_NOT_CONFIGURED');
    }
    const line = `[${new Date().toISOString()}] 开发模式验证码 → ${emailLower} : ${code}（${ttl} 分钟内有效）\n`;
    console.log('\n  ┌─ 开发模式（SMTP 未配置，验证码不发真实邮件）');
    console.log(`  │  收件邮箱：${emailLower}`);
    console.log(`  │  验证码  ：${code}`);
    console.log(`  │  有效期  ：${ttl} 分钟\n  └───────────────────────────────────────\n`);
    try { fs.appendFileSync(path.join(store.DATA_DIR, 'dev-codes.log'), line); } catch (_) { /* 忽略 */ }
    store.logMail(emailLower, logSubject, purpose, 'dev', '开发模式，未真实发信', '');
    return ok(res, {
      devMode: true,
      devCode: sec.devModeFallback === true ? code : undefined,
      message: 'SMTP 未配置，验证码已输出到服务端控制台',
      expiresIn: ttl * 60,
    });
  }

  try {
    const result = await sendMail(CONFIG.smtp, { to: emailLower, subject, html: mail.html, text: mail.text });
    store.logMail(emailLower, logSubject, purpose, 'sent', '', result.messageId);
    console.log(`[mail] 验证码已发送至 ${emailLower}`);
    return ok(res, { devMode: false, message: '验证码已发送，请查收邮箱（含垃圾箱）', expiresIn: ttl * 60 });
  } catch (e) {
    store.logMail(emailLower, logSubject, purpose, 'failed', e.message, '');
    console.error(`[mail] 发信失败：${e.message}`);
    if (sec.devModeFallback === true) {
      const line = `[${new Date().toISOString()}] 发信失败回退 → ${emailLower} : ${code}（原因：${e.message}）\n`;
      console.log(`\n  [发信失败，已回退开发模式] 验证码：${code}\n  原因：${e.message}\n`);
      try { fs.appendFileSync(path.join(store.DATA_DIR, 'dev-codes.log'), line); } catch (_) { /* 忽略 */ }
      return ok(res, {
        devMode: true,
        devCode: code,
        message: `邮件发送失败（${e.message}），已回退为控制台输出验证码`,
        expiresIn: ttl * 60,
      });
    }
    return fail(res, `验证码发送失败：${e.message}`, 502, 'SMTP_FAILED');
  }
}

/* ------------------------------------------------------------------ */
/* 接口处理                                                            */
/* ------------------------------------------------------------------ */

async function handleApi(req, res, url, cfg) {
  const route = url.pathname;
  const method = req.method;
  const ip = clientIp(req);

  /* ---------- 站点元信息 ---------- */
  if (route === '/api/bootstrap' && method === 'GET') {
    const sess = currentUser(req);
    store.recordAdImpressions(store.listAds({ enabledOnly: true }).map((a) => a.slotKey));
    return ok(res, {
      site: cfg.site,
      smtpConfigured: smtpConfigured(),
      devMode: !smtpConfigured() && cfg.security.devModeFallback !== false,
      topics: store.listTopics(),
      ads: store.listAds({ enabledOnly: true }),
      stats: store.siteStats(),
      hotPosts: store.hotPosts(6),
      latestUsers: store.latestUsers(6).map((u) => ({ id: u.id, nickname: u.nickname, avatarColor: u.avatarColor, createdAt: u.createdAt })),
      me: sess ? store.publicUser(sess.user) : null,
      limits: {
        passwordMinLength: cfg.security.passwordMinLength,
        nicknameMinLength: cfg.security.nicknameMinLength,
        nicknameMaxLength: cfg.security.nicknameMaxLength,
      },
    });
  }

  /* ---------- 发送验证码 ---------- */
  if (route === '/api/auth/send-code' && method === 'POST') {
    const body = await readJson(req);
    const email = String(body.email || '').trim();
    const purpose = body.purpose === 'login' ? 'login' : 'register';
    if (!isEmail(email)) return fail(res, '邮箱格式不正确，请检查后重试');

    if (purpose === 'register' && store.findUserByEmail(email)) {
      return fail(res, '该邮箱已注册，请直接登录；若忘记密码可用验证码登录', 409, 'EMAIL_EXISTS');
    }
    if (purpose === 'login' && !store.findUserByEmail(email)) {
      return fail(res, '该邮箱尚未注册，请先注册', 404, 'EMAIL_NOT_FOUND');
    }
    return sendVerificationCode(res, { email, purpose, cfg, ip });
  }

  /* ---------- 注册 ---------- */
  if (route === '/api/auth/register' && method === 'POST') {
    const body = await readJson(req);
    const email = String(body.email || '').trim();
    const code = String(body.code || '').trim();
    const nickname = String(body.nickname || '').trim();
    const password = String(body.password || '');

    if (!isEmail(email)) return fail(res, '邮箱格式不正确');
    if (!/^\d{4,8}$/.test(code)) return fail(res, '请输入收到的数字验证码');

    const nickErr = validateNickname(nickname, cfg.security.nicknameMinLength, cfg.security.nicknameMaxLength);
    if (nickErr) return fail(res, nickErr);
    const pwErr = validatePassword(password, cfg.security.passwordMinLength);
    if (pwErr) return fail(res, pwErr);

    if (store.findUserByEmail(email)) return fail(res, '该邮箱已注册，请直接登录', 409, 'EMAIL_EXISTS');
    if (store.findUserByNickname(nickname)) return fail(res, '该昵称已被占用，换一个试试', 409, 'NICKNAME_EXISTS');

    const verify = store.verifyCode(email, 'register', code);
    if (!verify.ok) return fail(res, verify.reason, 400, 'CODE_INVALID');

    const user = store.createUser({ email, nickname, password });
    store.touchLogin(user.id);
    const sess = store.createSession(user.id, ip, req.headers['user-agent'], cfg.security.sessionTtlDays);

    return ok(res, { user: store.publicUser(user), message: '注册成功，已自动登录' }, {
      'Set-Cookie': sessionCookie(sess.rawToken, cfg.security.sessionTtlDays * 86400),
    });
  }

  /* ---------- 密码登录 ---------- */
  if (route === '/api/auth/login' && method === 'POST') {
    const body = await readJson(req);
    const email = String(body.email || '').trim();
    const password = String(body.password || '');
    if (!isEmail(email)) return fail(res, '邮箱格式不正确');
    if (!password) return fail(res, '请输入密码');

    const key = `${store.normalizeEmail(email)}|${ip}`;
    if (store.countInWindow('login_fail', key, 3600) >= Number(cfg.security.loginMaxFailPerHour || 10)) {
      return fail(res, '登录失败次数过多，请一小时后再试，或用邮箱验证码登录', 429, 'RATE_LIMITED');
    }

    const user = store.findUserByEmail(email);
    if (!user || user.is_system === 1 || !store.verifyPassword(password, user.pass_salt, user.pass_hash)) {
      store.recordHit('login_fail', key);
      return fail(res, '邮箱或密码不正确', 401, 'BAD_CREDENTIALS');
    }
    if (user.status !== 'active') return fail(res, '该账号已被停用，请联系站长', 403, 'DISABLED');

    store.touchLogin(user.id);
    const sess = store.createSession(user.id, ip, req.headers['user-agent'], cfg.security.sessionTtlDays);
    return ok(res, { user: store.publicUser(user), message: `欢迎回来，${user.nickname}` }, {
      'Set-Cookie': sessionCookie(sess.rawToken, cfg.security.sessionTtlDays * 86400),
    });
  }

  /* ---------- 验证码免密登录 ---------- */
  if (route === '/api/auth/login-by-code' && method === 'POST') {
    const body = await readJson(req);
    const email = String(body.email || '').trim();
    const code = String(body.code || '').trim();
    if (!isEmail(email)) return fail(res, '邮箱格式不正确');
    if (!/^\d{4,8}$/.test(code)) return fail(res, '请输入收到的数字验证码');

    const user = store.findUserByEmail(email);
    if (!user) return fail(res, '该邮箱尚未注册', 404, 'EMAIL_NOT_FOUND');
    const verify = store.verifyCode(email, 'login', code);
    if (!verify.ok) return fail(res, verify.reason, 400, 'CODE_INVALID');

    store.touchLogin(user.id);
    const sess = store.createSession(user.id, ip, req.headers['user-agent'], cfg.security.sessionTtlDays);
    return ok(res, { user: store.publicUser(user), message: `欢迎回来，${user.nickname}` }, {
      'Set-Cookie': sessionCookie(sess.rawToken, cfg.security.sessionTtlDays * 86400),
    });
  }

  /* ---------- 退出 ---------- */
  if (route === '/api/auth/logout' && method === 'POST') {
    const token = parseCookies(req)[COOKIE_NAME];
    store.destroySession(token);
    return ok(res, { message: '已退出登录' }, { 'Set-Cookie': sessionCookie('', 0) });
  }

  /* ---------- 当前用户 ---------- */
  if (route === '/api/me' && method === 'GET') {
    const sess = requireUser(req, res);
    if (!sess) return;
    return ok(res, { user: store.publicUser(sess.user) });
  }

  if (route === '/api/me/profile' && method === 'POST') {
    const sess = requireUser(req, res);
    if (!sess) return;
    const body = await readJson(req);
    const bio = String(body.bio || '').slice(0, 200);
    store.updateUserBio(sess.user.id, bio);
    return ok(res, { user: store.publicUser(store.findUserById(sess.user.id)), message: '资料已更新' });
  }

  if (route === '/api/me/password' && method === 'POST') {
    const sess = requireUser(req, res);
    if (!sess) return;
    const body = await readJson(req);
    const oldPassword = String(body.oldPassword || '');
    const newPassword = String(body.newPassword || '');
    if (!store.verifyPassword(oldPassword, sess.user.pass_salt, sess.user.pass_hash)) {
      return fail(res, '当前密码不正确', 401, 'BAD_CREDENTIALS');
    }
    const err = validatePassword(newPassword, cfg.security.passwordMinLength);
    if (err) return fail(res, err);
    store.updateUserPassword(sess.user.id, newPassword);
    store.destroyUserSessions(sess.user.id);
    const newSess = store.createSession(sess.user.id, ip, req.headers['user-agent'], cfg.security.sessionTtlDays);
    return ok(res, { message: '密码已修改，其他设备的登录已失效' }, {
      'Set-Cookie': sessionCookie(newSess.rawToken, cfg.security.sessionTtlDays * 86400),
    });
  }

  /* ---------- 话题 ---------- */
  if (route === '/api/topics' && method === 'GET') {
    return ok(res, { topics: store.listTopics() });
  }

  /* ---------- 公开用户资料（不含邮箱等隐私字段） ---------- */
  const profileMatch = route.match(/^\/api\/users\/(\d+)$/);
  if (profileMatch && method === 'GET') {
    const uid = parseInt(profileMatch[1], 10);
    if (!uid) return fail(res, '用户不存在', 404, 'USER_NOT_FOUND');
    const profile = store.getPublicProfile(uid);
    if (!profile) return fail(res, '用户不存在或已注销', 404, 'USER_NOT_FOUND');
    return ok(res, { user: profile });
  }

  /* ---------- 帖子列表（话题筛选 / 搜索 / 排序 / 分页） ---------- */
  if (route === '/api/posts' && method === 'GET') {
    const q = url.searchParams;
    const topicRaw = q.get('topic');
    let topicId = null;
    if (topicRaw && topicRaw !== 'all') {
      const t = store.findTopic(topicRaw);
      if (!t) return fail(res, '话题不存在', 404, 'TOPIC_NOT_FOUND');
      topicId = t.id;
    }
    const sort = ['new', 'hot', 'replied'].includes(q.get('sort')) ? q.get('sort') : 'new';
    const page = Math.max(1, parseInt(q.get('page') || '1', 10) || 1);
    const pageSize = Math.min(50, Math.max(5, parseInt(q.get('pageSize') || '10', 10) || 10));
    const keyword = (q.get('q') || '').trim().slice(0, 60);
    const authorId = q.get('author') ? parseInt(q.get('author'), 10) : null;
    const sess = currentUser(req);

    const result = store.listPosts({
      topicId, keyword, sort, page, pageSize,
      userId: authorId || null,
    });
    // 标记当前用户是否点赞过
    if (sess) {
      const likedSet = store.listLikedIds(sess.user.id, 'post');
      result.items = result.items.map((it) => Object.assign({}, it, { liked: likedSet.has(it.id) }));
    }
    return ok(res, Object.assign({ keyword, sort }, result));
  }

  /* ---------- 发帖 ---------- */
  if (route === '/api/posts' && method === 'POST') {
    const sess = requireUser(req, res);
    if (!sess) return;
    const body = await readJson(req);
    const title = String(body.title || '').trim();
    const content = String(body.content || '').trim();
    const topicId = parseInt(body.topicId, 10);

    if (title.length < 4) return fail(res, '标题至少 4 个字');
    if (title.length > cfg.limits.postTitleMaxLength) return fail(res, `标题最多 ${cfg.limits.postTitleMaxLength} 个字`);
    if (content.length < 10) return fail(res, '正文至少 10 个字，多写一点更容易得到回复');
    if (content.length > cfg.limits.postContentMaxLength) return fail(res, `正文最多 ${cfg.limits.postContentMaxLength} 字`);
    const topic = store.findTopic(topicId);
    if (!topic) return fail(res, '请选择一个话题分类');

    const perHour = store.countInWindow('post_user', String(sess.user.id), 3600);
    if (perHour >= Number(cfg.limits.postsPerHourPerUser || 20)) {
      return fail(res, '发帖太频繁，请一小时后再试', 429, 'RATE_LIMITED');
    }
    store.recordHit('post_user', String(sess.user.id));

    const post = store.createPost({ userId: sess.user.id, topicId: topic.id, title, content });
    const detail = store.getPostDetail(post.id, sess.user.id);
    return json(res, 201, { ok: true, post: detail, message: '发布成功' });
  }

  /* ---------- 帖子详情 ---------- */
  const postMatch = route.match(/^\/api\/posts\/(\d+)$/);
  if (postMatch && method === 'GET') {
    const id = parseInt(postMatch[1], 10);
    const sess = currentUser(req);
    const detail = store.getPostDetail(id, sess ? sess.user.id : null);
    if (!detail) return fail(res, '帖子不存在或已被删除', 404, 'POST_NOT_FOUND');
    // 简单浏览量防刷：同一会话 30 秒内不重复计数
    const bucket = `view_${id}`;
    const key = sess ? `u${sess.user.id}` : `ip${ip}`;
    if (store.countInWindow(bucket, key, 30) === 0) {
      store.recordHit(bucket, key);
      store.increaseViews(id);
      detail.views += 1;
    }
    return ok(res, { post: detail });
  }

  if (postMatch && method === 'PUT') {
    const id = parseInt(postMatch[1], 10);
    const sess = requireUser(req, res);
    if (!sess) return;
    const post = store.findPost(id);
    if (!post) return fail(res, '帖子不存在', 404, 'POST_NOT_FOUND');
    if (post.user_id !== sess.user.id && sess.user.role !== 'admin') {
      return fail(res, '只能编辑自己发布的帖子', 403, 'FORBIDDEN');
    }
    const body = await readJson(req);
    const title = String(body.title || post.title).trim();
    const content = String(body.content || post.content).trim();
    const topicId = parseInt(body.topicId, 10) || post.topic_id;
    if (title.length < 4 || title.length > cfg.limits.postTitleMaxLength) return fail(res, '标题长度需在 4～80 字之间');
    if (content.length < 10 || content.length > cfg.limits.postContentMaxLength) return fail(res, '正文长度不合法');
    if (!store.findTopic(topicId)) return fail(res, '话题分类不存在');
    store.updatePost(id, { title, content, topicId });
    return ok(res, { post: store.getPostDetail(id, sess.user.id), message: '已保存修改' });
  }

  if (postMatch && method === 'DELETE') {
    const id = parseInt(postMatch[1], 10);
    const sess = requireUser(req, res);
    if (!sess) return;
    const post = store.findPost(id);
    if (!post) return fail(res, '帖子不存在', 404, 'POST_NOT_FOUND');
    if (post.user_id !== sess.user.id && sess.user.role !== 'admin') {
      return fail(res, '只能删除自己发布的帖子', 403, 'FORBIDDEN');
    }
    store.deletePost(id);
    return ok(res, { message: '帖子已删除' });
  }

  /* ---------- 回复 ---------- */
  const replyListMatch = route.match(/^\/api\/posts\/(\d+)\/replies$/);
  if (replyListMatch && method === 'POST') {
    const postId = parseInt(replyListMatch[1], 10);
    const sess = requireUser(req, res);
    if (!sess) return;
    const post = store.findPost(postId);
    if (!post) return fail(res, '帖子不存在', 404, 'POST_NOT_FOUND');

    const body = await readJson(req);
    const content = String(body.content || '').trim();
    if (content.length < 1) return fail(res, '回复内容不能为空');
    if (content.length > cfg.limits.replyContentMaxLength) return fail(res, `回复最多 ${cfg.limits.replyContentMaxLength} 字`);

    const perHour = store.countInWindow('reply_user', String(sess.user.id), 3600);
    if (perHour >= Number(cfg.limits.repliesPerHourPerUser || 60)) {
      return fail(res, '回复太频繁，请稍后再试', 429, 'RATE_LIMITED');
    }
    store.recordHit('reply_user', String(sess.user.id));

    const reply = store.createReply({ postId, userId: sess.user.id, content });
    return json(res, 201, {
      ok: true,
      reply: {
        id: reply.id, content: reply.content, likeCount: 0, createdAt: reply.created_at,
        author: { id: sess.user.id, nickname: sess.user.nickname, avatarColor: sess.user.avatar_color, role: sess.user.role },
        liked: false,
      },
      replyCount: (store.findPost(postId) || {}).reply_count,
      message: '回复成功',
    });
  }

  const replyMatch = route.match(/^\/api\/replies\/(\d+)$/);
  if (replyMatch && method === 'DELETE') {
    const id = parseInt(replyMatch[1], 10);
    const sess = requireUser(req, res);
    if (!sess) return;
    const target = store.findReplyRow(id);
    if (!target) return fail(res, '回复不存在', 404, 'REPLY_NOT_FOUND');
    if (target.user_id !== sess.user.id && sess.user.role !== 'admin') {
      return fail(res, '只能删除自己的回复', 403, 'FORBIDDEN');
    }
    store.deleteReply(id);
    return ok(res, { message: '回复已删除' });
  }

  /* ---------- 点赞 ---------- */
  if (route === '/api/like' && method === 'POST') {
    const sess = requireUser(req, res);
    if (!sess) return;
    const body = await readJson(req);
    const targetType = body.targetType === 'reply' ? 'reply' : 'post';
    const targetId = parseInt(body.targetId, 10);
    if (!targetId) return fail(res, '缺少点赞目标');
    const r = store.toggleLike(sess.user.id, targetType, targetId);
    if (!r.ok) return fail(res, r.reason, 404, 'TARGET_NOT_FOUND');
    const count = store.getLikeCount(targetType, targetId);
    return ok(res, { liked: r.liked, likeCount: count });
  }

  /* ---------- 广告招商位 ---------- */
  if (route === '/api/ads' && method === 'GET') {
    return ok(res, { ads: store.listAds({ enabledOnly: true }) });
  }

  const adMatch = route.match(/^\/api\/ads\/([a-z_]+)\/click$/);
  if (adMatch && method === 'POST') {
    const slotKey = adMatch[1];
    const ads = store.listAds({ enabledOnly: true });
    const ad = ads.find((a) => a.slotKey === slotKey);
    if (!ad) return fail(res, '广告位不存在', 404, 'AD_NOT_FOUND');
    store.recordAdClick(ad.id, slotKey, ip, req.headers['user-agent']);
    // 微信名片：优先用广告位单独配置的图，其次全局配置，最后回退内置占位图
    const globalAds = cfg.ads || {};
    const image = ad.wechatImage || globalAds.wechatImage || '/assets/wechat-card.svg';
    return ok(res, {
      card: {
        slotKey: ad.slotKey,
        slotName: ad.slotName,
        advertiser: ad.advertiser,
        title: ad.title,
        subtitle: ad.subtitle,
        price: ad.price,
        wechatId: ad.wechatId || globalAds.wechatId || '未设置',
        wechatImage: image,
        note: ad.note || globalAds.contactNote || '',
      },
    });
  }

  /* ---------- 图片上传（用于替换微信名片图等） ---------- */
  if (route === '/api/upload' && method === 'POST') {
    const sess = requireUser(req, res);
    if (!sess) return;
    const maxBytes = Number(cfg.limits.uploadMaxBytes || 5 * 1024 * 1024);
    let buf;
    try {
      buf = await readBody(req, maxBytes + 1024 * 1024);
    } catch (e) {
      return fail(res, `文件超过大小限制（最大 ${Math.round(maxBytes / 1024 / 1024)} MB）`, 413, 'TOO_LARGE');
    }
    if (buf.length > maxBytes) {
      return fail(res, `文件超过大小限制（最大 ${Math.round(maxBytes / 1024 / 1024)} MB）`, 413, 'TOO_LARGE');
    }
    let originalName = String(req.headers['x-filename'] || 'upload.png');
    try { originalName = decodeURIComponent(originalName); } catch (_) { /* 保持原值 */ }
    originalName = path.basename(originalName).slice(0, 120);
    const ext = path.extname(originalName).toLowerCase();
    if (!cfg.limits.uploadAllowedExtensions.includes(ext)) {
      return fail(res, `仅支持 ${cfg.limits.uploadAllowedExtensions.join(' / ')} 格式`);
    }
    const storedName = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`;
    try {
      fs.writeFileSync(path.join(store.UPLOAD_DIR, storedName), buf);
    } catch (e) {
      return fail(res, `保存文件失败：${e.message}`, 500, 'WRITE_FAILED');
    }
    store.recordUpload({ userId: sess.user.id, filename: originalName, storedName, mime: MIME[ext] || '', size: buf.length });
    return ok(res, { url: `/uploads/${storedName}`, filename: originalName, size: buf.length, message: '上传成功' });
  }

  /* ---------- 管理（仅站长） ---------- */
  if (route === '/api/admin/overview' && method === 'GET') {
    const sess = requireUser(req, res);
    if (!sess) return;
    if (sess.user.role !== 'admin') return fail(res, '需要站长权限', 403, 'FORBIDDEN');
    return ok(res, {
      stats: store.siteStats(),
      ads: store.listAds(),
      users: store.listUsers(50),
      mailLog: store.recentMailLog(20),
      uploads: store.listUploads(30),
      smtpConfigured: smtpConfigured(),
    });
  }

  const adUpdateMatch = route.match(/^\/api\/admin\/ads\/(\d+)$/);
  if (adUpdateMatch && method === 'PUT') {
    const sess = requireUser(req, res);
    if (!sess) return;
    if (sess.user.role !== 'admin') return fail(res, '需要站长权限', 403, 'FORBIDDEN');
    const body = await readJson(req);
    const updated = store.updateAd(parseInt(adUpdateMatch[1], 10), body);
    if (!updated) return fail(res, '广告位不存在或没有可更新字段', 404, 'AD_NOT_FOUND');
    return ok(res, { ads: store.listAds(), message: '广告位已更新' });
  }

  const userMatch = route.match(/^\/api\/admin\/users\/(\d+)\/status$/);
  if (userMatch && method === 'POST') {
    const sess = requireUser(req, res);
    if (!sess) return;
    if (sess.user.role !== 'admin') return fail(res, '需要站长权限', 403, 'FORBIDDEN');
    const body = await readJson(req);
    const status = body.status === 'banned' ? 'banned' : 'active';
    store.setUserStatus(parseInt(userMatch[1], 10), status);
    if (status === 'banned') store.destroyUserSessions(parseInt(userMatch[1], 10));
    return ok(res, { users: store.listUsers(50), message: status === 'banned' ? '已封禁该账号' : '已恢复该账号' });
  }

  return fail(res, '接口不存在', 404, 'NOT_FOUND');
}

/* ------------------------------------------------------------------ */
/* 静态文件服务                                                        */
/* ------------------------------------------------------------------ */

function serveStatic(req, res, url, cfg) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';

  // 防目录穿越
  const publicRoot = path.join(store.ROOT, 'public');
  let filePath;
  if (rel.startsWith('/uploads/')) {
    const name = path.basename(rel);
    filePath = path.join(store.UPLOAD_DIR, name);
  } else {
    filePath = path.join(publicRoot, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!filePath.startsWith(publicRoot)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden');
      return true;
    }
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    // 前端单页路由回退
    const indexHtml = path.join(publicRoot, 'index.html');
    if (fs.existsSync(indexHtml) && !path.extname(rel)) {
      const buf = fs.readFileSync(indexHtml);
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Content-Length': buf.length });
      res.end(buf);
      return true;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return true;
  }

  const ext = path.extname(filePath).toLowerCase();
  const buf = fs.readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': buf.length,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(buf);
  return true;
}

module.exports = { handleApi, serveStatic, json, ok, fail, setConfig, escapeHtml, isEmail, COOKIE_NAME };

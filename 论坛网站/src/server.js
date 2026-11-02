'use strict';

/**
 * 服务入口：Node 内置 http，无任何第三方依赖
 * 启动：node src/server.js  或双击 启动论坛.bat
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const store = require('./db.js');
const routes = require('./routes.js');

/* ---------- 读取配置 ---------- */
const CONFIG_PATH = path.join(store.ROOT, 'config.json');
let CONFIG;
try {
  CONFIG = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch (e) {
  console.error(`[致命] 无法读取 config.json：${e.message}`);
  process.exit(1);
}

// 填充缺省值，避免用户删字段后崩溃
CONFIG.site = Object.assign({ name: '青柚社区', port: 3000, host: '127.0.0.1' }, CONFIG.site);
CONFIG.smtp = Object.assign({ enabled: true, host: 'smtp.qq.com', port: 465, secure: true, timeoutMs: 15000 }, CONFIG.smtp);
CONFIG.security = Object.assign({
  devModeFallback: true, codeLength: 6, codeTtlMinutes: 10, codeResendIntervalSeconds: 60,
  maxCodesPerHourPerEmail: 5, maxCodesPerHourPerIp: 20, sessionTtlDays: 7,
  passwordMinLength: 8, loginMaxFailPerHour: 10,
  nicknameMinLength: 2, nicknameMaxLength: 20,
}, CONFIG.security);

// 关键安全参数做下限保护：即使用户在 config.json 里填了非法值，也不会让校验失效
const num = (v, fallback, min, max) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};
CONFIG.security.nicknameMinLength = num(CONFIG.security.nicknameMinLength, 2, 1, 20);
CONFIG.security.nicknameMaxLength = num(CONFIG.security.nicknameMaxLength, 20, Math.max(2, CONFIG.security.nicknameMinLength), 40);
CONFIG.security.passwordMinLength = num(CONFIG.security.passwordMinLength, 8, 6, 72);
CONFIG.security.codeLength = num(CONFIG.security.codeLength, 6, 4, 8);
CONFIG.security.codeTtlMinutes = num(CONFIG.security.codeTtlMinutes, 10, 1, 60);
CONFIG.security.sessionTtlDays = num(CONFIG.security.sessionTtlDays, 7, 1, 90);
CONFIG.limits = Object.assign({
  postTitleMaxLength: 80, postContentMaxLength: 20000, replyContentMaxLength: 5000,
  nicknameMinLength: 2, nicknameMaxLength: 20, postsPerHourPerUser: 20, repliesPerHourPerUser: 60,
  uploadMaxBytes: 5242880, uploadAllowedExtensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'],
}, CONFIG.limits);
CONFIG.ads = Object.assign({ wechatId: '未设置', wechatImage: '', contactNote: '' }, CONFIG.ads);

routes.setConfig(CONFIG);

const PORT = Number(CONFIG.site.port || 3000);
const HOST = String(CONFIG.site.host || '127.0.0.1');

/* ---------- 请求分发 ---------- */
const server = http.createServer(async (req, res) => {
  const started = Date.now();
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch (_) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('400 Bad Request');
    return;
  }

  // 基础安全响应头
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');

  try {
    if (url.pathname.startsWith('/api/')) {
      await routes.handleApi(req, res, url, CONFIG);
    } else if (req.method === 'GET' || req.method === 'HEAD') {
      routes.serveStatic(req, res, url, CONFIG);
    } else {
      routes.fail(res, '不支持的请求方式', 405, 'METHOD_NOT_ALLOWED');
    }
  } catch (e) {
    const status = Number(e && e.status) || 500;
    console.error(`[error] ${req.method} ${url.pathname} → ${e.message}`);
    if (status === 500) console.error(e.stack);
    if (!res.headersSent) {
      routes.fail(res, status === 500 ? '服务器内部错误，详情见服务端控制台' : e.message, status, 'ERROR');
    } else {
      try { res.end(); } catch (_) { /* 忽略 */ }
    }
  }

  if (CONFIG.site.verboseLog !== false) {
    console.log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`);
  }
});

server.on('clientError', (err, socket) => {
  try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch (_) { /* 忽略 */ }
});

/* ---------- 优雅退出 ---------- */
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[info] 收到 ${signal}，正在关闭服务…`);
  server.close(() => {
    try { store.purgeOldLogs(); } catch (_) { /* 忽略 */ }
    console.log('[info] 已安全退出。数据库文件保留在 data/forum.db');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

/* ---------- 启动 ---------- */
server.listen(PORT, HOST, () => {
  const smtpReady = !(
    !CONFIG.smtp || CONFIG.smtp.enabled === false ||
    !CONFIG.smtp.user || !CONFIG.smtp.pass ||
    /your_qq_number|在这里粘贴/.test(`${CONFIG.smtp.user}${CONFIG.smtp.pass}`)
  );

  const line = '─'.repeat(58);
  console.log(`\n┌${line}┐`);
  console.log(`│  ${CONFIG.site.name} 已启动`.padEnd(59) + '│');
  console.log(`│  访问地址：http://${HOST}:${PORT}`.padEnd(52) + '│');
  console.log(`│  数据库  ：data/forum.db`.padEnd(53) + '│');
  console.log(`│  上传目录：data/uploads/`.padEnd(53) + '│');
  console.log(`│  邮件服务：${smtpReady ? '已配置 QQ 邮箱，将发送真实验证码邮件' : '未配置 → 开发模式（验证码打印在下方控制台）'}`.padEnd(smtpReady ? 41 : 33) + '│');
  console.log(`└${line}┘`);
  console.log('  按 Ctrl + C 停止服务\n');

  const stats = store.siteStats();
  console.log(`  当前数据：${stats.users} 位用户 / ${stats.posts} 篇帖子 / ${stats.replies} 条回复 / ${stats.topics} 个话题\n`);

  if (!smtpReady) {
    console.log('  提示：要开启真实邮箱验证，请编辑 config.json 的 smtp 段，');
    console.log('        填入 QQ 邮箱地址与【授权码】（在 mail.qq.com → 设置 → 账户 中生成），');
    console.log('        保存后重启本服务即可。\n');
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n[致命] 端口 ${PORT} 已被占用。`);
    console.error(`       解决办法一：关闭占用该端口的程序后重新启动。`);
    console.error(`       解决办法二：编辑 config.json，把 site.port 改成 3001 等其他端口。\n`);
  } else if (e.code === 'EACCES') {
    console.error(`\n[致命] 没有权限绑定 ${HOST}:${PORT}，请尝试 1024 以上的端口。\n`);
  } else {
    console.error(`\n[致命] 服务启动失败：${e.message}\n`);
  }
  process.exit(1);
});

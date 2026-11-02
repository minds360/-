'use strict';

/**
 * 极简 SMTP 客户端（零第三方依赖）
 * 使用 Node 内置 tls / net 直接完成 SMTP 会话，支持 SSL(465) 与 STARTTLS(587)。
 * 针对 QQ 邮箱 smtp.qq.com 做过适配，也可用于其他标准 SMTP 服务。
 */

const tls = require('node:tls');
const net = require('node:net');
const os = require('node:os');

class SmtpError extends Error {
  constructor(message, code, response) {
    super(message);
    this.name = 'SmtpError';
    this.code = code;
    this.response = response;
  }
}

/** 把邮件正文按 base64 编码并折行（每行 76 字符，符合 RFC 2045） */
function base64Fold(input) {
  const b64 = Buffer.from(input, 'utf8').toString('base64');
  return b64.replace(/.{1,76}/g, '$&\r\n').trimEnd();
}

/** 编码非 ASCII 的邮件头（RFC 2047 B 编码） */
function encodeHeader(value) {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return '=?UTF-8?B?' + Buffer.from(value, 'utf8').toString('base64') + '?=';
}

/** 点填充：DATA 阶段以 "." 开头的行需要额外加一个 "." */
function dotStuff(text) {
  return text.replace(/\r\n\./g, '\r\n..').replace(/^\./, '..');
}

/**
 * 判断一段 SMTP 响应是否已经接收完整。
 * 多行响应形如 "250-xxx\r\n250 yyy\r\n"，第 4 个字符为空格时表示最后一行。
 */
function responseComplete(buffer) {
  if (!buffer.endsWith('\r\n')) return false;
  const lines = buffer.slice(0, -2).split('\r\n');
  const last = lines[lines.length - 1];
  return last.length >= 4 && last[3] === ' ';
}

function responseCode(buffer) {
  const m = buffer.match(/^(\d{3})/);
  return m ? Number(m[1]) : 0;
}

/**
 * 发送一封邮件。
 * @param {object} cfg  config.json 中的 smtp 段
 * @param {object} mail { to, subject, html, text }
 * @returns {Promise<{ok:boolean, messageId:string, transcript:string}>}
 */
function sendMail(cfg, mail) {
  return new Promise((resolve, reject) => {
    if (!cfg || !cfg.user || !cfg.pass || /在这里粘贴/.test(String(cfg.pass))) {
      reject(new SmtpError('SMTP 未配置：请在 config.json 的 smtp.user / smtp.pass 填入 QQ 邮箱与授权码', 'NOT_CONFIGURED'));
      return;
    }
    if (!mail || !mail.to) {
      reject(new SmtpError('缺少收件人', 'BAD_ARGS'));
      return;
    }

    const host = cfg.host || 'smtp.qq.com';
    const port = Number(cfg.port || 465);
    const useSsl = cfg.secure !== false && port === 465;
    const timeoutMs = Number(cfg.timeoutMs || 15000);
    const fromName = cfg.fromName || cfg.user;

    const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2, 10)}@${host.replace(/^smtp\./, '')}>`;

    // ---- 组装邮件原文 ----
    const boundary = '----=_ForumPart_' + Math.random().toString(36).slice(2, 14);
    const headers = [
      `From: ${encodeHeader(fromName)} <${cfg.user}>`,
      `To: <${mail.to}>`,
      `Subject: ${encodeHeader(mail.subject || '')}`,
      `Message-ID: ${messageId}`,
      `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
      'MIME-Version: 1.0',
    ];

    let raw;
    if (mail.html && mail.text) {
      headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
      raw =
        headers.join('\r\n') +
        '\r\n\r\n' +
        `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64Fold(mail.text)}\r\n` +
        `--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64Fold(mail.html)}\r\n` +
        `--${boundary}--\r\n`;
    } else if (mail.html) {
      headers.push('Content-Type: text/html; charset=UTF-8');
      headers.push('Content-Transfer-Encoding: base64');
      raw = headers.join('\r\n') + '\r\n\r\n' + base64Fold(mail.html) + '\r\n';
    } else {
      headers.push('Content-Type: text/plain; charset=UTF-8');
      headers.push('Content-Transfer-Encoding: base64');
      raw = headers.join('\r\n') + '\r\n\r\n' + base64Fold(mail.text || '') + '\r\n';
    }

    // ---- SMTP 会话状态机 ----
    const transcript = [];
    let socket = null;
    let buffer = '';
    let step = 0;
    let settled = false;
    let upgraded = false;

    const ehloHost = (os.hostname() || 'localhost').replace(/[^\w.-]/g, '');

    /** 每一步要发送的内容；返回 null 表示这一步只等待响应、不发送 */
    const steps = [
      { send: null, expect: [220], name: 'greeting' },
      { send: `EHLO ${ehloHost}`, expect: [250], name: 'ehlo' },
      ...(useSsl ? [] : [{ send: 'STARTTLS', expect: [220], name: 'starttls' }]),
      ...(useSsl ? [] : [{ send: `EHLO ${ehloHost}`, expect: [250], name: 'ehlo2' }]),
      { send: 'AUTH LOGIN', expect: [334], name: 'auth-login' },
      { send: Buffer.from(cfg.user).toString('base64'), expect: [334], name: 'auth-user', secret: true },
      { send: Buffer.from(cfg.pass).toString('base64'), expect: [235], name: 'auth-pass', secret: true },
      { send: `MAIL FROM:<${cfg.user}>`, expect: [250], name: 'mail-from' },
      { send: `RCPT TO:<${mail.to}>`, expect: [250, 251], name: 'rcpt-to' },
      { send: 'DATA', expect: [354], name: 'data' },
      { send: dotStuff(raw.replace(/\r?\n/g, '\r\n')) + '\r\n.', expect: [250], name: 'body', secret: true },
      { send: 'QUIT', expect: [221], name: 'quit', optional: true },
    ];

    function finish(err, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (socket) socket.destroy();
      } catch (_) { /* 忽略销毁异常 */ }
      if (err) reject(err);
      else resolve(result);
    }

    function log(direction, text, secret) {
      transcript.push(secret ? `${direction} ******` : `${direction} ${text.replace(/\r\n/g, ' | ')}`);
      if (transcript.length > 200) transcript.shift();
    }

    function runStep() {
      const s = steps[step];
      if (!s) {
        finish(null, { ok: true, messageId, transcript: transcript.join('\n') });
        return;
      }
      if (s.send !== null && s.send !== undefined) {
        log('C:', s.send, s.secret);
        socket.write(s.send + '\r\n');
      }
    }

    function onData(chunk) {
      buffer += chunk.toString('utf8');
      if (!responseComplete(buffer)) return;

      const resp = buffer;
      buffer = '';
      const code = responseCode(resp);
      const s = steps[step];
      log('S:', resp, false);

      if (!s) {
        finish(null, { ok: true, messageId, transcript: transcript.join('\n') });
        return;
      }

      if (s.expect.includes(code)) {
        // STARTTLS 成功后需要在同一 socket 上升级为 TLS
        if (s.name === 'starttls') {
          step++;
          upgradeToTls();
          return;
        }
        step++;
        if (step >= steps.length) {
          finish(null, { ok: true, messageId, transcript: transcript.join('\n') });
          return;
        }
        runStep();
        return;
      }

      const hint =
        code === 535
          ? '认证失败：授权码错误或 SMTP 服务未开启（QQ邮箱需先生成授权码，不能用QQ密码）'
          : code === 550 || code === 553
            ? '发件人被拒绝：请确认 smtp.user 与授权码属于同一邮箱'
            : code === 421 || code === 450 || code === 451
              ? '对方服务器临时拒绝，请稍后重试'
              : code === 554
                ? '邮件被判定为垃圾邮件，请降低发送频率或检查正文内容'
                : `SMTP 步骤 ${s.name} 失败`;
      finish(new SmtpError(`${hint}（服务器响应 ${code}）`, String(code), resp.trim()));
    }

    function attach(sock) {
      socket = sock;
      socket.setEncoding('utf8');
      socket.on('data', onData);
      socket.on('error', (e) => finish(new SmtpError(`连接错误：${e.message}`, 'SOCKET')));
      socket.on('close', () => {
        if (!settled) finish(new SmtpError('连接被远端关闭', 'CLOSED'));
      });
    }

    function upgradeToTls() {
      if (upgraded) return;
      upgraded = true;
      const plain = socket;
      plain.removeAllListeners('data');
      const secure = tls.connect(
        { socket: plain, host, port, servername: host, rejectUnauthorized: true },
        () => {
          attach(secure);
          runStep();
        }
      );
      secure.on('error', (e) => finish(new SmtpError(`TLS 升级失败：${e.message}`, 'TLS')));
    }

    const timer = setTimeout(() => {
      finish(new SmtpError(`SMTP 超时（${timeoutMs}ms），请检查网络或端口 ${port} 是否可达`, 'TIMEOUT'));
    }, timeoutMs);

    if (useSsl) {
      const sock = tls.connect({ host, port, servername: host, rejectUnauthorized: true }, () => {
        attach(sock);
        runStep();
      });
      sock.on('error', (e) => finish(new SmtpError(`SSL 连接失败：${e.message}`, 'TLS')));
    } else {
      const sock = net.connect({ host, port }, () => {
        attach(sock);
        runStep();
      });
      sock.on('error', (e) => finish(new SmtpError(`连接失败：${e.message}`, 'SOCKET')));
    }
  });
}

/** 构造验证码邮件的 HTML 与纯文本正文 */
function buildCodeMail(siteName, code, ttlMinutes) {
  const text = `【${siteName}】您的验证码是 ${code}，${ttlMinutes} 分钟内有效。若非本人操作请忽略本邮件。`;
  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f5f7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0"
             style="max-width:560px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;
                    box-shadow:0 2px 14px rgba(17,24,39,.06);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;">
        <tr><td style="background:linear-gradient(135deg,#4f7cff,#6a5cff);padding:26px 32px;">
          <div style="color:#ffffff;font-size:19px;font-weight:600;letter-spacing:.5px;">${siteName}</div>
          <div style="color:rgba(255,255,255,.82);font-size:13px;margin-top:6px;">邮箱验证码</div>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 18px;color:#374151;font-size:15px;line-height:1.7;">
            你正在${siteName}进行邮箱验证，请在页面中输入下方验证码完成操作。
          </p>
          <div style="margin:22px 0;padding:20px;background:#f7f8fc;border:1px dashed #c7ccdd;border-radius:10px;text-align:center;">
            <span style="font-size:34px;font-weight:700;letter-spacing:10px;color:#3b4bd8;font-family:Consolas,Menlo,monospace;">${code}</span>
          </div>
          <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.8;">
            验证码 <strong style="color:#374151;">${ttlMinutes} 分钟</strong>内有效，请勿转发给任何人。<br>
            如果这不是你本人的操作，直接忽略本邮件即可，你的账号不会受到影响。
          </p>
        </td></tr>
        <tr><td style="padding:18px 32px;background:#fafbfc;border-top:1px solid #eef0f4;">
          <p style="margin:0;color:#9aa1ad;font-size:12px;line-height:1.7;">
            本邮件由系统自动发送，请勿直接回复。<br>&copy; ${new Date().getFullYear()} ${siteName}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  return { text, html };
}

module.exports = { sendMail, buildCodeMail, SmtpError };

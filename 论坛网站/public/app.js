'use strict';
/* 青柚社区 · 前端逻辑（原生 JS，无框架） */

/* ===================== 全局状态 ===================== */
const State = {
  boot: null,          // /api/bootstrap 返回的数据
  me: null,            // 当前登录用户
  topics: [],
  ads: [],
  route: { name: 'home', params: {} },
  query: { topic: 'all', sort: 'new', page: 1, q: '' },
};

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

/* ===================== 工具 ===================== */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function timeAgo(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  const date = new Date(t);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function fullTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function initials(name) {
  const s = String(name || '?').trim();
  if (!s) return '?';
  if (/^[\x00-\x7F]+$/.test(s)) return s.slice(0, 2).toUpperCase();
  return s.slice(0, 1);
}

function avatarHtml(user, size) {
  const cls = size === 'sm' ? 'avatar sm' : size === 'lg' ? 'avatar lg' : 'avatar';
  const color = (user && user.avatarColor) || '#4f6ef7';
  return `<span class="${cls}" style="background:${esc(color)}" aria-hidden="true">${esc(initials(user && user.nickname))}</span>`;
}

function toast(message, type) {
  const host = $('#toastHost');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast ${type || 'info'}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 220);
  }, 2600);
}

async function api(path, options) {
  const opts = options || {};
  const init = {
    method: opts.method || 'GET',
    headers: Object.assign({}, opts.headers),
    credentials: 'same-origin',
  };
  if (opts.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch (e) {
    throw new Error('无法连接服务器，请确认服务是否正在运行');
  }
  let data = null;
  try { data = await res.json(); } catch (_) { data = null; }
  if (!res.ok || (data && data.ok === false)) {
    const err = new Error((data && data.error) || `请求失败（${res.status}）`);
    err.status = res.status;
    err.code = data && data.code;
    err.data = data;
    throw err;
  }
  return data || {};
}

/* ===================== 弹窗 ===================== */
let activeModal = null;

function closeModal() {
  if (!activeModal) return;
  activeModal.remove();
  activeModal = null;
  document.body.style.overflow = '';
}

function openModal(html, opts) {
  closeModal();
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `<div class="modal${opts && opts.wide ? ' wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  mask.addEventListener('mousedown', (e) => { if (e.target === mask) closeModal(); });
  $('#modalHost').appendChild(mask);
  activeModal = mask;
  document.body.style.overflow = 'hidden';
  const closeBtn = $('.modal-close', mask);
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  const first = $('input, textarea, select', mask);
  if (first) setTimeout(() => first.focus(), 60);
  return mask;
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

function modalHead(title, sub) {
  return `<div class="modal-head">
    <div style="flex:1">
      <h3 class="modal-title">${esc(title)}</h3>
      ${sub ? `<p class="modal-sub">${esc(sub)}</p>` : ''}
    </div>
    <button class="modal-close" type="button" aria-label="关闭">&times;</button>
  </div>`;
}

/* ===================== 广告位渲染 ===================== */
function findAd(slotKey) {
  return (State.ads || []).find((a) => a.slotKey === slotKey) || null;
}

function adBannerHtml(slotKey) {
  const ad = findAd(slotKey);
  if (!ad || !ad.enabled) return '';
  return `<button class="ad-banner" type="button" data-ad="${esc(ad.slotKey)}" aria-label="广告招商位：${esc(ad.title)}">
    <span class="ad-deco"></span>
    <span class="ad-tag">广告招商</span>
    <span class="ad-banner-inner">
      <span class="ad-banner-text">
        <span class="ad-banner-title">${esc(ad.title)}</span>
        <span class="ad-banner-sub">${esc(ad.subtitle)}</span>
      </span>
      <span class="ad-banner-cta">查看联系方式 →</span>
    </span>
  </button>`;
}

function adSideHtml(slotKey) {
  const ad = findAd(slotKey);
  if (!ad || !ad.enabled) return '';
  return `<button class="ad-side" type="button" data-ad="${esc(ad.slotKey)}" aria-label="广告招商位：${esc(ad.title)}">
    <span class="ad-side-top">📣<span class="ad-tag">广告</span></span>
    <span class="ad-side-body">
      <span class="ad-side-title">${esc(ad.title)}</span>
      <span class="ad-side-sub">${esc(ad.subtitle)}</span>
      <span class="ad-side-cta">${esc(ad.price || '点击联系')} →</span>
    </span>
  </button>`;
}

function adInfeedHtml(slotKey) {
  const ad = findAd(slotKey);
  if (!ad || !ad.enabled) return '';
  return `<div style="padding:12px 16px;border-bottom:1px solid var(--border)">
    <button class="ad-infeed" type="button" data-ad="${esc(ad.slotKey)}" aria-label="广告招商位：${esc(ad.title)}">
      <span class="ad-infeed-icon">🤝</span>
      <span class="ad-infeed-text">
        <span class="ad-infeed-title">${esc(ad.title)}</span>
        <span class="ad-infeed-sub">${esc(ad.subtitle)}</span>
      </span>
      <span class="ad-infeed-badge">招商</span>
    </button>
  </div>`;
}

function adFooterHtml(slotKey) {
  const ad = findAd(slotKey);
  if (!ad || !ad.enabled) return '';
  return `<button class="ad-footer" type="button" data-ad="${esc(ad.slotKey)}" style="margin-top:16px">
    <span>🏷️</span>
    <span><strong>${esc(ad.title)}</strong> · ${esc(ad.subtitle)}</span>
    <span style="color:var(--primary);font-weight:600">点击洽谈 →</span>
  </button>`;
}

/** 点击广告位：请求微信名片并弹窗展示 */
async function showAdCard(slotKey) {
  try {
    const r = await api(`/api/ads/${encodeURIComponent(slotKey)}/click`, { method: 'POST' });
    const c = r.card || {};
    openModal(`${modalHead(c.slotName || '广告招商位', c.advertiser ? `广告主：${c.advertiser}` : '欢迎洽谈合作')}
      <div class="modal-body">
        <div class="wechat-card">
          <div class="wechat-hero">
            ${c.wechatImage
              ? `<img src="${esc(c.wechatImage)}" alt="微信名片二维码" onerror="this.parentNode.innerHTML='<div class=&quot;wechat-hero-fallback&quot;>名片图片加载失败<br>请检查 public/assets/wechat-card.svg 或在后台重新上传</div>'">`
              : '<div class="wechat-hero-fallback">尚未配置名片图片</div>'}
          </div>
          <div class="wechat-id-row">
            <span class="wechat-id-label">微信号</span>
            <span class="wechat-id-value">${esc(c.wechatId || '未设置')}</span>
            <button class="btn btn-sm" type="button" id="copyWechat" data-copy="${esc(c.wechatId || '')}">复制</button>
          </div>
          ${c.note ? `<p class="wechat-note">${esc(c.note)}</p>` : ''}
          <dl class="wechat-ad-info">
            <div><dt>广告位置</dt><dd>${esc(c.slotName || '')}</dd></div>
            <div><dt>位置说明</dt><dd>${esc(c.subtitle || '')}</dd></div>
            ${c.price ? `<div><dt>报价</dt><dd>${esc(c.price)}</dd></div>` : ''}
          </dl>
        </div>
      </div>
      <div class="modal-foot"><button class="btn" type="button" data-close>关闭</button></div>`);

    const copyBtn = $('#copyWechat');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const text = copyBtn.getAttribute('data-copy') || '';
        if (!text || text === '未设置') { toast('微信号尚未配置', 'error'); return; }
        try {
          await navigator.clipboard.writeText(text);
          toast('微信号已复制', 'success');
        } catch (_) {
          toast(`请手动复制：${text}`, 'info');
        }
      });
    }
  } catch (e) {
    toast(e.message, 'error');
  }
}

/* ===================== 顶栏用户区 ===================== */
function renderHeaderUser() {
  const host = $('#headerUser');
  if (!host) return;
  if (!State.me) {
    host.innerHTML = `
      <button class="btn btn-sm" type="button" id="btnLogin">登录</button>
      <button class="btn btn-sm btn-primary" type="button" id="btnRegister">注册</button>`;
    $('#btnLogin').addEventListener('click', () => openAuthModal('login'));
    $('#btnRegister').addEventListener('click', () => openAuthModal('register'));
    return;
  }
  const u = State.me;
  host.innerHTML = `
    <button class="btn btn-sm btn-primary" type="button" id="btnNewPost">✏️ 发帖</button>
    <div class="user-menu-host">
      <button class="user-trigger" type="button" id="userTrigger" aria-haspopup="true">
        ${avatarHtml(u, 'sm')}
        <span class="user-trigger-name">${esc(u.nickname)}</span>
      </button>
    </div>`;
  $('#btnNewPost').addEventListener('click', () => openComposer());
  const trigger = $('#userTrigger');
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if ($('.dropdown')) { $('.dropdown').remove(); return; }
    const menu = document.createElement('div');
    menu.className = 'dropdown';
    menu.innerHTML = `
      <div class="dropdown-head">
        <div class="dropdown-head-name">${esc(u.nickname)}${u.role === 'admin' ? ' <span class="pill pill-on">站长</span>' : ''}</div>
        <div class="dropdown-head-mail">${esc(u.email)}</div>
      </div>
      <button type="button" data-act="mine">👤 我的主页</button>
      <button type="button" data-act="settings">⚙️ 账号设置</button>
      ${u.role === 'admin' ? '<button type="button" data-act="admin">🛠️ 站长后台</button>' : ''}
      <div class="dropdown-sep"></div>
      <button type="button" data-act="logout" class="danger">↩ 退出登录</button>`;
    trigger.parentNode.appendChild(menu);
    menu.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-act]');
      if (!btn) return;
      menu.remove();
      const act = btn.getAttribute('data-act');
      if (act === 'mine') location.hash = `#/user/${u.id}`;
      else if (act === 'settings') openSettingsModal();
      else if (act === 'admin') location.hash = '#/admin';
      else if (act === 'logout') doLogout();
    });
    const outside = () => { menu.remove(); document.removeEventListener('click', outside); };
    setTimeout(() => document.addEventListener('click', outside), 0);
  });
}

async function doLogout() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch (_) { /* 忽略 */ }
  State.me = null;
  renderHeaderUser();
  toast('已退出登录', 'success');
  location.hash = '#/';
  render();
}

/* ===================== 认证弹窗 ===================== */
function openAuthModal(mode) {
  const isLogin = mode === 'login';
  const pwMin = (State.boot && State.boot.limits.passwordMinLength) || 8;
  const nickMin = (State.boot && State.boot.limits.nicknameMinLength) || 2;
  const nickMax = (State.boot && State.boot.limits.nicknameMaxLength) || 20;
  const devMode = State.boot && State.boot.devMode;

  const html = `${modalHead(isLogin ? '登录' : '注册新账号', isLogin ? '支持密码登录与邮箱验证码登录' : '需要验证邮箱所有权，全程约 1 分钟')}
    <div class="modal-body">
      ${devMode ? '<div class="alert alert-warn">当前为本地开发模式：邮件服务未配置，验证码会显示在页面上并打印到服务端控制台。配置 QQ 邮箱授权码后即为真实发信。</div>' : ''}
      <div class="tabs" id="authTabs">
        <button type="button" data-tab="password" class="${isLogin ? 'active' : ''}">密码登录</button>
        <button type="button" data-tab="code" class="${isLogin ? '' : 'active'}">验证码登录</button>
        <button type="button" data-tab="register" class="${isLogin ? '' : 'active'}">注册</button>
      </div>
      <div id="authPanel"></div>
    </div>`;

  const mask = openModal(html);
  let tab = isLogin ? 'password' : 'register';
  let countdownTimer = null;

  function stopCountdown() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  }

  function paintTabs() {
    $$('#authTabs button', mask).forEach((b) => b.classList.toggle('active', b.getAttribute('data-tab') === tab));
  }

  function panelPassword() {
    return `<form id="formLogin" novalidate>
      <div class="field">
        <label class="field-label" for="lgEmail">邮箱 <span class="req">*</span></label>
        <input class="input" id="lgEmail" type="email" autocomplete="username" placeholder="you@example.com" required>
      </div>
      <div class="field">
        <label class="field-label" for="lgPass">密码 <span class="req">*</span></label>
        <input class="input" id="lgPass" type="password" autocomplete="current-password" placeholder="请输入登录密码" required>
      </div>
      <div class="alert alert-info" style="margin-bottom:12px">忘记密码？切到「验证码登录」，用邮箱验证码即可直接进入。</div>
      <button class="btn btn-primary btn-block" type="submit" id="lgSubmit">登录</button>
    </form>`;
  }

  function panelCode() {
    return `<form id="formCodeLogin" novalidate>
      <div class="field">
        <label class="field-label" for="clEmail">已注册的邮箱 <span class="req">*</span></label>
        <div class="input-row">
          <input class="input" id="clEmail" type="email" autocomplete="username" placeholder="you@example.com" required>
          <button class="btn" type="button" id="clSend">获取验证码</button>
        </div>
        <div class="field-hint">验证码将发送到该邮箱，10 分钟内有效。</div>
      </div>
      <div id="clDevBox"></div>
      <div class="field">
        <label class="field-label" for="clCode">验证码 <span class="req">*</span></label>
        <input class="input" id="clCode" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="6 位数字" required>
      </div>
      <button class="btn btn-primary btn-block" type="submit" id="clSubmit">验证码登录</button>
    </form>`;
  }

  function panelRegister() {
    return `<form id="formRegister" novalidate>
      <div class="steps">
        <span class="step active" data-step="1"><span class="step-dot">1</span>验证邮箱</span>
        <span class="step-line"></span>
        <span class="step" data-step="2"><span class="step-dot">2</span>设置账号</span>
      </div>
      <div id="regStep1">
        <div class="field">
          <label class="field-label" for="rgEmail">邮箱 <span class="req">*</span></label>
          <div class="input-row">
            <input class="input" id="rgEmail" type="email" autocomplete="email" placeholder="you@example.com" required>
            <button class="btn" type="button" id="rgSend">获取验证码</button>
          </div>
          <div class="field-hint">用于接收验证码，之后也作为你的登录账号。QQ 邮箱、163、Gmail 均可。</div>
        </div>
        <div id="rgDevBox"></div>
        <div class="field">
          <label class="field-label" for="rgCode">邮箱验证码 <span class="req">*</span></label>
          <input class="input" id="rgCode" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="请输入收到的 6 位数字" required>
        </div>
        <button class="btn btn-primary btn-block" type="button" id="rgNext">下一步：设置昵称和密码</button>
      </div>
      <div id="regStep2" style="display:none">
        <div class="alert alert-info" id="rgMailTip"></div>
        <div class="field">
          <label class="field-label" for="rgNick">昵称 <span class="req">*</span></label>
          <input class="input" id="rgNick" type="text" maxlength="${nickMax}" autocomplete="nickname" placeholder="${nickMin}～${nickMax} 个字符，全站唯一" required>
          <div class="field-hint">显示在帖子和回复上，注册后可在账号设置中修改简介。</div>
        </div>
        <div class="field">
          <label class="field-label" for="rgPass">密码 <span class="req">*</span></label>
          <input class="input" id="rgPass" type="password" autocomplete="new-password" placeholder="至少 ${pwMin} 位，需含字母和数字" required>
        </div>
        <div class="field">
          <label class="field-label" for="rgPass2">确认密码 <span class="req">*</span></label>
          <input class="input" id="rgPass2" type="password" autocomplete="new-password" placeholder="再输入一次" required>
        </div>
        <div style="display:flex;gap:9px">
          <button class="btn" type="button" id="rgBack" style="flex:none">上一步</button>
          <button class="btn btn-primary" type="submit" id="rgSubmit" style="flex:1">完成注册并登录</button>
        </div>
      </div>
    </form>`;
  }

  function renderPanel() {
    stopCountdown();
    const panel = $('#authPanel', mask);
    panel.innerHTML = tab === 'password' ? panelPassword() : tab === 'code' ? panelCode() : panelRegister();
    bindPanel();
  }

  function startCountdown(btn, seconds) {
    let left = seconds;
    btn.disabled = true;
    btn.textContent = `${left} 秒后重发`;
    countdownTimer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        stopCountdown();
        btn.disabled = false;
        btn.textContent = '重新获取';
      } else {
        btn.textContent = `${left} 秒后重发`;
      }
    }, 1000);
  }

  function showDevCode(boxId, data) {
    if (!data || !data.devMode || !data.devCode) return;
    const box = $(boxId, mask);
    if (!box) return;
    box.innerHTML = `<div class="code-display">开发模式验证码（未真实发信）：<br><strong>${esc(data.devCode)}</strong><br>正式环境配置 SMTP 后，此验证码将发送到邮箱。</div>`;
  }

  function bindPanel() {
    if (tab === 'password') {
      const form = $('#formLogin', mask);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = $('#lgSubmit', mask);
        const email = $('#lgEmail', mask).value.trim();
        const password = $('#lgPass', mask).value;
        if (!email || !password) { toast('请填写邮箱和密码', 'error'); return; }
        btn.disabled = true; btn.textContent = '登录中…';
        try {
          const r = await api('/api/auth/login', { method: 'POST', body: { email, password } });
          State.me = r.user;
          closeModal();
          renderHeaderUser();
          toast(r.message || '登录成功', 'success');
          render();
        } catch (err) {
          toast(err.message, 'error');
          btn.disabled = false; btn.textContent = '登录';
        }
      });
      return;
    }

    if (tab === 'code') {
      $('#clSend', mask).addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const email = $('#clEmail', mask).value.trim();
        if (!email) { toast('请先填写邮箱', 'error'); return; }
        btn.disabled = true; btn.textContent = '发送中…';
        try {
          const r = await api('/api/auth/send-code', { method: 'POST', body: { email, purpose: 'login' } });
          toast(r.message || '验证码已发送', 'success');
          showDevCode('#clDevBox', r);
          startCountdown(btn, 60);
          $('#clCode', mask).focus();
        } catch (err) {
          toast(err.message, 'error');
          btn.disabled = false; btn.textContent = '获取验证码';
        }
      });

      $('#formCodeLogin', mask).addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = $('#clSubmit', mask);
        const email = $('#clEmail', mask).value.trim();
        const code = $('#clCode', mask).value.trim();
        if (!email || !code) { toast('请填写邮箱和验证码', 'error'); return; }
        btn.disabled = true; btn.textContent = '登录中…';
        try {
          const r = await api('/api/auth/login-by-code', { method: 'POST', body: { email, code } });
          State.me = r.user;
          closeModal();
          renderHeaderUser();
          toast(r.message || '登录成功', 'success');
          render();
        } catch (err) {
          toast(err.message, 'error');
          btn.disabled = false; btn.textContent = '验证码登录';
        }
      });
      return;
    }

    // 注册
    let regStep = 1;
    let regEmail = '';
    let regCode = '';

    function gotoStep(n) {
      regStep = n;
      $('#regStep1', mask).style.display = n === 1 ? '' : 'none';
      $('#regStep2', mask).style.display = n === 2 ? '' : 'none';
      $$('.step', mask).forEach((s) => {
        const sn = Number(s.getAttribute('data-step'));
        s.classList.toggle('active', sn === n);
        s.classList.toggle('done', sn < n);
      });
      if (n === 2) $('#rgNick', mask).focus();
    }

    $('#rgSend', mask).addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const email = $('#rgEmail', mask).value.trim();
      if (!email) { toast('请先填写邮箱', 'error'); return; }
      btn.disabled = true; btn.textContent = '发送中…';
      try {
        const r = await api('/api/auth/send-code', { method: 'POST', body: { email, purpose: 'register' } });
        toast(r.message || '验证码已发送，请查收邮箱', 'success');
        showDevCode('#rgDevBox', r);
        startCountdown(btn, 60);
        $('#rgCode', mask).focus();
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false; btn.textContent = '获取验证码';
      }
    });

    $('#rgNext', mask).addEventListener('click', () => {
      regEmail = $('#rgEmail', mask).value.trim();
      regCode = $('#rgCode', mask).value.trim();
      if (!regEmail) { toast('请填写邮箱', 'error'); return; }
      if (!/^\d{4,8}$/.test(regCode)) { toast('请输入收到的数字验证码', 'error'); return; }
      $('#rgMailTip', mask).textContent = `验证码将用于邮箱 ${regEmail}。若下一步提示验证码错误，请返回上一步重新获取。`;
      gotoStep(2);
    });

    $('#rgBack', mask).addEventListener('click', () => gotoStep(1));

    $('#formRegister', mask).addEventListener('submit', async (e) => {
      e.preventDefault();
      if (regStep !== 2) return;
      const btn = $('#rgSubmit', mask);
      const nickname = $('#rgNick', mask).value.trim();
      const password = $('#rgPass', mask).value;
      const password2 = $('#rgPass2', mask).value;
      if (!nickname) { toast('请填写昵称', 'error'); return; }
      if (password !== password2) { toast('两次输入的密码不一致', 'error'); return; }
      btn.disabled = true; btn.textContent = '注册中…';
      try {
        const r = await api('/api/auth/register', {
          method: 'POST',
          body: { email: regEmail, code: regCode, nickname, password },
        });
        State.me = r.user;
        closeModal();
        renderHeaderUser();
        toast(r.message || '注册成功', 'success');
        render();
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false; btn.textContent = '完成注册并登录';
        if (err.code === 'CODE_INVALID') gotoStep(1);
      }
    });

    gotoStep(1);
  }

  $$('#authTabs button', mask).forEach((b) => {
    b.addEventListener('click', () => { tab = b.getAttribute('data-tab'); paintTabs(); renderPanel(); });
  });

  paintTabs();
  renderPanel();
}

/* ===================== 发帖 / 编辑弹窗 ===================== */
function openComposer(existing) {
  if (!State.me) { toast('请先登录后再发帖', 'error'); openAuthModal('login'); return; }
  const isEdit = !!existing;
  const currentTopic = isEdit ? String(existing.topic.id) : (State.query.topic !== 'all' ? String(State.query.topic) : String((State.topics[0] || {}).id || ''));
  const titleMax = 80;
  const contentMax = 20000;

  const topicOptions = State.topics
    .map((t) => `<option value="${t.id}"${String(t.id) === String(currentTopic) ? ' selected' : ''}>${esc(t.icon)} ${esc(t.name)}</option>`)
    .join('');

  const html = `${modalHead(isEdit ? '编辑帖子' : '发布新帖子', isEdit ? '修改后立即生效' : '选择合适的话题，更容易被看到')}
    <div class="modal-body">
      <form id="formPost" novalidate>
        <div class="field">
          <label class="field-label" for="ptTopic">话题分类 <span class="req">*</span></label>
          <select class="select" id="ptTopic">${topicOptions}</select>
        </div>
        <div class="field">
          <label class="field-label" for="ptTitle">标题 <span class="req">*</span></label>
          <input class="input" id="ptTitle" type="text" maxlength="${titleMax}" placeholder="一句话说清你想聊什么（4～${titleMax} 字）" value="${isEdit ? esc(existing.title) : ''}">
          <div class="char-count"><span id="ptTitleCount">${isEdit ? existing.title.length : 0}</span>/${titleMax}</div>
        </div>
        <div class="field">
          <label class="field-label" for="ptContent">正文 <span class="req">*</span></label>
          <textarea class="input" id="ptContent" maxlength="${contentMax}" placeholder="把背景、你的想法、想讨论的问题写清楚。支持换行，至少 10 个字。">${isEdit ? esc(existing.content) : ''}</textarea>
          <div class="char-count"><span id="ptContentCount">${isEdit ? existing.content.length : 0}</span>/${contentMax}</div>
        </div>
        <div class="modal-foot" style="padding:0">
          <button class="btn" type="button" data-close>取消</button>
          <button class="btn btn-primary" type="submit" id="ptSubmit">${isEdit ? '保存修改' : '发布帖子'}</button>
        </div>
      </form>
    </div>`;

  const mask = openModal(html, { wide: true });

  const titleInput = $('#ptTitle', mask);
  const contentInput = $('#ptContent', mask);
  titleInput.addEventListener('input', () => { $('#ptTitleCount', mask).textContent = titleInput.value.length; });
  contentInput.addEventListener('input', () => { $('#ptContentCount', mask).textContent = contentInput.value.length; });

  $$('[data-close]', mask).forEach((b) => b.addEventListener('click', closeModal));

  $('#formPost', mask).addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#ptSubmit', mask);
    const payload = {
      topicId: Number($('#ptTopic', mask).value),
      title: titleInput.value.trim(),
      content: contentInput.value.trim(),
    };
    if (payload.title.length < 4) { toast('标题至少 4 个字', 'error'); return; }
    if (payload.content.length < 10) { toast('正文至少 10 个字', 'error'); return; }
    btn.disabled = true; btn.textContent = isEdit ? '保存中…' : '发布中…';
    try {
      if (isEdit) {
        await api(`/api/posts/${existing.id}`, { method: 'PUT', body: payload });
        toast('已保存修改', 'success');
        closeModal();
        location.hash = `#/post/${existing.id}`;
        render();
      } else {
        const r = await api('/api/posts', { method: 'POST', body: payload });
        toast('发布成功', 'success');
        closeModal();
        await loadBootstrap();
        location.hash = `#/post/${r.post.id}`;
        render();
      }
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false; btn.textContent = isEdit ? '保存修改' : '发布帖子';
    }
  });

  setTimeout(() => (isEdit ? contentInput : titleInput).focus(), 80);
}

/* ===================== 账号设置 ===================== */
function openSettingsModal() {
  if (!State.me) return;
  const u = State.me;
  const html = `${modalHead('账号设置', u.email)}
    <div class="modal-body">
      <div class="tabs" id="setTabs">
        <button type="button" data-tab="profile" class="active">个人资料</button>
        <button type="button" data-tab="password">修改密码</button>
      </div>
      <div id="setPanel"></div>
    </div>`;
  const mask = openModal(html);
  let tab = 'profile';

  function renderSet() {
    const panel = $('#setPanel', mask);
    if (tab === 'profile') {
      panel.innerHTML = `<form id="formProfile" novalidate>
        <div class="field">
          <label class="field-label">昵称</label>
          <input class="input" value="${esc(u.nickname)}" disabled>
          <div class="field-hint">昵称全站唯一，注册后不可修改，以保证回复引用的一致性。</div>
        </div>
        <div class="field">
          <label class="field-label" for="stBio">个人简介</label>
          <textarea class="input" id="stBio" maxlength="200" style="min-height:88px" placeholder="介绍一下自己（200 字以内）">${esc(u.bio || '')}</textarea>
        </div>
        <div class="field">
          <label class="field-label">注册时间</label>
          <input class="input" value="${esc(fullTime(u.createdAt))}" disabled>
        </div>
        <div class="modal-foot" style="padding:0">
          <button class="btn btn-primary" type="submit">保存资料</button>
        </div>
      </form>`;
      $('#formProfile', mask).addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const r = await api('/api/me/profile', { method: 'POST', body: { bio: $('#stBio', mask).value } });
          State.me = r.user;
          toast('资料已更新', 'success');
          closeModal();
          render();
        } catch (err) { toast(err.message, 'error'); }
      });
    } else {
      const pwMin = (State.boot && State.boot.limits.passwordMinLength) || 8;
      panel.innerHTML = `<form id="formPw" novalidate>
        <div class="alert alert-warn">修改密码后，其他设备上的登录会全部失效，需要重新登录。</div>
        <div class="field">
          <label class="field-label" for="pwOld">当前密码 <span class="req">*</span></label>
          <input class="input" id="pwOld" type="password" autocomplete="current-password" required>
        </div>
        <div class="field">
          <label class="field-label" for="pwNew">新密码 <span class="req">*</span></label>
          <input class="input" id="pwNew" type="password" autocomplete="new-password" placeholder="至少 ${pwMin} 位，需含字母和数字" required>
        </div>
        <div class="field">
          <label class="field-label" for="pwNew2">确认新密码 <span class="req">*</span></label>
          <input class="input" id="pwNew2" type="password" autocomplete="new-password" required>
        </div>
        <div class="modal-foot" style="padding:0">
          <button class="btn btn-primary" type="submit">修改密码</button>
        </div>
      </form>`;
      $('#formPw', mask).addEventListener('submit', async (e) => {
        e.preventDefault();
        const oldPassword = $('#pwOld', mask).value;
        const newPassword = $('#pwNew', mask).value;
        if (newPassword !== $('#pwNew2', mask).value) { toast('两次输入的新密码不一致', 'error'); return; }
        try {
          const r = await api('/api/me/password', { method: 'POST', body: { oldPassword, newPassword } });
          toast(r.message || '密码已修改', 'success');
          closeModal();
        } catch (err) { toast(err.message, 'error'); }
      });
    }
    $$('#setTabs button', mask).forEach((b) => b.classList.toggle('active', b.getAttribute('data-tab') === tab));
  }

  $$('#setTabs button', mask).forEach((b) => {
    b.addEventListener('click', () => { tab = b.getAttribute('data-tab'); renderSet(); });
  });
  $$('[data-close]', mask).forEach((b) => b.addEventListener('click', closeModal));
  renderSet();
}

/* ===================== 路由 ===================== */
function parseHash() {
  const raw = (location.hash || '#/').replace(/^#/, '');
  const [p, qs] = raw.split('?');
  const seg = p.split('/').filter(Boolean);
  const params = new URLSearchParams(qs || '');
  if (seg.length === 0) return { name: 'home', params: {} };
  if (seg[0] === 'post' && seg[1]) return { name: 'post', params: { id: seg[1] } };
  if (seg[0] === 'topic' && seg[1]) return { name: 'home', params: { topic: seg[1] } };
  if (seg[0] === 'topics') return { name: 'topics', params: {} };
  if (seg[0] === 'ads') return { name: 'ads', params: {} };
  if (seg[0] === 'user' && seg[1]) return { name: 'user', params: { id: seg[1] } };
  if (seg[0] === 'admin') return { name: 'admin', params: {} };
  if (seg[0] === 'search') return { name: 'home', params: { q: params.get('q') || seg[1] || '' } };
  return { name: 'home', params: {} };
}

window.addEventListener('hashchange', () => {
  const r = parseHash();
  if (r.name === 'home' && r.params.topic) {
    State.query.topic = r.params.topic;
    State.query.page = 1;
  } else if (r.name === 'home' && r.params.q !== undefined) {
    State.query.q = r.params.q;
    State.query.page = 1;
  }
  State.route = r;
  window.scrollTo({ top: 0 });
  render();
});

/* ===================== 页面渲染 ===================== */
function layoutHtml(leftAside, main, rightAside) {
  return `<div class="layout${rightAside ? '' : ' no-aside'}">
    <aside class="aside-left">${leftAside}</aside>
    <section class="main-col">${main}</section>
    ${rightAside ? `<aside class="aside-right">${rightAside}</aside>` : ''}
  </div>`;
}

function topicNavHtml() {
  const current = State.query.topic;
  const total = State.topics.reduce((s, t) => s + (t.postCount || 0), 0);
  const items = State.topics.map((t) => `
    <button class="topic-item${String(current) === String(t.slug) || String(current) === String(t.id) ? ' active' : ''}" type="button" data-topic="${esc(t.slug)}">
      <span class="topic-icon">${esc(t.icon)}</span>
      <span class="topic-name">${esc(t.name)}</span>
      <span class="topic-count">${t.postCount}</span>
    </button>`).join('');
  return `<div class="card">
    <nav class="topic-nav" aria-label="话题筛选">
      <div class="topic-nav-label">话题分类</div>
      <button class="topic-item${current === 'all' || !current ? ' active' : ''}" type="button" data-topic="all">
        <span class="topic-icon">🗂️</span><span class="topic-name">全部帖子</span><span class="topic-count">${total}</span>
      </button>
      ${items}
    </nav>
  </div>
  ${adSideHtml('sidebar_rect')}
  <div style="height:16px"></div>
  ${adFooterHtml('footer_bar')}`;
}

function rightAsideHtml() {
  const s = (State.boot && State.boot.stats) || {};
  const hot = ((State.boot && State.boot.hotPosts) || []).map((p, i) => `
    <div class="hot-item" data-post="${p.id}">
      <span class="hot-rank r${i + 1}">${i + 1}</span>
      <div style="flex:1;min-width:0">
        <div class="hot-title">${esc(p.title)}</div>
        <div class="hot-meta">${esc(p.topicName)} · ${p.replyCount} 回复 · ${p.views} 浏览</div>
      </div>
    </div>`).join('');
  const users = ((State.boot && State.boot.latestUsers) || []).map((u) => `
    <div class="user-chip" data-user="${u.id}" style="cursor:pointer">
      ${avatarHtml(u, 'sm')}
      <span class="user-chip-name">${esc(u.nickname)}</span>
      <span class="user-chip-time">${esc(timeAgo(u.createdAt))}</span>
    </div>`).join('');

  return `<div class="card">
    <div class="card-head"><h3 class="card-title">社区数据</h3></div>
    <div class="card-body">
      <div class="stat-grid">
        <div class="stat-box"><div class="stat-num">${s.users || 0}</div><div class="stat-label">注册用户</div></div>
        <div class="stat-box"><div class="stat-num">${s.posts || 0}</div><div class="stat-label">主题帖</div></div>
        <div class="stat-box"><div class="stat-num">${s.replies || 0}</div><div class="stat-label">回复</div></div>
        <div class="stat-box"><div class="stat-num">${s.topics || 0}</div><div class="stat-label">话题</div></div>
      </div>
    </div>
  </div>
  <div class="card">
    <div class="card-head"><h3 class="card-title">🔥 热门讨论</h3></div>
    <div class="card-body" style="padding-top:6px;padding-bottom:6px">
      ${hot || '<div class="empty" style="padding:24px"><p class="empty-text">还没有帖子</p></div>'}
    </div>
  </div>
  <div class="card">
    <div class="card-head"><h3 class="card-title">最新加入</h3></div>
    <div class="card-body" style="padding-top:8px;padding-bottom:8px">
      ${users || '<div class="empty" style="padding:20px"><p class="empty-text">还没有用户注册</p></div>'}
    </div>
  </div>
  <div style="height:16px"></div>
  ${adSideHtml('sidebar_rect')}`;
}

function bindCommon(root) {
  $$('[data-ad]', root || document).forEach((b) => {
    if (b.dataset.bound) return;
    b.dataset.bound = '1';
    b.addEventListener('click', () => showAdCard(b.getAttribute('data-ad')));
  });
  $$('[data-topic]', root || document).forEach((b) => {
    if (b.dataset.bound) return;
    b.dataset.bound = '1';
    b.addEventListener('click', () => {
      const t = b.getAttribute('data-topic');
      State.query.topic = t;
      State.query.page = 1;
      State.query.q = '';
      const si = $('#searchInput'); if (si) si.value = '';
      location.hash = t === 'all' ? '#/' : `#/topic/${encodeURIComponent(t)}`;
      if (State.route.name === 'home') render();
    });
  });
  $$('[data-post]', root || document).forEach((el) => {
    if (el.dataset.boundPost) return;
    el.dataset.boundPost = '1';
    el.addEventListener('click', (e) => {
      if (e.target.closest('button[data-ad]')) return;
      location.hash = `#/post/${el.getAttribute('data-post')}`;
    });
  });
  $$('[data-user]', root || document).forEach((el) => {
    if (el.dataset.boundUser) return;
    el.dataset.boundUser = '1';
    el.addEventListener('click', () => { location.hash = `#/user/${el.getAttribute('data-user')}`; });
  });
  $$('[data-nav]', root || document).forEach((a) => {
    if (a.dataset.boundNav) return;
    a.dataset.boundNav = '1';
  });
}

function markNav() {
  const key = State.route.name === 'home' ? 'home' : State.route.name;
  $$('.header-nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('data-navkey') === key));
}

/* ---------- 首页：帖子列表 ---------- */
async function renderHome(container) {
  const q = State.query;
  container.innerHTML = layoutHtml(topicNavHtml(), `
    <div class="card">
      <div class="list-toolbar">
        <div class="list-toolbar-title" id="listTitle">全部帖子</div>
        <div class="seg" id="sortSeg">
          <button type="button" data-sort="new" class="${q.sort === 'new' ? 'active' : ''}">最新</button>
          <button type="button" data-sort="hot" class="${q.sort === 'hot' ? 'active' : ''}">最热</button>
          <button type="button" data-sort="replied" class="${q.sort === 'replied' ? 'active' : ''}">最近回复</button>
        </div>
        <button class="btn btn-sm btn-primary" type="button" id="btnNewPost2">✏️ 发帖</button>
      </div>
      <div id="postList"><div class="skeleton"><div class="skeleton-row"></div><div class="skeleton-row"></div><div class="skeleton-row"></div></div></div>
    </div>
    ${adFooterHtml('footer_bar')}`, rightAsideHtml());

  bindCommon(container);
  $('#btnNewPost2', container).addEventListener('click', () => openComposer());
  $$('#sortSeg button', container).forEach((b) => {
    b.addEventListener('click', () => {
      State.query.sort = b.getAttribute('data-sort');
      State.query.page = 1;
      $$('#sortSeg button', container).forEach((x) => x.classList.toggle('active', x === b));
      loadPosts();
    });
  });

  const topicLabel = $('#listTitle', container);
  if (q.q) topicLabel.textContent = `搜索「${q.q}」`;
  else if (q.topic && q.topic !== 'all') {
    const t = State.topics.find((x) => String(x.slug) === String(q.topic) || String(x.id) === String(q.topic));
    topicLabel.textContent = t ? `${t.icon} ${t.name}` : '全部帖子';
  } else topicLabel.textContent = '全部帖子';

  await loadPosts();
}

async function loadPosts() {
  const q = State.query;
  const host = $('#postList');
  if (!host) return;
  const params = new URLSearchParams({ sort: q.sort, page: String(q.page), pageSize: '10' });
  if (q.topic && q.topic !== 'all') params.set('topic', q.topic);
  if (q.q) params.set('q', q.q);

  try {
    const r = await api(`/api/posts?${params.toString()}`);
    if (!r.items.length) {
      host.innerHTML = `<div class="empty">
        <div class="empty-icon">${q.q ? '🔍' : '📭'}</div>
        <p class="empty-text">${q.q ? '没有找到匹配的帖子' : '这个话题下还没有帖子'}</p>
        <p class="empty-sub">${q.q ? '换个关键词试试，或者去掉筛选条件' : '成为第一个发帖的人吧'}</p>
      </div>`;
      return;
    }
    const rows = r.items.map((p, idx) => {
      const showInfeedAd = idx === 2 && findAd('infeed');
      const row = `<article class="post-item" data-post="${p.id}" tabindex="0" role="link">
        ${avatarHtml(p.author)}
        <div class="post-main">
          <div class="post-title-row">
            ${p.isTop ? '<span class="badge badge-top">置顶</span>' : ''}
            <h3 class="post-title">${esc(p.title)}</h3>
            <span class="badge badge-topic" style="background:${esc(p.topic.color)}1a;color:${esc(p.topic.color)}">${esc(p.topic.name)}</span>
          </div>
          <p class="post-excerpt">${esc(p.excerpt)}</p>
          <div class="post-meta">
            <span class="post-author">${esc(p.author.nickname)}</span>
            ${p.author.role === 'admin' ? '<span class="badge badge-role">站长</span>' : ''}
            <span>🕒 ${esc(timeAgo(p.createdAt))}</span>
            <span>👁 ${p.views}</span>
            <span>💬 ${p.replyCount}</span>
            <span>❤ ${p.likeCount}</span>
          </div>
        </div>
      </article>`;
      return showInfeedAd ? row + adInfeedHtml('infeed') : row;
    }).join('');

    const pagerTotal = r.totalPages;
    const pager = pagerTotal > 1 ? `<div class="pager">
      <button class="btn btn-sm" type="button" id="pgPrev"${r.page <= 1 ? ' disabled' : ''}>上一页</button>
      <span class="pager-info">第 ${r.page} / ${pagerTotal} 页 · 共 ${r.total} 篇</span>
      <button class="btn btn-sm" type="button" id="pgNext"${r.page >= pagerTotal ? ' disabled' : ''}>下一页</button>
    </div>` : `<div class="pager"><span class="pager-info">共 ${r.total} 篇帖子</span></div>`;

    host.innerHTML = rows + pager;
    bindCommon(host);
    $$('.post-item', host).forEach((el) => {
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') location.hash = `#/post/${el.getAttribute('data-post')}`;
      });
    });
    const prev = $('#pgPrev', host);
    const next = $('#pgNext', host);
    if (prev) prev.addEventListener('click', () => { State.query.page = Math.max(1, State.query.page - 1); loadPosts(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    if (next) next.addEventListener('click', () => { State.query.page += 1; loadPosts(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  } catch (e) {
    host.innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div><p class="empty-text">加载失败</p><p class="empty-sub">${esc(e.message)}</p></div>`;
  }
}

/* ---------- 帖子详情 ---------- */
async function renderPost(container, id) {
  container.innerHTML = layoutHtml(topicNavHtml(), `
    <div class="card" id="postCard"><div class="skeleton"><div class="skeleton-row"></div><div class="skeleton-row"></div></div></div>`, rightAsideHtml());
  bindCommon(container);

  const card = $('#postCard', container);
  try {
    const r = await api(`/api/posts/${encodeURIComponent(id)}`);
    const p = r.post;
    const canManage = State.me && (State.me.id === p.author.id || State.me.role === 'admin');

    card.innerHTML = `
      <div class="detail-head">
        <div class="breadcrumb">
          <a href="#/" data-nav>首页</a><span>›</span>
          <a href="#/topic/${esc(p.topic.slug)}" data-nav style="color:${esc(p.topic.color)}">${esc(p.topic.name)}</a><span>›</span>
          <span>正文</span>
        </div>
        <h1 class="detail-title">${esc(p.title)}</h1>
        <div class="detail-meta">
          <div class="detail-author" data-user="${p.author.id}" style="cursor:pointer">
            ${avatarHtml(p.author)}
            <div>
              <div class="detail-author-name">${esc(p.author.nickname)}${p.author.role === 'admin' ? ' <span class="badge badge-role">站长</span>' : ''}</div>
              <div class="detail-time">发布于 ${esc(fullTime(p.createdAt))}${p.updatedAt && p.updatedAt !== p.createdAt ? ` · 已编辑` : ''}</div>
            </div>
          </div>
          <span class="detail-time" style="margin-left:auto">👁 ${p.views} 浏览 · 💬 ${p.replyCount} 回复</span>
        </div>
      </div>
      <div class="detail-content">${esc(p.content)}</div>
      <div class="detail-actions">
        <button class="btn btn-sm like-btn${p.liked ? ' liked' : ''}" type="button" id="likePost">
          ${p.liked ? '❤' : '🤍'} <span id="likePostCount">${p.likeCount}</span> 赞
        </button>
        ${canManage ? '<button class="btn btn-sm" type="button" id="editPost">编辑</button>' : ''}
        ${canManage ? '<button class="btn btn-sm btn-danger" type="button" id="delPost">删除</button>' : ''}
        <span style="margin-left:auto;font-size:12.5px;color:var(--text-3)">楼主：共发 ${p.author.postCount} 帖</span>
      </div>`;

    bindCommon(card);

    $('#likePost', card).addEventListener('click', async () => {
      if (!State.me) { toast('请先登录后再点赞', 'error'); openAuthModal('login'); return; }
      try {
        const res = await api('/api/like', { method: 'POST', body: { targetType: 'post', targetId: p.id } });
        const btn = $('#likePost', card);
        btn.classList.toggle('liked', res.liked);
        btn.innerHTML = `${res.liked ? '❤' : '🤍'} <span id="likePostCount">${res.likeCount}</span> 赞`;
      } catch (e) { toast(e.message, 'error'); }
    });

    const editBtn = $('#editPost', card);
    if (editBtn) editBtn.addEventListener('click', () => openComposer(p));
    const delBtn = $('#delPost', card);
    if (delBtn) delBtn.addEventListener('click', () => confirmDelete('post', p.id, p.title));

    // 回复区
    const repliesCard = document.createElement('div');
    repliesCard.className = 'card';
    repliesCard.innerHTML = `
      <div class="card-head">
        <h3 class="card-title">全部回复</h3>
        <span class="card-sub" id="replyCount">${p.replies.length} 条</span>
      </div>
      <div class="composer" id="replyComposer"></div>
      <div id="replyList"></div>`;
    card.parentNode.insertBefore(repliesCard, card.nextSibling);

    function paintReplies(list) {
      const host = $('#replyList', repliesCard);
      $('#replyCount', repliesCard).textContent = `${list.length} 条`;
      if (!list.length) {
        host.innerHTML = `<div class="empty"><div class="empty-icon">💬</div><p class="empty-text">还没有人回复</p><p class="empty-sub">来说两句，成为第一个回复的人</p></div>`;
        return;
      }
      host.innerHTML = list.map((r2, i) => {
        const mine = State.me && (State.me.id === r2.author.id || State.me.role === 'admin');
        return `<div class="reply-item" data-reply-id="${r2.id}">
          ${avatarHtml(r2.author)}
          <div class="reply-main">
            <div class="reply-head">
              <span class="reply-author" data-user="${r2.author.id}" style="cursor:pointer">${esc(r2.author.nickname)}</span>
              ${r2.author.role === 'admin' ? '<span class="badge badge-role">站长</span>' : ''}
              ${i === 0 ? '' : ''}
              <span class="reply-time">${esc(timeAgo(r2.createdAt))}</span>
            </div>
            <p class="reply-content">${esc(r2.content)}</p>
            <div class="reply-actions">
              <button class="link-btn like-reply${r2.liked ? ' liked' : ''}" type="button" data-like="${r2.id}">
                ${r2.liked ? '❤' : '🤍'} <span>${r2.likeCount}</span>
              </button>
              ${mine ? `<button class="link-btn danger" type="button" data-delreply="${r2.id}">删除</button>` : ''}
            </div>
          </div>
        </div>`;
      }).join('');

      bindCommon(host);
      $$('[data-like]', host).forEach((b) => {
        b.addEventListener('click', async () => {
          if (!State.me) { toast('请先登录后再点赞', 'error'); openAuthModal('login'); return; }
          try {
            const res = await api('/api/like', { method: 'POST', body: { targetType: 'reply', targetId: Number(b.getAttribute('data-like')) } });
            b.classList.toggle('liked', res.liked);
            b.innerHTML = `${res.liked ? '❤' : '🤍'} <span>${res.likeCount}</span>`;
          } catch (e) { toast(e.message, 'error'); }
        });
      });
      $$('[data-delreply]', host).forEach((b) => {
        b.addEventListener('click', () => confirmDelete('reply', Number(b.getAttribute('data-delreply')), ''));
      });
    }

    paintReplies(p.replies);

    // 回复输入框
    const composer = $('#replyComposer', repliesCard);
    if (!State.me) {
      composer.innerHTML = `<div class="alert alert-info" style="margin:0">
        <a href="javascript:void(0)" id="loginToReply">登录</a> 或
        <a href="javascript:void(0)" id="regToReply">注册</a> 后即可参与回复。
      </div>`;
      $('#loginToReply', composer).addEventListener('click', () => openAuthModal('login'));
      $('#regToReply', composer).addEventListener('click', () => openAuthModal('register'));
    } else {
      composer.innerHTML = `
        <div style="display:flex;gap:11px;align-items:flex-start">
          ${avatarHtml(State.me)}
          <div style="flex:1;min-width:0">
            <textarea id="replyInput" placeholder="以 ${esc(State.me.nickname)} 的身份回复…（友善表达，理性讨论）" maxlength="5000"></textarea>
            <div class="composer-foot">
              <span class="composer-hint"><span id="replyCharCount">0</span>/5000</span>
              <button class="btn btn-primary btn-sm" type="button" id="btnReply">发表回复</button>
            </div>
          </div>
        </div>`;
      const ta = $('#replyInput', composer);
      ta.addEventListener('input', () => { $('#replyCharCount', composer).textContent = ta.value.length; });
      ta.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') $('#btnReply', composer).click();
      });
      $('#btnReply', composer).addEventListener('click', async () => {
        const btn = $('#btnReply', composer);
        const content = ta.value.trim();
        if (!content) { toast('回复内容不能为空', 'error'); return; }
        btn.disabled = true; btn.textContent = '发送中…';
        try {
          const res = await api(`/api/posts/${p.id}/replies`, { method: 'POST', body: { content } });
          ta.value = '';
          $('#replyCharCount', composer).textContent = '0';
          const list = p.replies.concat([res.reply]);
          p.replies = list;
          paintReplies(list);
          toast('回复成功', 'success');
          await loadBootstrap();
        } catch (e) { toast(e.message, 'error'); }
        btn.disabled = false; btn.textContent = '发表回复';
      });
    }
  } catch (e) {
    card.innerHTML = `<div class="empty"><div class="empty-icon">🚫</div><p class="empty-text">${esc(e.message)}</p>
      <p class="empty-sub"><a href="#/" data-nav>返回首页</a></p></div>`;
    bindCommon(card);
  }
}

/* ---------- 删除确认 ---------- */
function confirmDelete(type, id, title) {
  const isPost = type === 'post';
  const html = `${modalHead(isPost ? '删除帖子' : '删除回复', '此操作不可撤销')}
    <div class="modal-body">
      <div class="alert alert-error">${isPost ? `确定删除帖子「${esc(title)}」吗？该帖下的所有回复也会一并删除。` : '确定删除这条回复吗？'}</div>
    </div>
    <div class="modal-foot">
      <button class="btn" type="button" data-close>取消</button>
      <button class="btn btn-danger" type="button" id="confirmDel">确认删除</button>
    </div>`;
  const mask = openModal(html);
  $$('[data-close]', mask).forEach((b) => b.addEventListener('click', closeModal));
  $('#confirmDel', mask).addEventListener('click', async () => {
    try {
      if (isPost) {
        await api(`/api/posts/${id}`, { method: 'DELETE' });
        toast('帖子已删除', 'success');
        closeModal();
        await loadBootstrap();
        location.hash = '#/';
        render();
      } else {
        await api(`/api/replies/${id}`, { method: 'DELETE' });
        toast('回复已删除', 'success');
        closeModal();
        render();
      }
    } catch (e) { toast(e.message, 'error'); }
  });
}

/* ---------- 全部话题页 ---------- */
function renderTopics(container) {
  const cards = State.topics.map((t) => `
    <button class="card" type="button" data-topic="${esc(t.slug)}" style="display:block;width:100%;text-align:left;cursor:pointer;padding:0;border-color:var(--border)">
      <div class="card-body" style="display:flex;gap:13px;align-items:flex-start">
        <span style="width:44px;height:44px;border-radius:12px;flex:none;display:grid;place-items:center;font-size:21px;background:${esc(t.color)}1a">${esc(t.icon)}</span>
        <span style="flex:1;min-width:0">
          <span style="display:flex;align-items:center;gap:8px">
            <strong style="font-size:15.5px;color:${esc(t.color)}">${esc(t.name)}</strong>
            <span class="topic-count">${t.postCount} 帖</span>
          </span>
          <span style="display:block;font-size:13px;color:var(--text-3);margin-top:3px">${esc(t.description)}</span>
        </span>
      </div>
    </button>`).join('');

  container.innerHTML = `
    <div class="page-head">
      <div><h1>全部话题</h1><p>选择你感兴趣的话题，只看这个分类下的帖子</p></div>
    </div>
    ${adBannerHtml('top_banner')}
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;margin-top:16px">
      ${cards}
    </div>
    ${adFooterHtml('footer_bar')}`;
  bindCommon(container);
}

/* ---------- 广告招商页 ---------- */
function renderAds(container) {
  const ads = State.ads || [];
  const posName = { banner: '首页顶部横幅', sidebar: '右侧栏推荐位', infeed: '帖子列表内嵌', footer: '页脚通栏' };
  const items = ads.map((a) => `
    <div class="card">
      <div class="card-body" style="display:flex;gap:15px;align-items:flex-start;flex-wrap:wrap">
        <div style="width:64px;height:64px;border-radius:14px;flex:none;display:grid;place-items:center;font-size:28px;background:linear-gradient(135deg,#f0f3ff,#e6ebff)">
          ${a.position === 'banner' ? '🖼️' : a.position === 'sidebar' ? '📌' : a.position === 'infeed' ? '📰' : '🔻'}
        </div>
        <div style="flex:1;min-width:210px">
          <h3 style="margin:0 0 4px;font-size:16px">${esc(a.title)}</h3>
          <p style="margin:0 0 9px;font-size:13.5px;color:var(--text-2)">${esc(a.subtitle)}</p>
          <div style="display:flex;gap:7px;flex-wrap:wrap;font-size:12px">
            <span class="pill pill-on">${esc(posName[a.position] || a.slotName)}</span>
            <span class="pill pill-off">展示 ${a.impressions} 次</span>
            <span class="pill pill-off">点击 ${a.clicks} 次</span>
          </div>
        </div>
        <button class="btn btn-primary" type="button" data-ad="${esc(a.slotKey)}">查看微信名片</button>
      </div>
    </div>`).join('');

  container.innerHTML = `
    <div class="page-head">
      <div><h1>广告招商</h1><p>本站提供四个广告位，点击任意位置即可查看合作联系方式</p></div>
    </div>
    <div class="alert alert-info">四个招商位分别为：首页顶部横幅、右侧栏推荐位、帖子列表内嵌位、页脚通栏。点击「查看微信名片」会弹出站长的微信二维码与微信号，同时该广告位的点击数会 +1。</div>
    <div style="display:grid;gap:14px;margin-top:16px">${items}</div>
    <div style="margin-top:20px">${adBannerHtml('top_banner')}</div>
    ${adFooterHtml('footer_bar')}`;
  bindCommon(container);
}

/* ---------- 用户主页 ---------- */
async function renderUser(container, userId) {
  container.innerHTML = `<div class="card skeleton"><div class="skeleton-row"></div><div class="skeleton-row"></div></div>`;
  try {
    const isMe = State.me && String(State.me.id) === String(userId);
    const [profileRes, postsResult] = await Promise.all([
      api(`/api/users/${encodeURIComponent(userId)}`),
      api(`/api/posts?author=${encodeURIComponent(userId)}&pageSize=50&sort=new`),
    ]);
    const profile = Object.assign({}, profileRes.user);
    // 邮箱只对本人可见
    if (isMe && State.me.email) profile.email = State.me.email;

    const posts = postsResult.items || [];
    const rows = posts.map((p) => `
      <article class="post-item" data-post="${p.id}">
        <div class="post-main">
          <div class="post-title-row">
            <h3 class="post-title">${esc(p.title)}</h3>
            <span class="badge badge-topic" style="background:${esc(p.topic.color)}1a;color:${esc(p.topic.color)}">${esc(p.topic.name)}</span>
          </div>
          <p class="post-excerpt">${esc(p.excerpt)}</p>
          <div class="post-meta">
            <span>🕒 ${esc(timeAgo(p.createdAt))}</span><span>👁 ${p.views}</span>
            <span>💬 ${p.replyCount}</span><span>❤ ${p.likeCount}</span>
          </div>
        </div>
      </article>`).join('');

    container.innerHTML = `
      <div class="card">
        <div class="profile-hero">
          ${avatarHtml(profile, 'lg')}
          <div style="flex:1;min-width:0">
            <h1 class="profile-name">${esc(profile.nickname)}${profile.role === 'admin' ? ' <span class="badge badge-role">站长</span>' : ''}</h1>
            ${profile.email ? `<div class="profile-mail">${esc(profile.email)}</div>` : ''}
            <p class="profile-bio">${esc(profile.bio || '这个人很懒，还没有写简介。')}</p>
            <div class="profile-mail" style="margin-top:6px">加入于 ${esc(fullTime(profile.createdAt))}</div>
          </div>
          <div class="profile-stats">
            <div class="profile-stat"><b>${postsResult.total || 0}</b><span>帖子</span></div>
            <div class="profile-stat"><b>${profile.replyCount || 0}</b><span>回复</span></div>
          </div>
        </div>
      </div>
      <div class="card" style="margin-top:16px">
        <div class="card-head"><h3 class="card-title">${isMe ? '我发布的帖子' : 'TA 发布的帖子'}</h3><span class="card-sub">${postsResult.total || 0} 篇</span></div>
        ${rows || '<div class="empty"><div class="empty-icon">📝</div><p class="empty-text">还没有发过帖子</p></div>'}
      </div>
      ${adFooterHtml('footer_bar')}`;
    bindCommon(container);
  } catch (e) {
    container.innerHTML = `<div class="card"><div class="empty"><div class="empty-icon">⚠️</div><p class="empty-text">加载失败</p><p class="empty-sub">${esc(e.message)}</p></div></div>`;
  }
}

/* ---------- 站长后台 ---------- */
async function renderAdmin(container) {
  if (!State.me || State.me.role !== 'admin') {
    container.innerHTML = `<div class="card"><div class="empty"><div class="empty-icon">🔒</div>
      <p class="empty-text">需要站长权限</p><p class="empty-sub">请使用管理员账号登录后再访问本页</p></div></div>`;
    return;
  }
  container.innerHTML = `<div class="card skeleton"><div class="skeleton-row"></div><div class="skeleton-row"></div></div>`;
  try {
    const r = await api('/api/admin/overview');
    let tab = 'ads';

    function paint() {
      const s = r.stats;
      const adRows = r.ads.map((a) => `
        <tr>
          <td><strong>${esc(a.slotName)}</strong><div style="font-size:11.5px;color:var(--text-3)">${esc(a.slotKey)}</div></td>
          <td>${esc(a.title)}</td>
          <td><input class="input" style="height:32px;font-size:13px;width:130px" data-f="wechatId" data-id="${a.id}" value="${esc(a.wechatId)}" placeholder="微信号"></td>
          <td>${a.impressions} / ${a.clicks}</td>
          <td><span class="pill ${a.enabled ? 'pill-on' : 'pill-off'}">${a.enabled ? '展示中' : '已隐藏'}</span></td>
          <td><button class="btn btn-sm" type="button" data-savead="${a.id}">保存</button></td>
        </tr>`).join('');

      const userRows = r.users.map((u) => `
        <tr>
          <td style="display:flex;align-items:center;gap:8px">${avatarHtml(u, 'sm')}<span>${esc(u.nickname)}</span></td>
          <td style="font-size:12.5px">${esc(u.email)}</td>
          <td>${u.postCount}</td>
          <td>${esc(timeAgo(u.createdAt))}</td>
          <td>${esc(u.lastLoginAt ? timeAgo(u.lastLoginAt) : '—')}</td>
        </tr>`).join('');

      const mailRows = r.mailLog.map((m) => `
        <tr>
          <td>${esc(fullTime(m.createdAt))}</td>
          <td style="font-size:12.5px">${esc(m.to)}</td>
          <td>${esc(m.purpose)}</td>
          <td><span class="pill ${m.status === 'sent' ? 'pill-ok' : m.status === 'dev' ? 'pill-dev' : 'pill-fail'}">${esc(m.status)}</span></td>
          <td style="font-size:12px;color:var(--text-3);max-width:300px;overflow:hidden;text-overflow:ellipsis">${esc(m.error || '—')}</td>
        </tr>`).join('');

      const uploadRows = r.uploads.map((u) => `
        <tr>
          <td>${esc(u.filename)}</td>
          <td style="font-size:12.5px">${esc(u.storedName)}</td>
          <td>${Math.round(u.size / 1024)} KB</td>
          <td>${esc(fullTime(u.createdAt))}</td>
          <td><a href="/uploads/${esc(u.storedName)}" target="_blank" rel="noopener">查看</a></td>
        </tr>`).join('');

      container.innerHTML = `
        <div class="page-head">
          <div><h1>站长后台</h1><p>管理广告招商位、查看用户与发信记录</p></div>
          <a class="btn btn-sm" href="#/" data-nav style="margin-left:auto">返回前台</a>
        </div>
        <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));margin-bottom:16px">
          <div class="stat-box"><div class="stat-num">${s.users}</div><div class="stat-label">注册用户</div></div>
          <div class="stat-box"><div class="stat-num">${s.posts}</div><div class="stat-label">主题帖</div></div>
          <div class="stat-box"><div class="stat-num">${s.replies}</div><div class="stat-label">回复</div></div>
          <div class="stat-box"><div class="stat-num">${s.adClicks}</div><div class="stat-label">广告点击</div></div>
        </div>
        <div class="card">
          <div class="admin-tabs">
            <button class="btn btn-sm ${tab === 'ads' ? 'btn-primary' : ''}" type="button" data-atab="ads">广告招商位</button>
            <button class="btn btn-sm ${tab === 'users' ? 'btn-primary' : ''}" type="button" data-atab="users">用户列表</button>
            <button class="btn btn-sm ${tab === 'mail' ? 'btn-primary' : ''}" type="button" data-atab="mail">发信记录</button>
            <button class="btn btn-sm ${tab === 'files' ? 'btn-primary' : ''}" type="button" data-atab="files">已上传文件</button>
          </div>
          <div class="table-scroll">
            ${tab === 'ads' ? `<div class="alert ${r.smtpConfigured ? 'alert-info' : 'alert-warn'}" style="margin:14px 16px 0">
              ${r.smtpConfigured ? '邮件服务已配置，验证码将真实发送到用户邮箱。' : '邮件服务未配置：验证码目前只输出到服务端控制台。请在 config.json 的 smtp 段填入 QQ 邮箱与授权码后重启服务。'}
            </div>
            <table class="admin-table"><thead><tr><th>广告位</th><th>标题</th><th>微信号</th><th>展示/点击</th><th>状态</th><th>操作</th></tr></thead><tbody>${adRows}</tbody></table>` : ''}
            ${tab === 'users' ? `<table class="admin-table"><thead><tr><th>昵称</th><th>邮箱</th><th>发帖</th><th>注册</th><th>最近登录</th></tr></thead><tbody>${userRows || '<tr><td colspan="5" style="text-align:center;color:var(--text-3);padding:24px">还没有注册用户</td></tr>'}</tbody></table>` : ''}
            ${tab === 'mail' ? `<table class="admin-table"><thead><tr><th>时间</th><th>收件邮箱</th><th>用途</th><th>状态</th><th>说明</th></tr></thead><tbody>${mailRows || '<tr><td colspan="5" style="text-align:center;color:var(--text-3);padding:24px">还没有发信记录</td></tr>'}</tbody></table>` : ''}
            ${tab === 'files' ? `<table class="admin-table"><thead><tr><th>原始文件名</th><th>存储名</th><th>大小</th><th>上传时间</th><th>操作</th></tr></thead><tbody>${uploadRows || '<tr><td colspan="5" style="text-align:center;color:var(--text-3);padding:24px">还没有上传文件</td></tr>'}</tbody></table>` : ''}
          </div>
        </div>
        ${tab === 'files' ? `<div class="card" style="margin-top:16px">
          <div class="card-head"><h3 class="card-title">上传微信名片图片</h3></div>
          <div class="card-body">
            <p class="field-hint" style="margin-top:0">选择一张二维码图片（jpg/png/webp/svg，最大 5MB）。上传后把返回的地址填到上面对应广告位的图片字段，或直接替换 public/assets/wechat-card.svg。</p>
            <input type="file" id="adImageFile" accept=".jpg,.jpeg,.png,.gif,.webp,.svg" style="margin-bottom:10px">
            <div><button class="btn btn-primary btn-sm" type="button" id="btnUploadAd">上传</button>
            <span id="uploadResult" style="font-size:13px;color:var(--text-2);margin-left:10px"></span></div>
          </div>
        </div>` : ''}`;

      $$('[data-atab]', container).forEach((b) => {
        b.addEventListener('click', () => { tab = b.getAttribute('data-atab'); paint(); });
      });
      $$('[data-savead]', container).forEach((b) => {
        b.addEventListener('click', async () => {
          const id = Number(b.getAttribute('data-savead'));
          const wechatInput = $(`[data-f="wechatId"][data-id="${id}"]`, container);
          b.disabled = true; b.textContent = '保存中…';
          try {
            await api(`/api/admin/ads/${id}`, { method: 'PUT', body: { wechatId: wechatInput.value.trim() } });
            toast('广告位已更新', 'success');
            const fresh = await api('/api/admin/overview');
            Object.assign(r, fresh);
            State.ads = fresh.ads.filter((a) => a.enabled);
            paint();
          } catch (e) { toast(e.message, 'error'); b.disabled = false; b.textContent = '保存'; }
        });
      });
      const upBtn = $('#btnUploadAd', container);
      if (upBtn) upBtn.addEventListener('click', async () => {
        const fileInput = $('#adImageFile', container);
        const out = $('#uploadResult', container);
        const f = fileInput.files && fileInput.files[0];
        if (!f) { toast('请先选择一个图片文件', 'error'); return; }
        upBtn.disabled = true; upBtn.textContent = '上传中…';
        try {
          const buf = await f.arrayBuffer();
          const res = await fetch('/api/upload', {
            method: 'POST',
            headers: { 'X-Filename': encodeURIComponent(f.name), 'Content-Type': 'application/octet-stream' },
            body: buf, credentials: 'same-origin',
          });
          const data = await res.json();
          if (!res.ok || data.ok === false) throw new Error(data.error || '上传失败');
          out.innerHTML = `上传成功：<code>${esc(data.url)}</code>（可直接填入广告位图片字段）`;
          toast('上传成功', 'success');
        } catch (e) { out.textContent = `上传失败：${e.message}`; toast(e.message, 'error'); }
        upBtn.disabled = false; upBtn.textContent = '上传';
      });
    }
    paint();
  } catch (e) {
    container.innerHTML = `<div class="card"><div class="empty"><div class="empty-icon">⚠️</div><p class="empty-text">${esc(e.message)}</p></div></div>`;
  }
}

/* ===================== 主渲染 ===================== */
async function render() {
  const container = $('#app');
  markNav();
  const r = State.route;
  if (r.name === 'post') return renderPost(container, r.params.id);
  if (r.name === 'topics') return renderTopics(container);
  if (r.name === 'ads') return renderAds(container);
  if (r.name === 'user') return renderUser(container, r.params.id);
  if (r.name === 'admin') return renderAdmin(container);
  return renderHome(container);
}

async function loadBootstrap() {
  const r = await api('/api/bootstrap');
  State.boot = r;
  State.me = r.me;
  State.topics = r.topics || [];
  State.ads = (r.ads || []).filter((a) => a.enabled !== false);
  if (r.site && r.site.name) {
    document.title = `${r.site.name} · 动态论坛`;
    const sn = $('#siteName'); if (sn) sn.textContent = r.site.name;
    const fn = $('#footerName'); if (fn) fn.textContent = r.site.name;
  }
  const st = r.stats || {};
  const fs = $('#footerStats');
  if (fs) fs.textContent = `${st.users || 0} 位用户 · ${st.posts || 0} 篇帖子 · ${st.replies || 0} 条回复`;
  renderHeaderUser();
}

/* ===================== 启动 ===================== */
async function boot() {
  try {
    await loadBootstrap();
  } catch (e) {
    $('#app').innerHTML = `<div class="card"><div class="empty">
      <div class="empty-icon">⚠️</div><p class="empty-text">无法加载站点数据</p>
      <p class="empty-sub">${esc(e.message)}</p></div></div>`;
    return;
  }

  $('#searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#searchInput').value.trim();
    State.query.q = v;
    State.query.page = 1;
    State.query.topic = 'all';
    location.hash = v ? `#/search?q=${encodeURIComponent(v)}` : '#/';
    if (State.route.name === 'home') render();
  });

  State.route = parseHash();
  if (State.route.name === 'home' && State.route.params.topic) State.query.topic = State.route.params.topic;
  if (State.route.name === 'home' && State.route.params.q) State.query.q = State.route.params.q;
  await render();
}

boot();

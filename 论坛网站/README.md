# 青柚社区 · 动态论坛网站

一个**真实运行的动态论坛**：邮箱验证码注册登录、话题筛选、发帖回复点赞、四个广告招商位（点击弹出微信名片）。数据全部持久化在服务端本地数据库，关掉浏览器不会丢。

**零第三方依赖** —— 不需要 `npm install`，不需要联网装包，不需要 MySQL。只用 Node.js 内置能力（`node:http`、`node:sqlite`、`node:tls`、`node:crypto`），SMTP 发信客户端也是手写的。

---

## 一、快速开始

### 1. 确认 Node 版本

需要 **Node.js v22.5 或更高**（推荐 v22 LTS / v24），因为要用内置的 `node:sqlite`。

```powershell
node -v
```

### 2. 启动

双击项目根目录的 **`启动论坛.bat`**，浏览器会自动打开 <http://127.0.0.1:3000>。

也可以手动启动：

```powershell
cd 论坛网站
node src/server.js
```

关闭启动窗口（或在窗口里按 `Ctrl + C`）即停止服务。

### 3. 注册第一个账号 = 站长

**第一个注册的用户会自动成为站长**，登录后点右上角头像 → 「站长后台」即可配置广告位微信号、查看用户与发信记录。后续注册的都是普通用户。

---

## 二、配置 QQ 邮箱（关键一步）

不配置也能用：系统会进入**开发模式**，验证码直接显示在页面上并打印到启动窗口，注册登录流程完全可跑通。

要开启真实发信，编辑根目录的 **`config.json`**：

```json
"smtp": {
  "enabled": true,
  "host": "smtp.qq.com",
  "port": 465,
  "secure": true,
  "user": "123456789@qq.com",        ← 你的完整 QQ 邮箱地址
  "pass": "abcdefghijklmnop",         ← 授权码，不是 QQ 密码
  "fromName": "青柚社区"
}
```

### 怎么拿授权码

1. 浏览器登录 <https://mail.qq.com>
2. 顶部「设置」→「账户」
3. 找到「POP3/IMAP/SMTP/Exchange/CardDAV/CalDAV服务」
4. 开启「**POP3/SMTP服务**」或「**IMAP/SMTP服务**」
5. 按提示用手机发短信验证，页面会给出一个 **16 位授权码**
6. 把授权码填进 `config.json` 的 `smtp.pass`，保存后重启服务

> ⚠️ **授权码等同于邮箱密码**。`config.json` 不要上传到公开仓库、不要发给别人。

### 验证发信是否成功

启动窗口会打印 `[mail] 验证码已发送至 xxx@qq.com`；失败会打印具体原因。也可以登录站长后台看「发信记录」页签，状态含义：

| 状态 | 含义 |
|---|---|
| `sent` | 真实发送成功 |
| `dev` | 开发模式，未真实发信（验证码在控制台） |
| `failed` | 发送失败，右侧有原因 |

### 常见发信失败原因

| 现象 | 原因与解决 |
|---|---|
| `认证失败（535）` | 授权码错了，或 SMTP 服务没开启；**不能用 QQ 密码** |
| `发件人被拒绝（550/553）` | `smtp.user` 和授权码不是同一个邮箱 |
| `SMTP 超时` | 网络不通或端口被封，检查防火墙，或换 `port: 587` + `"secure": false` |
| `垃圾邮件（554）` | 发送太频繁，等一会儿再试 |
| 邮件收不到但状态是 sent | 去**垃圾箱**翻一下，把发件地址加白名单 |

### 正式对外部署前

把开发模式回退关掉，避免验证码泄露到控制台和日志文件：

```json
"security": { "devModeFallback": false }
```

---

## 三、配置微信名片（广告招商位）

四个广告位：**首页顶部横幅**、**侧栏推荐位**、**帖子列表内嵌**、**页脚通栏**。点击任意一个都会弹出微信名片。

### 方式 A：站长后台配置（推荐）

登录站长账号 → 头像菜单 → **站长后台** → 「广告招商位」页签 → 填微信号 → 保存。

同一页的「已上传文件」区可以直接上传二维码图片，上传后把返回的地址填到广告位图片字段。

### 方式 B：改配置文件

`config.json` 的 `ads` 段：

```json
"ads": {
  "wechatId": "your_wechat_id",       ← 你的微信号
  "wechatImage": "",                   ← 留空则用内置占位图
  "contactNote": "扫码或搜索微信号添加，备注「论坛合作」"
}
```

### 方式 C：替换名片图片

把你的微信二维码图片直接覆盖这个文件（保持文件名不变）：

```
public/assets/wechat-card.svg
```

换成 `.png` / `.jpg` 也可以，但要同步改 `config.json` 里的 `ads.wechatImage` 指向新路径，或上传到 `data/uploads/` 后填相对地址。

---

## 四、功能清单

### 账号与邮箱验证

- 注册三步：填邮箱 → 收 6 位验证码 → 设昵称和密码
- 密码登录 + **验证码免密登录**（忘记密码时的自救通道）
- 密码 scrypt 加盐哈希存储，每用户独立盐值，比对用 `timingSafeEqual` 防时序攻击
- 会话 Cookie `HttpOnly` + `SameSite=Lax`，服务端只存 token 的 HMAC 摘要（库被拖走也无法反推）
- 改密码后其他设备的会话全部失效
- 昵称全站唯一，邮箱/昵称/验证码均做格式与保留字校验

### 邮箱验证码安全

- 验证码**哈希存储**，数据库里看不到明文
- 60 秒内不可重发；单邮箱每小时 ≤ 5 次，单 IP 每小时 ≤ 20 次
- 单条验证码最多试错 5 次，超过即作废
- 默认 10 分钟过期
- 发信日志**不含验证码明文**

### 论坛核心

- **8 个预设话题**：站务公告、技术讨论、生活日常、创意设计、职场交流、学习成长、互助问答、自由灌水
- **话题筛选**：左侧栏点击即筛选，各话题独立计数，互不串扰
- **搜索**：标题、正文、作者昵称全文匹配
- **三种排序**：最新 / 最热（回复×3 + 点赞×2 + 浏览量加权）/ 最近回复
- **分页**：每页 10 条，页码与总数完整
- 发帖、编辑、删除（仅作者本人或站长）
- 回复、删除回复、帖子与回复各自独立点赞/取消赞
- 浏览量统计（同一访客 30 秒内不重复计数）
- 置顶帖支持
- 用户主页：公开资料 + 该用户全部帖子（**不泄露邮箱**）
- 个人简介编辑

### 广告招商

- 四个位置样式各不相同（横幅 / 侧栏卡片 / 信息流内嵌 / 页脚通栏）
- 点击弹出微信名片：二维码图 + 微信号（一键复制）+ 位置说明 + 报价
- **展示数与点击数自动统计**，站长后台可见
- 站长可随时停用某个位置，前台与接口同步消失

### 数据存储

所有数据都在 `data/forum.db`（SQLite），共 13 张表：

| 表 | 存什么 |
|---|---|
| `users` | 用户账号、密码哈希、简介、角色、计数 |
| `sessions` | 登录会话（token 哈希） |
| `codes` | 邮箱验证码（哈希存储） |
| `topics` | 话题分类 |
| `posts` / `replies` | 帖子与回复 |
| `likes` | 点赞记录（防重复赞） |
| `ads` / `ad_clicks` | 广告位配置与点击流水 |
| `mail_log` | 发信日志（脱敏） |
| `rate_log` | 限流计数（7 天自动清理） |
| `uploads` | 上传文件登记 |
| `settings` | 站点设置 |

上传的图片存在 `data/uploads/`。备份只需复制 `data/` 整个目录。

---

## 五、目录结构

```
论坛网站/
├─ 启动论坛.bat          ← 双击启动（推荐）
├─ config.json           ← 配置：站点/SMTP/安全/限流/广告
├─ README.md             ← 本文件
├─ src/
│  ├─ server.js          ← 服务入口，读取配置、启动 HTTP、优雅退出
│  ├─ routes.js          ← 接口层：路由、校验、鉴权、上传
│  ├─ db.js              ← 数据层：建表、种子数据、全部 CRUD
│  └─ smtp.js            ← 手写 SMTP 客户端 + 邮件模板
├─ public/
│  ├─ index.html         ← 单页入口
│  ├─ style.css          ← 样式（响应式，适配手机）
│  ├─ app.js             ← 前端逻辑（原生 JS，无框架）
│  └─ assets/
│     └─ wechat-card.svg ← 微信名片占位图（可替换）
└─ data/                 ← 运行时自动创建
   ├─ forum.db           ← 数据库（含 -wal / -shm）
   ├─ uploads/           ← 上传的图片
   └─ dev-codes.log      ← 开发模式验证码日志
```

---

## 六、常用配置项

`config.json` 里可以调：

```json
"site":     { "name": "站点名", "port": 3000, "host": "127.0.0.1" },
"security": {
  "codeTtlMinutes": 10,              // 验证码有效期
  "codeResendIntervalSeconds": 60,   // 重发间隔
  "maxCodesPerHourPerEmail": 5,      // 单邮箱每小时上限
  "sessionTtlDays": 7,               // 登录保持天数
  "passwordMinLength": 8,
  "devModeFallback": true            // 上线前改 false
},
"limits":   {
  "postTitleMaxLength": 80,
  "postContentMaxLength": 20000,
  "postsPerHourPerUser": 20,
  "repliesPerHourPerUser": 60,
  "uploadMaxBytes": 5242880,
  "uploadAllowedExtensions": [".jpg", ".png", ".gif", ".webp", ".svg"]
}
```

改完保存，重启服务生效。

### 端口被占用

启动窗口会提示 `EADDRINUSE`。把 `site.port` 改成 `3001` 等，或先关掉占用 3000 端口的程序。

### 让局域网内其他设备访问

把 `site.host` 改成 `"0.0.0.0"`，然后用 `http://你的内网IP:3000` 访问（需在 Windows 防火墙放行 Node.js）。

---

## 七、主要接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/bootstrap` | 站点初始化数据（话题、广告、统计、当前用户） |
| POST | `/api/auth/send-code` | 发送邮箱验证码（`purpose`: register / login） |
| POST | `/api/auth/register` | 注册（邮箱 + 验证码 + 昵称 + 密码） |
| POST | `/api/auth/login` | 密码登录 |
| POST | `/api/auth/login-by-code` | 验证码免密登录 |
| POST | `/api/auth/logout` | 退出登录 |
| GET | `/api/me` | 当前登录用户 |
| POST | `/api/me/profile` | 修改个人简介 |
| POST | `/api/me/password` | 修改密码（会使其他会话失效） |
| GET | `/api/topics` | 话题列表 |
| GET | `/api/users/:id` | 公开用户资料（不含邮箱） |
| GET | `/api/posts` | 帖子列表：`?topic=&q=&sort=&page=&pageSize=&author=` |
| POST | `/api/posts` | 发帖 |
| GET | `/api/posts/:id` | 帖子详情 + 全部回复 |
| PUT | `/api/posts/:id` | 编辑帖子 |
| DELETE | `/api/posts/:id` | 删除帖子 |
| POST | `/api/posts/:id/replies` | 回复 |
| DELETE | `/api/replies/:id` | 删除回复 |
| POST | `/api/like` | 点赞/取消赞（`targetType`: post / reply） |
| GET | `/api/ads` | 广告位列表 |
| POST | `/api/ads/:slot/click` | 点击广告位 → 返回微信名片并计数 |
| POST | `/api/upload` | 上传图片 |
| GET | `/api/admin/overview` | 站长后台概览（需站长权限） |
| PUT | `/api/admin/ads/:id` | 更新广告位（需站长权限） |
| POST | `/api/admin/users/:id/status` | 封禁/解封用户（需站长权限） |

---

## 八、已验证项

接口层跑过 **155+ 项端到端测试**，覆盖：

- 注册全流程与各类非法输入拦截（邮箱格式、弱密码、纯数字密码、过短昵称、保留昵称、错误验证码）
- 邮箱与昵称唯一性、验证码重发限流
- 密码登录、验证码登录、错误密码、未注册邮箱
- **登录失败提示统一**，不泄露账号是否存在（防用户枚举）
- 改密后旧密码失效、其他设备会话失效、当前会话保留
- 发帖/编辑/删除，**越权操作返回 403**
- 话题筛选互不串扰、搜索、三种排序、分页不重复、按作者筛选
- 回复、点赞与取消赞、浏览量累加
- **四个广告位全部返回微信名片**，展示数与点击数正确累加
- 站长后台权限（未登录 401 / 普通用户 403 / 站长 200）
- 广告位停用后前台与接口同步消失，重新启用后恢复
- 安全响应头（`nosniff` / `X-Frame-Options` / `Referrer-Policy` / `no-store`）
- **目录穿越防护**（`../`、`%2e%2e/`、`uploads/../../` 三种变体均拦截）
- 数据落库校验：用户、帖子、回复、验证码、发信日志、广告点击、点赞、会话
- **密码非明文、每用户盐值不同、会话与验证码均为哈希存储**
- **发信日志不含验证码明文**
- 公开资料接口不泄露邮箱与密码字段

---

## 九、安全说明

已做到的：

- 密码 scrypt 加盐哈希，绝不明文存储，接口永不回传密码字段
- 会话 token 只存 HMAC 摘要，Cookie `HttpOnly` 防 XSS 窃取
- 验证码哈希存储，限次限时限错
- 全部 SQL 使用参数化查询，无字符串拼接注入
- 前端所有用户输入经 HTML 转义后渲染，防 XSS
- 静态文件服务做路径规范化与根目录校验，防目录穿越
- 越权操作服务端校验（不能只看前端隐藏按钮）
- 上传文件只取 `basename`，白名单扩展名 + 大小限制
- 多层面限流：验证码、发帖、回复、登录失败
- 登录失败提示统一，防用户枚举

需要你自己注意的：

1. **`config.json` 含邮箱授权码，不要提交到公开仓库**。如果要传 Git，先加 `.gitignore`：
   ```
   config.json
   data/
   ```
   并提供一份 `config.example.json` 作为模板。
2. **上线前把 `security.devModeFallback` 改成 `false`**，否则验证码会留在控制台和 `data/dev-codes.log`。
3. **对外网部署必须加 HTTPS**。当前 Cookie 没设 `Secure` 标记（为了本地 http 能用），公网环境下建议用 Nginx/Caddy 做 TLS 反向代理。
4. 定期备份 `data/` 目录。
5. 当前没有内容审核机制，公开上线前建议加入敏感词过滤或人工审核。

---

## 十、二次开发提示

- **加话题**：改 `src/db.js` 里的 `DEFAULT_TOPICS`（仅在空库时生效），或直接往 `topics` 表插数据。
- **改配色**：`public/style.css` 顶部的 `:root` CSS 变量集中管理所有颜色。
- **加接口**：在 `src/routes.js` 的 `handleApi` 里按现有模式追加 `if (route === ... && method === ...)` 分支。
- **改种子内容**：`src/db.js` 里的 `SEED_POSTS`，同样只在空库时写入。
- **重置数据**：停服务 → 删除（或移走）`data/forum.db*` → 重启，会自动重建表结构和种子数据。

> Node 会提示 `ExperimentalWarning: SQLite is an experimental feature`，这是内置 SQLite 的正常提示，不影响使用，可忽略。

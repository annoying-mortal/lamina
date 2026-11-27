# Personal Blog (Lamina)

[English](README.md) | 简体中文

基于 **Astro**、**Three.js** 与 **Node.js** 构建的自托管静态个人博客、三维内容档案、作品志与本地内容工作台（CMS）系统。

项目以 `src/content/` 目录下的 Markdown 和 JSON 文件作为唯一数据源，无需外部数据库，同时内置单管理员 CMS 后台、便携 ZIP 备份恢复以及基于 Nginx 和 Docker Compose 的原子化静态发布流水线。

## 核心特性

- **五段式首页**：包含首屏轨道视觉、个人介绍与经历亮点（Highlights）、三维内容档案、个人精选“九部作品”（About me）以及联系方式与运行时间统计。
- **三维交互档案**：基于 Three.js（`src/archive/`）将博客文章、作品志与公开友链聚合到同一个可导航的三维空间中，并支持全站检索（`/archive-search.json`）。
- **Markdown 博客与 RSS**：直接读取 `src/content/blog/**/*.md`，支持动态分类、标签、阅读时长估算、Shiki 代码高亮、构建期 KaTeX 数学公式渲染以及 `/rss.xml`。
- **作品志与音频播放器**：支持记录 ACGN、音乐专辑（Albums，支持多曲目音频播放）、书籍（Books）与 Others，支持按类型、标签和曲名检索筛选。
- **友链目录与访客申请**：提供友链展示、站点信息一键复制以及可选的访客友链申请表单（内置蜜罐字段与按 IP 限流）。在纯静态托管场景下，可通过 `PUBLIC_FRIEND_APPLICATIONS=0` 或 `site.json` 中的 `friendApplicationsEnabled: false` 关闭表单。
- **本地内容工作台（CMS）**：内置 Node.js 后台服务（`admin/server.mjs`），支持中英双语界面、scrypt 密码哈希鉴权、CSRF/Origin 校验、`revision` 乐观锁并发控制、流式文件上传（`/static/`，单文件上限 256 MiB）以及带回滚快照轮转的 ZIP 便携备份与恢复。
- **原子化发布**：构建至隔离目录并校验通过后，原子切换 `.published/current` 软链接；若构建或校验失败，线上旧版本保持可用。

## 环境要求

- **本地运行**：Node.js `>= 24.0.0`
- **容器部署**：Docker 与 Docker Compose

## 快速开始

### 本地开发

安装依赖：

```sh
npm ci
```

在两个终端中分别启动前台开发服务和后台 CMS：

```sh
npm run dev
```

```sh
npm run admin
```

- **前台站点**：<http://127.0.0.1:4321/>
- **后台工作台**：<http://127.0.0.1:4322/>

首次访问后台页面时，直接在浏览器中设置管理员用户名和密码即可。

### 构建、校验与原子发布

```sh
npm run check                        # Astro 与 TypeScript 类型检查
npm run build                        # 构建静态产物到 dist/
npm run preview                      # 本地预览 dist/ 构建结果
npm run verify                       # 对 dist/ 执行全站完整校验
node scripts/verify.mjs --quick      # 快速校验（核心路由 + 抽样最新文章）
npm run publish                      # 构建、快速校验并原子切换 .published/current
```

若仅将静态产物托管在无后台服务的平台（如 GitHub Pages、Cloudflare Pages），可在构建时关闭友链申请表单：

```sh
PUBLIC_FRIEND_APPLICATIONS=0 npm run build
```

### Docker Compose 部署

默认命名卷模式（`blog-content`、`blog-uploads`、`blog-published`、`blog-admin`）：

```sh
docker compose up -d --build
```

宿主机目录挂载模式（直接在宿主机读写 `./src/content/` 与 `./public/static/`）：

```sh
docker compose -f compose.yaml -f compose.files.yaml up -d --build
```

- **前台 Nginx（只读容器）**：<http://127.0.0.1:8080/>
- **后台 CMS**：<http://127.0.0.1:4322/>

在 Docker Compose 模式下首次初始化管理员账号时，需在宿主机终端获取一次性初始化令牌：

```sh
docker compose exec admin cat /app/.admin/setup-token
```

## 环境变量与配置

### 站点与构建变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SITE_URL` | `http://localhost:4321`（Compose 下为 `http://localhost:8080`） | Astro 构建及来源校验使用的站点公开地址。 |
| `BUILD_OUTPUT_DIR` | `./dist` | `astro build` 与 `verify.mjs` 使用的输出目录。 |
| `SITE_PUBLISH_ROOT` | `./.published`（Compose 下为 `/published`） | 原子发布 `releases/` 与 `current` 软链接的根目录。 |
| `SITE_UPLOADS_DIR` | `./public/static`（Compose 下为 `/app/public/static`） | 上传文件存储目录。 |
| `PUBLIC_FRIEND_APPLICATIONS` | 读取 `site.json`（默认 `true`） | 设为 `0` 或 `false` 时在 `/friends/` 页面隐藏友链申请表单。 |
| `VERIFY_MODE` | `publish.mjs` 中为 `quick`，`npm run verify` 为 `full` | 在 `npm run publish` 中设为 `full` 可强制执行全量 HTML 校验。 |
| `VERIFY_SAMPLE_POSTS` | `3` | `quick` 快速校验模式下抽检的最新文章页面数量。 |

### 后台与代理变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `ADMIN_HOST` | `127.0.0.1`（容器内为 `0.0.0.0`） | CMS 服务监听地址。 |
| `ADMIN_PORT` | `4322` | CMS 服务端口。 |
| `ADMIN_SITE_URL` | `SITE_URL` 或 `http://127.0.0.1:4321` | 后台“打开网站”链接使用的前台地址。 |
| `ADMIN_AUTO_PUBLISH` | 未启用（Compose 下为 `1`） | 设为 `1` 时，CMS 保存和文件变更监听会自动触发 `scripts/publish.mjs`。 |
| `ADMIN_WATCH_CONTENT` | 随自动发布开启 | 设为 `0` 可关闭对外部文件修改的轮询监听。 |
| `ADMIN_ALLOWED_HOSTS` | 当前端口的回环地址 | 以逗号分隔的额外允许 `Host` 头列表。 |
| `ADMIN_AUTH_DIR` | `./.admin`（Compose 下为 `/app/.admin`） | 存放管理员凭据、恢复回滚快照和待处理友链申请的非公开目录。 |
| `ADMIN_LOOPBACK_PUBLISHED` | 未启用（Compose 下为 `1`） | 允许通过 Docker 私有网桥访问首次初始化（仍需终端一次性令牌）。 |
| `ADMIN_TRUST_PROXY_IP` | 未启用（Compose 下为 `1`） | 信任 Nginx 透传的 `X-Real-IP` 用于友链申请按 IP 限流。 |
| `ADMIN_SECURE_COOKIES` | 未启用 | 经 HTTPS 反向代理访问后台时设为 `1`，为 Cookie 添加 `Secure` 标记。 |
| `ADMIN_ALLOW_REMOTE_SETUP` | 未启用 | 与 `ADMIN_SECURE_COOKIES=1` 配合设为 `1`，允许经 HTTPS 与初始化令牌远程建号。 |

## 目录结构

```text
.
├── admin/                  # 本地 CMS 服务端、鉴权、流式上传、备份与后台前端资源
├── docs/                   # 写作指南与初始示例内容说明
├── examples/               # 示例文章模板
├── lib/                    # Node 与 Astro 共用的内容解析、Markdown 与设置工具
├── nginx/                  # 只读运行时 Nginx 配置
├── public/                 # 静态资源、本地字体、3D 模型与上传目录（/static/）
├── scripts/                # 内容初始化、原子发布、构建校验、预览与开发代理
├── src/
│   ├── archive/            # Three.js 三维档案场景与渲染模块
│   ├── components/         # Astro 组件（档案、音乐播放器、首屏轨道等）
│   ├── content/            # Markdown 文章（blog/）与 JSON 数据（site、library、friends）
│   ├── data/               # 站点、作品志与友链的类型化数据加载器
│   ├── layouts/            # 基础 HTML 布局与主题初始化脚本
│   ├── lib/                # 内容集合与搜索索引辅助模块
│   ├── pages/              # Astro 页面路由（/、/blog/、/library/、/friends/、/rss.xml 等）
│   ├── scripts/            # 前端交互与水合脚本
│   └── styles/             # 样式表
├── astro.config.mjs
├── compose.yaml
├── compose.files.yaml
└── Dockerfile
```

## 相关文档

- [写作与部署指南](docs/writing.md)
- [后台与 API 说明](admin/README.md)
- [初始示例内容说明](docs/content-examples.md)

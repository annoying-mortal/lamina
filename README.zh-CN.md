# Lamina

用于个人内容发布的网站模板，基于 Astro 构建，配备 Three.js 三维档案和基于文件的 CMS。

介绍自己、发布 Markdown 文章，并在交互式玻璃档案中收藏书籍、音乐及其他兴趣内容。内容保存在普通的 Markdown 和 JSON 文件中，可通过编辑器或内置 CMS 修改。

## 功能

- **首页与档案** — 个人介绍、亮点展示、联系方式，以及支持键盘、鼠标和触摸操作的三维档案。
- **Blog** — 分类、标签、草稿、搜索、文章目录、RSS、带复制按钮的代码高亮、脚注和 KaTeX 数学公式。
- **Library 与 Friends** — 收藏条目支持封面、评分、笔记和相关文章；友链支持头像、标签、排序和显示控制。
- **CMS** — 提供 Blog、Library、Friends、Media、Settings 和 Backup 六个栏目，支持中英文界面和站点设置实时预览。
- **外观** — 受 RhineLab 启发的日间与夜间主题、可配置的站点标识，以及相互独立的站点、档案和文章字体。
- **自行部署** — 静态前台与单管理员 Node.js 服务，支持 Docker 部署和 ZIP 内容迁移，无需外部数据库。

## 快速开始

本地开发需要 **Node.js 24+** 和 npm。

```sh
git clone https://github.com/annoying-mortal/lamina.git
cd lamina
npm ci
npm run dev
```

在另一个终端中进入同一目录，运行：

```sh
npm run admin
```

| 服务 | 地址 |
| --- | --- |
| 网站 | <http://127.0.0.1:4321/> |
| CMS | <http://127.0.0.1:4322/> |

打开 CMS，创建管理员账号。从 **Settings（设置）** 开始，修改站点名称、首页文案、导航、档案标签、联系方式和 Logo。在 CMS 中保存或直接修改本地文件，都会更新开发中的网站。

初始内容包括 Markdown 指南、Library 示例条目、Friends 友链和可编辑的 `Enter…` 占位文案。替换或删除这些记录，并取消自己内容上的 Demo 标记。详见[初始内容与图片来源](docs/content-examples.md)。

## 写作

在 `src/content/blog/` 下创建 `.md` 文件，也可以放在子目录中：

```md
---
title: My first post
date: 2026-01-01
tags: [notes]
draft: true
---

## A new beginning

Write your article here.
```

将 `draft` 设为 `false` 即可发布。草稿不会出现在公开页面、档案、Blog 列表和 RSS 中。通过 CMS 新建的文章默认为草稿；手写文章若省略 `draft` 字段，则默认公开。

| 可选字段 | 默认值 |
| --- | --- |
| `id`、`slug` | 根据相对文件路径生成 |
| `summary` | 从正文提取 |
| `categoryId` | 第一个已配置的 Blog 分类 |
| `tags` | 空列表 |
| `readTime` | 根据正文估算 |
| `draft`、`demo` | `false` |

显式设置唯一的 ID 和 slug，可在移动文件时保持地址不变。`pubDate` 和 `description` 分别可作为 `date` 和 `summary` 的别名。

可通过 **Media（素材库）** 上传图片，将文件放在 `public/` 下，或使用外部 HTTP(S) 图片地址。例如，`public/images/photo.jpg` 的引用地址为 `/images/photo.jpg`。素材上传支持 PNG、JPEG、GIF 和 WebP，**每张最大 10 MiB**。已有 SVG 文件可通过其 URL 用作 Logo。

[Markdown Guide](src/content/blog/markdown-guide.md) 展示了支持的排版格式。CMS 提供轻量预览，最终文字与公式排版以文章页面为准。字段规则、文件编辑和发布方式详见[写作指南](docs/writing.md)（中文）。

## Docker 部署

需要安装 Docker 及 Compose 插件。

### 通过 CMS 管理内容

```sh
docker compose up -d --build
```

网站地址为 <http://localhost:8080/>，CMS 地址为 <http://localhost:4322/>。两个端口均绑定到 `127.0.0.1`。

打开 CMS 初始化页面。如果页面要求初始化令牌，在服务器终端中获取：

```sh
docker compose exec admin cat /app/.admin/setup-token
```

输入令牌并创建账号。在 CMS 中保存后，网站会自动构建并发布；构建失败时，最近一次成功发布的页面仍可访问。上传文件独立于页面发布版本提供服务。

| 命名卷 | 保存内容 |
| --- | --- |
| `blog-content` | 文章、设置、Library、Friends 和素材索引 |
| `blog-uploads` | 上传的图片 |
| `blog-published` | 构建版本及当前生效的 `current` 链接 |
| `blog-admin` | 管理员凭据和恢复快照 |

Docker 从 [`admin/defaults/`](admin/defaults/README.md) 初始化文章和设置。此模式下，运行中的网站使用数据卷，不读取宿主机的 `src/content/`。

更新源码后，再次运行 `docker compose up -d --build`。重新构建会保留数据卷；`docker compose down -v` 会删除它们。通过 `docker compose logs -f admin` 查看发布日志。

### 与编辑器共享文件

新安装的站点如需使用宿主机上的内容和上传文件，可运行：

```sh
docker compose -f compose.yaml -f compose.files.yaml up -d --build
```

这会挂载 `./src/content/` 和 `./public/uploads/`，让编辑器与 CMS 使用同一份文件。两种方式的修改都会触发发布。后续命令也需同时使用这两份 Compose 文件。

可通过 `BLOG_CONTENT_DIR` 和 `BLOG_UPLOADS_DIR` 指定其他已存在的目录。在 Linux 上，需授予容器默认 UID/GID `1000:1000` 对这些目录的写入权限。已有数据卷模式的站点如需迁移，请参阅[文件夹迁移指南](docs/writing.md#已有命名卷先导出再切换)。

### 域名与访问

在本地 `.env` 中设置网站公开地址和宿主机端口：

```dotenv
SITE_URL=https://blog.example.com
PORT=8080
ADMIN_PORT=4322
```

修改 `SITE_URL` 后重新构建。生成 canonical 和 RSS 地址时，**Settings → Public URL** 的优先级更高；如果填写此项，请使用相同的地址。将 HTTPS 反向代理指向网站的本机回环端口。

CMS 可以保持私有，通过 SSH 隧道从自己的电脑访问：

```sh
ssh -N -L 4322:127.0.0.1:4322 user@your-server
```

随后打开 <http://localhost:4322/>。如需将 CMS 开放到公网，还需配置 Host、HTTPS Cookie 和初始化选项，详见 [CMS 运行配置](admin/README.md#运行配置)。

## 备份与恢复

在 **Backup（备份）** 中，点击 **Download ZIP** 可导出设置、文章（含草稿）、Library、Friends，以及内容引用且受支持的图片。可读取的本地图片和可下载的远程图片会打包并去重。图片引用仅在 ZIP 内改写；无法获取的图片会保留原地址并给出提示。

恢复时，选择备份文件，点击 **Inspect ZIP** 检查内容，然后确认 **Restore backup → Replace & restore**。恢复会替换内容和设置，保留已有上传文件及管理员账号，并在替换前保存恢复快照。

这些是内容备份。未引用的上传文件、凭据、字体、程序代码和生成的页面不在导出范围内。大小限制及手动恢复方式详见 [CMS 备份文档](admin/README.md#备份与恢复)。

## 字体

| 区域 | 英文 | 中文 |
| --- | --- | --- |
| 站点与 CMS 界面 | Geom | Alimama FangYuan，回退到 MiSans |
| 档案界面、3D 标签及档案／登录页文字标识 | MiSans | MiSans |
| 文章及 CMS Markdown 编辑器／预览 | JetBrains Mono Nerd Font Mono | LXGW WenKai |

KaTeX 使用自身的数学字体。字体栈定义在 [`public/typography.css`](public/typography.css) 中，可在 `/type-study/` 查看效果。

Alimama FangYuan 需单独提供。如需使用，请按所附[许可条款](public/fonts/alimama-fangyuan/LICENSE.txt)，从[记录的来源](public/fonts/alimama-fangyuan/SOURCE.json) 获取原始字体，将 WOFF2 文件放到：

```text
public/fonts/alimama-fangyuan/alimama-fangyuan.woff2
```

该字体文件已排除在 Git 和 Docker 构建上下文之外，Compose 会挂载字体目录。未提供文件时，站点中文使用 MiSans。完整来源和声明见[字体来源](public/fonts/FONT-SOURCES.md)。

## 开发

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动网站开发服务器，端口 4321 |
| `npm run admin` | 启动 CMS，端口 4322 |
| `npm run check` | 运行 Astro 和 TypeScript 诊断 |
| `npm run build` | 将静态网站生成到 `dist/` |
| `npm run preview` | 在本地提供 `dist/` 的访问服务 |
| `npm run verify` | 检查构建页面、链接、RSS 和档案资源隔离 |
| `npm test` | 运行自动化测试 |
| `npm run publish` | 构建、验证，并在 `.published/` 中启用新的本地发布版本 |

运行 `npm run verify` 前，先执行 `npm run build`。部署独立静态前台时，将 `dist/` 的内容交给静态服务器提供访问。`npm run publish` 则更新 `.published/current` 链接，供已有静态服务器读取。

设置 `ADMIN_AUTO_PUBLISH=1` 可启用本地 CMS 自动发布；Compose 默认已启用。`ADMIN_WATCH_CONTENT=0` 会关闭外部文件监听，同时保留 CMS 保存后的发布行为。

```text
admin/             CMS 服务端与界面
  defaults/        新 Docker 安装使用的初始内容
src/
  archive/         Three.js 场景与交互
  content/         Markdown 文章与 JSON 设置／收藏数据
  pages/           Astro 路由
  components/      站点组件
  styles/          页面样式与主题颜色
public/            模型、字体、图片及上传文件
lib/               共享的内容解析与校验
scripts/           初始化、发布与检查
nginx/             静态前台配置
docs/              写作与初始内容指南
```

`src/content/` 中的站点内容纳入版本管理，生成的素材索引除外。上传文件、凭据、环境文件和生成产物由 [`.gitignore`](.gitignore) 排除。修改新 Docker 安装所使用的示例内容时，请同步更新 `admin/defaults/`。

## 致谢与许可证

档案场景和卡匣模型改编自 [LBEILC/RhineLabUI](https://github.com/LBEILC/RhineLabUI)，上游版本、MIT 声明和模型署名记录在 [THREE-ATTRIBUTION.md](THREE-ATTRIBUTION.md) 中。首页与写作流程的灵感来自 [Nick Chen's blog](https://nickchen.top/) 和 [Astro Theme Hiro](https://github.com/nick-cjyx9/astro-theme-hiro)。

Lamina 尚未声明项目整体许可证。字体和示例图片各自保留相应声明，详见[字体来源](public/fonts/FONT-SOURCES.md)与[初始内容](docs/content-examples.md)。

# 用 Markdown 或 CMS 写文章

文章的源文件只有一份：`src/content/blog/` 中的 Markdown。你可以用本地编辑器创建文件，也可以在内容工作台创建、编辑同一份文章。Home 三维档案、Blog 列表、正文和 RSS 都读取这份内容，不需要另建目录索引或把正文导入数据库。

## 新建第一篇文章

在项目根目录创建 `src/content/blog/my-first-post.md`，内容最少只需标题、日期和正文：

```md
---
title: Enter post title
date: Enter date (YYYY-MM-DD)
---

## Enter heading

Enter content.
```

这些占位符需要先填写，尤其日期必须替换为有效的 `YYYY-MM-DD`。也可以复制仓库的草稿模板；目标文件已存在时，请使用另一个文件名，避免覆盖自己的文章：

```sh
cp -n examples/my-first-post.md src/content/blog/my-first-post.md
```

复制后先填写标题、有效日期、tag 与正文，保留 `draft: true` 可继续写作；准备发布时再改为 `false`。日期占位符不可直接保存进内容目录参与构建。

只支持 `.md`，不支持 `.mdx`。可按主题或年份创建子目录，例如 `src/content/blog/notes/first-post.md`。文件默认是公开文章；尚未写完时请加上 `draft: true`，或在 CMS 勾选 Draft（草稿）。

## 预览与发布

### 本地编辑

首次使用先运行 `npm ci`。两个终端分别启动：

```sh
npm run dev
```

```sh
npm run admin
```

前台是 <http://127.0.0.1:4321/>，CMS 是 <http://127.0.0.1:4322/>。保存 `.md` 后，开发服务自动读取变化；CMS 重新载入文章列表后，也能编辑手写文件。后台首次访问需要由你设置管理员用户名和密码。

开发预览不是正式发布。两种产物的用途不同：

| 命令 | 产物 | 用途 |
| --- | --- | --- |
| `npm run build` | `dist/` | 一次普通静态构建，可用 `npm run preview` 预览 |
| `npm run publish` | `.published/releases/`，并切换 `.published/current` | 构建、验证成功后发布，供使用 `current` 的静态服务读取 |

`npm run publish` 不会把内容上传到外部平台，也不会启动网页服务器。它默认发布到项目的 `.published/`，可用 `SITE_PUBLISH_ROOT` 指定发布目录。失败时退出并保留旧 `current`；普通 `npm run build` 不会更新该链接。

若本地另有静态服务读取 `.published/current`，可以在启动后台时开启自动发布：

```sh
ADMIN_AUTO_PUBLISH=1 npm run admin
```

此时 CMS 保存和内容目录中的外部修改都会触发发布。默认监听内容与上传文件变化；设置 `ADMIN_WATCH_CONTENT=0` 可关闭外部文件监听，CMS 保存仍按自动发布设置处理。无需为了预览本地开发页而开启生产构建。

### Docker 直接使用宿主机文件

新项目推荐使用可选覆盖文件，让编辑器和容器 CMS 读写相同目录：

```sh
docker compose -f compose.yaml -f compose.files.yaml up -d --build
```

前台为 <http://localhost:8080/>，CMS 为 <http://localhost:4322/>。默认挂载关系：

| 宿主机 | 容器用途 |
| --- | --- |
| `./src/content/` | CMS 与构建读取文章、站点设置、Library、友链及素材索引 |
| `./public/uploads/` | CMS 写入图片，Nginx 只读提供 `/uploads/` |
| 原有 `blog-published` 命名卷 | 发布版本与 `current` |
| 原有 `blog-admin` 命名卷 | 管理员凭据 |

Compose 已开启自动发布。直接保存 Markdown、在 CMS 保存文章，均会进入同一发布流程。后续 `up`、`stop`、`logs` 等操作都应继续带上相同的两份配置文件。

可以通过 `BLOG_CONTENT_DIR`、`BLOG_UPLOADS_DIR` 改用其它宿主目录。这些变量只用于 Docker Compose 挂载，不会改变本地 `npm run dev` 读取的项目路径。相对路径以主 `compose.yaml` 所在目录为基准。

**全新站点可以使用空内容目录，已有站点应迁移完整内容。** 空目录首次启动会从 `admin/defaults/` 填入站点占位设置、Blog 示例与模板、Library 六个初始条目和 Friends 两个初始条目；此后删除示例或清空列表不会重新生成。已有内容目录不会混入示例，仅补缺失的站点设置和空的 Library／Friends 文件。对于尚未使用命名卷的新项目，可以准备专用空目录：

```sh
mkdir -p ../personal-blog-files/content ../personal-blog-files/uploads
BLOG_CONTENT_DIR=../personal-blog-files/content \
BLOG_UPLOADS_DIR=../personal-blog-files/uploads \
docker compose -f compose.yaml -f compose.files.yaml up -d --build
```

请把所选变量保存在本地 `.env` 或后续每次使用相同的值；`.env` 不应提交到仓库。配置要求目录已经存在，避免拼错路径后自动生成空目录。

若要沿用本地编辑过的站点，请改为复制完整 `src/content/` 与 `public/uploads/`，或直接使用默认文件夹挂载。Docker 镜像本身只包含 `admin/defaults/` 的初始示例，不会把本地个人文章或 CMS 设置打包为新站点的默认内容。

Linux 上，容器中的内容工作台以 UID/GID `1000:1000` 运行；宿主内容目录和上传目录需允许该用户读写。只调整这些专用内容目录的权限，避免将整个项目开放为任意用户可写。

### 已有命名卷：先导出，再切换

只运行 `docker compose up -d --build` 时，仍使用原来的命名卷。此模式不会读取宿主 `src/content` 的日常改动。直接增加 `compose.files.yaml` 会改用宿主文件，**不会自动合并原卷数据**，也不会自动导出它们。

已通过原模式发布过内容时，不要直接把仓库模板目录挂进去。先在原项目目录下停止服务，导出旧容器中的内容和图片到一个新的空目录。以下命令假定原 `admin` 容器仍存在；停止的容器也可复制文件：

```sh
docker compose -f compose.yaml stop admin blog
mkdir ../personal-blog-export
mkdir ../personal-blog-export/content ../personal-blog-export/uploads
docker compose -f compose.yaml cp admin:/app/src/content/. ../personal-blog-export/content/
docker compose -f compose.yaml cp admin:/app/public/uploads/. ../personal-blog-export/uploads/
```

确认导出目录包含自己最新的文章、`site.json`、`library.json`、`friends.json`、素材索引（若有）和上传图片，并单独备份。只有确认完整后，再让两份配置使用导出的目录：

```sh
BLOG_CONTENT_DIR=../personal-blog-export/content \
BLOG_UPLOADS_DIR=../personal-blog-export/uploads \
docker compose -f compose.yaml -f compose.files.yaml up -d --build
```

把这两个路径记入本地 `.env`，继续使用原 Compose 项目名，不要更换 `-p` 或 `COMPOSE_PROJECT_NAME`，这样原发布卷和凭据卷仍被复用。原内容卷、上传卷没有被删除，可保留为迁移备份，但切换后它们不会继续收到更新。不要执行 `down -v`。如果原容器已删除，应先按原命名卷配置恢复容器或单独导出卷，再继续迁移；不要从仓库模板目录替代真实内容。

## 可选字段与默认值

```md
---
id: MY-001
slug: notes-my-first-post
title: Enter post title
date: Enter date (YYYY-MM-DD)
summary: Enter summary
categoryId: thinking
tags: [Enter tag]
readTime: 3
draft: false
demo: false
---

Enter content.
```

| 字段 | 未填写时的行为 |
| --- | --- |
| `id` | 根据相对文件路径生成稳定的 `FILE-…` 标识 |
| `slug` | 根据相对文件路径生成网址，例如 `notes/first-post.md` 对应 `notes-first-post`；中文等不能直接使用的路径采用 `post-…` 稳定哈希 |
| `summary` | 从正文自动提取摘要 |
| `categoryId` | 使用站点设置中的第一个文章分类 |
| `tags` | 空标签列表 |
| `readTime` | 根据正文自动估算阅读分钟数 |
| `draft` | `false`，文章会公开 |
| `demo` | `false`，不标为示例内容 |

`id` 和 `slug` 应保持唯一。基于路径推导时，重命名或移动文件可能改变 ID 和网址；需要固定地址时，显式填写并保留这两个字段。`slug` 只接受小写英文字母、数字和中间的连字符，不带斜线。分类 ID 来自站点设置，请使用已存在的分类；不确定时可省略。日期使用 `YYYY-MM-DD`。

为兼容 Hiro 写作习惯，也接受 `pubDate` 作为 `date` 的别名、`description` 作为 `summary` 的别名。例如：

```md
---
title: Enter post title
pubDate: Enter date (YYYY-MM-DD)
description: Enter summary
---

Enter content.
```

建议每组只选一种字段名。当前项目的分类、草稿与发布规则仍以本项目为准，并不等于支持 Hiro 的所有扩展。

也接受带时区的 ISO 时间戳，例如 `pubDate: 2026-01-01T08:30:00Z`，按 UTC 日期归档。CMS 保存时会统一写为 `date`、`summary`，去掉对应的兼容别名，其他自定义字段仍保留。以 `.` 或 `~` 开头的文件、目录视为隐藏文件或编辑器备份，不作为文章发布。

## 正文图片

将文件放到 `public/uploads/`，或在 CMS 素材库上传，再引用公开路径。也可引用 HTTPS 图床；日常浏览由访客浏览器直接加载。主动在 CMS 的 Backup 中导出 ZIP 时，后台会尝试下载引用的外链图片，并把备份内的图片地址改为可迁移的本地地址；无法下载的图片保留原 URL 并给出提示，当前源文件不会被导出操作修改。

```md
![Enter image description](/uploads/my-photo.jpg)

![Enter image description](https://images.example.com/my-photo.webp)
```

以上图片地址只是语法示例，使用前换成真实文件或地址。不要写 `/public/uploads/…`，也不要填写自己的电脑绝对路径。Docker 文件夹模式下，应把图片放进当前 `BLOG_UPLOADS_DIR` 所指的目录。CMS 素材库会维护上传索引；直接复制到目录的文件可按 URL 引用，不代表它已经出现在素材库列表中。

## 数学公式与正文排版

行内公式使用 `$…$`，独立公式使用单独成行的 `$$`：

```md
Inline formula: $\frac{1}{2}=0.5$.

$$
F=\frac{GMm}{r^2}
$$
```

公式在构建时通过 KaTeX 渲染，字体随站点提供，不需要外部公式 CDN。代码块、行内代码中的美元符号保持原样；普通文字要显示美元符号时可写 `\$`。无法识别的公式会保留并标红，悬停可查看错误，不会中断整站构建。CMS 编辑器目前提供轻量预览，公式最终排版请通过文章页面检查。

Markdown 中单次换行通常仍属于同一段；新段落之间留一空行，强制换行可在行尾添加两个空格。二、三级标题（`##`、`###`）会生成文章目录；没有这些标题时不显示空目录。

## 同步、冲突和发布失败

CMS 每次保存都校验读取时的版本。如果你在编辑器里修改了文件，而 CMS 仍打开旧版本，保存会报告冲突，不会静默覆盖外部修改。先复制保留尚未保存的文本，再重新加载最新文件，合并后保存。文件在编辑期间被移动或删除时，也应先重新载入列表。

自动发布会合并连续保存，并将构建期间的新修改排入后续发布。格式错误、字段校验失败或构建失败时，新源文件仍保留，之前成功发布的页面继续服务；在 CMS 发布状态与后台日志查看原因，修正后再次保存，或手动重新发布。监听异常也会在发布状态中显示；关闭监听后，需要通过 CMS 发布操作或 `npm run publish` 更新正式页面。

若尚未成功发布过任何版本，就没有可供保留的旧站点。上传目录由 Nginx 直接提供，不随文章的 `current` 链接回滚；覆盖同名图片会立即影响引用它的旧页面，替换图片时建议使用新文件名。

## 参考来源

内容组织借鉴作者公开的 [Astro Theme Hiro](https://github.com/nick-cjyx9/astro-theme-hiro)：固定 Markdown 目录与 CMS 写回同一份文件。它采用 [MIT 许可证](https://github.com/nick-cjyx9/astro-theme-hiro/blob/master/LICENSE)，其 Decap CMS 使用 GitHub backend；本项目继续使用自己的本地内容工作台和容器发布流程。

公开 Hiro 模板的首页与当前 [nickchen.top](https://nickchen.top/) 的完整线上 UI 存在差异。本项目没有迁移该模板，也没有把它的 Cloudflare／D1 依赖作为文件写作的前提。

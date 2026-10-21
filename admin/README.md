# 本地内容工作台

在项目根目录的两个终端分别启动前台和后台：

```sh
npm run dev
```

```sh
npm run admin
```

前台为 <http://127.0.0.1:4321/>，后台为 <http://127.0.0.1:4322/>。后台直接读写项目内容，前台开发服务器会自动检测保存。容器模式的前台默认为 8080，后台仍为 4322。

本地编辑器与 CMS 共用 `src/content/blog/` 中的 Markdown。直接新增 `.md` 文件后，重新载入后台文章列表即可继续编辑，不需要导入数据库。最小文章、自动字段、图片与部署说明见 [写作指南](../docs/writing.md)。

界面默认 English，右上角 EN / 中文可切换后台语言；站点文案、文章、标签等用户内容保持原样。

## 管理员登录

首次访问 `/` 或 `/login` 会显示身份确认页面，由你设置管理员用户名和密码。用户名为 3–32 个英文大小写字母、数字、点、下划线或连字符，以字母或数字开头，区分大小写。没有默认密码，也不会自动代设密码。密码需为 12–128 个字符，支持中文和空格；前后空格属于密码，不会被裁剪。初始化后同一页面同时验证用户名与密码。

这是单管理员工作台。旧版 `admin` 账号与密码哈希保持兼容，可使用原密码登录，再通过右上角“账号设置”修改用户名。账号设置需输入当前密码；新密码留空仅更改用户名，填写时需再次确认。成功保存会轮换当前会话与安全令牌，并使其他已登录会话失效。账号表单独立于文章编辑器，密码不会进入未提交内容的恢复存储。

密码使用随机盐和 scrypt（N=32768、r=8、p=1）保存为哈希，凭据位于非公开 `.admin/auth.json`，权限为 `0600`。该目录已排除 Git 和 Docker 构建上下文。容器将独立 `blog-admin` 卷挂载到 `/app/.admin`，只供后台使用，不对前台或素材服务器公开。

登录后使用 HttpOnly、SameSite=Strict cookie，最长有效期 12 小时；会话只保存在服务器内存，退出、到期或重启后台即失效。页面打开前的 CSRF token 与登录后的会话 token 独立，成功登录会轮换 token。登录失败使用统一提示；每个来源 15 分钟内最多 6 次失败尝试，并有全局限制。成功登录会清理相应失败计数。

首次初始化默认接受本机访问；HTTPS 远程初始化见[运行配置](#运行配置)。Docker Compose 显式设置 `ADMIN_LOOPBACK_PUBLISHED=1`，允许本机经私有网桥访问初始化；此设置必须与 `127.0.0.1` 发布端口配合，并额外需要一次性初始化令牌。打开初始化页后在本机终端执行 `docker compose exec admin cat /app/.admin/setup-token`，将返回值填入页面；令牌存在非公开凭据卷，权限为 `0600`，不会经 API 返回，初始化成功后删除。本机直接启动 Node 时从 loopback 访问无需令牌。所有内容／设置／媒体／发布 API 均要求有效会话，上传同样需要登录。

如忘记密码，没有在线重置接口。先停止后台，备份 `.admin/auth.json`（容器中位于 `blog-admin` 卷），然后由本机管理员移走该文件，再启动后台并亲自重新初始化。此操作不改动文章、收藏或素材；凭据备份需私密保存。

## 六个管理栏目

| 栏目 | 操作 |
| --- | --- |
| Blog | 新增、编辑、删除，Markdown 编辑／预览，插入图片，草稿与发布 |
| Library | 音乐／书籍／影视记录，标签、封面、评分、短评及关联文章 |
| Friends | 站名、网址、头像或文字标识、简介、标签、顺序、显隐 |
| Media | 上传图片、预览、复制地址和 Markdown |
| Settings | 基本身份、首页与档案文案、导航、栏目介绍、文章分类、主题及页脚 |
| Backup | 导出 ZIP、检查导入内容、确认恢复，替换前自动保存回滚快照 |

编辑后使用 Save 或 `⌘ / Ctrl + S`。编辑区顶部的 Save 和修改状态固定显示，无需滚动到底部。有未保存修改时，切换栏目或记录会提示确认。保存采用临时文件加原子替换；同一记录被其他窗口或本地编辑器更新时，`revision` 校验会拒绝旧修改，避免静默覆盖。遇到冲突应先保留编辑中的文本，再重新载入最新内容并合并。删除文章、收藏和友链需再次确认，没有回收站。

友链 ID 在新建时自动生成，编辑时沿用已有 ID，普通表单不显示此字段。修改名称、网址或显示顺序不会新建一条友链；JSON 与 API 仍保留 ID，用于定位记录。

### 文章与草稿

新建文章默认勾选 Draft（草稿）。草稿不会出现在 Home、Blog、RSS 中，不生成公开文章页，后台也不提供公开页面跳转。取消草稿并保存后才会公开。

手写文件最少需要 `title`、`date` 与正文；`summary`、`readTime`、`id`、`slug` 等缺省值由文件读取流程生成，CMS 读取到的是同一组值。支持子目录和 Hiro 的 `description`／`pubDate` 别名，仅支持 `.md`，不支持 `.mdx`。手写文件未填 `draft` 时默认为公开，与 CMS 新建表单默认勾选草稿不同。

创建后的 ID 保持不变；文章 slug 可编辑，但会改变其网址。正文使用 Markdown，预览安全地构建文本和图片 DOM，不执行原始 HTML。完整字体、代码高亮和文章排版以公开页面为准。

文章分类来自站点设置，可以新增、改名和删除。被任何文章（包括草稿）引用的分类无法删除，后台会提示关联文章；先迁移文章，再删除分类。标签仍可自由填写。

### 站点设置与友链

站点设置可修改站名、浏览器标题、介绍、公开网址、GitHub／邮箱、Logo、Favicon、默认主题、首页文案及各栏目文案。首页标题和简介支持换行，简介中的 `{name}` 会替换为站点名称。

Settings 的预览窗口直接读取尚未保存的表单值，可查看 Home、About、Archive、Contact、Blog、Library 与 Friends。聚焦对应字段会自动切换预览，也可手动选择页面及预览主题；预览操作不会保存或发布内容，完成后点击 Save。

Home 现在按首页、个人介绍、三维内容档案、联系与运行时间四段展示。About 和 Contact可分别编辑眉题、标题和正文。启用时间 `launchedAt` 使用带时区格式，例如 `2026-10-20T21:28:15+08:00`，也可填写 UTC 的 `Z` 格式。前台按该日期计算天、时、分、秒；清空则不显示计时。此数值表示自启用以来的时间，不是服务健康监控。联系页直接使用既有邮箱、GitHub 和 RSS 设置。

About 下的 Highlights 用于简短展示个人成就、教学实践、项目或经历，最多六条，可新增、删除和排序。每条包含 Label、Title、Summary、Period 与可选 HTTP(S) URL，只有 Title 必填。表单修改即时呈现在 About 预览中；语言切换和会话恢复保留当前记录与顺序。对应 JSON 字段为 `aboutHighlights: [{ label, title, description, period, url }]`；旧设置未提供该字段时使用三条英文占位，填写 `[]` 可清空展示。

默认主题可选跟随系统、日间或夜间；访客已有的手动选择优先。导航项可修改文字、调整顺序和显隐，隐藏不等于删除页面。RSS 开关只影响订阅入口，`/rss.xml` 仍保留。示例说明由独立勾选框控制。

友链的顺序值越小越靠前，取消“在友链页面显示”可暂时隐藏。头像可用图片，留空则使用文字标识；站点域名从网址自动提取。

### 上传与使用图片

在“素材库”点击“上传图片”，或从任何图片选择器内上传。支持 **PNG、JPEG、GIF、WEBP，每张最大 10 MiB**。SVG 不提供上传，但可填写已有 `public` 文件地址或 HTTP(S) 图床地址。

所有图片输入都支持两种来源：

- 站内文件：上传内容保存在本地 `public/uploads/`，使用 `/uploads/文件名`。已有 `public/covers/example.svg` 对应 `/covers/example.svg`，路径不带 `/public`。
- 外链图片：直接填写 `http://` 或 `https://` 地址，访客浏览器直接加载。日常编辑不代理或下载；主动导出备份时会尝试下载引用的图片并打包。

正文点击“插入图片”，选择已上传素材或填写地址，再输入图片说明；保存后即成为 Markdown 插图。也可在素材库复制 Markdown，或手动填写：

```md
![Enter image description](</uploads/example.png>)

![Enter image description](<https://images.example.com/photo.webp>)
```

收藏封面、友链头像、Logo 和 Favicon 共用同一个图片选择器，均可即时预览。空收藏封面显示文字封面，空友链头像显示文字标识，空 Logo 仅显示站名，不生成字母标识。自己的 SVG 可放在 `public/logo.svg`，Logo 地址填写 `/logo.svg`（也支持 SVG 外链）。首页圆环与登录页图形使用 Settings 中的圆环图片（`orbitImage`）。Favicon 需保留有效地址，默认 `/favicon.svg` 为透明占位，可用自己的文件替换。

图片 URL 可被多篇文章和多个栏目复用。素材库不提供删除，也不会自动清理未引用图片，避免造成已有文章断图。素材索引 `src/content/media.json` 只供后台使用，不作为前台公开文件；上传图片本身可通过 `/uploads/` 访问。

## 备份与恢复

进入 **Backup → Download ZIP** 导出当前站点。ZIP 包含站点设置、全部文章（含草稿及原始子目录）、Library、Friends 和这些内容引用的图片。可读取的本地图片与可下载的外链图片会按内容哈希去重，备份内的引用改为 `/uploads/backup-…`；导出不会修改正在使用的源文件。恢复后这些图片可独立使用，不再依赖原图床地址。无法读取、不可访问或不符合图片限制的地址保留原值，并记录在清单的 `warnings` 中；下载后会显示提示条数，可在 Import 中检查同一 ZIP 查看详情。

导入分两步：选择 ZIP 后点击 **Inspect ZIP**，检查文章、收藏、友链、图片数量及提示；检查本身不会修改站点。点击 **Restore backup** 后，还需在确认窗口点击 **Replace & restore**。恢复会替换设置、文章、收藏与友链，补入备份图片和素材索引；未被备份引用的已有上传文件不会删除。成功后页面重新载入，更新品牌、分类、记录和素材列表，并清除旧的未保存编辑暂存，避免误恢复到导入前的内容。

预览令牌绑定当前登录会话，有效期 15 分钟；服务器最多保留三个待恢复预览，重启后失效。如果预览后内容有变动、发布正在运行，或恢复尝试失败，需重新点击 Inspect ZIP 再确认。导出、检查及恢复期间应保持页面打开。

替换前自动保存 `before-restore-…zip` 回滚快照，位置为 `ADMIN_AUTH_DIR/backups/`，默认是项目 `.admin/backups/`，Docker 中为非公开凭据卷下的 `/app/.admin/backups/`。快照文件权限为 `0600`，目前不会自动删除；应按需妥善保管并清理旧快照。快照使用 `personal-blog-recovery` 格式，保存恢复前的原始文件，即使原内容已损坏也可留存；它供本机管理员手动恢复，不能直接通过 Import 导入。需要可直接导入的备份时，应使用 Download ZIP。文件写入失败时，后台会尝试立即还原已变更文件，错误信息会给出可用的快照文件名。

ZIP 不包含管理员凭据、会话、字体、程序代码或已构建页面，导入也不改变管理员账号与密码。它用于迁移内容；部署文件、字体和私密凭据仍应按原有方式备份。启用自动发布时，成功恢复会触发一次发布；构建状态仍显示在页面顶部。

备份格式为 `personal-blog-backup` 版本 `1`，允许的结构如下：

```text
manifest.json
content/site.json
content/library.json
content/friends.json
content/media.json
content/blog/<原始子目录与文件名>.md
images/backup-<sha256>.<图片扩展名>
```

`manifest.json` 含 `format`、`version`、`createdAt`、`summary`、`warnings` 及 `files: [{ path, size, sha256 }]`。检查会验证路径、ZIP 结构、每个文件的大小与 SHA-256、内容格式及记录关系。仅接受本格式 ZIP；不支持加密、多卷或 ZIP64。限制为压缩文件 256 MiB、解压总量 512 MiB、10,000 个条目、每张图片 20 MiB、每份 JSON 8 MiB、每篇 Markdown 2 MiB。普通素材上传仍保持每张 10 MiB 的限制。

## 内容位置与持久化

| 路径 | 内容 |
| --- | --- |
| `src/content/blog/**/*.md` | YAML 元数据和 Markdown 正文，支持子目录 |
| `src/content/library.json` | Library收藏 |
| `src/content/friends.json` | Friends |
| `src/content/site.json` | 站点设置和动态分类 |
| `src/content/media.json` | 上传素材索引 |
| `public/uploads/` | 上传图片文件 |

默认 `compose.yaml` 使用四个命名卷：`blog-content` 保存上述内容及索引，`blog-uploads` 保存图片，`blog-published` 保存发布版本，`blog-admin` 保存非公开管理员凭据。后台写入上传卷，Nginx 只读挂载并直接提供图片。首次部署从 `admin/defaults/` 填充示例与模板，镜像不包含宿主 `src/content/` 中的个人内容。旧内容卷升级时保留已有文件，只补缺失的站点设置，以及空的 Library／Friends 文件。初始化后删除的示例不会因重启或重建镜像而恢复；内容、图片与密码均保留。

需要直接在宿主机文件夹写文章的新项目可使用：

```sh
docker compose -f compose.yaml -f compose.files.yaml up -d --build
```

它用宿主 `src/content/` 和 `public/uploads/` 替代内容／图片卷，发布卷与管理员凭据卷仍保持不变。可用 `BLOG_CONTENT_DIR`、`BLOG_UPLOADS_DIR` 指向其它已存在的目录；全新的空内容目录会自动填入初始示例。**已有命名卷用户必须先导出完整旧内容和图片，再切换挂载**，否则运行中的站点会改读宿主目录，旧卷的数据不会自动合并。详细导出命令见 [迁移步骤](../docs/writing.md#已有命名卷先导出再切换)。

请按所用模式备份内容、图片、发布版本与凭据，不要在未备份时执行 `docker compose down -v`。完整命令、初始化和原子发布流程见 [项目说明](../README.md)。

## 运行配置

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `ADMIN_HOST` | `127.0.0.1` | 监听地址。容器内部可设 `0.0.0.0`，主机映射仍绑定本机。 |
| `ADMIN_PORT` | `4322` | 后台端口。 |
| `ADMIN_SITE_URL` | `SITE_URL` 或 `http://127.0.0.1:4321` | 后台“查看页面”使用的前台地址。 |
| `ADMIN_AUTO_PUBLISH` | 未启用 | `1` 时 CMS 保存和监听到的外部文件变化触发固定发布脚本；Compose 已启用。 |
| `ADMIN_WATCH_CONTENT` | 自动发布启用时开启 | `0` 关闭外部内容／图片监听，不改变 CMS 保存时的自动发布设置。 |
| `ADMIN_ALLOWED_HOSTS` | 当前端口的 `127.0.0.1`、`localhost`、`[::1]` | 额外允许的完整 Host，以逗号分隔。 |
| `ADMIN_AUTH_DIR` | 项目 `.admin/` | 非公开凭据目录；容器为 `/app/.admin`。 |
| `ADMIN_LOOPBACK_PUBLISHED` | 未启用 | `1` 允许私有网桥访问首次初始化，仍需终端一次性令牌；仅用于主机端口绑定 loopback 的 Compose。 |
| `ADMIN_SECURE_COOKIES` | 未启用 | 经 HTTPS 反向代理访问后台时设 `1`，给 cookie 增加 Secure；本机 HTTP 不设置。 |
| `ADMIN_ALLOW_REMOTE_SETUP` | 未启用 | `1` 允许非 loopback 请求经同源 HTTPS 首次建号，需同时启用 Secure cookie 并提供一次性初始化令牌。 |

经 HTTPS 反向代理公开后台时，在 Compose 的 `services.admin.environment` 中加入以下配置，将域名替换为实际后台域名；使用非默认 HTTPS 端口时，Host 还需包含端口：

```yaml
ADMIN_ALLOWED_HOSTS: cms.example.com
ADMIN_SECURE_COOKIES: "1"
ADMIN_ALLOW_REMOTE_SETUP: "1"
```

代理需保留外部 Host，浏览器请求的 Origin 应为对应的 `https://Host`。`ADMIN_ALLOW_REMOTE_SETUP` 用于首次远程建号；表单要求初始化令牌时，按[管理员登录](#管理员登录)中的命令获取。Compose 的 `.env` 本身不会将新增变量注入容器，需在 `admin.environment` 中显式填写或引用，并按当前 Compose 模式重新创建后台容器使配置生效。

这是需要管理员密码的本机管理工具，默认不面向公网。服务验证 Host／Origin／CSRF 和会话，校验内容、路径、图片类型和长度；没有让请求传入任意发布命令的接口，也没有通过环境变量跳过鉴权的入口。

容器模式下，后台调用既定的 `scripts/publish.mjs`，一次只运行一个构建，期间后续修改合并排队。监听和发布状态通过发布状态 API 提供；读取或构建失败时源文件保留、旧页面继续服务，可在后台状态与日志查看原因，修正后重试。后台上传图片写入所配置的图片目录或卷，Nginx 直接提供这些图片。

也可在项目根目录手动运行 `npm run publish`，构建并验证成功后切换 `.published/current`。它与 `npm run build` 输出的 `dist/` 分开，不会启动服务或上传到外部平台。

## API 与验证

- `GET /healthz`：健康状态，不需要 CSRF。
- `GET /api/auth/status`：公开返回 `configured`、`authenticated`、`csrf`、`setupTokenRequired` 及站点名称、主题、前台地址；未登录时建立独立 bootstrap cookie。仅返回是否需要初始化令牌，不返回令牌内容。
- `POST /api/auth/setup`：首次设置账号，请求体 `{ "username": "…", "password": "…", "setupToken": "…" }`，本机 loopback 可省略 `setupToken`；需 bootstrap cookie、对应 CSRF 与同源 Origin。
- `POST /api/auth/login`：用户名和密码登录，需 bootstrap cookie、对应 CSRF 与同源 Origin，无需初始化令牌；成功返回 `{ authenticated: true, username, csrf }` 并设置会话 cookie。
- `GET /api/account`：登录后读取 `{ username, csrf }`，未登录不公开用户名。
- `PUT /api/account`：登录、同源 Origin 和会话 CSRF 验证后接收 `{ username, currentPassword, newPassword? }`。新密码省略或为空时保持原密码；成功返回 `{ authenticated: true, username, csrf }`，更新当前会话 cookie 并注销其他会话。
- `POST /api/auth/logout`：需有效会话及其 CSRF，清除并撤销会话。
- `GET /api/session`：CSRF token、动态分类、前台地址与发布配置。
- `GET`／`POST /api/blog`、`/api/library`、`/api/friends`：列表与创建。
- `GET`／`PUT`／`DELETE /api/blog/:id`、`/api/library/:id`、`/api/friends/:id`：单条记录；修改和删除需携带当前 `revision`。
- `GET`／`PUT /api/settings`：设置对象及 `revision`；保存需携带当前版本。
- `GET /api/media`：素材记录数组；每项含 ID、名称、URL、MIME、大小与创建时间。
- `POST /api/media`：原始图片字节，`Content-Type` 为真实图片 MIME，`X-File-Name` 为 `encodeURIComponent(file.name)`；成功返回素材记录。不提供删除接口。
- `GET /api/backup/export`：下载 ZIP，响应为 `application/zip` 与附件文件名；`X-Backup-Warnings` 返回图片提示条数。
- `POST /api/backup/inspect`：上传原始 ZIP 字节，`Content-Type: application/zip`，`X-File-Name` 为 `encodeURIComponent(file.name)`；返回 `{ token, filename, summary: { blog, library, friends, images }, warnings, createdAt, expiresAt }`，不写入内容。
- `POST /api/backup/restore`：JSON `{ token }`，恢复已检查的备份；成功返回 `{ restored: true, summary, rollbackId, publish }`。令牌仅供一次恢复尝试，之后需重新检查。
- `GET /api/publish/status`：发布状态；`watch` 包含文件监听状态与错误。
- `POST /api/publish`：自动发布模式下重新发布。

除健康检查、鉴权状态和登录静态资源外，API 需登录 cookie。修改请求还需同源 `Origin` 与 `X-CSRF-Token`。除图片和备份上传发送原始字节外，其余修改请求使用 `Content-Type: application/json`。不支持跨域调用。HTTP 401 表示未登录、会话失效或登录失败，403 表示来源／CSRF 校验失败，429 表示登录尝试过于频繁，409 表示记录冲突、重复 ID／slug、已完成初始化、仍被引用的分类、备份预览过期／内容变化或当前模式不允许发布。

```sh
npm run admin:test
node --test scripts/publish.test.mjs
```

后台测试使用独立临时内容库及 `authDir`，覆盖首次初始化、密码校验、CSRF、限速、过期、注销、凭据隐私，以及内容／媒体管理。已有非鉴权测试显式调用 `createServer({ auth: false })` 隔离测试对象；此选项仅供程序测试调用，命令行和环境变量都没有禁用鉴权入口。测试不会修改项目真实内容或初始化真实密码。

## 初始示例与模板

首次部署提供一篇 Markdown 功能示例和一篇 `Enter Title` 文章模板；ACGN、Albums、Books 各有一个作品示例和一个 `Enter Title` 模板；Friends 包含 `Me`（`http://localhost:8080`）与一个填写模板。这些记录均标记为示例，可在 CMS 修改或删除；不会因重启重新出现。站点内容仍使用“Enter …”占位符，联系方式、Logo 和运行时间起点留空，不预置个人经历或评分。作品封面为网络引用，来源见 [示例内容说明](../docs/content-examples.md)。

文章与模板可直接编辑 `src/content/blog/` 中的 Markdown，或使用 CMS 修改同一份文件。默认示例的独立副本位于 `admin/defaults/`，只用于全新部署；已有内容卷不会被默认值覆盖。若要刻意改变模板对新部署者提供的初始内容，请同步维护这份副本，不要把个人站点数据复制进去。

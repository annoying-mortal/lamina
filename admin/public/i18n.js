const storageKey = 'admin-locale';
let locale = 'en';
try { if (localStorage.getItem(storageKey) === 'zh') locale = 'zh'; } catch {}
export const getLocale = () => locale;
export const t = (en, zh) => locale === 'zh' ? (zh ?? en) : en;
export function translateDom(root = document) {
  const nodes = [...(root.matches?.('[data-en], [data-en-placeholder], [data-en-label], [data-en-title], [data-en-alt]') ? [root] : []), ...root.querySelectorAll('[data-en], [data-en-placeholder], [data-en-label], [data-en-title], [data-en-alt]')];
  for (const node of nodes) {
    if (node.dataset.en !== undefined) node.textContent = t(node.dataset.en, node.dataset.zh);
    for (const [suffix, attribute] of [['Placeholder', 'placeholder'], ['Label', 'aria-label'], ['Title', 'title'], ['Alt', 'alt']]) {
      if (node.dataset[`en${suffix}`] !== undefined) node.setAttribute(attribute, t(node.dataset[`en${suffix}`], node.dataset[`zh${suffix}`]));
    }
  }
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  document.querySelectorAll('[data-admin-language]').forEach(button => {
    const active = button.dataset.adminLanguage === locale;
    button.setAttribute('aria-pressed', String(active));
    button.classList.toggle('active', active);
  });
}
export function setLocale(value) {
  const next = value === 'zh' ? 'zh' : 'en';
  if (next === locale) return;
  locale = next;
  try { localStorage.setItem(storageKey, locale); } catch {}
  translateDom();
  window.dispatchEvent(new CustomEvent('admin:language-change', { detail: { locale } }));
}
document.addEventListener('click', event => {
  const button = event.target.closest?.('[data-admin-language]');
  if (button) setLocale(button.dataset.adminLanguage);
});
const errors = {
  '请选择 .zip 备份文件。': 'Choose a .zip backup file.',
  '所选 ZIP 文件为空。': 'The selected ZIP is empty.',
  'ZIP 文件超过 256 MiB。': 'The ZIP exceeds 256 MiB.',
  '备份 ZIP 超过 256 MiB 上传限制。': 'ZIP backup exceeds the 256 MiB upload limit.',
  '无效的 ZIP 备份。': 'Invalid ZIP backup.',
  'ZIP 中缺少 manifest.json。': 'ZIP is missing manifest.json.',
  '备份清单无效或版本不受支持。': 'Unsupported or invalid backup manifest.',
  '备份文件校验和不匹配。': 'Backup manifest checksum mismatch.',
  '备份提示格式无效。': 'Invalid backup warnings.',
  '请先上传并检查备份，再进行恢复。': 'Upload and inspect a backup before restoring.',
  '备份预览已过期或属于其他会话，请重新上传。': 'Backup preview expired or belongs to another session. Upload it again.',
  '预览后内容已变化，请重新上传备份后再恢复。': 'Content changed after the preview. Upload the backup again before restoring.',
  '准备恢复时内容已变化，请重新上传备份。': 'Content changed while preparing restore. Upload the backup again.',
  '当前正在发布，请等待完成后重新检查备份。': 'A publish is running. Wait for it to finish, then inspect the backup again.',
  '备份文件名编码无效。': 'Invalid backup filename encoding.',
  '无法登录，请检查用户名和密码或稍后重试。': 'Unable to sign in. Check your credentials or try again later.',
  '这个文章网址已存在。': 'This slug is already in use.',
  '同名文章文件已存在。': 'A file with this name already exists.',
  'site.json 格式不正确，请先修复文件。': 'Invalid site.json. Fix the file before continuing.',
  '素材仅支持浏览和上传；不会自动删除被文章使用的图片。': 'Media supports browsing and uploading only.',
  '评分应为 0–10，可留空。': 'Rating must be 0–10. It may be left blank.',
  '请使用 JSON 请求内容。': 'Use a JSON request body.',
  '请求内容过大，最多 1 MiB。': 'Request body exceeds 1 MiB.',
  '此后台只接受已配置的本机 Host。': 'This host is not configured for the CMS.',
  '来源校验未通过。': 'Origin check failed.',
  '禁止跨站访问后台。': 'Cross-site access is not allowed.',
  '修改请求必须提供同源 Origin。': 'Changes require a same-origin request.',
  '请求内容必须是一个 JSON 对象。': 'Request body must be a JSON object.',
  '本地开发模式保存后自动热更新，无需发布。': 'Local preview updates automatically on save.',
  '未找到这个地址。': 'Not found.',
  '图片地址应为不超过 2000 字的 URL。': 'Image URL must be no longer than 2000 characters.',
  '图片地址包含无效字符。': 'Image URL contains invalid characters.',
  '图片地址不能省略协议。': 'Image URL must include HTTP or HTTPS.',
  '图片路径不能包含目录穿越或重复编码。': 'Image path cannot contain relative traversal or repeated encoding.',
  '图片路径无效。': 'Invalid image path.',
  '请使用站内 /uploads/... 路径或完整的 HTTP(S) 图片地址。': 'Use a local /uploads/... path or a full HTTP(S) URL.',
  '图片地址只支持 HTTP(S)，且不能包含账号密码。': 'Image URL must use HTTP(S) and cannot contain credentials.',
  '登录已过期，请重新登录。': 'Session expired. Sign in again.',
  '登录页面已过期，请刷新后重试。': 'Session expired. Refresh and try again.',
  '安全令牌已失效，请刷新后台后重试。': 'Session expired. Refresh and try again.',
  '用户名或密码不正确，请稍后重试。': 'Invalid credentials. Try again later.',
  '当前密码不正确，请重新输入。': 'Current password is incorrect.',
  '用户名需为 3–32 位，以英文字母或数字开头，仅允许字母、数字、点、下划线和连字符。': 'Username must be 3–32 characters, start with a letter or number, and use letters, numbers, dots, underscores or hyphens.',
  '密码需为 12–128 个字符，允许空格和中文。': 'Password must be 12–128 characters.',
  '新密码需为 12–128 个字符，允许空格和中文。': 'New password must be 12–128 characters.',
  '管理员凭据暂时不可用，请检查后台日志或恢复凭据备份。': 'Credentials unavailable. Check the server logs or restore a backup.',
  '初始化令牌不可用，请检查管理员凭据目录。': 'Setup token unavailable. Check the credentials directory.',
  '管理员已完成初始化，请使用登录入口。': 'Setup is complete. Sign in to continue.',
  '首次初始化仅允许从本机访问。': 'Initial setup is available only on localhost.',
  '初始化令牌不正确，请在本机 Docker 终端获取令牌后重试。': 'Incorrect setup token. Retrieve it from the local Docker terminal.',
  '无法读取或保存文件，请检查后台终端。': 'Unable to read or save files. Check the server logs.',
  'JSON 格式不正确。': 'Invalid JSON.',
  '日期应为 YYYY-MM-DD。': 'Use YYYY-MM-DD for dates.',
  '请输入有效日期。': 'Enter a valid date.',
  '运行计时起点应为含时区的 ISO 时间，例如 2026-10-20T21:28:15+08:00；留空则不显示计时。': 'Use an ISO date and time with a timezone. Leave blank to hide uptime.',
  '请输入有效的运行计时起点与时区。': 'Enter a valid launch date and timezone.',
  '标签最多 20 个。': 'Up to 20 tags.',
  '站点设置格式不正确。': 'Invalid settings.',
  '导航需包含 Home、Blog、Library、Friends 四项，可调整顺序或隐藏。': 'Navigation requires Home, Blog, Library and Friends. Items may be reordered or hidden.',
  '导航 ID 不正确。': 'Invalid navigation ID.',
  '导航 ID 不能重复。': 'Navigation IDs must be unique.',
  '文章分类需保留 1–30 个。': 'Keep 1–30 categories.',
  '分类格式不正确。': 'Invalid category.',
  '分类 ID 只接受小写字母、数字及中间的连字符。': 'Category IDs use lowercase letters, numbers and hyphens.',
  '分类 ID 不能重复。': 'Category IDs must be unique.',
  'Library 需保留 1–30 个分类。': 'Library must contain 1–30 categories.',
  'Library 分类格式不正确。': 'Each Library category must be an object.',
  'Library 分类 ID 只接受小写字母、数字及中间的连字符。': 'Library category IDs may contain lowercase letters, digits and internal hyphens.',
  'Library 分类 ID 不能重复。': 'Library category IDs must be unique.',
  '除 All 外，请至少保留一个 Library 分类。': 'Keep at least one Library category besides All.',
  '请选择已配置的 Library 分类，All 仅用于显示全部内容，不能分配给条目。': 'Select a configured Library category. All is an aggregate tab and cannot be assigned to an item.',
  '页面设置格式不正确。': 'Invalid page settings.',
  '电子邮箱格式不正确。': 'Enter a valid email address.',
  '默认主题应为 system、light 或 dark。': 'Theme must be system, light or dark.',
  '友链格式不正确。': 'Invalid friend record.',
  '排序应为 0–999999 的整数。': 'Order must be an integer from 0 to 999999.',
  '文章内容格式不正确。': 'Invalid post.',
  '文章网址只接受小写字母、数字及中间的连字符。': 'Slug must use lowercase letters, numbers and hyphens.',
  '请选择有效分类。': 'Select a valid category.',
  '阅读时长应为 1–999 分钟。': 'Read time must be 1–999 minutes.',
  'Markdown 正文不能为空，最长 300,000 字。': 'Markdown content is required, up to 300,000 characters.',
  '收藏内容格式不正确。': 'Invalid library item.',
  '请选择音乐、书籍或影视。': 'Select Music, Books or Film & TV.',
  '关联文章应为 /blog/article-slug/ 格式。': 'Related post must use /blog/article-slug/.',
  '图片不能超过 10 MiB。': 'Images must be no larger than 10 MiB.',
  '图片上传已中断。': 'Image upload interrupted.',
  '图片上传失败。': 'Image upload failed.',
  '素材目录索引损坏，请恢复备份后重试。': 'Media index is invalid. Restore a backup.',
  '图片路径编码不正确。': 'Invalid image path encoding.',
  '图片不存在。': 'Image not found.',
  '仅支持 PNG、JPEG、GIF 和 WebP 图片。': 'Supported formats: PNG, JPEG, GIF and WebP.',
  '请选择有效的 PNG、JPEG、GIF 或 WebP 图片；不接受 SVG 或其它文件。': 'Choose a PNG, JPEG, GIF or WebP image. SVG uploads are not supported.',
  '文件内容与声明的图片类型不一致。': 'File contents do not match the image type.',
  '文件名称编码不正确。': 'Invalid filename encoding.',
  '文件名无效或过长。': 'Invalid filename or filename too long.',
};
const fields = { '标题':'Title', '文章网址':'Slug', '分类 ID':'Category ID', '标签':'Tags', '摘要':'Summary', '评分':'Rating', '站点名称':'Site name', '浏览器标题':'Page title', '站点描述':'Description', '站点地址':'Site URL', '首页标语':'Home heading', '首页介绍':'Introduction', '首页眉题':'Home eyebrow', '页脚文字':'Footer text', '页脚标签':'Footer label', 'GitHub 地址':'GitHub URL', '电子邮箱':'Email', '站点 Logo':'Logo', '浏览器图标':'Favicon', '档案副标题':'Archive subtitle', '档案标题':'Archive title', '首页版本文字':'Home bottom text', '导航名称':'Navigation label', '分类名称':'Category name', '分类英文名称':'English category name', '页面标题':'Page title', '页面眉题':'Page eyebrow', '页面介绍':'Page description', '网站名称':'Site name', '网站地址':'Website URL', '友链头像':'Avatar', '文字头像':'Initials', '网站介绍':'Description', '友链类型':'Type', '封面地址':'Cover', '运行计时起点':'Launch date', '作品名称':'Title', '原名':'Original title', '创作者':'Creator', '短评':'Summary', '详细记录':'Notes' };
export function translateError(value) {
  const message = String(value || '');
  if (locale === 'zh') {
    const translated = Object.entries(errors).find(([, en]) => en === message)?.[0];
    if (translated) return translated;
    let match = /^Cannot remove a Library category that contains items\. Move or delete these items first: (.*)\.$/.exec(message);
    if (match) return `删除分类前请先迁移或删除这些条目：${match[1]}。`;
    match = /^Library category ID "(.*)" is reserved for legacy content; use "(.*)" instead\.$/.exec(message);
    if (match) return `分类 ID「${match[1]}」保留用于旧内容，请使用「${match[2]}」。`;
    return message.replace(/^Library category English name/, 'Library 档案标签').replace(/^Library category name/, 'Library 分类名称').replace(/^Library category ID/, 'Library 分类 ID');
  }
  if (errors[message]) return errors[message];
  const imageError = /^(.+?)：(.+)$/.exec(message);
  if (imageError && errors[imageError[2]]) return `${fields[imageError[1]] || imageError[1]}: ${errors[imageError[2]]}`;
  let match = /^(.*?)(不能为空，且)?不能超过 (\d+) 字。$/.exec(message);
  if (match) return `${fields[match[1]] || match[1]}${match[2] ? ' is required;' : ':'} maximum ${match[3]} characters.`;
  match = /^(.*?)应为完整的 HTTP 或 HTTPS 地址。$/.exec(message);
  if (match) return `${fields[match[1]] || match[1]} must be a full HTTP(S) URL.`;
  match = /^(.*?) 只能使用字母、数字、连字符或下划线，最长 80 字。$/.exec(message);
  if (match) return `${fields[match[1]] || match[1]} must use letters, numbers, hyphens or underscores, up to 80 characters.`;
  match = /^缺少 (.*?) 页面设置。$/.exec(message);
  if (match) return `Missing ${match[1]} page settings.`;
  match = /^(.*?)已被其它窗口修改，请重新载入后再保存。$/.exec(message);
  if (match) return 'This record has changed in another window. Reload before saving.';
  match = /^(.*?)不存在，可能已被删除。$/.exec(message);
  if (match) return 'Record not found. It may have been deleted.';
  match = /^已有(.*?)的 ID 不能修改。$/.exec(message);
  if (match) return 'An existing record ID cannot be changed.';
  match = /^这个(.*?) ID 已存在。$/.exec(message);
  if (match) return 'This ID is already in use.';
  match = /^无法移除正在使用的分类，请先移动这些文章（含草稿）：(.*)。$/.exec(message);
  if (match) return `Move these posts before deleting their category: ${match[1]}.`;
  return message;
}
translateDom();

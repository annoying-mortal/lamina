# 字体来源与许可

本网站及本地内容后台使用 **MiSans**，由小米科技有限责任公司提供。字体以网页嵌入形式随项目提供，字体文件保持原样，版权和许可不属于本项目的代码许可证。

## 已包含的字体

- 来源：本地 RhineLabUI 项目的 `public/fonts/misans-webfont-4.3.1/` 与 `src/fonts.css`。
- 上游分包：`misans-webfont` 4.3.1，字体版本 4.003。
- 字重：Light 300、Regular 400、DemiBold 600、Bold 700，共 753 个 WOFF2 分包。
- CSS family：`MiSans`，通过 `/fonts.css` 在前台与后台共用。浏览器依据 `unicode-range` 按实际文字加载，并非一次下载所有分包。
- 本次未修改、重制或重新分包任何字体二进制；全部文件已按原 `source.json` 的 SHA-256 校验。

保留文件：

- [MiSans 原始许可](public/fonts/MiSans-license.pdf)
- [字体版权说明](public/fonts/NOTICE.txt)
- [上游说明及许可摘录](public/fonts/misans-webfont-4.3.1/UPSTREAM-README.md)
- [来源、包完整性与逐文件哈希](public/fonts/misans-webfont-4.3.1/source.json)

MiSans 字体版权：Copyright © 2020–2025 Beijing Xiaomi Mobile Software Co., Ltd. All Rights Reserved. 分包来源中保留的原始版权年份为 2020–2023；以上文件按原样保留各自的声明。

## 未包含的字体

RhineLabUI 另曾为片头和品牌字样使用独立授权的 **Novecento Sans Wide**。当前本地检出没有其授权字体文件或 Webfont kit；该资源也不随原项目 Git 仓库提供。本项目未复制、下载或模拟该字体，标题、导航、正文、档案文字和后台均使用上述可用的 MiSans。

## 字体回退

MiSans 加载失败时依次回退到 Mi Sans、苹方、微软雅黑与系统无衬线字体。界面上的原 `--font-mono` 变量也统一指向 MiSans，以免导航、编号、表格和辅助文字仍使用另一套字形；没有另行引入代码字体。档案模型的 Canvas 标签在字体加载后会更新贴图。

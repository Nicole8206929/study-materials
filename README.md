# Nicole 的学习资料库

[打开学习书架](https://nicole8206929.github.io/study-materials/) · [反馈问题](https://github.com/Nicole8206929/study-materials/issues/new)

按学科、标签和文件格式查找教材，支持多关键词搜索、排序、PDF 预览及原文件下载。搜索和筛选条件保存在网址中，可复制分享。手机默认收起主题标签，打开已带标签的分享链接时会展开并显示所选项。EPUB 是流式电子书，请下载后在阅读器中打开。

当前目录包含 **17 份资料：16 个 PDF、1 个 EPUB**。`books.json` 是目录的唯一数据源；`assets/` 存放界面样式和逻辑。网页通过 GitHub Pages 在原网址提供服务，不需要前端构建或第三方 CDN。

## 访问与隐私

入口沿用原密码，仅用于日常访问提示。**它不是身份认证，不能保护资料隐私。** 本仓库和文件直链都是公开的，修改浏览器状态即可绕过入口。若需要真正限制访问，应把需要保密的文件移到私有存储，并由服务端认证后提供授权下载；仅修改前端密码或仓库可见性不能保证历史公开副本失效。

文件较大，首次打开可能需要时间，GitHub Pages 的连通性也会因地区和网络而变化。PDF 弹窗始终提供新窗口打开和下载入口。浏览器的 PDF 引擎、下载策略和 EPUB 支持各有差异；手机无法内嵌预览时请使用上述备用入口。

## 2026-11-07 检查结果

17 个原始链接均返回有效文件头，但完整下载和解析发现 `OpenIntroStatistics4.pdf` 损坏、无可读页面。已在同一路径替换为 [OpenIntro 官方第四版屏幕阅读器友好版本](https://www.openintro.org/go?id=os4_for_screen_reader)，465 页，15,926,600 字节。**它的页码与普通版不同，引用请用章节号。** 原损坏版本可从 Git 历史追溯。

目前 17 份文件均通过完整下载后的大小、SHA-256 和格式检查；PDF 检查了页数并渲染首末页，EPUB 检查了 ZIP 完整性和 mimetype。此检查不等于逐页校对内容。已将实测页数、字节数、哈希及核验日期写入目录；EPUB 不再显示估计页数。

界面改进包括：正确区分 EPUB/PDF、真实下载链接、动态学科计数、格式与排序、空结果提示、超时及失败重试、安全文本渲染、键盘与屏幕阅读器支持、浅色/深色及手机布局。

## 本地预览与检查

```bash
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000
```

从根目录运行检查（维护脚本需要 Python 3.11+）：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install PyMuPDF reportlab python-pptx
.venv/bin/python scripts/check_catalog.py
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
npm ci
npx playwright install chromium
npm test
```

文档工具的真实引擎测试需要系统安装 Ghostscript 和 LibreOffice；缺失时会显示跳过。浏览器测试覆盖搜索、筛选、网址状态、标签折叠、PDF/EPUB 实际下载及完整哈希、弹窗焦点、重试、注入输入，以及不提供 `AbortSignal.timeout` 的浏览器兼容，以及 320/390/768/1440 像素宽度和浅/深色自动无障碍扫描。

轻量检查线上直链（只检查 HTTP、文件头和目录中的大小，不验证完整文档）：

```bash
python3 scripts/check_catalog.py --remote https://nicole8206929.github.io/study-materials/
```

GitHub Actions 自动运行目录完整性、文档工具和浏览器检查。它是代码检查，不更改现有 Pages 发布来源。

## 添加或更新资料

1. 将文件放入合适目录；保持旧路径可用，避免使已分享的链接失效。
2. 更新 `books.json` 的唯一 `id`、书名、作者、分类、说明和标签。填入实际 `format`、`bytes`、`sha256`、`pages`（EPUB 为 `null`）和 `verifiedAt`。大小标签使用 1024 为换算基数。
3. 运行上述完整性检查并在网页搜索、预览或下载新增条目。文件未改变时不应重新压缩已有公开原件。
4. 本仓库默认忽略新 PDF/EPUB；确认需要提交的文件后使用 `git add -f -- "资料路径"`。不要一次性取消整个仓库的大文件忽略规则。

## 文档处理 skills

`skills/pdf-compress/` 和 `skills/ppt-pdf/` 包含本地文档工具和说明。实际运行请使用各 skill 目录下脚本的绝对路径。它们保留源文件，拒绝覆盖已有输出，验证文件及页数后才发布结果。压缩未变小时输出完整原件副本；PPT 合并默认在任何输入失败时停止，明确传 `--allow-partial` 才允许跳过。

## 来源与许可

代码使用根目录 MIT 许可。书籍、译文和讲义的权利归原作者、出版方或标注的许可方所有，代码许可不能替代资料授权。目录中的许可标签仍需按具体版本和来源核实；对需限制传播的资料应采用相应存储和访问方式。

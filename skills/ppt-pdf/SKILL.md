---
name: ppt-pdf
description: "PPT 转 PDF 统一工具（单转+合并）。当用户需要把 PPT/PPTX 转 PDF、批量转换课件、合并多个 PPT 为一个 PDF、整理系列讲义时使用。支持单文件转换、多文件合并、目录扫描、封面目录、书签、自动压缩。与 pdf-compress skill 完全兼容。适用于：(1) 单个课件转 PDF (2) 批量转换 (3) 多 PPT 合并为统一讲义 (4) 课件归档。"
---

# PPT 转 PDF 统一工具

## 执行前与输出约定

先定位本 SKILL.md 所在目录；脚本位于该目录的 `scripts/ppt_pdf.py`。示例中的 `scripts/` 都相对此 skill 目录，不是任意项目的当前目录。实际执行使用脚本绝对路径，并保留用户输入文件路径的原意。
检查 Python 3.10+、`requirements.txt` 以及系统程序是否可用。依赖缺失时给出实际缺失项；不要声称安装或转换已完成。文件只在本地处理，上传或发布须有相应用户请求。
默认保留输入并拒绝覆盖任何已有输出。遇到同名文件时选新路径；失败返回非零状态。先验证输出可打开和页数，再报告成功。

## 两种使用情形

| 情形 | 命令 | 说明 |
|---|---|---|
| 单个 PPT 转 PDF | `convert` | 一个 PPT → 一个 PDF |
| 多个 PPT 合并 | `merge` | 多个 PPT → 一个统一 PDF |
| 目录批量处理 | `batch` | 目录内 PPT 逐个转换或合并 |

## 快速开始

### 情形 1：单个 PPT 转 PDF

```bash
# 基本转换
python3 scripts/ppt_pdf.py convert input.pptx

# 指定输出
python3 scripts/ppt_pdf.py convert input.pptx -o output.pdf

# 转换并压缩
python3 scripts/ppt_pdf.py convert input.pptx --compress medium
```

### 情形 2：多个 PPT 合并为一个 PDF

```bash
# 合并指定文件
python3 scripts/ppt_pdf.py merge \
  第1章.pptx 第2章.pptx 第3章.pptx \
  -o 完整讲义.pdf

# 带封面、目录、压缩
python3 scripts/ppt_pdf.py merge \
  第1章.pptx 第2章.pptx \
  --cover "高中物理讲义" \
  --subtitle "热力学部分" \
  --toc \
  --compress medium \
  -o 讲义.pdf
```

### 情形 3：目录批量处理

```bash
# 目录内每个 PPT 单独转 PDF
python3 scripts/ppt_pdf.py batch ./课件/ --mode separate

# 目录内所有 PPT 合并为一个 PDF
python3 scripts/ppt_pdf.py batch ./课件/ --mode merge \
  --cover "课件合集" --toc \
  -o 合集.pdf

# 递归扫描子目录
python3 scripts/ppt_pdf.py batch ./课件/ --recursive --mode merge -o 合集.pdf
```

## 支持格式

| 输入 | 输出 |
|---|---|
| .pptx / .ppt | PDF |
| .odp | PDF |
| .pps / .ppsx | PDF |

## 内容保留

| 内容 | 保留 |
|---|---|
| 文字、字体、颜色 | 通常保留，受字体替换和转换引擎影响，必须抽查 |
| 图片、形状、图表 | ✅ |
| 表格、超链接 | ✅ |
| 幻灯片布局 | 可能重排，需核对代表性页面 |
| 动画/切换 | 静态化 |
| 视频/音频 | 不嵌入 |

## 合并专属功能

仅 `merge` 模式可用：

| 功能 | 参数 |
|---|---|
| 封面标题 | `--cover` |
| 封面副标题 | `--subtitle` |
| 作者 | `--author` |
| 自动目录 | `--toc` |
| PDF 书签 | 自动生成 |
| 元数据 | 自动写入 |

## 压缩联动

所有模式都支持 `--compress`，直接调用 pdf-compress skill：

| 级别 | 适用 |
|---|---|
| low | 高质量阅读 |
| medium | 屏幕阅读、GitHub（推荐） |
| high | AI识别、快速传输 |

## 完整工作流

```
PPT课件
    │
    ├─ 单个 → convert → PDF
    │
    └─ 多个 → merge → 封面+目录+书签 → 统一PDF
                │
                ▼
        [可选] pdf-compress 压缩
                │
                ▼
        上传 GitHub 书籍库
```

## 故障处理

| 问题 | 处理 |
|---|---|
| 转换失败 | 每次使用独立 LibreOffice 配置重试，不清理其他会话 |
| 单文件失败 | 自动重试2次；合并默认停止，明确传 --allow-partial 才跳过 |
| 转换超时 | `--timeout` 调整 |
| 压缩失败 | 保留未压缩版本 |
| 中文字体 | 自动使用文泉驿 TrueType |

`batch --mode merge` 必须指定 `-o`；`separate` 不接受 `-o`，输出在源文件旁。同名输出会停止，合并默认不生成缺章文件。目录页码按实际目录页数计算。转换后抽查中文、公式、图表及首末页。

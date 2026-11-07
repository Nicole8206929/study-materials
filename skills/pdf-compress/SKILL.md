---
name: pdf-compress
description: "PDF 本地压缩工具。当用户需要压缩 PDF、减小 PDF 文件大小、处理大体积 PDF（含大量图片）时使用。支持多种压缩级别、批量压缩、自动重命名。使用 Ghostscript + PyMuPDF，无需上传到外部网站。压缩率和目标体积须以实测为准。适用于：(1) 用户说「帮我压缩PDF」「PDF太大了」「减小文件大小」(2) 需要把 PDF 压缩到 100MB 以下（GitHub 限制）(3) 批量处理多个 PDF。"
---

# PDF 本地压缩工具

## 执行前与输出约定

先定位本 SKILL.md 所在目录；脚本位于该目录的 `scripts/pdf_compress.py`。示例中的 `scripts/` 都相对此 skill 目录，不是任意项目的当前目录。实际执行使用脚本绝对路径，并保留用户输入文件路径的原意。
检查 Python 3.10+、`requirements.txt` 以及系统程序是否可用。依赖缺失时给出实际缺失项；不要声称安装或转换已完成。文件只在本地处理，上传或发布须有相应用户请求。
默认保留输入并拒绝覆盖任何已有输出。遇到同名文件时选新路径；失败返回非零状态。先验证输出可打开和页数，再报告成功。

## 概述

在本地直接压缩 PDF，无需上传到 iLovePDF 等外部网站。使用 Ghostscript 引擎，支持三种压缩级别。

## 快速开始

### 1. 压缩单个 PDF

```bash
python3 scripts/pdf_compress.py compress input.pdf
```

默认使用中等压缩，输出文件为 `input_compressed.pdf`。

### 2. 指定压缩级别

```bash
# 轻度压缩（画质好，体积减小少）
python3 scripts/pdf_compress.py compress input.pdf --level low

# 中度压缩（默认，平衡画质和体积）
python3 scripts/pdf_compress.py compress input.pdf --level medium

# 高度压缩（画质较低，体积最小）
python3 scripts/pdf_compress.py compress input.pdf --level high
```

### 3. 指定输出路径

```bash
python3 scripts/pdf_compress.py compress input.pdf -o output.pdf
```

### 4. 批量压缩

```bash
python3 scripts/pdf_compress.py batch /path/to/pdfs/
```

### 5. 查看 PDF 信息

```bash
python3 scripts/pdf_compress.py info input.pdf
```

## 压缩级别说明

| 级别 | 图片 DPI | 适用场景 | 说明 |
|---|---|---|---|
| low | 150 DPI | 打印、高质量阅读 | 效果取决于原文件 |
| medium | 100 DPI | 屏幕阅读、GitHub 上传 | 不保证目标体积 |
| high | 72 DPI | 仅需文字识别、快速传输 | 小字、公式可能模糊 |

## 工作流程

```
用户请求压缩 PDF
    │
    ▼
检查文件是否存在、是否为 PDF
    │
    ▼
获取原始文件信息（大小、页数）
    │
    ▼
调用 Ghostscript 压缩
    │
    ▼
验证输出文件（非空、可打开）
    │
    ▼
输出压缩报告（原始大小、压缩后大小、压缩率）
```

## 安全与注意事项

- **本地处理**：文件不会上传到任何外部服务器
- **原始文件保留**：默认不会删除原文件，输出为新文件
- **文件类型校验**：拒绝非 PDF 文件
- **压缩失败保护**：如果压缩后文件比原文件大，自动保留原文件

## 故障排查

| 问题 | 可能原因 | 解决方法 |
|---|---|---|
| Ghostscript 未找到 | 未安装 gs | `sudo apt install ghostscript` |
| 压缩后文件损坏 | PDF 本身有问题 | 先尝试用 PyMuPDF 修复 |
| 压缩率不高 | PDF 主要是文字而非图片 | 文字 PDF 本身已经很小，无需压缩 |
| 输出文件比原文件大 | 原 PDF 已高度优化 | 脚本会自动提示并保留原文件 |

压缩未变小时，输出是原 PDF 的完整副本，命令仍成功；不会删除用户已有文件。对扫描小字、公式和图表先试 low 并抽查可读性；72 DPI 不保证适合 OCR。加密、零页或损坏 PDF 会被拒绝。

---
name: ppt-merge-pdf
description: "PPT 批量合并转 PDF 工具。当用户需要把多个 PPT/PPTX 课件合并成一个统一的 PDF、整理系列课件、将多份演示文稿汇编成书籍形式时使用。先逐个转 PDF，再按顺序合并为单一 PDF。与 ppt-to-pdf 和 pdf-compress skill 完全兼容。适用于：(1) 用户说「合并PPT」「把几个课件合成一个PDF」「系列课件汇编」(2) 按章节整理讲义 (3) 批量转换多个PPT并合并。"
---

# PPT 批量合并转 PDF

## 概述

将多个 PPT/PPTX 按指定顺序逐个转换为 PDF，然后合并为一个统一的 PDF 文件。支持自定义封面、目录页，可直接调用 pdf-compress 压缩。

## 快速开始

### 1. 合并指定的多个 PPT

```bash
python3 scripts/ppt_merge_pdf.py merge \
  第1章.pptx 第2章.pptx 第3章.pptx \
  -o 完整讲义.pdf
```

### 2. 合并整个目录的 PPT（按文件名排序）

```bash
python3 scripts/ppt_merge_pdf.py merge-dir /path/to/ppts/ \
  -o 完整讲义.pdf
```

### 3. 合并并自动压缩

```bash
# 合并后中度压缩
python3 scripts/ppt_merge_pdf.py merge \
  第1章.pptx 第2章.pptx \
  --compress medium \
  -o 完整讲义.pdf

# 合并后高度压缩
python3 scripts/ppt_merge_pdf.py merge \
  第1章.pptx 第2章.pptx \
  --compress high \
  -o 完整讲义.pdf
```

### 4. 添加封面页

```bash
python3 scripts/ppt_merge_pdf.py merge \
  第1章.pptx 第2章.pptx \
  --cover "高中物理热力学讲义" \
  --subtitle "第14章 气体动理论" \
  -o 完整讲义.pdf
```

### 5. 添加自动目录页

```bash
python3 scripts/ppt_merge_pdf.py merge \
  第1章.pptx 第2章.pptx 第3章.pptx \
  --toc \
  -o 完整讲义.pdf
```

## 输入方式

| 命令 | 说明 |
|---|---|
| `merge` | 直接指定多个 PPT 文件路径 |
| `merge-dir` | 指定一个目录，自动按文件名排序合并所有 PPT |

## 合并流程

```
多个 PPT 文件
    │
    ▼
逐个调用 LibreOffice 转为 PDF（临时目录）
    │
    ▼
[可选] 生成封面页
    │
    ▼
[可选] 生成目录页（自动统计页数）
    │
    ▼
按顺序合并所有 PDF
    │
    ▼
[可选] 调用 pdf-compress 压缩
    │
    ▼
输出统一 PDF
```

## 与其他 Skill 的关系

- **ppt-to-pdf**：本 skill 内部直接调用相同的 LibreOffice 转换逻辑
- **pdf-compress**：本 skill 转换后可直接调用压缩，形成完整工作流

完整工作流：
```
PPT系列课件 → 逐个转PDF → 合并为单一PDF → 压缩 → 上传GitHub书籍库
```

## 故障排查

| 问题 | 可能原因 | 解决方法 |
|---|---|---|
| 某个 PPT 转换失败 | 文件损坏/特殊字体 | 脚本会跳过失败文件并提示 |
| 合并后页数不对 | 某些 PPT 为空文件 | 检查中间临时PDF |
| 中文字体异常 | 缺少中文字体 | 安装 fonts-noto-cjk |
| soffice 冲突 | 有残留进程 | 执行 `pkill soffice` |
| 大文件合并慢 | PPT 数量多/图片大 | 正常现象，耐心等待 |

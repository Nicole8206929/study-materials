---
name: ppt-merge-pdf
description: "PPT 批量合并转 PDF 工具（增强版）。当用户需要把多个 PPT/PPTX 课件合并成一个统一的 PDF、整理系列课件、批量处理大量演示文稿时使用。支持递归目录扫描、自动重试、封面目录、书签大纲、自动压缩。与 ppt-to-pdf 和 pdf-compress skill 完全兼容。适用于：(1) 批量合并课件 (2) 按章节整理讲义 (3) 大批量 PPT 转 PDF 归档。"
---

# PPT 批量合并转 PDF（增强版）

## 核心特性

- **一次性批量处理**：支持任意数量的 PPT
- **自动重试**：单个文件失败自动重试，不影响整体
- **递归扫描**：可扫描整个目录及子目录
- **多种排序**：按文件名/修改时间/大小排序
- **专业封面**：带装饰线、标题、作者、日期
- **自动目录**：虚线引导、页码自动计算、支持多页
- **书签大纲**：PDF 内可点击跳转章节
- **压缩联动**：直接调用 pdf-compress skill
- **元数据**：自动写入 PDF 标题、作者、主题

## 快速开始

### 1. 合并指定文件

```bash
python3 scripts/ppt_merge_pdf.py merge \
  第1章.pptx 第2章.pptx 第3章.pptx \
  -o 完整讲义.pdf
```

### 2. 合并整个目录（推荐）

```bash
# 按文件名排序，自动扫描目录所有PPT
python3 scripts/ppt_merge_pdf.py merge-dir ./课件/ \
  -o 完整讲义.pdf

# 递归扫描子目录
python3 scripts/ppt_merge_pdf.py merge-dir ./课件/ \
  --recursive \
  -o 完整讲义.pdf
```

### 3. 完整功能（封面+目录+压缩）

```bash
python3 scripts/ppt_merge_pdf.py merge-dir ./课件/ \
  --cover "高中物理讲义" \
  --subtitle "热力学综合应用" \
  --author "Nicole" \
  --toc \
  --compress medium \
  -o 物理讲义汇编.pdf
```

### 4. 不同排序方式

```bash
# 按修改时间排序
python3 scripts/ppt_merge_pdf.py merge-dir ./课件/ \
  --sort mtime \
  -o 讲义.pdf

# 按文件大小排序
python3 scripts/ppt_merge_pdf.py merge-dir ./课件/ \
  --sort size \
  -o 讲义.pdf
```

## 支持格式

| 输入 | 输出 |
|---|---|
| .pptx / .ppt | PDF |
| .odp | PDF |
| .pps / .ppsx | PDF |

## 三阶段处理流程

```
阶段 1: 批量转换
  PPT文件 → LibreOffice → PDF（自动重试2次）
  单个失败不影响整体

阶段 2: 合并整理
  生成封面 → 生成目录 → 按顺序合并 → 添加书签
  自动计算页码、写入元数据

阶段 3: 压缩输出
  调用 pdf-compress → 验证完整性 → 输出报告
```

## 与其他 Skill 的完整工作流

```
PPT系列课件（任意数量）
    │
    ▼
ppt-merge-pdf（本skill）
    ├─ 批量转换
    ├─ 封面+目录+书签
    └─ 自动调用 pdf-compress
            │
            ▼
        统一PDF（可直接上传GitHub）
```

## 压缩级别

| 级别 | 适用场景 | 预期压缩率 |
|---|---|---|
| low | 高质量阅读、打印 | 30-50% |
| medium | 屏幕阅读、GitHub（推荐） | 50-70% |
| high | AI识别、快速传输 | 70-90% |

## 故障处理

| 问题 | 自动处理 |
|---|---|
| soffice 残留进程 | 自动清理后重试 |
| 单个文件转换失败 | 自动重试2次，仍失败则跳过 |
| 转换超时 | 可通过 --timeout 调整 |
| 压缩失败 | 保留未压缩版本，不影响主流程 |
| 目录文件过多 | 目录自动分页 |

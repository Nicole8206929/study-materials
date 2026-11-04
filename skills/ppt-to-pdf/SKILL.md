---
name: ppt-to-pdf
description: "PPT 转 PDF 工具。当用户需要把 PPT/PPTX 课件转换为 PDF、批量转换演示文稿、将课件保存为书籍形式时使用。使用 LibreOffice 引擎，完整保留文字、图片、布局和动画静态效果。支持转换后直接调用 pdf-compress 压缩。适用于：(1) 用户说「PPT转PDF」「课件转PDF」「把演示文稿转成PDF」(2) 批量处理课件归档 (3) 转换后压缩上传 GitHub。"
---

# PPT 转 PDF 工具

## 概述

使用 LibreOffice 将 PPT/PPTX 转换为高质量 PDF，完整保留所有内容。支持转换后直接调用 pdf-compress skill 进行压缩。

## 快速开始

### 1. 转换单个 PPT

```bash
python3 scripts/ppt_to_pdf.py convert input.pptx
```

输出文件为同目录下的 `input.pdf`。

### 2. 指定输出路径

```bash
python3 scripts/ppt_to_pdf.py convert input.pptx -o output.pdf
```

### 3. 转换并自动压缩

```bash
# 转换后用 pdf-compress 中度压缩
python3 scripts/ppt_to_pdf.py convert input.pptx --compress medium

# 转换后高度压缩
python3 scripts/ppt_to_pdf.py convert input.pptx --compress high
```

### 4. 批量转换

```bash
python3 scripts/ppt_to_pdf.py batch /path/to/ppts/
```

### 5. 批量转换并压缩

```bash
python3 scripts/ppt_to_pdf.py batch /path/to/ppts/ --compress medium
```

### 6. 查看 PPT 信息

```bash
python3 scripts/ppt_to_pdf.py info input.pptx
```

## 支持格式

| 输入格式 | 输出格式 | 说明 |
|---|---|---|
| .pptx | PDF | PowerPoint 2007+ |
| .ppt | PDF | PowerPoint 97-2003 |
| .odp | PDF | OpenDocument 演示文稿 |
| .pps/.ppsx | PDF | PowerPoint 放映格式 |

## 内容保留说明

| 内容类型 | 保留情况 | 备注 |
|---|---|---|
| 文字 | ✅ 完整保留 | 字体、字号、颜色 |
| 图片 | ✅ 完整保留 | 原始分辨率 |
| 形状/图表 | ✅ 完整保留 | 矢量图形 |
| 表格 | ✅ 完整保留 | 格式和数据 |
| 超链接 | ✅ 保留 | 可点击链接 |
| 幻灯片布局 | ✅ 完整保留 | 页面比例一致 |
| 动画 | ⚠️ 静态化 | PDF 不支持动画，显示最终状态 |
| 切换效果 | ⚠️ 不保留 | PDF 不支持幻灯片切换 |
| 视频/音频 | ⚠️ 不嵌入 | 仅显示封面/占位 |

## 与 pdf-compress 联动

转换后可以直接压缩，形成完整工作流：

```
PPT/PPTX → PDF（本skill）→ 压缩（pdf-compress skill）→ 上传 GitHub
```

压缩级别：
- `low`：150 DPI，画质好
- `medium`：100 DPI，平衡（推荐）
- `high`：72 DPI，体积最小

## 工作流程

```
用户请求 PPT 转 PDF
    │
    ▼
检查文件格式（.ppt/.pptx/.odp/.pps）
    │
    ▼
获取 PPT 信息（幻灯片数、大小）
    │
    ▼
调用 LibreOffice 无头模式转换
    │
    ▼
验证输出 PDF（非空、页数匹配）
    │
    ├─ 需要压缩 → 调用 pdf-compress
    │
    ▼
输出转换报告
```

## 故障排查

| 问题 | 可能原因 | 解决方法 |
|---|---|---|
| soffice 未找到 | 未安装 LibreOffice | `sudo apt install libreoffice` |
| 中文字体显示异常 | 缺少中文字体 | 安装 fonts-noto-cjk |
| 转换后布局错乱 | 复杂动画/特殊字体 | 尝试在 PPT 中嵌入字体后再转换 |
| 转换超时 | 文件过大/图片过多 | 增加超时时间，关闭其他 LibreOffice 进程 |
| 输出文件为 0 字节 | 有残留 soffice 进程 | 执行 `pkill soffice` 后重试 |
| 批量转换部分失败 | 个别文件损坏 | 查看错误日志，单独处理失败文件 |

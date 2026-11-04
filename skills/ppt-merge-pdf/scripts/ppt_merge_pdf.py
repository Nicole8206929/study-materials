#!/usr/bin/env python3
"""
PPT 批量合并转 PDF 工具（增强版）
将多个 PPT 合并为一个统一的 PDF，支持封面、目录、书签、自动压缩、递归扫描
"""

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

# 支持的输入格式
SUPPORTED_EXTENSIONS = {".ppt", ".pptx", ".odp", ".pps", ".ppsx"}

# 其他 skill 脚本路径
SKILL_ROOT = Path(__file__).parent.parent.parent
PDF_COMPRESS_SCRIPT = SKILL_ROOT / "pdf-compress" / "scripts" / "pdf_compress.py"


# ============ 工具函数 ============

def format_size(size_bytes):
    """格式化文件大小"""
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    elif size_bytes < 1024 * 1024 * 1024:
        return f"{size_bytes / (1024 * 1024):.1f} MB"
    else:
        return f"{size_bytes / (1024 * 1024 * 1024):.2f} GB"


def find_cjk_font():
    """查找可用的中文字体（reportlab仅支持TrueType）"""
    # 优先使用 TrueType 字体（reportlab不支持OpenType/CFF）
    font_paths = [
        "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
        "/usr/share/fonts/truetype/arphic/uming.ttc",
    ]
    for path in font_paths:
        if os.path.exists(path):
            return path
    return None


def register_cjk_font(font_name="CJK"):
    """注册中文字体并返回字体名"""
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    font_path = find_cjk_font()
    if font_path:
        try:
            pdfmetrics.registerFont(
                TTFont(font_name, font_path, subfontIndex=0)
            )
            return font_name
        except Exception:
            pass
    return "Helvetica"


# ============ PPT 转换 ============

def convert_ppt_to_pdf(ppt_path, output_pdf, timeout=300, retries=2):
    """
    用 LibreOffice 转换单个 PPT，带重试机制
    """
    input_path = Path(ppt_path).resolve()
    output_path = Path(output_pdf).resolve()

    if not input_path.exists():
        raise FileNotFoundError(f"文件不存在: {input_path}")

    output_path.parent.mkdir(parents=True, exist_ok=True)

    last_error = None
    for attempt in range(retries + 1):
        # 清理可能残留的 soffice 进程
        if attempt > 0:
            subprocess.run(["pkill", "-f", "soffice"], capture_output=True)
            import time
            time.sleep(2)

        with tempfile.TemporaryDirectory() as tmpdir:
            cmd = [
                "soffice", "--headless", "--norestore", "--nofirststartwizard",
                "--convert-to", "pdf", "--outdir", tmpdir, str(input_path),
            ]
            try:
                result = subprocess.run(
                    cmd, capture_output=True, text=True, timeout=timeout
                )

                if result.returncode != 0:
                    last_error = result.stderr
                    continue

                expected = Path(tmpdir) / f"{input_path.stem}.pdf"
                if not expected.exists():
                    pdfs = list(Path(tmpdir).glob("*.pdf"))
                    if pdfs:
                        expected = pdfs[0]
                    else:
                        last_error = "未找到 PDF 输出"
                        continue

                shutil.move(str(expected), str(output_path))

                if output_path.exists() and output_path.stat().st_size > 0:
                    return output_path

            except subprocess.TimeoutExpired:
                last_error = f"转换超时（{timeout}秒）"
            except Exception as e:
                last_error = str(e)

    raise RuntimeError(f"转换失败（重试{retries}次）: {last_error}")


# ============ 封面和目录生成 ============

def create_cover_pdf(title, subtitle, output_path, author=None, date=None):
    """生成专业封面 PDF"""
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.pdfgen import canvas
    from reportlab.lib.units import mm
    from reportlab.lib.colors import HexColor

    font_name = register_cjk_font()

    page_size = landscape(A4)
    c = canvas.Canvas(str(output_path), pagesize=page_size)
    w, h = page_size

    # 顶部装饰线
    c.setStrokeColor(HexColor("#2563eb"))
    c.setLineWidth(3)
    c.line(30 * mm, h - 25 * mm, w - 30 * mm, h - 25 * mm)

    # 主标题
    c.setFont(font_name, 36)
    c.setFillColor(HexColor("#1e293b"))
    c.drawCentredString(w / 2, h / 2 + 15 * mm, title)

    # 副标题
    if subtitle:
        c.setFont(font_name, 20)
        c.setFillColor(HexColor("#475569"))
        c.drawCentredString(w / 2, h / 2 - 10 * mm, subtitle)

    # 底部信息
    c.setStrokeColor(HexColor("#2563eb"))
    c.setLineWidth(1)
    c.line(30 * mm, 30 * mm, w - 30 * mm, 30 * mm)

    c.setFont(font_name, 11)
    c.setFillColor(HexColor("#64748b"))
    if author:
        c.drawString(30 * mm, 22 * mm, f"作者: {author}")
    if date:
        c.drawRightString(w - 30 * mm, 22 * mm, date)

    c.save()
    return output_path


def create_toc_pdf(entries, output_path):
    """生成目录 PDF，支持多页"""
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.pdfgen import canvas
    from reportlab.lib.units import mm
    from reportlab.lib.colors import HexColor

    font_name = register_cjk_font()

    page_size = landscape(A4)
    c = canvas.Canvas(str(output_path), pagesize=page_size)
    w, h = page_size

    # 标题
    c.setFont(font_name, 26)
    c.setFillColor(HexColor("#1e293b"))
    c.drawString(25 * mm, h - 25 * mm, "目录")

    # 装饰线
    c.setStrokeColor(HexColor("#2563eb"))
    c.setLineWidth(2)
    c.line(25 * mm, h - 30 * mm, w - 25 * mm, h - 30 * mm)

    y = h - 45 * mm
    line_height = 11 * mm

    for i, (name, page_num) in enumerate(entries, 1):
        # 检查是否需要新页
        if y < 25 * mm:
            c.showPage()
            y = h - 25 * mm

        c.setFont(font_name, 13)
        c.setFillColor(HexColor("#334155"))

        # 序号和名称
        label = f"{i}. {name}"
        c.drawString(30 * mm, y, label)

        # 虚线引导
        c.setStrokeColor(HexColor("#cbd5e1"))
        c.setLineWidth(0.5)
        c.setDash(1, 2)
        text_width = c.stringWidth(label, font_name, 13)
        x_start = 30 * mm + text_width + 5 * mm
        x_end = w - 35 * mm
        c.line(x_start, y + 1 * mm, x_end, y + 1 * mm)
        c.setDash()

        # 页码
        c.setFont(font_name, 13)
        c.setFillColor(HexColor("#2563eb"))
        c.drawRightString(w - 25 * mm, y, str(page_num))

        y -= line_height

    c.save()
    return output_path


# ============ PDF 合并 ============

def merge_pdfs_with_bookmarks(pdf_list, output_path, metadata=None):
    """
    合并多个 PDF，同时添加书签/大纲
    pdf_list: [(pdf_path, section_name), ...]
    """
    import pymupdf

    merged = pymupdf.open()
    toc = []
    page_offset = 0

    for pdf_path, name in pdf_list:
        doc = pymupdf.open(str(pdf_path))
        merged.insert_pdf(doc)
        toc.append([1, name, page_offset + 1])
        page_offset += doc.page_count
        doc.close()

    # 设置书签
    if toc:
        merged.set_toc(toc)

    # 设置元数据
    if metadata:
        merged.set_metadata(metadata)

    merged.save(str(output_path), garbage=4, deflate=True)
    merged.close()
    return toc


def get_pdf_info(pdf_path):
    """获取 PDF 信息"""
    import pymupdf
    with pymupdf.open(str(pdf_path)) as doc:
        return {
            "pages": doc.page_count,
            "size": Path(pdf_path).stat().st_size,
        }


# ============ 压缩 ============

def compress_pdf(pdf_path, level="medium"):
    """调用 pdf-compress skill 压缩"""
    if not PDF_COMPRESS_SCRIPT.exists():
        raise FileNotFoundError(f"pdf-compress 未找到: {PDF_COMPRESS_SCRIPT}")

    compressed_path = pdf_path.with_name(
        f"{pdf_path.stem}_compressed{pdf_path.suffix}"
    )
    cmd = [
        sys.executable, str(PDF_COMPRESS_SCRIPT), "compress",
        str(pdf_path), "--level", level, "-o", str(compressed_path),
    ]
    result = subprocess.run(
        cmd, capture_output=True, text=True, timeout=600
    )

    if result.returncode != 0:
        raise RuntimeError(f"压缩失败: {result.stderr}")

    if compressed_path.exists() and compressed_path.stat().st_size > 0:
        original_size = pdf_path.stat().st_size
        compressed_size = compressed_path.stat().st_size
        shutil.move(str(compressed_path), str(pdf_path))
        return {
            "original_size": original_size,
            "compressed_size": compressed_size,
            "ratio": (1 - compressed_size / original_size) * 100,
        }
    raise RuntimeError("压缩输出为空")


# ============ 文件扫描 ============

def scan_directory(input_dir, recursive=False, sort_by="name"):
    """扫描目录中的 PPT 文件"""
    input_dir = Path(input_dir)
    files = []

    if recursive:
        for ext in SUPPORTED_EXTENSIONS:
            files.extend(input_dir.rglob(f"*{ext}"))
            files.extend(input_dir.rglob(f"*{ext.upper()}"))
    else:
        for ext in SUPPORTED_EXTENSIONS:
            files.extend(input_dir.glob(f"*{ext}"))
            files.extend(input_dir.glob(f"*{ext.upper()}"))

    # 去重、排除隐藏文件
    files = sorted(set(f for f in files if not f.name.startswith(".")))

    # 排序
    if sort_by == "name":
        files.sort(key=lambda f: f.name.lower())
    elif sort_by == "mtime":
        files.sort(key=lambda f: f.stat().st_mtime)
    elif sort_by == "size":
        files.sort(key=lambda f: f.stat().st_size)

    return files


# ============ 主流程 ============

def do_merge(
    ppt_files, output_path,
    cover=None, subtitle=None, author=None,
    add_toc=False, compress_level=None,
    timeout=300,
):
    """执行完整合并流程"""
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    total = len(ppt_files)
    print(f"待处理 PPT 数量: {total}")
    print(f"输出路径: {output_path}")
    print()

    converted = []
    failed = []
    total_original_size = 0

    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir = Path(tmpdir)

        # 1. 批量转换
        print("=" * 60)
        print("阶段 1/3: 批量转换 PPT → PDF")
        print("=" * 60)

        for i, ppt_file in enumerate(ppt_files, 1):
            ppt_path = Path(ppt_file)
            pdf_path = tmpdir / f"part_{i:04d}.pdf"

            print(f"\n[{i}/{total}] {ppt_path.name}")
            try:
                convert_ppt_to_pdf(ppt_path, pdf_path, timeout=timeout)
                info = get_pdf_info(pdf_path)
                file_size = ppt_path.stat().st_size
                total_original_size += file_size

                print(f"  ✓ {info['pages']} 页 | {format_size(info['size'])}")
                converted.append((pdf_path, ppt_path.stem))

            except Exception as e:
                print(f"  ✗ 失败: {e}")
                failed.append({"file": ppt_path.name, "error": str(e)})

        if not converted:
            print("\n错误: 没有成功转换的文件", file=sys.stderr)
            sys.exit(1)

        # 2. 准备封面和目录
        print("\n" + "=" * 60)
        print("阶段 2/3: 生成封面、目录并合并")
        print("=" * 60)

        merge_list = []
        section_pages = []

        # 封面
        if cover:
            print("\n生成封面...")
            cover_pdf = tmpdir / "cover.pdf"
            create_cover_pdf(
                cover, subtitle, cover_pdf,
                author=author,
                date=datetime.now().strftime("%Y年%m月"),
            )
            merge_list.append((cover_pdf, "封面"))

        # 先计算各章节页码（用于目录）
        current_page = 1
        if cover:
            current_page += 1
        if add_toc:
            current_page += 1

        for pdf_path, name in converted:
            info = get_pdf_info(pdf_path)
            section_pages.append((name, current_page))
            current_page += info["pages"]

        # 目录
        if add_toc:
            print("生成目录...")
            toc_pdf = tmpdir / "toc.pdf"
            create_toc_pdf(section_pages, toc_pdf)
            merge_list.append((toc_pdf, "目录"))

        # 各章节
        for pdf_path, name in converted:
            merge_list.append((pdf_path, name))

        # 3. 合并
        print("合并 PDF...")
        metadata = {
            "title": cover or output_path.stem,
            "author": author or "",
            "subject": subtitle or "",
            "creator": "ppt-merge-pdf skill",
        }
        merge_pdfs_with_bookmarks(merge_list, output_path, metadata)

    # 3. 压缩
    final_info = get_pdf_info(output_path)
    print("\n" + "=" * 60)
    print("阶段 3/3: 最终处理")
    print("=" * 60)

    if compress_level:
        print(f"\n调用 pdf-compress 压缩（级别: {compress_level}）...")
        try:
            comp_result = compress_pdf(output_path, compress_level)
            final_info = get_pdf_info(output_path)
            print(f"  压缩前: {format_size(comp_result['original_size'])}")
            print(f"  压缩后: {format_size(comp_result['compressed_size'])}")
            print(f"  压缩率: {comp_result['ratio']:.1f}%")
        except Exception as e:
            print(f"  压缩失败（保留未压缩版本）: {e}")

    # 最终报告
    print("\n" + "=" * 60)
    print("处理完成报告")
    print("=" * 60)
    print(f"输出文件: {output_path}")
    print(f"总页数: {final_info['pages']}")
    print(f"最终大小: {format_size(final_info['size'])}")
    print(f"成功转换: {len(converted)}/{total}")

    if failed:
        print(f"\n失败文件 ({len(failed)}):")
        for item in failed:
            print(f"  ✗ {item['file']}: {item['error']}")


# ============ 命令行 ============

def cmd_merge(args):
    """处理 merge 命令"""
    if len(args.files) < 1:
        print("请至少指定 1 个 PPT 文件", file=sys.stderr)
        sys.exit(1)

    do_merge(
        args.files, args.output,
        cover=args.cover, subtitle=args.subtitle, author=args.author,
        add_toc=args.toc, compress_level=args.compress,
        timeout=args.timeout,
    )


def cmd_merge_dir(args):
    """处理 merge-dir 命令"""
    files = scan_directory(
        args.input_dir,
        recursive=args.recursive,
        sort_by=args.sort,
    )

    if not files:
        print(f"目录中未找到支持的文件", file=sys.stderr)
        sys.exit(1)

    print(f"扫描目录: {args.input_dir}")
    print(f"找到 {len(files)} 个文件（排序: {args.sort}）")
    print()

    do_merge(
        [str(f) for f in files], args.output,
        cover=args.cover, subtitle=args.subtitle, author=args.author,
        add_toc=args.toc, compress_level=args.compress,
        timeout=args.timeout,
    )


def main():
    parser = argparse.ArgumentParser(
        description="PPT 批量合并转 PDF（增强版）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    subparsers = parser.add_subparsers(dest="command", help="可用命令")

    # merge 命令
    merge_parser = subparsers.add_parser("merge", help="合并指定的多个 PPT")
    merge_parser.add_argument("files", nargs="+", help="PPT 文件列表")
    merge_parser.add_argument("-o", "--output", required=True, help="输出 PDF 路径")
    merge_parser.add_argument("--cover", help="封面标题")
    merge_parser.add_argument("--subtitle", help="封面副标题")
    merge_parser.add_argument("--author", help="作者")
    merge_parser.add_argument("--toc", action="store_true", help="自动生成目录")
    merge_parser.add_argument(
        "--compress", choices=["low", "medium", "high"],
        help="合并后自动压缩",
    )
    merge_parser.add_argument(
        "--timeout", type=int, default=300,
        help="单文件转换超时（秒）",
    )
    merge_parser.set_defaults(func=cmd_merge)

    # merge-dir 命令
    dir_parser = subparsers.add_parser("merge-dir", help="合并整个目录")
    dir_parser.add_argument("input_dir", help="PPT 所在目录")
    dir_parser.add_argument("-o", "--output", required=True, help="输出 PDF 路径")
    dir_parser.add_argument(
        "--recursive", action="store_true",
        help="递归扫描子目录",
    )
    dir_parser.add_argument(
        "--sort", choices=["name", "mtime", "size"],
        default="name", help="排序方式",
    )
    dir_parser.add_argument("--cover", help="封面标题")
    dir_parser.add_argument("--subtitle", help="封面副标题")
    dir_parser.add_argument("--author", help="作者")
    dir_parser.add_argument("--toc", action="store_true", help="自动生成目录")
    dir_parser.add_argument(
        "--compress", choices=["low", "medium", "high"],
        help="合并后自动压缩",
    )
    dir_parser.add_argument(
        "--timeout", type=int, default=300,
        help="单文件转换超时",
    )
    dir_parser.set_defaults(func=cmd_merge_dir)

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        sys.exit(0)
    args.func(args)


if __name__ == "__main__":
    main()

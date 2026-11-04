#!/usr/bin/env python3
"""
PPT 批量合并转 PDF 工具
将多个 PPT 合并为一个统一的 PDF，支持封面、目录、自动压缩
"""

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# 支持的输入格式
SUPPORTED_EXTENSIONS = {".ppt", ".pptx", ".odp", ".pps", ".ppsx"}

# 其他 skill 脚本路径
PPT_TO_PDF_SCRIPT = (
    Path(__file__).parent.parent.parent / "ppt-to-pdf" / "scripts" / "ppt_to_pdf.py"
)
PDF_COMPRESS_SCRIPT = (
    Path(__file__).parent.parent.parent / "pdf-compress" / "scripts" / "pdf_compress.py"
)


def format_size(size_bytes):
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    elif size_bytes < 1024 * 1024 * 1024:
        return f"{size_bytes / (1024 * 1024):.1f} MB"
    else:
        return f"{size_bytes / (1024 * 1024 * 1024):.2f} GB"


def convert_ppt_to_pdf(ppt_path, output_pdf, timeout=300):
    """用 LibreOffice 转换单个 PPT"""
    input_path = Path(ppt_path).resolve()
    output_path = Path(output_pdf).resolve()

    if not input_path.exists():
        raise FileNotFoundError(f"文件不存在: {input_path}")

    output_path.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmpdir:
        cmd = [
            "soffice", "--headless", "--norestore", "--nofirststartwizard",
            "--convert-to", "pdf", "--outdir", tmpdir, str(input_path),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)

        if result.returncode != 0:
            raise RuntimeError(f"转换失败: {result.stderr}")

        expected = Path(tmpdir) / f"{input_path.stem}.pdf"
        if not expected.exists():
            pdfs = list(Path(tmpdir).glob("*.pdf"))
            if pdfs:
                expected = pdfs[0]
            else:
                raise RuntimeError("未找到 PDF 输出")

        shutil.move(str(expected), str(output_path))

    if not output_path.exists() or output_path.stat().st_size == 0:
        raise RuntimeError("输出 PDF 为空")

    return output_path


def create_cover_pdf(title, subtitle, output_path):
    """生成封面 PDF"""
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.pdfgen import canvas
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.lib.units import mm

    # 注册中文字体
    font_name = "Helvetica"
    for font_path in [
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
    ]:
        if os.path.exists(font_path):
            try:
                pdfmetrics.registerFont(TTFont("CJK", font_path))
                font_name = "CJK"
                break
            except Exception:
                continue

    # 用A4横向（与PPT宽屏一致）
    page_size = landscape(A4)
    c = canvas.Canvas(str(output_path), pagesize=page_size)
    w, h = page_size

    # 标题
    c.setFont(font_name, 36)
    c.drawCentredString(w / 2, h / 2 + 20 * mm, title)

    # 副标题
    if subtitle:
        c.setFont(font_name, 18)
        c.drawCentredString(w / 2, h / 2 - 10 * mm, subtitle)

    c.save()
    return output_path


def create_toc_pdf(entries, output_path):
    """生成目录 PDF"""
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.pdfgen import canvas
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.lib.units import mm

    font_name = "Helvetica"
    for font_path in [
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
    ]:
        if os.path.exists(font_path):
            try:
                pdfmetrics.registerFont(TTFont("CJK", font_path))
                font_name = "CJK"
                break
            except Exception:
                continue

    page_size = landscape(A4)
    c = canvas.Canvas(str(output_path), pagesize=page_size)
    w, h = page_size

    y = h - 30 * mm
    c.setFont(font_name, 24)
    c.drawString(20 * mm, y, "目录")
    y -= 15 * mm

    c.setFont(font_name, 14)
    for i, (name, page) in enumerate(entries, 1):
        c.drawString(25 * mm, y, f"{i}. {name}")
        c.drawRightString(w - 20 * mm, y, f"第 {page} 页")
        y -= 10 * mm
        if y < 20 * mm:
            c.showPage()
            y = h - 30 * mm

    c.save()
    return output_path


def merge_pdfs(pdf_list, output_path):
    """合并多个 PDF"""
    import pymupdf

    merged = pymupdf.open()
    page_offset = 0
    toc_entries = []

    for pdf_path, name in pdf_list:
        doc = pymupdf.open(str(pdf_path))
        merged.insert_pdf(doc)
        toc_entries.append((name, page_offset + 1))
        page_offset += doc.page_count
        doc.close()

    merged.save(str(output_path))
    merged.close()
    return toc_entries


def compress_pdf(pdf_path, level="medium"):
    """调用 pdf-compress"""
    if not PDF_COMPRESS_SCRIPT.exists():
        raise FileNotFoundError(f"pdf-compress 未找到: {PDF_COMPRESS_SCRIPT}")

    compressed_path = pdf_path.with_name(f"{pdf_path.stem}_compressed{pdf_path.suffix}")
    cmd = [
        sys.executable, str(PDF_COMPRESS_SCRIPT), "compress",
        str(pdf_path), "--level", level, "-o", str(compressed_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if result.returncode != 0:
        raise RuntimeError(f"压缩失败: {result.stderr}")

    if compressed_path.exists() and compressed_path.stat().st_size > 0:
        shutil.move(str(compressed_path), str(pdf_path))
    return pdf_path


def get_pdf_info(pdf_path):
    import pymupdf
    with pymupdf.open(str(pdf_path)) as doc:
        return {"pages": doc.page_count, "size": Path(pdf_path).stat().st_size}


def do_merge(ppt_files, output_path, cover=None, subtitle=None, toc=False, compress=None):
    """执行合并主流程"""
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"待合并 PPT 数量: {len(ppt_files)}")
    print()

    # 1. 逐个转换为 PDF
    converted_pdfs = []
    failed = []

    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir = Path(tmpdir)

        for i, ppt_file in enumerate(ppt_files, 1):
            ppt_path = Path(ppt_file)
            pdf_path = tmpdir / f"part_{i:03d}.pdf"

            print(f"[{i}/{len(ppt_files)}] 转换: {ppt_path.name}")
            try:
                convert_ppt_to_pdf(ppt_path, pdf_path)
                info = get_pdf_info(pdf_path)
                print(f"  → {info['pages']} 页, {format_size(info['size'])}")
                converted_pdfs.append((pdf_path, ppt_path.stem))
            except Exception as e:
                print(f"  失败: {e}")
                failed.append((ppt_path.name, str(e)))
            print()

        if not converted_pdfs:
            print("没有成功转换的文件", file=sys.stderr)
            sys.exit(1)

        # 2. 准备合并列表
        merge_list = []

        # 封面
        if cover:
            print("生成封面...")
            cover_pdf = tmpdir / "cover.pdf"
            create_cover_pdf(cover, subtitle, cover_pdf)
            merge_list.append((cover_pdf, "封面"))

        # 各章节PDF
        for pdf_path, name in converted_pdfs:
            merge_list.append((pdf_path, name))

        # 3. 先合并一次，统计页数（用于目录）
        print("合并中...")
        toc_entries = merge_pdfs(merge_list, output_path)

        # 4. 如果需要目录，重新合并（封面+目录+内容）
        if toc:
            print("生成目录...")
            # 计算目录页码偏移（封面1页+目录1页）
            content_start = 2  # 封面+目录各1页
            # 重新计算每个文件的起始页
            current_page = content_start
            adjusted_entries = []
            for pdf_path, name in converted_pdfs:
                page_count = get_pdf_info(pdf_path)["pages"]
                adjusted_entries.append((name, current_page))
                current_page += page_count

            toc_pdf = tmpdir / "toc.pdf"
            create_toc_pdf(adjusted_entries, toc_pdf)

            # 重新完整合并
            final_list = []
            if cover:
                final_list.append((tmpdir / "cover.pdf", "封面"))
            final_list.append((toc_pdf, "目录"))
            for pdf_path, name in converted_pdfs:
                final_list.append((pdf_path, name))

            merge_pdfs(final_list, output_path)

    # 5. 输出报告
    info = get_pdf_info(output_path)
    print("=" * 50)
    print("合并完成")
    print("=" * 50)
    print(f"输出文件: {output_path}")
    print(f"总页数: {info['pages']}")
    print(f"文件大小: {format_size(info['size'])}")

    if failed:
        print(f"\n失败文件 ({len(failed)}):")
        for name, err in failed:
            print(f"  {name}: {err}")

    # 6. 压缩
    if compress:
        print(f"\n正在压缩（级别: {compress}）...")
        try:
            compress_pdf(output_path, compress)
            compressed_info = get_pdf_info(output_path)
            ratio = (1 - compressed_info["size"] / info["size"]) * 100
            print(f"压缩后大小: {format_size(compressed_info['size'])}")
            print(f"压缩率: {ratio:.1f}%")
        except Exception as e:
            print(f"压缩失败（保留未压缩版本）: {e}")


def cmd_merge(args):
    """处理 merge 命令"""
    if len(args.files) < 2:
        print("merge 命令至少需要 2 个 PPT 文件", file=sys.stderr)
        sys.exit(1)

    do_merge(
        args.files, args.output,
        cover=args.cover, subtitle=args.subtitle,
        toc=args.toc, compress=args.compress,
    )


def cmd_merge_dir(args):
    """处理 merge-dir 命令"""
    input_dir = Path(args.input_dir)
    if not input_dir.is_dir():
        print(f"目录不存在: {input_dir}", file=sys.stderr)
        sys.exit(1)

    ppt_files = []
    for ext in SUPPORTED_EXTENSIONS:
        ppt_files.extend(input_dir.glob(f"*{ext}"))
        ppt_files.extend(input_dir.glob(f"*{ext.upper()}"))
    ppt_files = sorted(set(ppt_files))

    if len(ppt_files) < 2:
        print(f"目录中至少需要 2 个 PPT 文件", file=sys.stderr)
        sys.exit(1)

    print(f"目录: {input_dir}")
    print(f"按文件名排序合并: {len(ppt_files)} 个文件")
    print()

    do_merge(
        [str(f) for f in ppt_files], args.output,
        cover=args.cover, subtitle=args.subtitle,
        toc=args.toc, compress=args.compress,
    )


def main():
    parser = argparse.ArgumentParser(
        description="PPT 批量合并转 PDF",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    subparsers = parser.add_subparsers(dest="command", help="可用命令")

    # merge 命令
    merge_parser = subparsers.add_parser("merge", help="合并指定的多个 PPT")
    merge_parser.add_argument("files", nargs="+", help="PPT 文件列表")
    merge_parser.add_argument("-o", "--output", required=True, help="输出 PDF 路径")
    merge_parser.add_argument("--cover", help="封面标题")
    merge_parser.add_argument("--subtitle", help="封面副标题")
    merge_parser.add_argument("--toc", action="store_true", help="自动生成目录页")
    merge_parser.add_argument(
        "--compress", choices=["low", "medium", "high"],
        help="合并后自动压缩",
    )
    merge_parser.set_defaults(func=cmd_merge)

    # merge-dir 命令
    dir_parser = subparsers.add_parser("merge-dir", help="合并整个目录的 PPT")
    dir_parser.add_argument("input_dir", help="PPT 所在目录")
    dir_parser.add_argument("-o", "--output", required=True, help="输出 PDF 路径")
    dir_parser.add_argument("--cover", help="封面标题")
    dir_parser.add_argument("--subtitle", help="封面副标题")
    dir_parser.add_argument("--toc", action="store_true", help="自动生成目录页")
    dir_parser.add_argument(
        "--compress", choices=["low", "medium", "high"],
        help="合并后自动压缩",
    )
    dir_parser.set_defaults(func=cmd_merge_dir)

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        sys.exit(0)
    args.func(args)


if __name__ == "__main__":
    main()

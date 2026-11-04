#!/usr/bin/env python3
"""
PPT 转 PDF 工具
使用 LibreOffice 无头模式转换，支持批量转换和自动压缩
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

# pdf-compress 脚本路径（相对于本skill）
PDF_COMPRESS_SCRIPT = (
    Path(__file__).parent.parent.parent / "pdf-compress" / "scripts" / "pdf_compress.py"
)


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


def get_ppt_info(ppt_path):
    """获取 PPT 基本信息"""
    info = {
        "slides": None,
        "size": Path(ppt_path).stat().st_size,
    }

    # 用 python-pptx 读取 pptx
    if ppt_path.suffix.lower() == ".pptx":
        try:
            from pptx import Presentation
            prs = Presentation(str(ppt_path))
            info["slides"] = len(prs.slides)
            # 获取幻灯片尺寸
            info["width"] = prs.slide_width
            info["height"] = prs.slide_height
        except Exception:
            pass

    return info


def convert_to_pdf(input_path, output_path, timeout=300):
    """
    使用 LibreOffice 将 PPT 转换为 PDF
    """
    input_path = Path(input_path).resolve()
    output_path = Path(output_path).resolve()

    if not input_path.exists():
        raise FileNotFoundError(f"文件不存在: {input_path}")

    # LibreOffice 输出到临时目录，然后移动
    with tempfile.TemporaryDirectory() as tmpdir:
        cmd = [
            "soffice",
            "--headless",
            "--norestore",
            "--nofirststartwizard",
            "--convert-to", "pdf",
            "--outdir", tmpdir,
            str(input_path),
        ]

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )

        if result.returncode != 0:
            raise RuntimeError(
                f"LibreOffice 转换失败 (code={result.returncode}): {result.stderr}"
            )

        # 找到输出文件
        expected_pdf = Path(tmpdir) / f"{input_path.stem}.pdf"
        if not expected_pdf.exists():
            # 尝试找任何PDF
            pdfs = list(Path(tmpdir).glob("*.pdf"))
            if pdfs:
                expected_pdf = pdfs[0]
            else:
                raise RuntimeError("转换完成但未找到 PDF 输出文件")

        # 确保输出目录存在
        output_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(expected_pdf), str(output_path))

    if not output_path.exists() or output_path.stat().st_size == 0:
        raise RuntimeError("输出文件为空或不存在")

    return output_path


def compress_pdf(pdf_path, level="medium"):
    """
    调用 pdf-compress skill 压缩 PDF
    """
    if not PDF_COMPRESS_SCRIPT.exists():
        raise FileNotFoundError(
            f"pdf-compress 脚本未找到: {PDF_COMPRESS_SCRIPT}"
        )

    compressed_path = pdf_path.with_name(
        f"{pdf_path.stem}_compressed{pdf_path.suffix}"
    )

    cmd = [
        sys.executable,
        str(PDF_COMPRESS_SCRIPT),
        "compress",
        str(pdf_path),
        "--level", level,
        "-o", str(compressed_path),
    ]

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=600,
    )

    if result.returncode != 0:
        raise RuntimeError(f"压缩失败: {result.stderr}")

    # 替换原文件
    if compressed_path.exists() and compressed_path.stat().st_size > 0:
        shutil.move(str(compressed_path), str(pdf_path))

    return pdf_path


def get_pdf_page_count(pdf_path):
    """获取 PDF 页数"""
    try:
        import pymupdf
        with pymupdf.open(str(pdf_path)) as doc:
            return doc.page_count
    except Exception:
        return None


def cmd_convert(args):
    """处理 convert 命令"""
    input_path = Path(args.input)

    if input_path.suffix.lower() not in SUPPORTED_EXTENSIONS:
        print(
            f"不支持的文件格式: {input_path.suffix}，"
            f"支持: {', '.join(sorted(SUPPORTED_EXTENSIONS))}",
            file=sys.stderr,
        )
        sys.exit(1)

    # 确定输出路径
    if args.output:
        output_path = Path(args.output)
    else:
        output_path = input_path.with_suffix(".pdf")

    # 原始信息
    ppt_info = get_ppt_info(input_path)
    original_size = ppt_info["size"]

    print(f"输入文件: {input_path}")
    print(f"原始大小: {format_size(original_size)}")
    if ppt_info.get("slides"):
        print(f"幻灯片数: {ppt_info['slides']}")
    print()

    # 转换
    print("正在转换为 PDF...")
    try:
        convert_to_pdf(input_path, output_path, timeout=args.timeout)
    except Exception as e:
        print(f"转换失败: {e}", file=sys.stderr)
        sys.exit(1)

    pdf_size = output_path.stat().st_size
    pdf_pages = get_pdf_page_count(output_path)

    print(f"输出文件: {output_path}")
    print(f"PDF 大小: {format_size(pdf_size)}")
    if pdf_pages:
        print(f"PDF 页数: {pdf_pages}")

    # 验证页数
    if ppt_info.get("slides") and pdf_pages:
        if ppt_info["slides"] != pdf_pages:
            print(
                f"警告: 幻灯片数({ppt_info['slides']})与PDF页数({pdf_pages})不一致",
                file=sys.stderr,
            )

    # 压缩
    if args.compress:
        print()
        print(f"正在压缩（级别: {args.compress}）...")
        try:
            compress_pdf(output_path, args.compress)
            compressed_size = output_path.stat().st_size
            ratio = (1 - compressed_size / pdf_size) * 100
            print(f"压缩后大小: {format_size(compressed_size)}")
            print(f"压缩率: {ratio:.1f}%")
        except Exception as e:
            print(f"压缩失败（保留未压缩PDF）: {e}", file=sys.stderr)

    print()
    print("转换完成")


def cmd_batch(args):
    """处理 batch 命令"""
    input_dir = Path(args.input_dir)

    if not input_dir.is_dir():
        print(f"目录不存在: {input_dir}", file=sys.stderr)
        sys.exit(1)

    # 找所有支持的文件
    ppt_files = []
    for ext in SUPPORTED_EXTENSIONS:
        ppt_files.extend(input_dir.glob(f"*{ext}"))
        ppt_files.extend(input_dir.glob(f"*{ext.upper()}"))
    ppt_files = sorted(set(ppt_files))

    if not ppt_files:
        print(f"目录中没有找到支持的文件: {', '.join(sorted(SUPPORTED_EXTENSIONS))}")
        return

    print(f"找到 {len(ppt_files)} 个演示文稿")
    if args.compress:
        print(f"转换后自动压缩（级别: {args.compress}）")
    print()

    results = []
    success_count = 0

    for i, ppt_file in enumerate(ppt_files, 1):
        output_path = ppt_file.with_suffix(".pdf")
        original_size = ppt_file.stat().st_size

        print(f"[{i}/{len(ppt_files)}] {ppt_file.name}")
        print(f"  原始: {format_size(original_size)}")

        try:
            # 转换
            convert_to_pdf(ppt_file, output_path, timeout=args.timeout)
            pdf_size = output_path.stat().st_size
            pdf_pages = get_pdf_page_count(output_path)
            print(f"  PDF: {format_size(pdf_size)}", end="")
            if pdf_pages:
                print(f" | {pdf_pages}页", end="")
            print()

            # 压缩
            if args.compress:
                try:
                    compress_pdf(output_path, args.compress)
                    compressed_size = output_path.stat().st_size
                    ratio = (1 - compressed_size / pdf_size) * 100
                    print(f"  压缩后: {format_size(compressed_size)} ({ratio:.1f}%)")
                except Exception as e:
                    print(f"  压缩失败: {e}")

            success_count += 1
            results.append({
                "file": ppt_file.name,
                "success": True,
                "output": str(output_path),
            })

        except Exception as e:
            print(f"  失败: {e}")
            results.append({
                "file": ppt_file.name,
                "success": False,
                "error": str(e),
            })

        print()

    # 汇总
    print("=" * 50)
    print("转换汇总")
    print("=" * 50)
    print(f"成功: {success_count}/{len(ppt_files)}")

    failed = [r for r in results if not r["success"]]
    if failed:
        print("\n失败文件:")
        for r in failed:
            print(f"  {r['file']}: {r.get('error', '未知错误')}")


def cmd_info(args):
    """处理 info 命令"""
    input_path = Path(args.input)

    if not input_path.exists():
        print(f"文件不存在: {input_path}", file=sys.stderr)
        sys.exit(1)

    info = get_ppt_info(input_path)

    print(f"文件: {input_path}")
    print(f"大小: {format_size(info['size'])} ({info['size']} 字节)")
    if info.get("slides"):
        print(f"幻灯片数: {info['slides']}")
    if info.get("width") and info.get("height"):
        print(f"幻灯片尺寸: {info['width']} x {info['height']} EMU")
        # 转换为英寸（914400 EMU = 1英寸）
        w_in = info["width"] / 914400
        h_in = info["height"] / 914400
        print(f"幻灯片尺寸: {w_in:.2f} x {h_in:.2f} 英寸")


def main():
    parser = argparse.ArgumentParser(
        description="PPT 转 PDF 工具",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    subparsers = parser.add_subparsers(dest="command", help="可用命令")

    # convert 命令
    convert_parser = subparsers.add_parser("convert", help="转换单个 PPT")
    convert_parser.add_argument("input", help="输入 PPT/PPTX 文件")
    convert_parser.add_argument("-o", "--output", help="输出 PDF 路径")
    convert_parser.add_argument(
        "--compress",
        choices=["low", "medium", "high"],
        help="转换后自动压缩（级别: low/medium/high）",
    )
    convert_parser.add_argument(
        "--timeout",
        type=int,
        default=300,
        help="转换超时时间（秒，默认: 300）",
    )
    convert_parser.set_defaults(func=cmd_convert)

    # batch 命令
    batch_parser = subparsers.add_parser("batch", help="批量转换")
    batch_parser.add_argument("input_dir", help="包含 PPT 的目录")
    batch_parser.add_argument(
        "--compress",
        choices=["low", "medium", "high"],
        help="转换后自动压缩",
    )
    batch_parser.add_argument(
        "--timeout",
        type=int,
        default=300,
        help="单文件转换超时（秒）",
    )
    batch_parser.set_defaults(func=cmd_batch)

    # info 命令
    info_parser = subparsers.add_parser("info", help="查看 PPT 信息")
    info_parser.add_argument("input", help="PPT 文件")
    info_parser.set_defaults(func=cmd_info)

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(0)

    args.func(args)


if __name__ == "__main__":
    main()

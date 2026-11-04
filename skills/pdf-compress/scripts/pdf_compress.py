#!/usr/bin/env python3
"""
PDF 本地压缩工具
使用 Ghostscript 压缩 PDF，支持多种压缩级别
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path

# 压缩级别配置
LEVELS = {
    "low": {
        "dpi": 150,
        "desc": "轻度压缩（150 DPI，画质好）",
    },
    "medium": {
        "dpi": 100,
        "desc": "中度压缩（100 DPI，平衡）",
    },
    "high": {
        "dpi": 72,
        "desc": "高度压缩（72 DPI，体积最小）",
    },
}


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


def get_pdf_info(pdf_path):
    """获取 PDF 基本信息"""
    try:
        import pymupdf
        with pymupdf.open(pdf_path) as doc:
            return {
                "pages": doc.page_count,
                "metadata": doc.metadata,
            }
    except Exception:
        return {"pages": None, "metadata": {}}


def compress_pdf(input_path, output_path, level="medium"):
    """
    使用 Ghostscript 压缩 PDF
    """
    if level not in LEVELS:
        raise ValueError(f"不支持的压缩级别: {level}，可选: {list(LEVELS.keys())}")

    dpi = LEVELS[level]["dpi"]
    input_path = Path(input_path).resolve()
    output_path = Path(output_path).resolve()

    if not input_path.exists():
        raise FileNotFoundError(f"文件不存在: {input_path}")

    # Ghostscript 命令
    gs_cmd = [
        "gs",
        "-sDEVICE=pdfwrite",
        "-dCompatibilityLevel=1.4",
        "-dPDFSETTINGS=/screen",  # 屏幕优化
        "-dNOPAUSE",
        "-dQUIET",
        "-dBATCH",
        f"-dColorImageResolution={dpi}",
        f"-dGrayImageResolution={dpi}",
        f"-dMonoImageResolution={dpi}",
        "-dColorImageDownsampleType=/Bicubic",
        "-dGrayImageDownsampleType=/Bicubic",
        "-dMonoImageDownsampleType=/Bicubic",
        "-dEmbedAllFonts=true",
        "-dSubsetFonts=true",
        "-dAutoRotatePages=/None",
        f"-sOutputFile={output_path}",
        str(input_path),
    ]

    # 调整 PDFSETTINGS
    if level == "low":
        gs_cmd[gs_cmd.index("-dPDFSETTINGS=/screen")] = "-dPDFSETTINGS=/printer"
    elif level == "medium":
        gs_cmd[gs_cmd.index("-dPDFSETTINGS=/screen")] = "-dPDFSETTINGS=/ebook"
    # high 保持 /screen

    result = subprocess.run(
        gs_cmd,
        capture_output=True,
        text=True,
        timeout=600,
    )

    if result.returncode != 0:
        raise RuntimeError(f"Ghostscript 错误: {result.stderr}")

    if not output_path.exists():
        raise RuntimeError("压缩完成但输出文件不存在")

    return output_path


def cmd_compress(args):
    """处理 compress 命令"""
    input_path = Path(args.input)
    level = args.level

    # 确定输出路径
    if args.output:
        output_path = Path(args.output)
    else:
        output_path = input_path.with_name(f"{input_path.stem}_compressed{input_path.suffix}")

    # 原始信息
    original_size = input_path.stat().st_size
    pdf_info = get_pdf_info(input_path)

    print(f"输入文件: {input_path}")
    print(f"原始大小: {format_size(original_size)}")
    if pdf_info["pages"]:
        print(f"页数: {pdf_info['pages']}")
    print(f"压缩级别: {LEVELS[level]['desc']}")
    print()

    # 压缩
    print("正在压缩...")
    try:
        compress_pdf(input_path, output_path, level)
    except Exception as e:
        print(f"压缩失败: {e}", file=sys.stderr)
        sys.exit(1)

    # 压缩后信息
    compressed_size = output_path.stat().st_size
    ratio = (1 - compressed_size / original_size) * 100

    print(f"输出文件: {output_path}")
    print(f"压缩后大小: {format_size(compressed_size)}")
    print(f"压缩率: {ratio:.1f}%")

    # 如果压缩后反而更大，提示
    if compressed_size >= original_size:
        print()
        print("提示: 压缩后文件未变小，原文件可能已优化。")
        output_path.unlink()
        print(f"已删除无效输出，保留原文件: {input_path}")


def cmd_batch(args):
    """处理 batch 命令"""
    input_dir = Path(args.input_dir)
    level = args.level

    if not input_dir.is_dir():
        print(f"目录不存在: {input_dir}", file=sys.stderr)
        sys.exit(1)

    pdf_files = sorted(input_dir.glob("*.pdf"))
    # 排除已压缩的文件
    pdf_files = [f for f in pdf_files if "_compressed" not in f.stem]

    if not pdf_files:
        print("目录中没有找到 PDF 文件")
        return

    print(f"找到 {len(pdf_files)} 个 PDF 文件")
    print(f"压缩级别: {LEVELS[level]['desc']}")
    print()

    results = []
    total_original = 0
    total_compressed = 0

    for i, pdf_file in enumerate(pdf_files, 1):
        output_path = pdf_file.with_name(f"{pdf_file.stem}_compressed{pdf_file.suffix}")
        original_size = pdf_file.stat().st_size

        print(f"[{i}/{len(pdf_files)}] {pdf_file.name}")
        print(f"  原始: {format_size(original_size)}")

        try:
            compress_pdf(pdf_file, output_path, level)
            compressed_size = output_path.stat().st_size
            ratio = (1 - compressed_size / original_size) * 100

            print(f"  压缩后: {format_size(compressed_size)} ({ratio:.1f}%)")

            if compressed_size >= original_size:
                print("  提示: 压缩无效，保留原文件")
                output_path.unlink()
                compressed_size = original_size

            results.append({
                "file": pdf_file.name,
                "original": original_size,
                "compressed": compressed_size,
                "ratio": ratio,
                "success": True,
            })
            total_original += original_size
            total_compressed += compressed_size

        except Exception as e:
            print(f"  失败: {e}")
            results.append({
                "file": pdf_file.name,
                "original": original_size,
                "compressed": None,
                "ratio": None,
                "success": False,
            })

        print()

    # 汇总
    print("=" * 50)
    print("压缩汇总")
    print("=" * 50)
    success_count = sum(1 for r in results if r["success"])
    print(f"成功: {success_count}/{len(results)}")
    print(f"原始总大小: {format_size(total_original)}")
    print(f"压缩后总大小: {format_size(total_compressed)}")
    if total_original > 0:
        total_ratio = (1 - total_compressed / total_original) * 100
        print(f"总压缩率: {total_ratio:.1f}%")


def cmd_info(args):
    """处理 info 命令"""
    input_path = Path(args.input)

    if not input_path.exists():
        print(f"文件不存在: {input_path}", file=sys.stderr)
        sys.exit(1)

    size = input_path.stat().st_size
    info = get_pdf_info(input_path)

    print(f"文件: {input_path}")
    print(f"大小: {format_size(size)} ({size} 字节)")
    if info["pages"]:
        print(f"页数: {info['pages']}")
    if info["metadata"]:
        print("元数据:")
        for key, value in info["metadata"].items():
            if value:
                print(f"  {key}: {value}")


def main():
    parser = argparse.ArgumentParser(
        description="PDF 本地压缩工具",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    subparsers = parser.add_subparsers(dest="command", help="可用命令")

    # compress 命令
    compress_parser = subparsers.add_parser("compress", help="压缩单个 PDF")
    compress_parser.add_argument("input", help="输入 PDF 文件路径")
    compress_parser.add_argument("-o", "--output", help="输出文件路径")
    compress_parser.add_argument(
        "--level",
        choices=list(LEVELS.keys()),
        default="medium",
        help="压缩级别（默认: medium）",
    )
    compress_parser.set_defaults(func=cmd_compress)

    # batch 命令
    batch_parser = subparsers.add_parser("batch", help="批量压缩目录中的 PDF")
    batch_parser.add_argument("input_dir", help="包含 PDF 的目录")
    batch_parser.add_argument(
        "--level",
        choices=list(LEVELS.keys()),
        default="medium",
        help="压缩级别（默认: medium）",
    )
    batch_parser.set_defaults(func=cmd_batch)

    # info 命令
    info_parser = subparsers.add_parser("info", help="查看 PDF 信息")
    info_parser.add_argument("input", help="PDF 文件路径")
    info_parser.set_defaults(func=cmd_info)

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(0)

    args.func(args)


if __name__ == "__main__":
    main()

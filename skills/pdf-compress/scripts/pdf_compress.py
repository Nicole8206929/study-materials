#!/usr/bin/env python3
"""Compress local PDFs without overwriting an input or existing output."""
import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

LEVELS = {
    'low': {'dpi': 150, 'preset': '/printer', 'desc': '轻度压缩（150 DPI）'},
    'medium': {'dpi': 100, 'preset': '/ebook', 'desc': '中度压缩（100 DPI）'},
    'high': {'dpi': 72, 'preset': '/screen', 'desc': '高度压缩（72 DPI）'},
}


def format_size(size_bytes):
    for unit in ('B', 'KB', 'MB', 'GB'):
        if size_bytes < 1024 or unit == 'GB':
            return f'{size_bytes:.1f} {unit}'
        size_bytes /= 1024


def get_pdf_info(pdf_path):
    import pymupdf
    with pymupdf.open(pdf_path) as doc:
        if not doc.is_pdf or doc.is_encrypted or doc.page_count < 1:
            raise ValueError('需要未加密、至少含一页的有效 PDF')
        return {'pages': doc.page_count, 'metadata': doc.metadata}


def compress_pdf(input_path, output_path, level='medium'):
    """Always return a valid new file; copy the original if compression is larger.

    The output is published atomically only after PDF/page-count validation.
    An existing output (including symlinks) is never replaced.
    """
    if level not in LEVELS:
        raise ValueError(f'不支持的压缩级别: {level}')
    source = Path(input_path).resolve(strict=True)
    target = Path(output_path).absolute()
    if source == target.resolve() or target.exists() or target.is_symlink():
        raise FileExistsError(f'拒绝覆盖输入或已有输出: {target}')
    if source.suffix.lower() != '.pdf' or target.suffix.lower() != '.pdf':
        raise ValueError('输入和输出必须使用 .pdf 扩展名')
    info = get_pdf_info(source)
    if not shutil.which('gs'):
        raise RuntimeError('未找到 Ghostscript（gs），请先安装该依赖')
    target.parent.mkdir(parents=True, exist_ok=True)
    config = LEVELS[level]
    with tempfile.TemporaryDirectory(prefix='.pdf-compress-', dir=target.parent) as tmp:
        candidate = Path(tmp) / 'output.pdf'
        command = [
            'gs', '-dSAFER', '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.4',
            f"-dPDFSETTINGS={config['preset']}", '-dNOPAUSE', '-dQUIET', '-dBATCH',
            '-dDownsampleColorImages=true', '-dDownsampleGrayImages=true',
            '-dDownsampleMonoImages=true',
            f"-dColorImageResolution={config['dpi']}",
            f"-dGrayImageResolution={config['dpi']}",
            f"-dMonoImageResolution={config['dpi']}",
            '-dColorImageDownsampleType=/Bicubic', '-dGrayImageDownsampleType=/Bicubic',
            '-dMonoImageDownsampleType=/Subsample', '-dEmbedAllFonts=true',
            '-dSubsetFonts=true', '-dAutoRotatePages=/None',
            f'-sOutputFile={candidate}', '-f', str(source),
        ]
        result = subprocess.run(command, capture_output=True, text=True, timeout=600)
        if result.returncode:
            raise RuntimeError(f'Ghostscript 失败: {result.stderr.strip()}')
        if get_pdf_info(candidate)['pages'] != info['pages']:
            raise RuntimeError('压缩后的页数发生变化，已放弃输出')
        if candidate.stat().st_size >= source.stat().st_size:
            shutil.copyfile(source, candidate)
        # Same filesystem: link is atomic and fails if another writer created target.
        os.link(candidate, target)
    return target


def cmd_compress(args):
    source = Path(args.input)
    target = Path(args.output) if args.output else source.with_name(f'{source.stem}_compressed.pdf')
    before = source.stat().st_size
    result = compress_pdf(source, target, args.level)
    after = result.stat().st_size
    print(f'输出: {result}\n大小: {format_size(before)} → {format_size(after)}\n压缩率: {(1-after/before)*100:.1f}%')
    if after == before:
        print('文件未变小，输出保留原始 PDF 的完整副本；原文件未修改。')


def cmd_batch(args):
    directory = Path(args.input_dir)
    if not directory.is_dir():
        raise NotADirectoryError(str(directory))
    files = sorted(p for p in directory.iterdir() if p.is_file() and p.suffix.lower() == '.pdf' and not p.stem.endswith('_compressed'))
    if not files:
        print('目录中没有找到 PDF 文件')
        return
    failures = 0
    for source in files:
        target = source.with_name(f'{source.stem}_compressed.pdf')
        try:
            compress_pdf(source, target, args.level)
            print(f'成功: {source.name} → {target.name}（{format_size(target.stat().st_size)}）')
        except Exception as exc:
            failures += 1
            print(f'失败: {source.name}: {exc}', file=sys.stderr)
    print(f'完成: {len(files)-failures}/{len(files)}')
    if failures:
        raise RuntimeError(f'{failures} 个文件未完成')


def cmd_info(args):
    path = Path(args.input)
    info = get_pdf_info(path)
    print(f"文件: {path}\n大小: {format_size(path.stat().st_size)}\n页数: {info['pages']}")
    for key, value in info['metadata'].items():
        if value:
            print(f'{key}: {value}')


def main():
    parser = argparse.ArgumentParser(description='PDF 本地压缩工具（保留原件，拒绝覆盖已有输出）')
    sub = parser.add_subparsers(dest='command', required=True)
    for name, field in [('compress', 'input'), ('batch', 'input_dir'), ('info', 'input')]:
        command = sub.add_parser(name)
        command.add_argument(field)
        if name != 'info':
            command.add_argument('--level', choices=list(LEVELS), default='medium')
        if name == 'compress':
            command.add_argument('-o', '--output')
        command.set_defaults(func=globals()['cmd_' + name])
    args = parser.parse_args()
    try:
        args.func(args)
    except (Exception, KeyboardInterrupt) as exc:
        print(f'处理失败: {exc}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())

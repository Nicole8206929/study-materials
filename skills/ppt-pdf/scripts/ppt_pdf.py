#!/usr/bin/env python3
"""
PPT 转 PDF 统一工具
支持单文件转换、多文件合并、目录批量处理
"""

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

SUPPORTED_EXTENSIONS = {".ppt", ".pptx", ".odp", ".pps", ".ppsx"}
SKILL_ROOT = Path(__file__).parent.parent.parent
PDF_COMPRESS_SCRIPT = SKILL_ROOT / "pdf-compress" / "scripts" / "pdf_compress.py"


# ============ 基础工具 ============

def format_size(n):
    if n < 1024:
        return f"{n} B"
    elif n < 1024**2:
        return f"{n / 1024:.1f} KB"
    elif n < 1024**3:
        return f"{n / 1024**2:.1f} MB"
    return f"{n / 1024**3:.2f} GB"


def find_cjk_font():
    for p in [
        "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
        "/usr/share/fonts/truetype/arphic/uming.ttc",
    ]:
        if os.path.exists(p):
            return p
    return None


def register_cjk_font(name="CJK"):
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    p = find_cjk_font()
    if p:
        try:
            pdfmetrics.registerFont(TTFont(name, p, subfontIndex=0))
            return name
        except Exception:
            pass
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont
    pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
    return "STSong-Light"


# ============ PPT 转换 ============

def ensure_new_output(path):
    path = Path(path).absolute()
    if path.exists() or path.is_symlink():
        raise FileExistsError(f"拒绝覆盖已有文件: {path}")
    if path.suffix.lower() != ".pdf":
        raise ValueError("输出必须使用 .pdf 扩展名")
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def publish_pdf(source, target):
    """Validate and atomically publish without replacing an existing file."""
    get_pdf_info(source)
    target = ensure_new_output(target)
    with tempfile.TemporaryDirectory(prefix=".ppt-pdf-", dir=target.parent) as tmp:
        candidate = Path(tmp) / "output.pdf"
        shutil.copyfile(source, candidate)
        os.link(candidate, target)
    return target


def convert_ppt(ppt_path, pdf_path, timeout=300, retries=2):
    """Use a private LibreOffice profile per attempt; never kill other sessions."""
    ppt_path = Path(ppt_path).resolve(strict=True)
    pdf_path = ensure_new_output(pdf_path)
    if ppt_path.suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"不支持的演示文稿格式: {ppt_path.suffix}")
    if timeout <= 0 or retries < 0:
        raise ValueError("timeout 必须为正数，retries 不能为负数")
    if not shutil.which("soffice"):
        raise RuntimeError("未找到 LibreOffice（soffice）")
    err = None
    for attempt in range(retries + 1):
        with tempfile.TemporaryDirectory(prefix="ppt-convert-") as tmp:
            profile = (Path(tmp) / "lo-profile").as_uri()
            cmd = ["soffice", f"-env:UserInstallation={profile}", "--headless", "--norestore",
                   "--convert-to", "pdf", "--outdir", tmp, str(ppt_path)]
            try:
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
                out = Path(tmp) / f"{ppt_path.stem}.pdf"
                if result.returncode or not out.is_file():
                    err = result.stderr or result.stdout or "无 PDF 输出"
                    continue
                get_pdf_info(out)
            except (subprocess.TimeoutExpired, ValueError, RuntimeError) as exc:
                err = str(exc)
                continue
            return publish_pdf(out, pdf_path)
    raise RuntimeError(f"转换失败: {err}")


# ============ 封面和目录 ============

def create_cover(out_path, title, subtitle=None, author=None, date=None):
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.pdfgen import canvas
    from reportlab.lib.units import mm
    from reportlab.lib.colors import HexColor

    font = register_cjk_font()
    c = canvas.Canvas(str(out_path), pagesize=landscape(A4))
    w, h = landscape(A4)

    c.setStrokeColor(HexColor("#2563eb"))
    c.setLineWidth(3)
    c.line(30*mm, h - 25*mm, w - 30*mm, h - 25*mm)

    c.setFont(font, 36)
    c.setFillColor(HexColor("#1e293b"))
    c.drawCentredString(w/2, h/2 + 15*mm, title)

    if subtitle:
        c.setFont(font, 20)
        c.setFillColor(HexColor("#475569"))
        c.drawCentredString(w/2, h/2 - 10*mm, subtitle)

    c.setLineWidth(1)
    c.line(30*mm, 30*mm, w - 30*mm, 30*mm)
    c.setFont(font, 11)
    c.setFillColor(HexColor("#64748b"))
    if author:
        c.drawString(30*mm, 22*mm, f"作者: {author}")
    c.drawRightString(w - 30*mm, 22*mm, date or datetime.now().strftime("%Y年%m月"))
    c.save()


def create_toc(out_path, entries):
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.pdfgen import canvas
    from reportlab.lib.units import mm
    from reportlab.lib.colors import HexColor

    font = register_cjk_font()
    c = canvas.Canvas(str(out_path), pagesize=landscape(A4))
    w, h = landscape(A4)

    c.setFont(font, 26)
    c.setFillColor(HexColor("#1e293b"))
    c.drawString(25*mm, h - 25*mm, "目录")
    c.setStrokeColor(HexColor("#2563eb"))
    c.setLineWidth(2)
    c.line(25*mm, h - 30*mm, w - 25*mm, h - 30*mm)

    y = h - 45*mm
    for i, (name, page) in enumerate(entries, 1):
        if y < 25*mm:
            c.showPage()
            y = h - 25*mm
        c.setFont(font, 13)
        c.setFillColor(HexColor("#334155"))
        label = f"{i}. {name}"
        c.drawString(30*mm, y, label)
        tw = c.stringWidth(label, font, 13)
        c.setStrokeColor(HexColor("#cbd5e1"))
        c.setLineWidth(0.5)
        c.setDash(1, 2)
        c.line(30*mm + tw + 5*mm, y + 1*mm, w - 35*mm, y + 1*mm)
        c.setDash()
        c.setFillColor(HexColor("#2563eb"))
        c.drawRightString(w - 25*mm, y, str(page))
        y -= 11*mm
    c.save()


# ============ PDF 操作 ============

def get_pdf_info(p):
    import pymupdf
    with pymupdf.open(str(p)) as d:
        if not d.is_pdf or d.is_encrypted or d.page_count < 1:
            raise ValueError("需要未加密、至少含一页的有效 PDF")
        return {"pages": d.page_count, "size": Path(p).stat().st_size}


def merge_pdfs(items, out_path, metadata=None):
    """items: [(pdf_path, name), ...]"""
    import pymupdf
    doc = pymupdf.open()
    toc, offset = [], 0
    for p, name in items:
        with pymupdf.open(str(p)) as src:
            doc.insert_pdf(src)
            toc.append([1, name, offset + 1])
            offset += src.page_count
    doc.set_toc(toc)
    if metadata:
        doc.set_metadata(metadata)
    doc.save(str(out_path), garbage=4, deflate=True)
    doc.close()


def compress(pdf_path, level="medium"):
    if not PDF_COMPRESS_SCRIPT.exists():
        raise FileNotFoundError(str(PDF_COMPRESS_SCRIPT))
    pdf_path = Path(pdf_path).resolve(strict=True)
    orig = pdf_path.stat().st_size
    with tempfile.TemporaryDirectory(prefix=".ppt-compress-", dir=pdf_path.parent) as tmp:
        tmp_out = Path(tmp) / "compressed.pdf"
        r = subprocess.run([
            sys.executable, str(PDF_COMPRESS_SCRIPT), "compress",
            str(pdf_path), "--level", level, "-o", str(tmp_out),
        ], capture_output=True, text=True, timeout=660)
        if r.returncode:
            raise RuntimeError(r.stderr)
        if get_pdf_info(tmp_out)["pages"] != get_pdf_info(pdf_path)["pages"]:
            raise RuntimeError("压缩结果页数不一致，保留未压缩文件")
        os.replace(tmp_out, pdf_path)
    return orig, pdf_path.stat().st_size



# ============ 目录扫描 ============

def scan_dir(d, recursive=False, sort_by="name"):
    d = Path(d)
    if not d.is_dir():
        raise NotADirectoryError(str(d))
    candidates = d.rglob("*") if recursive else d.glob("*")
    files = sorted(f for f in candidates if f.is_file() and f.suffix.lower() in SUPPORTED_EXTENSIONS and not f.name.startswith("."))
    key = {
        "name": lambda f: f.name.lower(),
        "mtime": lambda f: f.stat().st_mtime,
        "size": lambda f: f.stat().st_size,
    }[sort_by]
    return sorted(files, key=key)


# ============ 命令实现 ============

def cmd_convert(args):
    """单个转换"""
    inp = Path(args.input)
    out = Path(args.output) if args.output else inp.with_suffix(".pdf")

    print(f"输入: {inp}")
    print(f"原始大小: {format_size(inp.stat().st_size)}")
    convert_ppt(inp, out, args.timeout)
    info = get_pdf_info(out)
    print(f"输出: {out}")
    print(f"页数: {info['pages']} | 大小: {format_size(info['size'])}")

    if args.compress:
        o, c = compress(out, args.compress)
        print(f"压缩: {format_size(o)} → {format_size(c)} ({(1-c/o)*100:.1f}%)")


def cmd_merge(args):
    """多文件合并"""
    files = [Path(f) for f in args.files]
    out = ensure_new_output(args.output)
    if any(f.resolve() == out.resolve() for f in files):
        raise ValueError("输出不能覆盖输入")

    print(f"合并 {len(files)} 个 PPT → {out}\n")

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        converted = []
        failed = []

        # 转换
        for i, f in enumerate(files, 1):
            pdf = tmp / f"p{i:04d}.pdf"
            print(f"[{i}/{len(files)}] {f.name}")
            try:
                convert_ppt(f, pdf, args.timeout)
                info = get_pdf_info(pdf)
                print(f"  ✓ {info['pages']}页 {format_size(info['size'])}")
                converted.append((pdf, f.stem))
            except Exception as e:
                print(f"  ✗ {e}")
                failed.append((f.name, str(e)))

        if not converted:
            sys.exit("全部失败")

        if failed and not args.allow_partial:
            raise RuntimeError(f"{len(failed)} 个输入转换失败，已停止合并；如接受缺失章节，可使用 --allow-partial")

        # Measure the actual TOC page count before calculating chapter offsets.
        toc_pages = 0
        if args.toc:
            probe = tmp / "toc-probe.pdf"
            create_toc(probe, [(name, 1) for _, name in converted])
            toc_pages = get_pdf_info(probe)["pages"]
        # 计算页码
        start = 1
        if args.cover:
            start += 1
        if args.toc:
            start += toc_pages
        toc_entries, cur = [], start
        for pdf, name in converted:
            toc_entries.append((name, cur))
            cur += get_pdf_info(pdf)["pages"]

        # 封面/目录
        items = []
        if args.cover:
            cover_pdf = tmp / "cover.pdf"
            create_cover(cover_pdf, args.cover, args.subtitle, args.author)
            items.append((cover_pdf, "封面"))
        if args.toc:
            toc_pdf = tmp / "toc.pdf"
            create_toc(toc_pdf, toc_entries)
            items.append((toc_pdf, "目录"))
        items.extend(converted)

        # 合并
        print("\n合并中...")
        meta = {
            "title": args.cover or out.stem,
            "author": args.author or "",
            "subject": args.subtitle or "",
        }
        merged = tmp / "merged.pdf"
        merge_pdfs(items, merged, meta)
        publish_pdf(merged, out)

    info = get_pdf_info(out)
    print(f"\n合并完成: {info['pages']}页 {format_size(info['size'])}")

    if args.compress:
        o, c = compress(out, args.compress)
        print(f"压缩: {format_size(o)} → {format_size(c)} ({(1-c/o)*100:.1f}%)")

    if failed:
        print(f"\n失败 {len(failed)} 个:")
        for n, e in failed:
            print(f"  {n}: {e}")


def cmd_batch(args):
    """目录批量处理"""
    files = scan_dir(args.input_dir, args.recursive, args.sort)
    if not files:
        sys.exit("未找到 PPT")

    print(f"目录: {args.input_dir}")
    print(f"找到 {len(files)} 个文件 | 模式: {args.mode}\n")

    if args.mode == "separate":
        # 每个单独转
        outputs = [f.with_suffix(".pdf").absolute() for f in files]
        if len(set(outputs)) != len(outputs):
            raise ValueError("多个输入会生成同名 PDF，请分别指定输出位置")
        for output in outputs:
            ensure_new_output(output)
        ok = 0
        for i, f in enumerate(files, 1):
            out = f.with_suffix(".pdf")
            print(f"[{i}/{len(files)}] {f.name}")
            try:
                convert_ppt(f, out, args.timeout)
                if args.compress:
                    compress(out, args.compress)
                ok += 1
                print("  ✓")
            except Exception as e:
                print(f"  ✗ {e}")
        print(f"\n完成 {ok}/{len(files)}")
        if ok != len(files):
            raise RuntimeError(f"{len(files)-ok} 个文件未完成")

    else:
        # 合并为一个
        args.files = [str(f) for f in files]
        cmd_merge(args)


# ============ CLI ============

def main():
    p = argparse.ArgumentParser(description="PPT 转 PDF 统一工具")
    sub = p.add_subparsers(dest="cmd", required=True)

    # convert
    c1 = sub.add_parser("convert", help="单个 PPT 转 PDF")
    c1.add_argument("input")
    c1.add_argument("-o", "--output")
    c1.add_argument("--compress", choices=["low", "medium", "high"])
    c1.add_argument("--timeout", type=int, default=300)
    c1.set_defaults(func=cmd_convert)

    # merge
    c2 = sub.add_parser("merge", help="多个 PPT 合并")
    c2.add_argument("files", nargs="+")
    c2.add_argument("-o", "--output", required=True)
    c2.add_argument("--cover")
    c2.add_argument("--subtitle")
    c2.add_argument("--author")
    c2.add_argument("--toc", action="store_true")
    c2.add_argument("--allow-partial", action="store_true", help="明确允许跳过失败的输入")
    c2.add_argument("--compress", choices=["low", "medium", "high"])
    c2.add_argument("--timeout", type=int, default=300)
    c2.set_defaults(func=cmd_merge)

    # batch
    c3 = sub.add_parser("batch", help="目录批量")
    c3.add_argument("input_dir")
    c3.add_argument("--mode", choices=["separate", "merge"], default="separate")
    c3.add_argument("--recursive", action="store_true")
    c3.add_argument("--sort", choices=["name", "mtime", "size"], default="name")
    c3.add_argument("-o", "--output")
    c3.add_argument("--cover")
    c3.add_argument("--subtitle")
    c3.add_argument("--author")
    c3.add_argument("--toc", action="store_true")
    c3.add_argument("--allow-partial", action="store_true")
    c3.add_argument("--compress", choices=["low", "medium", "high"])
    c3.add_argument("--timeout", type=int, default=300)
    c3.set_defaults(func=cmd_batch)

    args = p.parse_args()
    if args.cmd == "batch" and args.mode == "merge" and not args.output:
        p.error("batch --mode merge 必须提供 -o/--output")
    if args.cmd == "batch" and args.mode == "separate" and args.output:
        p.error("batch --mode separate 不接受 -o；每个 PDF 保存在源文件旁")
    if args.timeout <= 0:
        p.error("--timeout 必须为正数")
    try:
        args.func(args)
    except (Exception, KeyboardInterrupt) as exc:
        print(f"处理失败: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

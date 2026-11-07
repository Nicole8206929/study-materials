"""Regression tests for destructive edge cases and document workflows."""
import argparse
import importlib.util
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import pymupdf

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / 'skills' if (ROOT / 'skills').is_dir() else ROOT / '.agents/skills'


def load(name, relative):
    spec = importlib.util.spec_from_file_location(name, SKILLS / relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


pdf = load('pdf_compress', 'pdf-compress/scripts/pdf_compress.py')
ppt = load('ppt_pdf', 'ppt-pdf/scripts/ppt_pdf.py')


def make_pdf(path, text='Test document'):
    with pymupdf.open() as doc:
        page = doc.new_page()
        page.insert_text((72, 72), text)
        doc.save(path)
    return path


class DocumentToolsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = make_pdf(self.root / 'original.pdf')
        self.original = self.source.read_bytes()

    def tearDown(self):
        self.temp.cleanup()

    def test_compression_refuses_same_file_and_existing_outputs(self):
        for target in [self.source, make_pdf(self.root / 'existing.pdf')]:
            before = target.read_bytes()
            with self.assertRaises(FileExistsError):
                pdf.compress_pdf(self.source, target)
            self.assertEqual(target.read_bytes(), before)
        alias = self.root / 'alias.pdf'
        alias.symlink_to(self.source)
        with self.assertRaises(FileExistsError):
            pdf.compress_pdf(self.source, alias)
        self.assertEqual(self.source.read_bytes(), self.original)

    def test_invalid_pdf_does_not_publish_output(self):
        bad = self.root / 'bad.pdf'
        bad.write_text('not a PDF')
        with self.assertRaises(Exception):
            pdf.compress_pdf(bad, self.root / 'out.pdf')
        self.assertFalse((self.root / 'out.pdf').exists())

    @unittest.skipUnless(shutil.which('gs'), 'Ghostscript is not installed')
    def test_real_compression_keeps_valid_output_even_without_savings(self):
        out = pdf.compress_pdf(self.source, self.root / 'compressed.pdf')
        self.assertLessEqual(out.stat().st_size, self.source.stat().st_size)
        self.assertEqual(pdf.get_pdf_info(out)['pages'], 1)
        self.assertEqual(self.source.read_bytes(), self.original)
        before, after = ppt.compress(out)
        self.assertLessEqual(after, before)
        self.assertTrue(out.exists(), 'PPT integration must retain output when no smaller result exists')

    def test_failed_engine_does_not_leave_output_or_change_source(self):
        with patch.object(pdf.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, '', 'engine failed')):
            with self.assertRaises(RuntimeError):
                pdf.compress_pdf(self.source, self.root / 'failed.pdf')
        self.assertFalse((self.root / 'failed.pdf').exists())
        self.assertEqual(self.source.read_bytes(), self.original)

    def test_scanning_supports_mixed_case_extensions(self):
        (self.root / 'a.PpTx').touch()
        (self.root / 'b.PPT').touch()
        self.assertEqual(len(ppt.scan_dir(self.root)), 2)

    def test_merge_requires_explicit_output_at_cli(self):
        result = subprocess.run([sys.executable, str(SKILLS / 'ppt-pdf/scripts/ppt_pdf.py'), 'batch', str(self.root), '--mode', 'merge'], capture_output=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn(b'--output', result.stderr)

    def test_partial_merge_is_reported_and_does_not_publish(self):
        args = argparse.Namespace(files=['bad.pptx'], output=str(self.root / 'merge.pdf'), timeout=1, allow_partial=False, toc=False, cover=None, subtitle=None, author=None, compress=None)
        with patch.object(ppt, 'convert_ppt', side_effect=RuntimeError('bad input')):
            with self.assertRaises(SystemExit):
                ppt.cmd_merge(args)
        self.assertFalse(Path(args.output).exists())

    def test_multi_page_toc_offsets_match_chapter_bookmarks(self):
        files = [f'chapter-{i:02d}.pptx' for i in range(40)]
        args = argparse.Namespace(files=files, output=str(self.root / 'merged.pdf'), timeout=10, allow_partial=False, toc=True, cover='测试封面', subtitle=None, author=None, compress=None)
        def converted(source, target, timeout):
            return shutil.copyfile(self.source, target)
        with patch.object(ppt, 'convert_ppt', side_effect=converted):
            ppt.cmd_merge(args)
        with pymupdf.open(args.output) as doc:
            toc = doc.get_toc()
            first_chapter = next(row for row in toc if row[1] == 'chapter-00')
            toc_pages = first_chapter[2] - 2
            self.assertGreater(toc_pages, 1)
            self.assertEqual(doc.page_count, 41 + toc_pages)
            text = ''.join(doc[i].get_text() for i in range(1, 1 + toc_pages))
            self.assertIn('chapter-00', text)
            self.assertIn('chapter-39', text)
            # Read the printed first/last chapter page numbers, not only bookmarks.
            self.assertRegex(text, rf'chapter-00\s+{first_chapter[2]}\b')
            self.assertRegex(text, rf'chapter-39\s+{first_chapter[2]+39}\b')

    @unittest.skipUnless(shutil.which('soffice'), 'LibreOffice is not installed')
    def test_real_ppt_conversion_preserves_input_and_refuses_overwrite(self):
        from pptx import Presentation
        source = self.root / 'input.pptx'
        presentation = Presentation()
        slide = presentation.slides.add_slide(presentation.slide_layouts[0])
        slide.shapes.title.text = 'Real conversion test'
        presentation.save(source)
        before = source.read_bytes()
        out = ppt.convert_ppt(source, self.root / 'slides.pdf', timeout=60)
        self.assertEqual(ppt.get_pdf_info(out)['pages'], 1)
        self.assertEqual(source.read_bytes(), before)
        with self.assertRaises(FileExistsError):
            ppt.convert_ppt(source, out)


if __name__ == '__main__':
    unittest.main(verbosity=2)

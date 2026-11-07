#!/usr/bin/env python3
"""Validate catalog paths, hashes, sizes and parseable PDFs/EPUBs locally.

Use --remote URL for a lightweight HTTP/file-signature check of a deployed site.
HTTP success alone is not a full document integrity check.
"""
import argparse
import hashlib
import json
import sys
import zipfile
from pathlib import Path, PurePosixPath
from urllib.parse import quote, urljoin
from urllib.request import Request, urlopen


def validate(root, remote=None):
    books = json.loads((root / 'books.json').read_text(encoding='utf-8'))['books']
    if not isinstance(books, list) or not books:
        raise ValueError('books must be a nonempty array')
    ids, paths, errors = set(), set(), []
    for book in books:
        try:
            for key in ['id', 'title', 'author', 'cat', 'catName', 'desc', 'file']:
                if not isinstance(book.get(key), str) or not book[key].strip():
                    raise ValueError(f'missing or invalid {key}')
            if book['id'] in ids or book['file'] in paths:
                raise ValueError('duplicate id/file')
            ids.add(book['id']); paths.add(book['file'])
            path = PurePosixPath(book['file'])
            if path.is_absolute() or any(part in ('', '.', '..') for part in book['file'].split('/')) or '\\' in book['file'] or any(ord(char) < 32 for char in book['file']):
                raise ValueError('unsafe local path')
            fmt = path.suffix.lower()
            if fmt not in ('.pdf', '.epub') or book.get('format') != fmt[1:].upper():
                raise ValueError('invalid/mismatched format')
            if not isinstance(book.get('tags'), list) or not all(isinstance(tag, str) and tag for tag in book['tags']):
                raise ValueError('invalid tags')
            if not isinstance(book.get('bytes'), int) or book['bytes'] <= 0:
                raise ValueError('invalid byte size')
            if remote:
                url = urljoin(remote.rstrip('/') + '/', quote(book['file']))
                request = Request(url, headers={'Range': 'bytes=0-1023', 'User-Agent': 'StudyLibrary-LinkCheck/1.0'})
                with urlopen(request, timeout=30) as response:
                    magic = response.read(1024)
                    if response.status not in (200, 206):
                        raise ValueError(f'HTTP {response.status}')
                    content_range = response.headers.get('Content-Range', '')
                    if content_range and int(content_range.split('/')[-1]) != book['bytes']:
                        raise ValueError('deployed file size differs from catalog')
                if not magic.startswith(b'%PDF-' if fmt == '.pdf' else b'PK'):
                    raise ValueError('invalid file signature')
            else:
                local = root / book['file']
                if not local.resolve().is_relative_to(root.resolve()):
                    raise ValueError('file escapes root')
                if local.stat().st_size != book['bytes']:
                    raise ValueError('byte size mismatch')
                with local.open('rb') as source:
                    digest = hashlib.file_digest(source, 'sha256').hexdigest()
                if digest != book['sha256']:
                    raise ValueError('SHA-256 mismatch')
                if fmt == '.pdf':
                    import pymupdf
                    with pymupdf.open(local) as doc:
                        if not doc.is_pdf or doc.is_encrypted or doc.page_count < 1 or doc.page_count != book['pages']:
                            raise ValueError('invalid PDF or page count mismatch')
                        for index in {0, doc.page_count - 1}:
                            doc[index].get_pixmap(matrix=pymupdf.Matrix(.2, .2))
                else:
                    with zipfile.ZipFile(local) as archive:
                        if archive.read('mimetype') != b'application/epub+zip' or archive.testzip():
                            raise ValueError('invalid EPUB archive')
                    if book.get('pages') is not None:
                        raise ValueError('reflowable EPUB must not claim a fixed page count')
            print(f"OK {book['id']}")
        except Exception as exc:
            errors.append(f"{book.get('id', '?')}: {exc}")
    for error in errors:
        print(f'FAIL {error}', file=sys.stderr)
    print(f'{len(books)-len(errors)}/{len(books)} passed' + (' (HTTP and signature only)' if remote else ' (local integrity and document parsing)'))
    return 1 if errors else 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--remote', help='Deployed site base URL')
    args = parser.parse_args()
    sys.exit(validate(args.root, args.remote))

#!/usr/bin/env python3
"""Fail if a public shelf contains original books or points at their files."""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ALLOWED_KEYS = {'id','title','author','cat','catName','desc','pages','size','year','format','bytes','tags','searchTitles','preview'}
FORBIDDEN = {'.pdf','.epub','.mobi','.zip','.rar','.7z','.tar','.gz'}


def validate():
    data = json.loads((ROOT / 'books.json').read_text(encoding='utf-8'))
    assert data['access'] == 'public-preview-only'
    assert 1 <= data['previewLimit'] <= 20
    assert data['books']
    ids = set()
    images = set()
    for book in data['books']:
        assert not set(book)-ALLOWED_KEYS, f"Unexpected public fields: {book['id']}"
        assert book['id'] not in ids
        ids.add(book['id'])
        assert book['format'] in ('PDF','EPUB')
        preview = book['preview']
        assert 1 <= len(preview['images']) == preview['pageCount'] <= data['previewLimit']
        for image in preview['images']:
            assert re.fullmatch(r'previews/[A-Za-z0-9_-]+/page-\d{3}\.webp', image)
            assert image.startswith(f"previews/{book['id']}/")
            path = ROOT / image
            content = path.read_bytes()
            assert content[:4] == b'RIFF' and content[8:12] == b'WEBP'
            images.add(image)
    for path in ROOT.rglob('*'):
        relative = path.relative_to(ROOT)
        if set(relative.parts) & {'.git','node_modules','.venv','__pycache__'}:
            continue
        assert not path.is_symlink(), f'Symlink not permitted: {relative}'
        if path.is_file():
            assert path.suffix.lower() not in FORBIDDEN, f'Original/archive found: {relative}'
            assert path.name != '.env' and not path.name.startswith('.env.'), f'Environment file found: {relative}'
            if path.suffix.lower() == '.webp':
                assert relative.as_posix() in images, f'Unlisted preview: {relative}'
    print(f'PASS: {len(ids)} books; {len(images)} limited preview images; no originals or download URLs')


if __name__ == '__main__':
    try:
        validate()
    except Exception as exc:
        print(f'FAIL: {exc}', file=sys.stderr)
        sys.exit(1)

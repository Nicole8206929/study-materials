#!/usr/bin/env python3
"""Fail if a public shelf contains original books or points at their files."""
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit, unquote

ROOT = Path(__file__).resolve().parents[1]
ALLOWED_KEYS = {'id','title','author','cat','catName','desc','pages','size','year','format','bytes','tags','searchTitles','preview','subcat','ownerAccess','cats','subcats'}
FORBIDDEN = {'.pdf','.epub','.mobi','.zip','.rar','.7z','.tar','.gz'}


def check_owner_access(access):
    assert set(access)=={'provider','view','download'} and access['provider']=='github-private', 'Invalid owner access'
    for key in ['view','download']:
        url=urlsplit(access[key])
        assert url.scheme=='https' and url.netloc=='github.com' and not url.query and not url.fragment, 'Unprotected original link'
        assert re.match(r'^/Nicole8206929/study-materials-originals/(?:blob/|raw/|releases/(?:tag|download)/)',url.path), 'Owner link must stay in the private repository'
        assert not any(p=='..' or any(ord(c)<32 for c in p) for p in unquote(url.path).split('/')), 'Unsafe owner path'


def validate():
    data = json.loads((ROOT / 'books.json').read_text(encoding='utf-8'))
    assert data['access'] == 'public-preview-only'
    assert 1 <= data['previewLimit'] <= 20
    assert data['books']
    categories = data['categories']
    assert isinstance(categories, list) and categories
    category_names = {}
    for category in categories:
        assert re.fullmatch(r'[a-z][a-z0-9-]*', category['id']) and category['id'] != 'all'
        assert isinstance(category['name'], str) and category['name'].strip()
        assert category['id'] not in category_names, 'Duplicate category ID'
        category_names[category['id']] = category['name']
    assert len(set(category_names.values())) == len(category_names), 'Duplicate category name'
    if data.get('categoryGroups'):
        grouped = [id for group in data['categoryGroups'] for id in group['ids']]
        assert len(grouped) == len(set(grouped)) and set(grouped) == set(category_names), 'Invalid category groups'
    for legacy, target in data.get('categoryAliases', {}).items():
        assert legacy not in category_names and target['cat'] in category_names, 'Invalid category alias'
    ids = set()
    subcategories=data.get('subcategories',[])
    assert len({s['id'] for s in subcategories})==len(subcategories),'Duplicate subcategory'
    for sub in subcategories:
        assert sub['parent'] in category_names and re.fullmatch(r'[a-z][a-z0-9-]*',sub['id']) and sub['name'].strip(), 'Invalid subcategory'
    for legacy, target in data.get('subcategoryAliases', {}).items():
        assert legacy not in {s['id'] for s in subcategories} and target['subcat'] in {s['id'] for s in subcategories}, 'Invalid subcategory alias'
    for b in data['books']:
        assert len(b['tags'])==len(set(b['tags'])), 'Duplicate book tag'
    images = set()
    for book in data['books']:
        assert all(isinstance(book.get(key),str) and book[key].strip()
                   for key in ['id','title','author','cat','catName','desc']), 'Missing required book text; the browser would reject the catalogue'
        assert not set(book)-ALLOWED_KEYS, f"Unexpected public fields: {book['id']}"
        assert book['id'] not in ids
        ids.add(book['id'])
        assert category_names.get(book['cat']) == book['catName'], f"Category mismatch: {book['id']}"
        selected=book.get('cats',[book['cat']])
        assert isinstance(selected,list) and selected and selected[0]==book['cat'] and all(isinstance(c,str) and c in category_names for c in selected), 'Invalid category membership'
        assert len(set(selected))==len(selected), 'Duplicate category membership'
        assert book['format'] in ('PDF','EPUB')
        children=book.get('subcats',[book['subcat']] if book.get('subcat') else [])
        assert isinstance(children,list) and all(isinstance(child,str) and any(s['id']==child and s['parent'] in selected for s in subcategories) for child in children),'Subcategory mismatch'
        assert len(set(children))==len(children),'Duplicate subcategory membership'
        if book.get('subcat'):assert children and children[0]==book['subcat'],'Primary subcategory mismatch'
        if book.get('ownerAccess'):check_owner_access(book['ownerAccess'])
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
    print(f'PASS: {len(ids)} books; {len(images)} limited previews; no public originals; owner links restricted to private GitHub')


if __name__ == '__main__':
    try:
        validate()
    except Exception as exc:
        print(f'FAIL: {exc}', file=sys.stderr)
        sys.exit(1)

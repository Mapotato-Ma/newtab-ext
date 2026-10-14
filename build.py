#!/usr/bin/env python3
"""打上架用的包。

商店包只放「扩展本体」，我调试验东西（mock-chrome.js / preview.html / README）
一律不进包 —— 审核看到多余文件只会多问几句。

用法：python3 build.py
产出：dist/  和  ../attachments/newtab-ext-store-<version>.zip
"""
import json
import os
import shutil
import subprocess
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
DIST = HERE / 'dist'
STORE_FILES = ['manifest.json', 'newtab.html', 'newtab.css', 'newtab.js']
STORE_DIRS = ['icons']


def main():
    manifest = json.loads((HERE / 'manifest.json').read_text(encoding='utf-8'))
    version = manifest['version']

    # ── 上线前自检：语法 + 别把调试的东西写进 manifest ──
    subprocess.run(
        ['node', '-e', "new Function(require('fs').readFileSync('newtab.js','utf8'))"],
        cwd=HERE, check=True,
    )
    assert 'key' not in manifest, 'manifest 里不该有 key（商店自己会给 ID）'
    assert not str(manifest.get('update_url', '')), 'manifest 里不该有 update_url'
    missing = [f for f in STORE_FILES if not (HERE / f).exists()]
    assert not missing, f'缺文件：{missing}'

    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir(parents=True)

    for name in STORE_FILES:
        shutil.copy2(HERE / name, DIST / name)
    for name in STORE_DIRS:
        shutil.copytree(HERE / name, DIST / name)

    # 包里的 manifest 要跟源头一致（version 别漏改）
    assert json.loads((DIST / 'manifest.json').read_text(encoding='utf-8')) == manifest

    out = HERE.parent.parent / 'attachments' / f'newtab-ext-store-{version}.zip'
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for path in sorted(DIST.rglob('*')):
            if path.is_file():
                z.write(path, path.relative_to(DIST))

    # ── 回读校验：确认包里没有调试文件、也没有多余顶层目录 ──
    with zipfile.ZipFile(out) as z:
        names = sorted(z.namelist())
    bad = [n for n in names if n.startswith(('mock-', 'preview', 'README', 'build.py'))
           or n.endswith(('.md', '.py'))]
    assert not bad, f'包里混进了调试文件：{bad}'
    assert 'manifest.json' in names, '包根目录下没有 manifest.json —— 商店会拒收'

    print(f'打包完成  v{version}')
    print(f'  文件：{out}  ({out.stat().st_size} bytes)')
    for n in names:
        print(f'    {n}')

    # ── 另一个产物：本地开发加载用的包 ──
    # 目录结构是「一个文件夹 + 里面是 manifest.json」：解压出来直接就是一个能选的文件夹。
    # （商店那个包的根目录必须是 manifest.json，解压会散一地，不能拿来点「加载已解压的扩展程序」）
    local = HERE.parent.parent / 'attachments' / f'newtab-ext-local-{version}.zip'
    root = f'newtab-ext-{version}'
    with zipfile.ZipFile(local, 'w', zipfile.ZIP_DEFLATED) as z:
        for path in sorted(DIST.rglob('*')):
            if path.is_file():
                z.write(path, f'{root}/{path.relative_to(DIST)}')

    with zipfile.ZipFile(local) as z:
        lnames = sorted(z.namelist())
    assert f'{root}/manifest.json' in lnames, '本地包里没找到 manifest.json'
    assert all(n.startswith(root + '/') for n in lnames), '本地包里混进了根目录外的文件'

    print(f'  本地加载包：{local}  ({local.stat().st_size} bytes)')
    print(f'    解压出一个 {root}/ 文件夹，chrome://extensions 里直接选它')


if __name__ == '__main__':
    main()

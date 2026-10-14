#!/usr/bin/env python3
"""从 newtab.html 生成两个预览页（都只是它的副本 + 替换脚本）。

- preview.html       本地调试用：mock-chrome.js 的假书签（含一条 7 层深链）
- preview-store.html 商店截图用：先 mock-chrome.js 再 store-demo.js（**故意不用真书签**，
                     商店页面公开可访问，真书签里有公司内网系统）

都会把 css/js 的 ?v= 换成当前时间戳 —— 不换的话 WebView 一直吃缓存，改了看不见。
改完 newtab.html 就跑一次：python3 sync-preview.py
"""
import os
import re
import time

HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, "newtab.html"), encoding="utf-8").read()
v = int(time.time())

assert '<script src="newtab.js"></script>' in src, "newtab.html 里的 newtab.js 引用变了，改这里"

base = re.sub(r'(href="newtab\.css)(\?v=\d+)?(")', rf'\1?v={v}\3', src)

for name, scripts in (
    ("preview.html", [f'mock-chrome.js?v={v}']),
    ("preview-store.html", [f'mock-chrome.js?v={v}', f'store-demo.js?v={v}']),
):
    tags = "\n  ".join(f'<script src="{s}"></script>' for s in scripts)
    out = base.replace(
        '<script src="newtab.js"></script>',
        f'{tags}\n  <script src="newtab.js?v={v}"></script>',
    )
    open(os.path.join(HERE, name), "w", encoding="utf-8").write(out)
    print(f"{name} 已同步（v={v}）")

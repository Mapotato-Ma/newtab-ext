/* 索引卡 · 新标签页
   数据源只有一个：chrome.bookmarks。不建后端、不存账号，
   所以「新标签页显示的分组」永远等于「你书签里的文件夹」。 */

'use strict';

const DEFAULTS = { theme: 'auto', size: 'regular', showLoosies: true, clock: 'seconds', scale: 1.15, openIn: 'newtab', engine: 'bing', countMode: 'deep', cols: 3, fs: 13, fw: 400, flyout: true };

const el = {
  board: document.getElementById('board'),
  clock: document.getElementById('clock'),
  greeting: document.getElementById('greeting'),
  stats: document.getElementById('stats'),
  rail: document.getElementById('rail-list'),
  railFilter: document.getElementById('rail-filter'),
  railTotal: document.getElementById('rail-total'),
  crumbs: document.getElementById('crumbs'),
  searchInput: document.getElementById('search-input'),
  searchForm: document.getElementById('search-form'),
  suggest: document.getElementById('suggest'),
  panel: document.getElementById('settings'),
  theme: document.getElementById('opt-theme'),
  clockMode: document.getElementById('opt-clock'),
  size: document.getElementById('opt-size'),
  scale: document.getElementById('opt-scale'),
  openIn: document.getElementById('opt-open'),
  countMode: document.getElementById('opt-count'),
  cols: document.getElementById('opt-cols'),
  fs: document.getElementById('opt-fs'),
  fw: document.getElementById('opt-fw'),
  engineBtn: document.getElementById('btn-engine'),
  flyout: document.getElementById('opt-fly'),
  loosies: document.getElementById('opt-loosies'),
};

/* 一条路径最多钻这么深（Chrome 本身不限层级，这里只是防数据异常炸栈） */
const MAX_DEPTH = 8;

let groupsCache = [];
let flatItems = [];        // 摊平后的全部书签，用于搜索框的本地匹配
let activeGroup = null;
let activePath = [];       // 当前钻到的文件夹 id 链（空数组 = 停在顶层）
let railQuery = '';        // 左栏筛选框的内容（筛选 ≠ 排序）
let foldedIds = new Set(); // 主区里「原地折叠」掉的子文件夹 id

let settings = { ...DEFAULTS };

/* ── 兼容层：没有 chrome.bookmarks 时（本地预览）用注入的替身 ── */

const api = globalThis.chrome || {};
const hasBookmarks = !!(api.bookmarks && api.bookmarks.getTree);

/* ── 设置 ───────────────────────────────────────────── */

function loadSettings() {
  return new Promise((resolve) => {
    if (!api.storage || !api.storage.sync) return resolve({ ...DEFAULTS });
    api.storage.sync.get(DEFAULTS, (v) => resolve({ ...DEFAULTS, ...(v || {}) }));
  });
}

function saveSettings(patch) {
  settings = { ...settings, ...patch };
  applySettings();
  if (api.storage && api.storage.sync) api.storage.sync.set(patch);
}

/** 设置面板：紧贴齿轮的左下角（右边缘跟齿轮右边缘对齐、顶边贴它下面 8px），并限定最大高度。
    ⚠️ 页面整体有 --scale 缩放，setProperty 的坐标和屏幕坐标不是 1:1 ——
    先按 1:1 摆一次，再量实际位置按偏差修正一次（偏差 ÷ 实测缩放比，一遍到位）。 */
function placePanel() {
  const gear = document.getElementById('btn-settings').getBoundingClientRect();
  const targetRight = gear.right;
  const targetTop = gear.bottom + 8;

  // 小屏幕 / 设置项变多时，往下长到头就内部滚动，绝不让面板顶出屏幕
  const maxH = Math.max(220, Math.min(window.innerHeight - targetTop - 16, 620));
  el.panel.style.top = targetTop + 'px';
  el.panel.style.right = Math.max(12, window.innerWidth - targetRight) + 'px';
  el.panel.style.maxHeight = maxH + 'px';

  const r = el.panel.getBoundingClientRect();
  const scale = (r.width / (el.panel.offsetWidth || 1)) || 1;
  // right/top 的量法方向相反：right 变大元素往左，top 变大元素往下，所以修正的符号也不同
  const dRight = (r.right - targetRight) / scale;
  const dTop = -(r.top - targetTop) / scale;
  if (Math.abs(dRight) > 0.5 || Math.abs(dTop) > 0.5) {
    el.panel.style.right = (parseFloat(el.panel.style.right) + dRight) + 'px';
    el.panel.style.top = (parseFloat(el.panel.style.top) + dTop) + 'px';
  }

  // 面板可能比可用高度还高：让顶边贴住齿轮、把多出来的高度交给内部滚动
  const r2 = el.panel.getBoundingClientRect();
  if (r2.bottom > window.innerHeight - 8) {
    el.panel.style.maxHeight = Math.max(220, maxH - (r2.bottom - (window.innerHeight - 8)) / scale) + 'px';
  }
}

/** 打开设置面板：先显形再摆位（隐藏时量不到尺寸） */
function openPanel() {
  el.panel.hidden = false;
  placePanel();
}

function applySettings() {
  const theme = settings.theme === 'auto'
    ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : settings.theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.size = settings.size;
  document.documentElement.style.setProperty('--scale', String(settings.scale));
  el.theme.value = settings.theme;
  el.clockMode.value = settings.clock;
  el.size.value = settings.size;
  el.scale.value = String(settings.scale);
  el.openIn.value = settings.openIn;
  el.countMode.value = settings.countMode;
  el.cols.value = String(settings.cols);
  el.fs.value = String(settings.fs);
  el.fw.value = String(settings.fw);
  // 字号 / 字重：一套基准值派生出各处（域名、计数比正文小 1.5–2px，文件夹名比正文粗一档）
  const fs = Number(settings.fs) || 13;
  const fw = Number(settings.fw) || 400;
  const root = document.documentElement.style;
  root.setProperty('--fs', fs + 'px');
  root.setProperty('--fs-md', (fs - 0.5) + 'px');
  root.setProperty('--fs-sm', (fs - 1.5) + 'px');
  root.setProperty('--fs-xs', (fs - 2) + 'px');
  // 图标也要跟着字号走：24px 的字配一个 30px 的小图标会很别扭
  root.setProperty('--fs-ratio', String(fs / 13));
  root.setProperty('--fw', String(fw));
  root.setProperty('--fw-strong', String(Math.max(fw, 500)));
  // 每行列数：固定列数而不是 auto-fill —— auto-fill 在宽屏上只排两列，右边留一大片死白
  document.documentElement.style.setProperty('--cols', String(settings.cols));
  applyEngine();
  el.flyout.checked = settings.flyout;
  if (!settings.flyout) closeFly();   // 关掉开关时，正在显示的面板立刻收起
  el.loosies.checked = settings.showLoosies;
}

/* ── 书签 → 分组模型（递归，任意层级都收得住）──────────── */

function isFolder(node) { return !node.url; }

/** 从一个文件夹节点里分出「直接子书签」和「子文件夹」 */
function split(folder) {
  const items = [];
  const subs = [];
  for (const child of folder.children || []) {
    if (isFolder(child)) subs.push(child);
    else items.push(child);
  }
  return { items, subs };
}

/** 文件夹 → 递归节点 {id, name, path, items, subs, total}
    · total 含所有更深层级 —— 左栏计数和子标题条计数统一用这个语义
    · 第 2 层及以后「空的文件夹」不挂进来（深层空文件夹只是噪声；顶层空文件夹照留，
      因为那是用户手动排的位置记忆） */
function buildNode(folder, path, depth) {
  const { items, subs: rawSubs } = split(folder);
  const pathArr = path.concat([folder.title || '未命名']);
  const subs = [];
  if (depth + 1 < MAX_DEPTH) {
    for (const raw of rawSubs) {
      const node = buildNode(raw, pathArr, depth + 1);
      if (node.total) subs.push(node);
    }
  }
  return {
    id: folder.id,
    name: folder.title || '未命名',
    path: pathArr,
    items,
    subs,
    total: items.length + subs.reduce((s, n) => s + n.total, 0),
  };
}

/** 书签栏里的一级文件夹 = 一个分组；散在外面的书签 = 「未分组」 */
function buildGroups(root) {
  const bar = (root.children || []).find((c) => c.id === '1')
    || (root.children || [])[0] || { children: [] };

  const groups = [];
  const loosies = [];

  for (const child of bar.children || []) {
    if (isFolder(child)) {
      const node = buildNode(child, [], 0);
      groups.push({ name: node.name, id: node.id, node, total: node.total });
    } else {
      loosies.push(child);
    }
  }

  if (loosies.length && settings.showLoosies) {
    const node = {
      id: '__loose__', name: '未分组', path: ['未分组'],
      items: loosies, subs: [], total: loosies.length, loose: true,
    };
    groups.push({ name: '未分组', id: node.id, node, total: node.total, loose: true });
  }

  return groups;
}

/* ── 图标 ───────────────────────────────────────────── */


function faviconFor(url) {
  if (!api.runtime || !api.runtime.getURL) return '';
  try {
    return api.runtime.getURL(`_favicon/?pageUrl=${encodeURIComponent(url)}&size=64`);
  } catch (e) {
    return '';
  }
}

/** 兜底第二路：站点自己的 /favicon.ico（Chrome 的图标缓存里没有时试一把） */
function siteFavicon(url) {
  try {
    return new URL('/favicon.ico', url).href;
  } catch (e) {
    return '';
  }
}

/* ⚠️ Chrome 的 _favicon 服务在「找不到图标」时**不会报错**，
   而是返回一张默认的灰色地球图 —— 所以不能靠 onerror 判断有没有图标，得把地球认出来。
   做法：拿一个必然没有图标的地址（.invalid 顶级域，永远不存在）当参照物，
   缩到 16×16 算个指纹；之后每个图标的指纹跟它一样，就当「没有图标」。 */
function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.referrerPolicy = 'no-referrer';
    img.src = src;
  });
}

function analyze(img) {
  try {
    const N = 16;
    const c = document.createElement('canvas');
    c.width = N;
    c.height = N;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, N, N);
    const d = g.getImageData(0, 0, N, N).data;
    let h = 2166136261;
    let uniform = true;
    const [r0, g0, b0, a0] = [d[0], d[1], d[2], d[3]];
    for (let i = 0; i < d.length; i += 4) {
      h ^= d[i]; h = Math.imul(h, 16777619) >>> 0;
      h ^= d[i + 1]; h = Math.imul(h, 16777619) >>> 0;
      h ^= d[i + 2]; h = Math.imul(h, 16777619) >>> 0;
      if (uniform && (d[i] !== r0 || d[i + 1] !== g0 || d[i + 2] !== b0 || d[i + 3] !== a0)) {
        uniform = false;
      }
    }
    return { hash: h, uniform };
  } catch (e) {
    return null;   // canvas 被污染等异常 → 认不出来，不影响出图
  }
}

let placeholderPrint = null;
let iconObserver = null;

async function learnPlaceholder() {
  const img = await loadImage(faviconFor(`https://minis-no-favicon-${Date.now()}.invalid/`));
  if (img) {
    const a = analyze(img);
    if (a) placeholderPrint = a.hash;
  }
}

/** Chrome 缓存 → 认出来是地球/纯色块 → 试站点自己的 favicon.ico → 都不行就留着字母 */
async function resolveIcon(item) {
  const img = await loadImage(faviconFor(item.url));
  if (!img) return null;
  const a = analyze(img);
  // 认不出来（跨域污染）就当是真的，宁可显示也别误判
  if (a && (a.uniform || (placeholderPrint !== null && a.hash === placeholderPrint))) {
    const alt = await loadImage(siteFavicon(item.url));
    // 第二路是跨域图，读不了像素，只能挡掉 1×1 那种空白图
    if (alt && alt.naturalWidth >= 8 && alt.naturalHeight >= 8) return alt;
    return null;
  }
  return img;
}

/** 文字兜底：取标题的第一个字（中文最自然），标题空了才退到域名 */
function fallbackFor(url, title) {
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { host = ''; }

  // 跳过 【】[]()《》「」 这类开头的括号和标点，取第一个有意义的字
  const cleaned = (title || '').replace(/^[\s\-–—·|【】\[\]（）()《》「」<>"'“”]+/, '');
  const first = (cleaned || host || '?').trim().charAt(0);
  const label = /[a-z]/i.test(first) ? first.toUpperCase() : first;

  let hash = 0;
  const seed = host || title || '?';
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) % 360;

  return { label, hue: hash };
}

/** 一张索引卡：左边图标，右边完整标题 + 站点域名（比纯磁贴多两样信息） */
function makeCard(item) {
  const a = document.createElement('a');
  a.className = 'card';
  a.href = item.url;
  a.title = `${item.title || item.url}\n${item.url}`;
  if (settings.openIn === 'newtab') {
    a.target = '_blank';
    a.rel = 'noopener';
  }

  const box = document.createElement('span');
  box.className = 'card__icon';

  const glyph = document.createElement('span');
  glyph.className = 'card__initial';
  const fb = fallbackFor(item.url, item.title);
  glyph.textContent = fb.label;
  glyph.style.setProperty('--h', fb.hue);
  box.appendChild(glyph);

  // 滚到跟前才去解析图标 —— 542 张卡不该在新标签页一打开就发一堆请求
  a._item = item;
  if (iconObserver) iconObserver.observe(a);

  const text = document.createElement('span');
  text.className = 'card__text';
  const name = document.createElement('span');
  name.className = 'card__title';
  name.textContent = item.title || item.url;
  const host = document.createElement('span');
  host.className = 'card__host';
  host.textContent = hostOf(item.url);
  text.append(name, host);

  a.append(box, text);
  return a;
}

/** 域名（去 www.）—— 卡片的第二行信息 */
function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
}

/* ── 渲染 ───────────────────────────────────────────── */

function gridFor(items, compact) {
  const g = document.createElement('div');
  g.className = compact ? 'grid grid--sub' : 'grid';
  for (const item of items) g.appendChild(makeCard(item));
  return g;
}

/* ── 左栏（永远只有第 1 层）────────────────────────── */

const ICON_FOLDER = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">'
  + '<path d="M3 7.5A2 2 0 0 1 5 5.5h3.6a2 2 0 0 1 1.5.7l1 1.2H19a2 2 0 0 1 2 2v7.1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const ICON_CHEVRON = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">'
  + '<path d="m9 6 6 6-6 6"/></svg>';

/** 计数口径：默认含所有更深层级；设置里可切成「只算本级」。
    ⚠️ 「空文件夹置灰」永远看 total（真的什么都没有），不看这个开关 —— 否则一个只装了子文件夹的组
    会被显示成 0 项还灰掉。 */
function countOf(node) {
  return settings.countMode === 'self' ? node.items.length : node.total;
}

/** 沿 id 链展开成 [{node, ids}]（第 0 项是分组本身） */
function pathChain(group, pathIds) {
  const out = [];
  if (!group || !group.node) return out;
  out.push({ node: group.node, ids: [] });
  let node = group.node;
  let ids = [];
  for (const id of pathIds || []) {
    const next = node.subs.find((s) => s.id === id);
    if (!next) break;
    ids = ids.concat([id]);
    out.push({ node: next, ids: ids.slice() });
    node = next;
  }
  return out;
}

function renderRail() {
  el.rail.replaceChildren();
  const q = railQuery.trim().toLowerCase();
  const frag = document.createDocumentFragment();
  let shown = 0;

  for (const g of groupsCache) {
    // 筛选 ≠ 排序：只藏掉不合的，顺序一律不动
    if (q && !g.name.toLowerCase().includes(q)) continue;
    shown++;

    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ritem' + (g.total ? '' : ' ritem--zero');   // 置灰看 total：真的空
    b.dataset.group = g.name;
    b.setAttribute('role', 'tab');
    const isActive = g.name === activeGroup;
    b.setAttribute('aria-selected', String(isActive));
    if (isActive && activePath.length) b.dataset.drilled = 'true';
    b.title = g.total ? `${g.name} · ${countOf(g.node)} 项` : `${g.name}（空文件夹）`;

    const nm = document.createElement('span');
    nm.className = 'ritem__name';
    nm.textContent = g.name;
    const n = document.createElement('span');
    n.className = 'ritem__n';
    n.textContent = countOf(g.node);
    b.append(nm, n);

    // 悬停 / 聚焦时飘出内容：**所有非空分组一视同仁**（没有「大的才有小的没有」这种两套逻辑）
    if (g.total > 0) attachRailPreview(b, g);
    b.addEventListener('click', () => selectGroup(g.name));
    frag.appendChild(b);
  }

  el.rail.appendChild(frag);
  el.railTotal.textContent = q ? `${shown}/${groupsCache.length}` : String(groupsCache.length);
  if (groupsCache.length > 40) el.railFilter.hidden = false;
}

/** 从节点里凑够 n 条书签（自己没直属书签就往子层里找）—— 免得「只有子文件夹」的组预览是空的 */
function firstItems(node, n) {
  const out = [];
  const walk = (nd) => {
    for (const it of nd.items) {
      if (out.length >= n) return;
      out.push(it);
    }
    for (const sub of nd.subs) {
      if (out.length >= n) return;
      walk(sub);
    }
  };
  walk(node);
  return out;
}

/** 左栏预览浮层：hover + focus 双通道，所有非空分组都一样
    ⚠️ 浮层挂在 body 上、用 fixed 定位 —— 挂在左栏里会被滚动容器的 overflow 裁掉 */
let flyBox = null;      // 悬浮面板是单例：同一时刻只可能有一块
let flyTimer = 0;

function closeFly() {
  if (flyTimer) { clearTimeout(flyTimer); flyTimer = 0; }
  if (flyBox) { flyBox.remove(); flyBox = null; }
}

/** 面板内容：永远对应当前选中的那一组（切组时是「换内容」，不是再叠一层） */
function showFly(group) {
  if (!group || !group.total) { closeFly(); return; }
  buildFly(group);
}

function buildFly(g) {
  if (flyBox) flyBox.remove();
  const box = document.createElement('div');
  box.className = 'fly';

  const head = document.createElement('div');
  head.className = 'fly__head';
  const hn = document.createElement('span');
  hn.className = 'fly__head-name';
  hn.textContent = g.name;
  const hc = document.createElement('span');
  hc.className = 'fly__head-n';
  hc.textContent = `${countOf(g.node)} 项`;
  head.append(hn, hc);
  box.appendChild(head);

  // 有子文件夹就先把名字亮出来 —— 一眼知道「这个组里还有什么」
  if (g.node.subs.length) {
    const names = g.node.subs.slice(0, 4).map((x) => x.name);
    const rest = g.node.subs.length - names.length;
    const line = document.createElement('div');
    line.className = 'fly__subs';
    line.textContent = '子文件夹：' + names.join(' · ') + (rest > 0 ? ` 等 ${g.node.subs.length} 个` : '');
    box.appendChild(line);
  }

  const list = document.createElement('div');
  list.className = 'fly__list';
  box.appendChild(list);

  // 面板固定居中、内部可滚 —— 一次多给点条目，别动不动就「还有 n 项」
  const shown = firstItems(g.node, 24);
  for (const it of shown) {
    const row = document.createElement('div');
    row.className = 'fly__row';

    const ic = document.createElement('span');
    ic.className = 'fly__ic';
    const fb = fallbackFor(it.url, it.title);
    ic.textContent = fb.label;
    ic.style.setProperty('--h', fb.hue);
    // 图标解析走和卡片同一条路径（含「Chrome 找不到图标返回灰地球」的识别）
    resolveIcon(it).then((img) => {
      if (img && ic.isConnected) {
        img.alt = '';
        ic.textContent = '';
        ic.appendChild(img);
      }
    });

    const t = document.createElement('span');
    t.className = 'fly__t';
    t.textContent = it.title || it.url;
    const h = document.createElement('span');
    h.className = 'fly__h';
    h.textContent = hostOf(it.url);
    row.append(ic, t, h);
    list.appendChild(row);
  }
  if (!shown.length) {
    const none = document.createElement('div');
    none.className = 'fly__more';
    none.textContent = '这一层还没有书签';
    list.appendChild(none);
  } else if (countOf(g.node) > shown.length) {
    const more = document.createElement('div');
    more.className = 'fly__more';
    more.textContent = `还有 ${countOf(g.node) - shown.length} 项…`;
    list.appendChild(more);
  }

  document.body.appendChild(box);   // 位置由 CSS 固定在屏幕中间，不跟着条目跑
  flyBox = box;
}

/** 左栏预览：hover + focus 双通道（只有鼠标能用的东西不算做完） */
function attachRailPreview(btn, g) {
  const open = () => {
    if (!settings.flyout) return;      // 设置里关掉了就完全不触发
    if (flyTimer) return;
    // 一点点延迟：鼠标只是路过时不该弹出来
    flyTimer = setTimeout(() => { flyTimer = 0; showFly(g); }, 140);
  };

  btn.addEventListener('mouseenter', open);
  btn.addEventListener('mouseleave', closeFly);
  btn.addEventListener('focus', open);
  btn.addEventListener('blur', closeFly);
  btn.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFly(); });
}

/* ── 面包屑（「我在哪」的唯一答案）──────────────────── */

function renderCrumbs(chain) {
  el.crumbs.replaceChildren();
  const group = groupsCache.find((g) => g.name === activeGroup);
  if (!group) return;

  const trail = [{ label: '全部文件夹', ids: [] }];
  for (const step of chain) trail.push({ label: step.node.name, ids: step.ids });

  // 深度 ≥4 时中间折成 …（保第一段 + 末两段）
  let parts = trail;
  let folded = null;
  if (trail.length >= 5) {
    parts = [trail[0], ...trail.slice(-2)];
    folded = trail.slice(1, -2);
  }

  const frag = document.createDocumentFragment();
  parts.forEach((p, i) => {
    if (i > 0 || (i === 1 && folded)) frag.appendChild(sep('›'));
    if (i === 1 && folded) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'crumb crumb--fold';
      more.textContent = '…';
      more.title = `已折叠 ${folded.length} 层：` + folded.map((f) => f.label).join(' / ');
      more.addEventListener('click', () => selectPath(folded[folded.length - 1].ids));
      frag.appendChild(more);
      frag.appendChild(sep('›'));
    }
    const last = i === parts.length - 1;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'crumb' + (last ? ' crumb--cur' : '');
    b.textContent = p.label;
    b.title = p.label;
    if (last) b.setAttribute('aria-current', 'page');
    else b.addEventListener('click', () => selectPath(p.ids));
    frag.appendChild(b);
  });

  const node = chain.length ? chain[chain.length - 1].node : group.node;
  const count = document.createElement('span');
  count.className = 'crumbs__count';
  count.textContent = `${countOf(node)} 项`;
  frag.appendChild(count);

  el.crumbs.appendChild(frag);
  el.rail.scrollTop = el.rail.scrollTop;   // 保持左栏滚动位置
}

function sep(ch) {
  const s = document.createElement('span');
  s.className = 'crumbs__sep';
  s.setAttribute('aria-hidden', 'true');
  s.textContent = ch;
  return s;
}

/* ── 主区 ───────────────────────────────────────────── */

/** 子文件夹入口行：一行里两个动作，各占各的按钮（别把两个语义塞进一个点击区）
    · 左边 ▸ 原地折叠/展开它自己的内容
    · 其余部分（图标 + 名字 + 计数 + ›）钻进去 */
function folderRow(node, indent, ids) {
  const row = document.createElement('div');
  row.className = 'frow' + (indent ? ' frow--deep' : '');
  row.title = node.path.join(' / ');

  const foldable = node.items.length > 0 || node.subs.length > 0;
  const expanded = foldable && !foldedIds.has(node.id);

  if (foldable) {
    const fold = document.createElement('button');
    fold.type = 'button';
    fold.className = 'frow__fold';
    fold.setAttribute('aria-expanded', String(expanded));
    fold.title = expanded ? '折叠这一层' : '展开这一层';
    fold.innerHTML = ICON_CHEVRON;
    fold.addEventListener('click', () => toggleFold(node.id));
    row.appendChild(fold);
  } else {
    const pad = document.createElement('span');
    pad.className = 'frow__fold frow__fold--none';
    pad.setAttribute('aria-hidden', 'true');
    row.appendChild(pad);
  }

  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'frow__open';

  const ic = document.createElement('span');
  ic.className = 'frow__ic';
  ic.innerHTML = ICON_FOLDER;

  const nm = document.createElement('span');
  nm.className = 'frow__name';
  nm.textContent = node.name;

  const n = document.createElement('span');
  n.className = 'frow__n';
  n.textContent = countOf(node);

  const arrow = document.createElement('span');
  arrow.className = 'frow__arrow';
  arrow.innerHTML = ICON_CHEVRON;

  open.append(ic, nm, n, arrow);
  open.addEventListener('click', () => selectPath(ids));
  row.appendChild(open);
  return row;
}

/** 原地折叠/展开（只影响显示，不动数据结构） */
function toggleFold(id) {
  if (foldedIds.has(id)) foldedIds.delete(id);
  else foldedIds.add(id);
  persistFolded();
  repaint(true);
}

function persistFolded() {
  try { localStorage.setItem('folded', JSON.stringify([...foldedIds])); } catch (e) { /* 忽略 */ }
}

function loadFolded() {
  try {
    const raw = localStorage.getItem('folded');
    const list = raw ? JSON.parse(raw) : [];
    foldedIds = new Set(Array.isArray(list) ? list : []);
  } catch (e) { foldedIds = new Set(); }
}

function emptyFolder(node) {
  const box = document.createElement('p');
  box.className = 'note';
  box.textContent = node.loose
    ? '书签栏上还没有散着的书签。'
    : `「${node.name}」是空的。`;
  return box;
}

function renderMain(chain) {
  const group = groupsCache.find((g) => g.name === activeGroup) || groupsCache[0];
  if (!group) return;
  const node = chain.length ? chain[chain.length - 1].node : group.node;
  const curIds = chain.length ? chain[chain.length - 1].ids : [];

  el.board.replaceChildren();
  if (node.items.length) el.board.appendChild(gridFor(node.items));

  // 直接子文件夹：条目 + 它自己的内容；它还有下一层时，只放一个缩进一格的入口行。
  // 被折叠掉的（▸）不铺内容 —— 只影响显示，数据结构不动
  for (const sub of node.subs) {
    const ids = curIds.concat([sub.id]);
    const folded = foldedIds.has(sub.id);
    el.board.appendChild(folderRow(sub, 0, ids));
    if (folded) continue;
    if (sub.items.length) el.board.appendChild(gridFor(sub.items, true));
    for (const deeper of sub.subs) {
      el.board.appendChild(folderRow(deeper, 1, ids.concat([deeper.id])));
    }
  }

  if (!node.total) el.board.appendChild(emptyFolder(node));

  const total = groupsCache.reduce((s, g) => s + g.total, 0);
  el.stats.textContent = `${node.path.join(' / ')} · ${countOf(node)} 项　（共 ${groupsCache.length} 组 / ${total} 个书签）`;
  if (!iconObserver) el.board.querySelectorAll('.card').forEach(hydrateIcon);
}

/** 摊平全部书签，供搜索框做本地匹配（含还没画出来的深层） */
function flattenAll(groups) {
  const out = [];
  const walk = (node) => { out.push(...node.items); node.subs.forEach(walk); };
  for (const g of groups) walk(g.node);
  return out;
}

/* ── 缩放快捷键用的步进 ─────────────────────────────── */

function stepScale(dir) {
  let i = SUGGEST_STEPS.indexOf(Number(settings.scale));
  if (i < 0) i = 2;
  const next = Math.min(SUGGEST_STEPS.length - 1, Math.max(0, i + dir));
  saveSettings({ scale: SUGGEST_STEPS[next] });
}

/* ── 选中态与整体重绘 ───────────────────────────────── */

function loadSavedState() {
  try {
    const raw = localStorage.getItem('activeGroup');
    if (!raw) return { group: null, path: [] };
    if (raw.charAt(0) === '{') return JSON.parse(raw);
    return { group: raw, path: [] };          // 兼容 0.3.x 存的纯名字
  } catch (e) { return { group: null, path: [] }; }
}

function persistState() {
  try {
    localStorage.setItem('activeGroup', JSON.stringify({ group: activeGroup, path: activePath }));
  } catch (e) { /* 无痕模式等，忽略 */ }
}

/** 只留下在当前分组里真的存在的 id（书签被删/改名后不至于卡在假路径上） */
function validIds(group, ids) {
  const out = [];
  let node = group && group.node;
  for (const id of ids || []) {
    const next = node && node.subs.find((s) => s.id === id);
    if (!next) break;
    out.push(id);
    node = next;
  }
  return out;
}

/** 重画一遍（链路：左栏 + 面包屑 + 主区） */
function repaint(keepScroll) {
  const group = groupsCache.find((g) => g.name === activeGroup) || groupsCache[0];
  if (!group) return;
  activeGroup = group.name;
  const chain = pathChain(group, activePath);
  renderRail();
  renderCrumbs(chain);
  renderMain(chain);
  // 悬浮面板跟着当前分组走：方向键切组时是换内容，不是又叠一层
  if (flyBox) showFly(groupsCache.find((x) => x.name === activeGroup));
  if (!keepScroll) el.board.scrollTop = 0;
}

function selectGroup(name) {
  activeGroup = name;
  activePath = [];
  persistState();
  repaint();
  const cur = el.rail.querySelector('.ritem[aria-selected="true"]');
  if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
}

function selectPath(ids) {
  activePath = ids || [];
  persistState();
  repaint();
}

function renderBoard(root) {
  if (!root) return;
  groupsCache = buildGroups(root);
  flatItems = flattenAll(groupsCache);
  el.board.replaceChildren();

  if (!groupsCache.length) {
    el.rail.replaceChildren();
    el.crumbs.replaceChildren();
    el.railTotal.textContent = '0';
    el.board.appendChild(emptyState());
    el.stats.textContent = '';
    return;
  }

  // 上次看的那一组 + 钻到哪一层（新标签页每次全新加载，必须持久化）
  loadFolded();
  const saved = loadSavedState();
  activeGroup = (saved.group && groupsCache.some((g) => g.name === saved.group))
    ? saved.group : groupsCache[0].name;
  const group = groupsCache.find((g) => g.name === activeGroup);
  activePath = validIds(group, saved.path);
  repaint();
}

/* ── 搜索引擎（点左边放大镜来回切）────────────────── */

const ENGINES = {
  bing:   { name: '必应', action: 'https://www.bing.com/search',  ph: '用必应搜索…', params: '' },
  google: { name: '谷歌', action: 'https://www.google.com/search', ph: '用谷歌搜索…', params: 'gl=us&hl=en' },
};

function currentEngine() { return ENGINES[settings.engine] || ENGINES.bing; }

function applyEngine() {
  const eng = currentEngine();
  const other = settings.engine === 'bing' ? ENGINES.google : ENGINES.bing;
  el.searchForm.action = eng.action;
  el.searchInput.placeholder = eng.ph;
  el.searchInput.setAttribute('aria-label', eng.ph);
  el.engineBtn.title = `搜索引擎：${eng.name}（点击切到${other.name}）`;
}

/* ── 搜索建议 ───────────────────────────────────────── */

const SUGGEST_STEPS = [0.9, 1, 1.15, 1.3, 1.5];
const MAX_LOCAL = 4;
const MAX_WEB = 8;

let suggestRows = [];
let suggestIdx = -1;
let suggestSeq = 0;
let suggestTimer = 0;

/* 两家建议接口。⚠️ 都不带 CORS 头（带 Origin 实测过），所以 manifest 里按域单独申请：
   必应 api.bing.com、谷歌 suggestqueries.google.com，都不是「所有网站」那种 */
const SUGGEST_URL = {
  bing: (q) => `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(q)}&market=zh-CN`,
  // gl = 结果地区（us）；hl = 界面/建议语言（en）。两者是分开的开关，别混：
  // 实测 gl=us 加不加，中文 hl 下拿到的建议完全一样，真正决定语言的是 hl
  google: (q) => 'https://suggestqueries.google.com/complete/search?client=firefox'
    + '&hl=en&gl=us&q=' + encodeURIComponent(q),
};

/** 两家都返回 [查询词, [建议…], …]；谷歌用 client=chrome 时建议里还会套一层数组，一并兼容 */
function pickList(data) {
  const arr = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
  const out = [];
  for (const x of arr) {
    const s = typeof x === 'string' ? x
      : (Array.isArray(x) && typeof x[0] === 'string' ? x[0] : '');
    if (s) out.push(s);
  }
  return out;
}

async function fetchSuggest(engine, q) {
  if (api.suggest) return api.suggest(q);      // 本地预览的替身
  const res = await fetch(SUGGEST_URL[engine](q));
  if (!res.ok) return [];
  return pickList(await res.json());
}

/** 只问当前引擎那一家。取不到就只留本地书签匹配 —— **故意不跨引擎降级**：
    用谷歌搜索却给必应的补全词没意义，反正最后那一步（跳 google.com）照样打不开 */
async function engineSuggest(q) {
  try {
    return await fetchSuggest(settings.engine === 'google' ? 'google' : 'bing', q);
  } catch (e) {
    return [];
  }
}

/** 本地书签匹配：标题开头 > 标题包含 > 网址包含 */
function localMatches(q) {
  const needle = q.toLowerCase();
  const hit = [];
  for (const it of flatItems) {
    const title = (it.title || '').toLowerCase();
    const url = (it.url || '').toLowerCase();
    let score = -1;
    if (title.startsWith(needle)) score = 0;
    else if (title.includes(needle)) score = 1;
    else if (url.includes(needle)) score = 2;
    if (score >= 0) hit.push({ score, it });
  }
  hit.sort((a, b) => a.score - b.score);
  return hit.slice(0, MAX_LOCAL).map((x) => x.it);
}

async function refreshSuggest() {
  const q = el.searchInput.value.trim();
  if (!q) return closeSuggest();

  const seq = ++suggestSeq;
  const rows = [{ kind: 'search', text: q }];
  for (const it of localMatches(q)) rows.push({ kind: 'bookmark', text: it.title || it.url, url: it.url });
  const idxBeforeWeb = rows.length;
  renderSuggest(rows);

  let web = [];
  try { web = await engineSuggest(q); } catch (e) { web = []; }   // 取不到就只留本地结果
  if (seq !== suggestSeq || el.searchInput.value.trim() !== q) return;   // 已经翻篇了

  const seen = new Set([q.toLowerCase()]);
  for (const s of web) {
    if (rows.length >= MAX_LOCAL + MAX_WEB + idxBeforeWeb) break;
    if (typeof s !== 'string' || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    rows.push({ kind: 'web', text: s });
  }
  renderSuggest(rows);
}

function renderSuggest(rows) {
  suggestRows = rows;
  suggestIdx = 0;
  el.suggest.replaceChildren();
  rows.forEach((row, i) => {
    const item = document.createElement('div');
    item.className = 'suggest__item';
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(i === suggestIdx));

    const ic = document.createElement('span');
    ic.className = 'suggest__ic';
    if (row.kind === 'bookmark') {
      const img = document.createElement('img');
      img.alt = '';
      const src = faviconFor(row.url);
      if (src) img.src = src;
      else img.replaceWith(magnifier());
      ic.appendChild(img);
    } else {
      ic.appendChild(magnifier());
    }

    const t = document.createElement('span');
    t.className = 'suggest__t';
    t.textContent = row.kind === 'search' ? `${row.text} · 用${currentEngine().name}搜索` : row.text;

    item.append(ic, t);
    if (row.kind === 'bookmark') {
      const u = document.createElement('span');
      u.className = 'suggest__u';
      try { u.textContent = new URL(row.url).hostname.replace(/^www\./, ''); } catch (e) { u.textContent = ''; }
      item.appendChild(u);
    }

    // 用 mousedown 而不是 click：否则输入框先失焦、下拉先关，点击就丢了
    item.addEventListener('mousedown', (e) => { e.preventDefault(); activateSuggest(i); });
    item.addEventListener('mouseenter', () => setSuggestIdx(i));
    el.suggest.appendChild(item);
  });
  el.suggest.hidden = rows.length === 0;
  el.searchInput.setAttribute('aria-expanded', String(!el.suggest.hidden));
}

function magnifier() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '15');
  svg.setAttribute('height', '15');
  const c = document.createElementNS(ns, 'circle');
  c.setAttribute('cx', '11'); c.setAttribute('cy', '11'); c.setAttribute('r', '6.5');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', 'M16 16l4.5 4.5');
  svg.append(c, p);
  return svg;
}

function setSuggestIdx(i) {
  suggestIdx = i;
  [...el.suggest.children].forEach((node, n) => node.setAttribute('aria-selected', String(n === i)));
}

function closeSuggest() {
  el.suggest.hidden = true;
  el.searchInput.setAttribute('aria-expanded', 'false');
  suggestRows = [];
  suggestIdx = -1;
}

/** 一个口子决定「当前页 / 新标签页」，磁贴和搜索建议都走它 */
function openUrl(url) {
  if (settings.openIn !== 'newtab') {
    location.href = url;
    return;
  }
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function goSearch(q) {
  const eng = currentEngine();
  const extra = eng.params ? `&${eng.params}` : '';
  openUrl(`${el.searchForm.action}?q=${encodeURIComponent(q)}${extra}`);
}

function activateSuggest(i) {
  const row = suggestRows[i];
  if (!row) return;
  if (row.kind === 'bookmark') openUrl(row.url);
  else goSearch(row.text);
}

function wireSearch() {
  el.searchInput.addEventListener('input', () => {
    clearTimeout(suggestTimer);
    const q = el.searchInput.value.trim();
    if (!q) return closeSuggest();
    suggestTimer = setTimeout(refreshSuggest, 130);   // 防抖，别每敲一个键就打一次接口
  });

  el.searchInput.addEventListener('keydown', (e) => {
    const open = !el.suggest.hidden && suggestRows.length > 0;
    if (e.key === 'ArrowDown' && open) {
      e.preventDefault();
      setSuggestIdx((suggestIdx + 1) % suggestRows.length);
    } else if (e.key === 'ArrowUp' && open) {
      e.preventDefault();
      setSuggestIdx((suggestIdx - 1 + suggestRows.length) % suggestRows.length);
    } else if (e.key === 'Enter' && open && suggestIdx >= 0) {
      e.preventDefault();
      activateSuggest(suggestIdx);
    } else if (e.key === 'Escape') {
      closeSuggest();
    }
  });

  el.engineBtn.addEventListener('click', () => {
    saveSettings({ engine: settings.engine === 'bing' ? 'google' : 'bing' });
    applyEngine();
    if (!el.suggest.hidden) refreshSuggest();   // 下拉开着就把第一行文案也换掉
    el.searchInput.focus();
  });

  el.searchInput.addEventListener('blur', () => setTimeout(closeSuggest, 120));

  // ⚠️ 表单原生提交会直接在当前标签页导航，绕过 openUrl —— 所以拦下来自己走
  el.searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = el.searchInput.value.trim();
    closeSuggest();
    if (q) goSearch(q);
  });
}

/* ── 键盘 ───────────────────────────────────────────── */

function wireKeys() {
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    const meta = e.ctrlKey || e.metaKey;

    if (meta && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      el.searchInput.focus();
      el.searchInput.select();
      return;
    }
    if (meta && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '_')) {
      e.preventDefault();                       // 抢在浏览器缩放之前，改成调我们自己的缩放
      stepScale(e.key === '=' || e.key === '+' ? 1 : -1);
      return;
    }
    if (e.key === '/' && !typing) {
      e.preventDefault();
      el.searchInput.focus();
      return;
    }
    if (e.key === 'Escape' && document.activeElement === el.searchInput) {
      el.searchInput.blur();
      return;
    }
    // Esc = 返回上一级（设置面板开着时先让面板自己关，别一次做两件事）
    if (e.key === 'Escape' && !typing) {
      if (!el.panel.hidden) return;
      if (activePath.length) {
        e.preventDefault();
        selectPath(activePath.slice(0, -1));
      }
      return;
    }
    if (typing || meta || e.altKey) return;

    // 上下左右都切分组；到头绕回去（19 个组的时候省得一路按）
    const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (dir) {
      const i = groupsCache.findIndex((g) => g.name === activeGroup);
      if (i < 0) return;
      e.preventDefault();
      const n = groupsCache.length;
      selectGroup(groupsCache[(i + dir + n) % n].name);
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      if (!groupsCache.length) return;
      e.preventDefault();
      selectGroup(groupsCache[e.key === 'Home' ? 0 : groupsCache.length - 1].name);
    }
  });
}

/* ── 图标懒解析 ─────────────────────────────────────── */

function setupIconObserver() {
  if (!('IntersectionObserver' in window)) {
    iconObserver = null;
    return;
  }
  iconObserver = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      iconObserver.unobserve(e.target);
      hydrateIcon(e.target);
    }
  }, { rootMargin: '300px 0px' });
}

async function hydrateIcon(tile) {
  const item = tile._item;
  if (!item) return;
  const glyph = tile.querySelector('.card__initial');
  if (!glyph) return;
  const img = await resolveIcon(item);
  if (img && glyph.isConnected) {
    img.alt = '';
    glyph.replaceWith(img);
  }
}

function emptyState() {
  const box = document.createElement('div');
  box.className = 'empty';
  box.innerHTML = `
    <p class="empty__title">书签栏还是空的</p>
    <p class="empty__body">
      在 Chrome 里把常用网站拖进<strong>书签栏</strong>，
      每建一个文件夹就是一个分组。<br>
      加完回到这里按 <kbd>⌘R</kbd>（或 <kbd>F5</kbd>）刷新即可。
    </p>`;
  return box;
}

/* ── 时钟 ───────────────────────────────────────────── */

let lastClock = '';

function tick() {
  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const hh = p(now.getHours());
  const mm = p(now.getMinutes());

  const html = settings.clock === 'seconds'
    ? `${hh}:${mm}<span class="clock__sec">:${p(now.getSeconds())}</span>`
    : `${hh}:${mm}`;
  if (html !== lastClock) {
    el.clock.innerHTML = html;
    lastClock = html;
  }

  const h = now.getHours();
  const part = h < 5 ? '夜深了' : h < 11 ? '早上好' : h < 13 ? '中午好'
    : h < 18 ? '下午好' : h < 23 ? '晚上好' : '夜深了';
  const week = '日一二三四五六'[now.getDay()];
  el.greeting.textContent = `${part} · ${now.getMonth() + 1} 月 ${now.getDate()} 日 周${week}`;
}

/* ── 启动 ───────────────────────────────────────────── */

function refresh() {
  if (!hasBookmarks) return;
  api.bookmarks.getTree((tree) => renderBoard(tree && tree[0]));
}

function wireSettings() {
  document.getElementById('btn-settings').addEventListener('click', openPanel);
  window.addEventListener('resize', () => { if (!el.panel.hidden) placePanel(); });
  document.getElementById('btn-close-settings').addEventListener('click', () => {
    el.panel.hidden = true;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') el.panel.hidden = true;
  });
  // 点面板外面任意地方就关掉（用 pointerdown：按下那一刻就关，不用等抬手）
  document.addEventListener('pointerdown', (e) => {
    if (el.panel.hidden) return;
    if (el.panel.contains(e.target)) return;
    if (e.target.closest && e.target.closest('#btn-settings')) return;
    el.panel.hidden = true;
  });
  el.theme.addEventListener('change', () => saveSettings({ theme: el.theme.value }));
  el.clockMode.addEventListener('change', () => {
    saveSettings({ clock: el.clockMode.value });
    tick();
  });
  el.size.addEventListener('change', () => saveSettings({ size: el.size.value }));
  el.scale.addEventListener('change', () => saveSettings({ scale: Number(el.scale.value) }));
  el.cols.addEventListener('change', () => saveSettings({ cols: Number(el.cols.value) }));
  el.fs.addEventListener('change', () => saveSettings({ fs: Number(el.fs.value) }));
  el.fw.addEventListener('change', () => saveSettings({ fw: Number(el.fw.value) }));
  el.countMode.addEventListener('change', () => {
    saveSettings({ countMode: el.countMode.value });
    repaint(true);             // 左栏 / 面包屑 / 入口行的计数都要跟着换口径
  });
  el.openIn.addEventListener('change', () => {
    saveSettings({ openIn: el.openIn.value });
    repaint(true);             // 卡片的 target 是生成时写的，重画一遍最省事
  });
  el.flyout.addEventListener('change', () => {
    saveSettings({ flyout: el.flyout.checked });
    if (!el.flyout.checked) closeFly();
  });
  el.loosies.addEventListener('change', () => {
    saveSettings({ showLoosies: el.loosies.checked });
    refresh();
  });

  // 左栏筛选：只藏不合的，不动顺序
  el.railFilter.addEventListener('input', () => {
    railQuery = el.railFilter.value;
    renderRail();
  });
  el.railFilter.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      el.railFilter.value = '';
      railQuery = '';
      renderRail();
      el.railFilter.blur();
    }
  });
}

function wireBookmarkEvents() {
  if (!api.bookmarks) return;
  const b = api.bookmarks;
  for (const evt of ['onCreated', 'onRemoved', 'onChanged', 'onMoved',
                     'onChildrenReordered', 'onImportEnded', 'onImportBegan']) {
    if (b[evt] && b[evt].addListener) b[evt].addListener(() => refresh());
  }
}

(async function main() {
  settings = await loadSettings();
  applySettings();
  wireSettings();
  wireKeys();
  wireSearch();
  wireBookmarkEvents();
  tick();
  setInterval(tick, 1000);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (settings.theme === 'auto') applySettings();
  });
  await learnPlaceholder();   // 先认一下 Chrome 的「没有图标」占位图长什么样
  setupIconObserver();
  refresh();
})();

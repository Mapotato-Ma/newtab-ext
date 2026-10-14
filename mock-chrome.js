/* 本地预览用的 chrome.* 替身 —— 只在 preview.html 里加载，不进扩展包。
   真机上的 chrome.bookmarks.getTree 是异步回调，这里照样用回调，保证行为一致。 */

(function () {
  // Chrome 在「这个网站没有图标」时返回的那张默认地球图
  const GLOBE = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    '<circle cx="32" cy="32" r="25" fill="#dcdcdc"/>' +
    '<path d="M8 32h48M32 7c9 8 9 42 0 50M32 7c-9 8-9 42 0 50" ' +
    'stroke="#b0b0b0" stroke-width="3" fill="none"/></svg>');

  const B = (id, parentId, title, url) => url
    ? { id, parentId, title, url, dateAdded: 1760000000000 }
    : { id, parentId, title, children: [], dateAdded: 1760000000000 };

  const tree = B('0', null, '');
  const bar = B('1', '0', '书签栏');
  const other = B('2', '0', '其他书签');
  tree.children.push(bar, other);

  const folder = (id, title, kids) => {
    const f = B(id, '1', title);
    f.children = kids.map((k) => (Array.isArray(k) ? folder(k[0], k[1], k[2]) : k));
    return f;
  };

  // 直接放在书签栏根下的散书签 → 「未分组」
  const loose = [
    B('l1', '1', 'Notion', 'https://www.notion.so/'),
    B('l2', '1', 'DeepSeek', 'https://chat.deepseek.com/'),
    B('l3', '1', '天溯 OA', 'https://oa.tiansu-china.com:88/wui/index.html'),
  ];

  bar.children.push(
    folder('f1', '工作', [
      B('w1', 'f1', 'team 看板', 'https://team.tiansu-china.com:10134/'),
      B('w2', 'f1', '工时填报', 'https://team.tiansu-china.com:10134/tiansu/COC-IEMS/proxima'),
      B('w3', 'f1', '企业微信', 'https://work.weixin.qq.com/'),
      // 深链：第 2 → 第 7 层，用来验钻取、缩进刻度与面包屑折叠
      ['f1a', '项目文档', [
        B('w4', 'f1a', '综能需求池', 'https://doc.weixin.qq.com/'),
        ['f1b', '综能 · 2026', [
          ['f1c', '需求池', [
            ['f1d', 'IEMS', [
              ['f1e', '工时模块', [
                ['f1f', '接口文档', [
                  B('w5', 'f1f', '第七层 · 工时接口 v2 联调说明', 'https://example.com/deep/7'),
                ]],
              ]],
            ]],
          ]],
        ]],
      ]],
    ]),
    folder('f2', '前端', [
      B('d1', 'f2', 'MDN', 'https://developer.mozilla.org/zh-CN/'),
      B('d2', 'f2', 'Can I use', 'https://caniuse.com/'),
      B('d3', 'f2', 'Vue 3 文档', 'https://cn.vuejs.org/'),
      B('d4', 'f2', 'Vite', 'https://cn.vitejs.dev/'),
      B('d5', 'f2', 'Angular', 'https://angular.dev/'),
    ]),
    folder('f3', 'AI', [
      B('a1', 'f3', 'Claude', 'https://claude.ai/'),
      B('a2', 'f3', 'DeepSeek - 深度求索对话模型', 'https://chat.deepseek.com/'),
      B('a3', 'f3', 'MiniMax Agent · 智能体开发平台（标题很长的这一条，用来验证「完整标题」换行之后会不会把整行撑坏）', 'https://platform.minimaxi.com/'),
      B('a4', 'f3', 'GitHub', 'https://github.com/'),
      ['f3a', '图像生成', [
        B('a5', 'f3a', 'Midjourney - 文本生成图像', 'https://www.midjourney.com/'),
        B('a6', 'f3a', 'Galileo AI - 图像生成与编辑', 'https://www.usegalileo.ai/'),
      ]],
      ['f3b', '对话模型', [
        B('a7', 'f3b', '通义千问', 'https://tongyi.aliyun.com/'),
      ]],
    ]),
    folder('f4', '阅读', [
      B('r1', 'f4', '掘金', 'https://juejin.cn/'),
      B('r2', 'f4', '少数派', 'https://sspai.com/'),
      B('r3', 'f4', 'Hacker News', 'https://news.ycombinator.com/'),
    ]),
    folder('f5', 'token中转站', [                       // 12 字符无空格
      B('t1', 'f5', 'One API', 'https://example.com/one-api'),
      B('t2', 'f5', 'New API', 'https://example.com/new-api'),
    ]),
    folder('f6', '归档 · 2026-10', [                    // 含空格与间隔号
      B('g1', 'f6', '十月归档说明', 'https://example.com/archive'),
    ]),
    folder('f7', 'Flutter', []),                        // 空文件夹 → 左栏置灰不隐藏
    folder('f8', '3D', [
      B('x1', 'f8', 'three.js', 'https://threejs.org/'),
      B('x2', 'f8', 'TresJS', 'https://docs.tresjs.org/'),
    ]),
    ...loose
  );

  other.children.push(
    B('o1', '2', '一个陈年收藏', 'https://example.com/')
  );

  const listeners = [];
  const fire = () => listeners.forEach((fn) => fn());

  const store = {};

  window.chrome = {
    bookmarks: {
      getTree(cb) { setTimeout(() => cb([tree]), 10); },
      getSubTree(id, cb) { setTimeout(() => cb([tree]), 10); },
      onCreated: { addListener: (fn) => listeners.push(fn) },
      onRemoved: { addListener: (fn) => listeners.push(fn) },
      onChanged: { addListener: (fn) => listeners.push(fn) },
      onMoved: { addListener: (fn) => listeners.push(fn) },
      onChildrenReordered: { addListener: (fn) => listeners.push(fn) },
      onImportEnded: { addListener: (fn) => listeners.push(fn) },
      onImportBegan: { addListener: (fn) => listeners.push(fn) },
      // 预览时造点动静：3 秒后「新增一个书签」，用来验证实时刷新
      _fire: fire,
    },
    storage: {
      sync: {
        get(defaults, cb) { setTimeout(() => cb({ ...defaults, ...store }), 5); },
        set(patch, cb) { Object.assign(store, patch); if (cb) cb(); },
      },
    },
    runtime: {
      // 真机上这里返回 chrome 本地的 favicon 缓存；**找不到图标时会返回一张默认地球图**
      // （这就是本地预览要模拟的关键行为，否则「认占位图」这条逻辑没法验）
      getURL(path) {
        if (path[0] !== '_') return path;
        const m = /pageUrl=([^&]+)/.exec(path);
        if (!m) return '';
        let u;
        try { u = new URL(decodeURIComponent(m[1])); } catch (e) { return ''; }
        if (/\.invalid$/.test(u.hostname)) return GLOBE;
        return `${u.origin}/favicon.ico`;
      },
    },

    // 预览里没法跨域打必应建议接口（真实页面有 host_permissions），用固定列表代替
    suggest(q) {
      // 截商店图用：模仿真实必应返回的那种英文建议
      const seed = ['deepseek', 'deepseek harness', 'deep learning', 'deepseek api',
        'deepwater horizon', 'deep purple', 'deep freeze', 'deepseek v4'];
      return seed.filter((s) => s !== q.toLowerCase());
    },
  };
})();

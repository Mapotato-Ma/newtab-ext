/* 商店截图专用的演示数据。
   故意不含任何真实/公司书签 —— 商店页面是公开可访问的，
   拿真书签截图等于把自己的收藏夹贴出去。这里全用通用开发站点。 */

(function () {
  const B = (id, parentId, title, url) =>
    ({ id, parentId, title, url, index: 0, dateAdded: 1 });

  const bar = B('1', '0', '书签栏', undefined);
  const other = B('2', '0', '其他书签', undefined);

  const groups = [
    ['开发', [
      ['GitHub', 'https://github.com/'],
      ['MDN', 'https://developer.mozilla.org/zh-CN/'],
      ['Stack Overflow', 'https://stackoverflow.com/'],
      ['DevDocs', 'https://devdocs.io/'],
      ['Can I use', 'https://caniuse.com/'],
      ['npm', 'https://www.npmjs.com/'],
      ['Docker Hub', 'https://hub.docker.com/'],
      ['regex101', 'https://regex101.com/'],
      ['Sentry', 'https://sentry.io/'],
      ['GitLab', 'https://gitlab.com/'],
      ['Postman', 'https://www.postman.com/'],
      ['VitePress', 'https://vitepress.dev/'],
      ['Rollup', 'https://rollupjs.org/'],
      ['esbuild', 'https://esbuild.github.io/'],
      ['Kubernetes', 'https://kubernetes.io/zh-cn/'],
      ['Grafana', 'https://grafana.com/'],
      ['Redis 文档', 'https://redis.io/docs/'],
      ['MySQL 文档', 'https://dev.mysql.com/doc/'],
    ], ['项目文档', [
      ['产品需求文档', 'https://example.com/prd'],
      ['接口文档', 'https://example.com/api'],
      ['设计稿', 'https://example.com/design'],
      ['部署手册', 'https://example.com/deploy'],
    ]]],
    ['前端', [
      ['Vue 3 文档', 'https://cn.vuejs.org/'],
      ['React', 'https://react.dev/'],
      ['Vite', 'https://cn.vitejs.dev/'],
      ['Tailwind CSS', 'https://tailwindcss.com/'],
      ['TypeScript', 'https://www.typescriptlang.org/'],
      ['Pinia', 'https://pinia.vuejs.org/'],
      ['VueUse', 'https://vueuse.org/'],
      ['Nuxt', 'https://nuxt.com/'],
      ['Element Plus', 'https://element-plus.org/'],
      ['unocss', 'https://unocss.dev/'],
    ]],
    ['AI 工具', [
      ['ChatGPT', 'https://chatgpt.com/'],
      ['Claude', 'https://claude.ai/'],
      ['DeepSeek', 'https://chat.deepseek.com/'],
      ['Hugging Face', 'https://huggingface.co/'],
      ['Kimi', 'https://kimi.moonshot.cn/'],
      ['Midjourney', 'https://www.midjourney.com/'],
      ['Perplexity', 'https://www.perplexity.ai/'],
      ['Cursor', 'https://cursor.com/'],
    ]],
    ['设计', [
      ['Figma', 'https://www.figma.com/'],
      ['Dribbble', 'https://dribbble.com/'],
      ['Iconify', 'https://icon-sets.iconify.design/'],
      ['Coolors', 'https://coolors.co/'],
      ['unDraw', 'https://undraw.co/'],
      ['Google Fonts', 'https://fonts.google.com/'],
      ['Unsplash', 'https://unsplash.com/'],
      ['Lottiefiles', 'https://lottiefiles.com/'],
    ]],
    ['阅读', [
      ['掘金', 'https://juejin.cn/'],
      ['少数派', 'https://sspai.com/'],
      ['Hacker News', 'https://news.ycombinator.com/'],
      ['InfoQ', 'https://www.infoq.cn/'],
      ['阮一峰周刊', 'https://www.ruanyifeng.com/blog/'],
      ['MDH 前端周刊', 'https://mdhweekly.com/'],
      ['Node Weekly', 'https://nodeweekly.com/'],
      ['CSS-Tricks', 'https://css-tricks.com/'],
    ]],
    ['工具', [
      ['Notion', 'https://www.notion.so/'],
      ['Excalidraw', 'https://excalidraw.com/'],
      ['TinyPNG', 'https://tinypng.com/'],
      ['Carbon', 'https://carbon.now.sh/'],
      ['JSON 格式化', 'https://www.json.cn/'],
      ['Squoosh', 'https://squoosh.app/'],
      ['crontab.guru', 'https://crontab.guru/'],
      ['it-tools', 'https://it-tools.tech/'],
    ]],
  ];

  const children = bar ? [] : [];
  let n = 0;
  for (const [name, items, subs] of groups) {
    const folder = B(`g${n}`, '1', name, undefined);
    folder.children = items.map(([title, url]) => B(`b${n}-${title}`, folder.id, title, url));
    for (const [subName, subItems] of (subs ? [subs] : [])) {
      const sub = B(`s${n}`, folder.id, subName, undefined);
      sub.children = subItems.map(([title, url]) => B(`s${n}-${title}`, sub.id, title, url));
      folder.children.push(sub);
    }
    children.push(folder);
    n++;
  }
  bar.children = children;
  other.children = [];
  const root = B('0', null, '', undefined);
  root.children = [bar, other];

  // 覆盖掉 mock 的书签数据（mock-chrome.js 先加载，这里后覆盖）
  if (globalThis.chrome && chrome.bookmarks) {
    chrome.bookmarks.getTree = (cb) => setTimeout(() => cb([root]), 5);
  }
  globalThis.__demoRoot = root;
})();

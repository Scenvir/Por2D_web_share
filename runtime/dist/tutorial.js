'use strict';
// Render only the Markdown constructs used by the bundled tutorial.
// Text is always inserted as text nodes; raw HTML is never executed.
(() => {
  const content = document.getElementById('tutorial-content');
  const status = document.getElementById('tutorial-status');
  function inline(parent, text) {
    const tokens = /(`[^`]+`|\*\*[^*]+\*\*)/g;
    let offset = 0;
    for (const match of text.matchAll(tokens)) {
      parent.append(document.createTextNode(text.slice(offset, match.index)));
      const code = match[0].startsWith('`');
      const element = document.createElement(code ? 'code' : 'strong');
      element.textContent = match[0].slice(code ? 1 : 2, code ? -1 : -2);
      parent.append(element);
      offset = match.index + match[0].length;
    }
    parent.append(document.createTextNode(text.slice(offset)));
  }
  const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
  const separator = line => /^\s*\|/.test(line) && cells(line).every(cell => /^:?-{3,}:?$/.test(cell));
  function render(markdown) {
    const fragment = document.createDocumentFragment();
    const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
    let list = null;
    for (let i = 0; i < lines.length;) {
      const line = lines[i];
      if (!line.trim()) { list = null; i++; continue; }
      const illustration = /^!\[([^\]]+)\]\((tutorial-images\/(?:exit-alignment|portal-pair|portal-center)\.svg)\)$/.exec(line);
      if (illustration) {
        list = null;
        const figure = document.createElement('figure'), img = document.createElement('img');
        img.src = illustration[2]; img.alt = illustration[1];
        img.width = 840; img.height = 360; img.loading = 'lazy';
        const caption = document.createElement('figcaption');
        caption.textContent = illustration[1];
        figure.append(img, caption); fragment.append(figure); i++; continue;
      }
      if (/^```/.test(line)) {
        list = null;
        const block = [];
        for (i++; i < lines.length && !/^```/.test(lines[i]); i++) block.push(lines[i]);
        const pre = document.createElement('pre'), code = document.createElement('code');
        code.textContent = block.join('\n'); pre.append(code); fragment.append(pre); i++; continue;
      }
      if (/^\s*\|/.test(line) && separator(lines[i + 1] || '')) {
        list = null;
        const wrapper = document.createElement('div'), table = document.createElement('table');
        wrapper.className = 'table-scroll';
        wrapper.tabIndex = 0; wrapper.setAttribute('role', 'region');
        wrapper.setAttribute('aria-label', cells(line).join(' / '));
        const head = document.createElement('thead'), body = document.createElement('tbody');
        function row(target, values, tag) {
          const tr = document.createElement('tr');
          for (const value of values) {
            const cell = document.createElement(tag);
            if (tag === 'th') cell.scope = 'col';
            inline(cell, value); tr.append(cell);
          }
          target.append(tr);
        }
        row(head, cells(line), 'th'); i += 2;
        while (i < lines.length && /^\s*\|/.test(lines[i])) row(body, cells(lines[i++]), 'td');
        table.append(head, body); wrapper.append(table); fragment.append(wrapper); continue;
      }
      const heading = /^(#{1,6})\s+(.+)$/.exec(line);
      if (heading) {
        list = null;
        const element = document.createElement(`h${heading[1].length}`);
        inline(element, heading[2]); fragment.append(element); i++; continue;
      }
      const item = /^(?:(\d+)\. |([-*]) )(.+)$/.exec(line);
      if (item) {
        const tag = item[1] ? 'OL' : 'UL';
        if (!list || list.tagName !== tag) {
          list = document.createElement(tag);
          if (item[1]) list.start = Number(item[1]);
          fragment.append(list);
        }
        const li = document.createElement('li'); inline(li, item[3]); list.append(li); i++; continue;
      }
      list = null;
      const paragraph = document.createElement('p');
      inline(paragraph, line); fragment.append(paragraph); i++;
    }
    content.replaceChildren(fragment);
  }
  fetch(content.dataset.source === '三分钟上手.md' ? '三分钟上手.md' : '新手教程.md').then(response => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  }).then(markdown => {
    render(markdown); status.hidden = true;
  }).catch(() => {
    status.textContent = '教程加载失败，请刷新重试，或使用上方链接查看 Markdown 原文。';
  });
})();

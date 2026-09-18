#!/usr/bin/env node
'use strict';

/**
 * WATE Automated Documentation Generator (`wate doc`)
 * -------------------------------------------------------------
 * Parses WATE source code, extracting:
 *  - Module comments
 *  - JSDoc / Docstring block comments (/** ... *\/, """ ... """, # ...)
 *  - Functions, parameters, return types, examples
 *  - Classes, constructors, inheritance, interfaces, methods, properties
 *  - Interfaces and method signatures
 *  - Global constants & exports
 * Generates:
 *  - Markdown API reference (`API.md`)
 *  - Modern, responsive, searchable HTML documentation site (`index.html`)
 *  - Optional preview server with `--serve` / `-s`
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

// ===============================================================
// 1. DOCSTRING & METADATA EXTRACTOR
// ===============================================================
class WateDocExtractor {
  constructor(filePath) {
    this.filePath = filePath;
    this.fileName = path.basename(filePath);
    this.content = fs.readFileSync(filePath, 'utf-8');
    this.lines = this.content.split('\n');
    this.doc = {
      file: this.fileName,
      path: this.filePath,
      description: '',
      functions: [],
      classes: [],
      interfaces: [],
      constants: []
    };
  }

  extract() {
    let currentDocstring = [];
    let inBlockComment = false;
    let inTripleQuote = false;

    for (let i = 0; i < this.lines.length; i++) {
      const rawLine = this.lines[i];
      const line = rawLine.trim();

      // Block comment /** ... */
      if (line.startsWith('/**') || line.startsWith('/*')) {
        inBlockComment = true;
        currentDocstring = [line.replace(/^\/\*\*?/, '').replace(/\*\/$/, '').trim()];
        if (line.includes('*/') && line.length > 3) inBlockComment = false;
        continue;
      }
      if (inBlockComment) {
        if (line.includes('*/')) {
          inBlockComment = false;
          currentDocstring.push(line.replace(/\*\/$/, '').replace(/^\s*\*?\s?/, '').trim());
        } else {
          currentDocstring.push(line.replace(/^\s*\*?\s?/, '').trim());
        }
        continue;
      }

      // Triple quotes """ ... """
      if (line.startsWith('"""') || line.startsWith("'''")) {
        if (inTripleQuote) {
          inTripleQuote = false;
        } else {
          inTripleQuote = true;
          currentDocstring = [line.substring(3).trim()];
        }
        continue;
      }
      if (inTripleQuote) {
        if (line.endsWith('"""') || line.endsWith("'''")) {
          inTripleQuote = false;
          currentDocstring.push(line.slice(0, -3).trim());
        } else {
          currentDocstring.push(line);
        }
        continue;
      }

      // Line comments `#` or `//`
      if (line.startsWith('#') && !line.startsWith('#!') && !line.startsWith('#[') && !line.startsWith('#name')) {
        currentDocstring.push(line.replace(/^#+\s?/, '').trim());
        continue;
      }
      if (line.startsWith('//')) {
        currentDocstring.push(line.replace(/^\/\/+\s?/, '').trim());
        continue;
      }

      // Empty line reset docstring if not followed by a declaration immediately
      if (!line) {
        if (currentDocstring.length > 0 && i === currentDocstring.length) {
          // File overview docstring at top
          this.doc.description = currentDocstring.filter(Boolean).join('\n');
          currentDocstring = [];
        }
        continue;
      }

      // Parse tags from accumulated docstring
      const parsedDoc = this.parseDocstring(currentDocstring);

      // Match: Interface
      const ifaceMatch = line.match(/^interface\s+([a-zA-Z0-9_]+)\s*\{?/);
      if (ifaceMatch) {
        const name = ifaceMatch[1];
        const methods = [];
        let j = i + 1;
        while (j < this.lines.length) {
          const inner = this.lines[j].trim();
          if (inner.startsWith('}')) break;
          const methodMatch = inner.match(/^method\s+([a-zA-Z0-9_]+)/);
          if (methodMatch) methods.push(methodMatch[1]);
          j++;
        }
        this.doc.interfaces.push({
          name,
          methods,
          line: i + 1,
          description: parsedDoc.description,
          tags: parsedDoc.tags
        });
        currentDocstring = [];
        continue;
      }

      // Match: Class
      const classMatch = line.match(/^class\s+([a-zA-Z0-9_]+)(?:\s+extends\s+([a-zA-Z0-9_]+))?(?:\s+implements\s+([a-zA-Z0-9_,\s]+))?\s*\{?/);
      if (classMatch) {
        const name = classMatch[1];
        const extendsClass = classMatch[2] || null;
        const implementsInterfaces = classMatch[3] ? classMatch[3].split(',').map(s => s.trim()) : [];
        const classObj = {
          name,
          extends: extendsClass,
          implements: implementsInterfaces,
          line: i + 1,
          description: parsedDoc.description,
          tags: parsedDoc.tags,
          constructor: null,
          methods: [],
          properties: []
        };

        // Scan class body
        let j = i + 1;
        let cDepth = 1;
        let methodDoc = [];
        while (j < this.lines.length && cDepth > 0) {
          const mLine = this.lines[j].trim();
          if (mLine.startsWith('#')) {
            methodDoc.push(mLine.replace(/^#+\s?/, '').trim());
            j++;
            continue;
          }
          if (mLine.startsWith('{')) cDepth++;
          if (mLine.startsWith('}')) {
            cDepth--;
            if (cDepth === 0) break;
          }

          // Constructor
          const ctorMatch = mLine.match(/^constructor\s*\((.*?)\)/);
          if (ctorMatch) {
            classObj.constructor = {
              params: ctorMatch[1].split(',').map(s => s.trim()).filter(Boolean),
              doc: this.parseDocstring(methodDoc)
            };
            methodDoc = [];
          }

          // Method
          const fnMatch = mLine.match(/^(?:fn\s+|static\s+|async\s+)?([a-zA-Z0-9_]+)\s*\((.*?)\)\s*\{?/);
          if (fnMatch && !['if', 'for', 'while', 'catch', 'guard', 'switch', 'match', 'constructor', 'super', 'return', 'out', 'print'].includes(fnMatch[1])) {
            classObj.methods.push({
              name: fnMatch[1],
              params: fnMatch[2].split(',').map(s => s.trim()).filter(Boolean),
              isStatic: mLine.includes('static '),
              isAsync: mLine.includes('async '),
              doc: this.parseDocstring(methodDoc)
            });
            methodDoc = [];
          }

          // Property (#name or set this.#name)
          const propMatch = mLine.match(/^#([a-zA-Z0-9_]+);/);
          if (propMatch) {
            classObj.properties.push({ name: `#${propMatch[1]}`, isPrivate: true });
          }

          j++;
        }

        this.doc.classes.push(classObj);
        currentDocstring = [];
        continue;
      }

      // Match: Function
      const funcMatch = line.match(/^(?:async\s+)?fn\s+([a-zA-Z0-9_]+)\s*\((.*?)\)/);
      if (funcMatch) {
        const name = funcMatch[1];
        const rawParams = funcMatch[2];
        const params = rawParams.split(',').map(p => {
          const [pName, pDef] = p.split('=').map(s => s.trim());
          return { name: pName, default: pDef || null };
        }).filter(p => p.name);

        this.doc.functions.push({
          name,
          params,
          isAsync: line.startsWith('async'),
          line: i + 1,
          description: parsedDoc.description,
          tags: parsedDoc.tags,
          examples: parsedDoc.examples
        });
        currentDocstring = [];
        continue;
      }

      // Match: Constant / Export
      const constMatch = line.match(/^(?:const|set)\s+([a-zA-Z0-9_]+)\s*=\s*(.+)/);
      if (constMatch && currentDocstring.length > 0) {
        this.doc.constants.push({
          name: constMatch[1],
          value: constMatch[2].trim(),
          line: i + 1,
          description: parsedDoc.description
        });
        currentDocstring = [];
        continue;
      }

      currentDocstring = [];
    }

    return this.doc;
  }

  parseDocstring(lines) {
    let descLines = [];
    const tags = [];
    const examples = [];
    let inExample = false;
    let currentExample = [];

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      if (line.startsWith('@')) {
        inExample = false;
        const match = line.match(/^@([a-zA-Z0-9_]+)(?:\s+\{([^}]+)\})?(?:\s+([a-zA-Z0-9_]+))?(?:\s*-\s*|\s+)?(.*)/);
        if (match) {
          const tag = match[1].toLowerCase();
          const type = match[2] || 'any';
          const name = match[3] || '';
          const detail = match[4] || '';

          if (tag === 'example') {
            inExample = true;
            currentExample = detail ? [detail] : [];
            examples.push(currentExample);
          } else {
            tags.push({ tag, type, name, detail: (name + ' ' + detail).trim() });
          }
        }
      } else if (inExample) {
        currentExample.push(line);
      } else {
        descLines.push(line);
      }
    }

    return {
      description: descLines.join(' '),
      tags,
      examples: examples.map(e => e.join('\n'))
    };
  }
}

// ===============================================================
// 2. MARKDOWN GENERATOR
// ===============================================================
class WateMarkdownGenerator {
  static generate(docs, options = {}) {
    const title = options.title || 'WATE API Documentation';
    let md = `# ${title}\n\n`;
    md += `*Generated automatically by \`wate doc\` on ${new Date().toLocaleDateString()}*\n\n---\n\n`;

    // Table of Contents
    md += `## 📑 Table of Contents\n\n`;
    for (const doc of docs) {
      md += `### [${doc.file}](#${doc.file.toLowerCase().replace(/[^a-z0-9]/g, '-')})\n`;
      if (doc.classes.length > 0) {
        md += `- **Classes:** ` + doc.classes.map(c => `[\`${c.name}\`](#class-${c.name.toLowerCase()})`).join(', ') + `\n`;
      }
      if (doc.interfaces.length > 0) {
        md += `- **Interfaces:** ` + doc.interfaces.map(i => `[\`${i.name}\`](#interface-${i.name.toLowerCase()})`).join(', ') + `\n`;
      }
      if (doc.functions.length > 0) {
        md += `- **Functions:** ` + doc.functions.map(f => `[\`${f.name}()\`](#fn-${f.name.toLowerCase()})`).join(', ') + `\n`;
      }
      md += `\n`;
    }

    md += `---\n\n`;

    // Content per file
    for (const doc of docs) {
      md += `## 📄 \`${doc.file}\`\n\n`;
      if (doc.description) {
        md += `> ${doc.description}\n\n`;
      }

      // Interfaces
      if (doc.interfaces.length > 0) {
        md += `### 🧩 Interfaces\n\n`;
        for (const iface of doc.interfaces) {
          md += `#### <a id="interface-${iface.name.toLowerCase()}"></a> \`interface ${iface.name}\`\n\n`;
          if (iface.description) md += `${iface.description}\n\n`;
          md += `**Required Methods:**\n`;
          for (const m of iface.methods) {
            md += `- \`${m}\`\n`;
          }
          md += `\n`;
        }
      }

      // Classes
      if (doc.classes.length > 0) {
        md += `### 🏛️ Classes\n\n`;
        for (const cls of doc.classes) {
          let inheritInfo = '';
          if (cls.extends) inheritInfo += ` extends \`${cls.extends}\``;
          if (cls.implements.length > 0) inheritInfo += ` implements ${cls.implements.map(i => `\`${i}\``).join(', ')}`;

          md += `#### <a id="class-${cls.name.toLowerCase()}"></a> \`class ${cls.name}\`${inheritInfo}\n\n`;
          if (cls.description) md += `${cls.description}\n\n`;

          if (cls.properties.length > 0) {
            md += `**Properties:**\n`;
            for (const p of cls.properties) {
              md += `- \`${p.name}\` (private)\n`;
            }
            md += `\n`;
          }

          if (cls.methods.length > 0) {
            md += `**Methods:**\n\n`;
            for (const m of cls.methods) {
              const sig = `${m.isAsync ? 'async ' : ''}${m.isStatic ? 'static ' : ''}${m.name}(${m.params.join(', ')})`;
              md += `##### \`${sig}\`\n\n`;
              if (m.doc.description) md += `${m.doc.description}\n\n`;
            }
          }
        }
      }

      // Functions
      if (doc.functions.length > 0) {
        md += `### ⚡ Functions\n\n`;
        for (const fn of doc.functions) {
          const paramStr = fn.params.map(p => p.default ? `${p.name} = ${p.default}` : p.name).join(', ');
          md += `#### <a id="fn-${fn.name.toLowerCase()}"></a> \`${fn.isAsync ? 'async ' : ''}fn ${fn.name}(${paramStr})\`\n\n`;
          if (fn.description) md += `${fn.description}\n\n`;

          if (fn.params.length > 0) {
            md += `| Parameter | Default | Description |\n`;
            md += `|---|---|---|\n`;
            for (const p of fn.params) {
              const tag = fn.tags.find(t => t.name === p.name);
              md += `| \`${p.name}\` | \`${p.default || '-'}\` | ${tag ? tag.detail : '-'} |\n`;
            }
            md += `\n`;
          }

          if (fn.examples && fn.examples.length > 0) {
            md += `**Example:**\n\`\`\`wate\n${fn.examples.join('\n\n')}\n\`\`\`\n\n`;
          }
        }
      }

      md += `---\n\n`;
    }

    return md;
  }
}

// ===============================================================
// 3. RESPONSIVE HTML GENERATOR
// ===============================================================
class WateHTMLGenerator {
  static generate(docs, options = {}) {
    const title = options.title || 'WATE Documentation';

    // JSON serialization for search index
    const searchData = [];
    for (const doc of docs) {
      for (const fn of doc.functions) {
        searchData.push({ type: 'fn', name: fn.name, file: doc.file, desc: fn.description, id: `fn-${fn.name}` });
      }
      for (const cls of doc.classes) {
        searchData.push({ type: 'class', name: cls.name, file: doc.file, desc: cls.description, id: `class-${cls.name}` });
      }
      for (const iface of doc.interfaces) {
        searchData.push({ type: 'interface', name: iface.name, file: doc.file, desc: iface.description, id: `iface-${iface.name}` });
      }
    }

    let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --bg-surface: #0f172a;
      --bg-card: #131d35;
      --border: rgba(255, 255, 255, 0.08);
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --accent: #06b6d4;
      --accent-purple: #8b5cf6;
      --accent-green: #10b981;
      --code-bg: #070a12;
      --font: 'Plus Jakarta Sans', system-ui, sans-serif;
      --mono: 'Fira Code', monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--font);
      background: var(--bg);
      color: var(--text);
      display: flex;
      height: 100vh;
      overflow: hidden;
    }
    /* Sidebar */
    .sidebar {
      width: 290px;
      background: var(--bg-surface);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
    }
    .sidebar-header {
      padding: 1.25rem 1rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .logo-badge {
      background: linear-gradient(135deg, var(--accent), var(--accent-purple));
      width: 32px; height: 32px;
      border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      font-size: 1.1rem;
    }
    .sidebar-header h2 {
      font-size: 1rem;
      font-weight: 700;
    }
    .search-box {
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--border);
    }
    .search-box input {
      width: 100%;
      background: rgba(255,255,255,0.05);
      border: 1px solid var(--border);
      color: #fff;
      padding: 0.5rem 0.75rem;
      border-radius: 6px;
      font-family: var(--font);
      font-size: 0.85rem;
      outline: none;
    }
    .sidebar-nav {
      flex: 1;
      overflow-y: auto;
      padding: 1rem 0.5rem;
    }
    .nav-group-title {
      font-size: 0.7rem;
      font-weight: 700;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 0.5rem 0.75rem 0.25rem;
    }
    .nav-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.45rem 0.75rem;
      border-radius: 6px;
      color: #cbd5e1;
      text-decoration: none;
      font-size: 0.85rem;
      transition: all 0.15s;
    }
    .nav-item:hover {
      background: rgba(255,255,255,0.06);
      color: #fff;
    }
    .badge-tag {
      font-size: 0.65rem;
      padding: 1px 5px;
      border-radius: 4px;
      font-family: var(--mono);
      font-weight: 600;
    }
    .tag-fn { background: rgba(6, 182, 212, 0.15); color: var(--accent); }
    .tag-class { background: rgba(139, 92, 246, 0.15); color: var(--accent-purple); }
    .tag-interface { background: rgba(16, 185, 129, 0.15); color: var(--accent-green); }

    /* Main Content */
    .content {
      flex: 1;
      overflow-y: auto;
      padding: 2.5rem 3rem;
    }
    .content-header {
      margin-bottom: 2.5rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 1.5rem;
    }
    .content-header h1 {
      font-size: 2rem;
      font-weight: 800;
      margin-bottom: 0.5rem;
    }
    .content-header p {
      color: var(--text-muted);
      font-size: 0.95rem;
    }

    /* Cards */
    .doc-card {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 2rem;
      scroll-margin-top: 2rem;
    }
    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1rem;
    }
    .signature {
      font-family: var(--mono);
      font-size: 1.05rem;
      font-weight: 600;
      color: #fff;
    }
    .signature .kw { color: var(--accent); }
    .signature .fn-name { color: #facc15; }
    .signature .class-name { color: #a78bfa; }
    .description {
      color: #cbd5e1;
      font-size: 0.92rem;
      line-height: 1.6;
      margin-bottom: 1rem;
    }

    /* Parameter Tables */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 1rem 0;
      font-size: 0.88rem;
    }
    th {
      text-align: left;
      padding: 0.6rem 0.75rem;
      background: rgba(255,255,255,0.03);
      border-bottom: 1px solid var(--border);
      color: var(--text-muted);
      font-weight: 600;
    }
    td {
      padding: 0.6rem 0.75rem;
      border-bottom: 1px solid var(--border);
    }
    code {
      font-family: var(--mono);
      background: var(--code-bg);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.85em;
      color: var(--accent);
    }
    pre {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem;
      font-family: var(--mono);
      font-size: 0.85rem;
      overflow-x: auto;
      color: #e2e8f0;
      margin: 0.75rem 0;
    }
  </style>
</head>
<body>

  <!-- Left Sidebar -->
  <aside class="sidebar">
    <div class="sidebar-header">
      <div class="logo-badge">⚡</div>
      <div>
        <h2>${title}</h2>
      </div>
    </div>
    <div class="search-box">
      <input id="searchInput" type="text" placeholder="Search symbols..." autocomplete="off">
    </div>
    <nav id="sidebarNav" class="sidebar-nav">
`;

    // Sidebar items
    for (const doc of docs) {
      html += `<div class="nav-group-title">📄 ${doc.file}</div>\n`;
      for (const cls of doc.classes) {
        html += `<a class="nav-item" href="#class-${cls.name}" data-name="${cls.name.toLowerCase()}"><span class="badge-tag tag-class">CLASS</span> ${cls.name}</a>\n`;
      }
      for (const iface of doc.interfaces) {
        html += `<a class="nav-item" href="#iface-${iface.name}" data-name="${iface.name.toLowerCase()}"><span class="badge-tag tag-interface">IFACE</span> ${iface.name}</a>\n`;
      }
      for (const fn of doc.functions) {
        html += `<a class="nav-item" href="#fn-${fn.name}" data-name="${fn.name.toLowerCase()}"><span class="badge-tag tag-fn">FN</span> ${fn.name}()</a>\n`;
      }
    }

    html += `    </nav>
  </aside>

  <!-- Main Content Area -->
  <main class="content">
    <div class="content-header">
      <h1>${title}</h1>
      <p>Automated API Reference Documentation generated for WATE programming language.</p>
    </div>
`;

    // Detailed Content
    for (const doc of docs) {
      html += `<h2 style="margin: 2rem 0 1rem; color: #94a3b8; font-size: 1.1rem;">File: ${doc.file}</h2>\n`;

      // Interfaces
      for (const iface of doc.interfaces) {
        html += `
        <article id="iface-${iface.name}" class="doc-card">
          <div class="card-header">
            <div class="signature"><span class="kw">interface</span> <span class="class-name">${iface.name}</span></div>
            <span class="badge-tag tag-interface">INTERFACE</span>
          </div>
          ${iface.description ? `<div class="description">${iface.description}</div>` : ''}
          <div style="font-weight:600; font-size:0.85rem; color:#94a3b8; margin-top:0.75rem;">Required Interface Methods:</div>
          <ul style="margin: 0.5rem 1.5rem; font-size:0.9rem;">
            ${iface.methods.map(m => `<li><code>method ${m}</code></li>`).join('')}
          </ul>
        </article>
        `;
      }

      // Classes
      for (const cls of doc.classes) {
        let inherits = '';
        if (cls.extends) inherits += ` <span class="kw">extends</span> ${cls.extends}`;
        if (cls.implements.length > 0) inherits += ` <span class="kw">implements</span> ${cls.implements.join(', ')}`;

        html += `
        <article id="class-${cls.name}" class="doc-card">
          <div class="card-header">
            <div class="signature"><span class="kw">class</span> <span class="class-name">${cls.name}</span>${inherits}</div>
            <span class="badge-tag tag-class">CLASS</span>
          </div>
          ${cls.description ? `<div class="description">${cls.description}</div>` : ''}
          ${cls.properties.length > 0 ? `
            <div style="font-weight:600; font-size:0.85rem; color:#94a3b8; margin-top:0.75rem;">Properties:</div>
            <ul style="margin: 0.5rem 1.5rem; font-size:0.9rem;">
              ${cls.properties.map(p => `<li><code>${p.name}</code> (private)</li>`).join('')}
            </ul>
          ` : ''}
          ${cls.methods.length > 0 ? `
            <div style="font-weight:600; font-size:0.85rem; color:#94a3b8; margin-top:1rem;">Methods:</div>
            ${cls.methods.map(m => `
              <div style="margin-top:0.75rem; padding:0.75rem; background:rgba(0,0,0,0.2); border-radius:6px;">
                <div style="font-family:var(--mono); font-size:0.9rem; color:#facc15;">
                  ${m.isAsync ? 'async ' : ''}${m.isStatic ? 'static ' : ''}${m.name}(${m.params.join(', ')})
                </div>
                ${m.doc.description ? `<p style="font-size:0.85rem; color:#cbd5e1; margin-top:0.25rem;">${m.doc.description}</p>` : ''}
              </div>
            `).join('')}
          ` : ''}
        </article>
        `;
      }

      // Functions
      for (const fn of doc.functions) {
        const paramStr = fn.params.map(p => p.default ? `${p.name} = ${p.default}` : p.name).join(', ');
        html += `
        <article id="fn-${fn.name}" class="doc-card">
          <div class="card-header">
            <div class="signature">
              ${fn.isAsync ? '<span class="kw">async </span>' : ''}<span class="kw">fn</span> <span class="fn-name">${fn.name}</span>(${paramStr})
            </div>
            <span class="badge-tag tag-fn">FUNCTION</span>
          </div>
          ${fn.description ? `<div class="description">${fn.description}</div>` : ''}
          ${fn.params.length > 0 ? `
            <table>
              <thead>
                <tr><th>Parameter</th><th>Default</th><th>Description</th></tr>
              </thead>
              <tbody>
                ${fn.params.map(p => {
                  const tag = fn.tags.find(t => t.name === p.name);
                  return `<tr><td><code>${p.name}</code></td><td><code>${p.default || '-'}</code></td><td>${tag ? tag.detail : '-'}</td></tr>`;
                }).join('')}
              </tbody>
            </table>
          ` : ''}
          ${fn.examples && fn.examples.length > 0 ? `
            <div style="font-weight:600; font-size:0.85rem; color:#94a3b8; margin-top:0.75rem;">Example:</div>
            <pre>${fn.examples.join('\n\n')}</pre>
          ` : ''}
        </article>
        `;
      }
    }

    html += `
  </main>

  <script>
    // Live Search Filter
    const searchInput = document.getElementById('searchInput');
    const navItems = document.querySelectorAll('.nav-item');

    searchInput.addEventListener('input', () => {
      const q = searchInput.value.toLowerCase().trim();
      navItems.forEach(item => {
        const name = item.getAttribute('data-name') || '';
        item.style.display = (!q || name.includes(q)) ? 'flex' : 'none';
      });
    });
  </script>
</body>
</html>
`;

    return html;
  }
}

// ===============================================================
// 4. MAIN CLI DRIVER
// ===============================================================
function runDocGenerator(target, options = {}) {
  const resolvedTarget = path.resolve(target || '.');
  let filesToProcess = [];

  if (fs.existsSync(resolvedTarget) && fs.statSync(resolvedTarget).isFile()) {
    filesToProcess = [resolvedTarget];
  } else {
    // Collect recursively
    function collectWateFiles(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.name.startsWith('.') || ent.name === 'node_modules' || ent.name === 'wate_packages' || ent.name === 'dist') continue;
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          collectWateFiles(full);
        } else if (ent.isFile() && ent.name.endsWith('.wate')) {
          filesToProcess.push(full);
        }
      }
    }
    collectWateFiles(resolvedTarget);
  }

  if (filesToProcess.length === 0) {
    console.error('\x1b[33m⚠  No .wate files found to generate documentation for.\x1b[0m');
    process.exit(1);
  }

  console.log(`\n\x1b[1m\x1b[36m⚡ WATE Documentation Generator\x1b[0m`);
  console.log(`\x1b[90mScanning ${filesToProcess.length} file(s)...\x1b[0m\n`);

  const allDocs = [];
  for (const fp of filesToProcess) {
    const extractor = new WateDocExtractor(fp);
    const doc = extractor.extract();
    allDocs.push(doc);
    console.log(`  📄 \x1b[32m${path.basename(fp)}\x1b[0m (${doc.functions.length} fns, ${doc.classes.length} classes, ${doc.interfaces.length} ifaces)`);
  }

  const outDir = path.resolve(options.out || 'docs');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const format = (options.format || 'html').toLowerCase();
  const shouldGenHtml = format === 'html' || format === 'all';
  const shouldGenMd = format === 'md' || format === 'all';

  if (shouldGenMd) {
    const md = WateMarkdownGenerator.generate(allDocs, options);
    const mdPath = path.join(outDir, 'API.md');
    fs.writeFileSync(mdPath, md, 'utf-8');
    console.log(`\n  \x1b[32m✔\x1b[0m Markdown Reference saved: \x1b[33m${mdPath}\x1b[0m`);
  }

  if (shouldGenHtml) {
    const html = WateHTMLGenerator.generate(allDocs, options);
    const htmlPath = path.join(outDir, 'index.html');
    fs.writeFileSync(htmlPath, html, 'utf-8');
    console.log(`  \x1b[32m✔\x1b[0m HTML Site saved: \x1b[33m${htmlPath}\x1b[0m`);
  }

  if (options.serve) {
    const port = options.port || 3300;
    const server = http.createServer((req, res) => {
      const filePath = path.join(outDir, 'index.html');
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(500);
          res.end('Error loading documentation.');
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(data);
        }
      });
    });

    server.listen(port, () => {
      console.log(`\n\x1b[36m🌐 Documentation Server running at:\x1b[0m \x1b[32mhttp://localhost:${port}\x1b[0m`);
      console.log(`\x1b[90mPress Ctrl+C to stop.\x1b[0m\n`);

      // Open in browser
      const { exec } = require('child_process');
      const startCmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      exec(`${startCmd} http://localhost:${port}`);
    });
  } else {
    console.log(`\n\x1b[32m\x1b[1m🏆 Documentation generation completed!\x1b[0m\n`);
  }
}

// CLI Execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const target = args.find(a => !a.startsWith('--'));

  let format = 'html';
  let outDir = 'docs';
  let title = 'WATE Project Documentation';
  let serve = args.includes('--serve') || args.includes('-s');

  for (const a of args) {
    if (a.startsWith('--format=')) format = a.split('=')[1];
    if (a.startsWith('--out=')) outDir = a.split('=')[1];
    if (a.startsWith('--title=')) title = a.split('=')[1];
  }

  runDocGenerator(target, { format, out: outDir, title, serve });
}

module.exports = {
  WateDocExtractor,
  WateMarkdownGenerator,
  WateHTMLGenerator,
  runDocGenerator
};

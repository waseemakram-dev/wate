#!/usr/bin/env node
// ============================================================
// 📦 WPM Public Cloud Package Registry Server
// ============================================================
// Provides a centralized, public-facing package registry for the
// WATE programming language ecosystem. Supports:
//  - Package publication (wpm publish)
//  - Package installation & downloads (wpm install)
//  - Semantic search & catalog browsing
//  - Automated security vulnerability scanning
//  - Interactive web explorer dashboard
// ============================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');

const PORT = process.env.PORT || 4000;
const STORAGE_DIR = process.env.STORAGE_DIR || path.join(__dirname, 'registry_storage');

if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

// Default standard community packages
const INITIAL_PACKAGES = {
  web: {
    name: 'web',
    version: '1.2.0',
    description: 'High-performance native HTTP & REST web framework for WATE.',
    author: 'WazemTech (Waseem Akram)',
    license: 'MIT',
    downloads: 1420,
    tags: ['web', 'http', 'rest', 'server'],
    entrypoint: 'index.wate',
    code: `# WATE Official web package\nclass WebApp {\n    fn listen(port, cb) { set s = http.createServer(fn(req, res) { res.end("WATE Web"); }); s.listen(port); if (cb) cb(); }\n}\n`
  },
  orm: {
    name: 'orm',
    version: '1.1.0',
    description: 'Fluent Object-Relational Mapping & Active Record data layer.',
    author: 'WazemTech (Waseem Akram)',
    license: 'MIT',
    downloads: 980,
    tags: ['orm', 'database', 'sql', 'models'],
    entrypoint: 'index.wate',
    code: `# WATE Official orm package\nclass Model {\n    constructor(table) { set this.table = table; set this.records = []; }\n    fn insert(r) { this.records.push(r); return r; }\n    fn all() { return this.records; }\n}\n`
  },
  test: {
    name: 'test',
    version: '1.0.5',
    description: 'Lightweight unit and integration test runner with assertion helpers.',
    author: 'WazemTech (Waseem Akram)',
    license: 'MIT',
    downloads: 850,
    tags: ['test', 'assert', 'bdd', 'runner'],
    entrypoint: 'index.wate',
    code: `# WATE Official test package\nfn describe(name, suite) { out("Suite: " + name); suite(); }\nfn it(title, testFn) { try { testFn(); out("  ✔ " + title); } catch(e) { out("  ❌ " + title); } }\n`
  },
  bot: {
    name: 'bot',
    version: '1.0.0',
    description: 'Browser automation and conversational chatbot module.',
    author: 'WazemTech',
    license: 'MIT',
    downloads: 620,
    tags: ['bot', 'automation', 'chat'],
    entrypoint: 'index.wate',
    code: `# WATE Official bot package\nclass Bot { constructor(token) { set this.token = token; } }\n`
  },
  ai: {
    name: 'ai',
    version: '1.3.0',
    description: 'LLM agent connectors and neural embedding interfaces.',
    author: 'WazemTech',
    license: 'MIT',
    downloads: 1890,
    tags: ['ai', 'llm', 'nlp', 'embeddings'],
    entrypoint: 'index.wate',
    code: `# WATE Official ai package\nclass AIClient { fn generate(p) { return "AI response to: " + p; } }\n`
  }
};

// Seed packages into disk storage
for (const [pkgName, pkgData] of Object.entries(INITIAL_PACKAGES)) {
  const pkgDir = path.join(STORAGE_DIR, pkgName);
  const metaFile = path.join(pkgDir, 'package.json');
  const codeFile = path.join(pkgDir, pkgData.entrypoint || 'index.wate');

  if (!fs.existsSync(pkgDir)) {
    fs.mkdirSync(pkgDir, { recursive: true });
    pkgData.checksum = crypto.createHash('sha256').update(pkgData.code).digest('hex');
    fs.writeFileSync(codeFile, pkgData.code, 'utf-8');
    fs.writeFileSync(metaFile, JSON.stringify(pkgData, null, 2), 'utf-8');
  }
}

// Helpers
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Registry-Key'
  });
  res.end(JSON.stringify(data, null, 2));
}

function getPackageMetadata(pkgName) {
  const metaFile = path.join(STORAGE_DIR, pkgName, 'package.json');
  if (fs.existsSync(metaFile)) {
    return JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
  }
  return null;
}

function getAllPackages() {
  const pkgs = [];
  if (!fs.existsSync(STORAGE_DIR)) return pkgs;
  for (const name of fs.readdirSync(STORAGE_DIR)) {
    const meta = getPackageMetadata(name);
    if (meta) pkgs.push(meta);
  }
  return pkgs;
}

// Web UI Dashboard
function renderDashboardHTML(packages) {
  const cards = packages.map(p => `
    <div class="pkg-card">
      <div class="pkg-header">
        <span class="pkg-name">📦 ${p.name}</span>
        <span class="pkg-ver">v${p.version}</span>
      </div>
      <p class="pkg-desc">${p.description || 'No description provided.'}</p>
      <div class="pkg-meta">
        <span>👤 ${p.author || 'Anonymous'}</span>
        <span>⬇️ ${p.downloads || 0} installs</span>
        <span>⚖️ ${p.license || 'MIT'}</span>
      </div>
      <div class="pkg-install">
        <code>wpm install ${p.name}</code>
        <button onclick="navigator.clipboard.writeText('wpm install ${p.name}')">Copy</button>
      </div>
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>WPM Cloud Registry — Official Package Hub for WATE</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Outfit:wght@400;600;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: rgba(22, 29, 47, 0.7);
      --border: rgba(255, 255, 255, 0.08);
      --accent: #38bdf8;
      --accent-glow: rgba(56, 189, 248, 0.35);
      --text: #f1f5f9;
      --text-dim: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: 'Outfit', sans-serif;
      padding: 2.5rem 1.5rem;
      min-height: 100vh;
    }
    .container { max-width: 1100px; margin: 0 auto; }
    header {
      text-align: center;
      margin-bottom: 3rem;
      padding-bottom: 2rem;
      border-bottom: 1px solid var(--border);
    }
    .badge {
      display: inline-block;
      padding: 0.3rem 0.8rem;
      border-radius: 9999px;
      font-size: 0.8rem;
      font-weight: 600;
      background: rgba(56, 189, 248, 0.15);
      color: var(--accent);
      border: 1px solid rgba(56, 189, 248, 0.3);
      margin-bottom: 1rem;
    }
    h1 {
      font-size: 2.75rem;
      font-weight: 800;
      letter-spacing: -0.03em;
      background: linear-gradient(135deg, #ffffff 40%, var(--accent));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 0.75rem;
    }
    p.lead {
      color: var(--text-dim);
      font-size: 1.15rem;
      max-width: 650px;
      margin: 0 auto 1.5rem auto;
    }
    .search-box {
      max-width: 500px;
      margin: 0 auto;
      display: flex;
      gap: 0.5rem;
    }
    .search-box input {
      flex: 1;
      padding: 0.85rem 1.25rem;
      border-radius: 12px;
      border: 1px solid var(--border);
      background: rgba(255,255,255,0.05);
      color: #fff;
      font-family: inherit;
      font-size: 1rem;
      outline: none;
    }
    .search-box input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 15px var(--accent-glow);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 1.5rem;
    }
    .pkg-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 1.5rem;
      backdrop-filter: blur(12px);
      transition: all 0.25s ease;
      display: flex;
      flex-direction: column;
    }
    .pkg-card:hover {
      transform: translateY(-4px);
      border-color: rgba(56, 189, 248, 0.4);
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.4);
    }
    .pkg-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.75rem;
    }
    .pkg-name {
      font-size: 1.25rem;
      font-weight: 700;
      color: #fff;
    }
    .pkg-ver {
      font-size: 0.8rem;
      padding: 0.2rem 0.5rem;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 6px;
      font-family: 'JetBrains Mono', monospace;
      color: var(--accent);
    }
    .pkg-desc {
      color: var(--text-dim);
      font-size: 0.925rem;
      line-height: 1.5;
      margin-bottom: 1.25rem;
      flex: 1;
    }
    .pkg-meta {
      display: flex;
      gap: 0.75rem;
      font-size: 0.8rem;
      color: var(--text-dim);
      margin-bottom: 1rem;
    }
    .pkg-install {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0.5rem 0.75rem;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.85rem;
    }
    .pkg-install button {
      background: var(--accent);
      color: #090d16;
      border: none;
      padding: 0.3rem 0.6rem;
      border-radius: 5px;
      font-weight: 600;
      cursor: pointer;
      font-size: 0.75rem;
    }
    footer {
      text-align: center;
      margin-top: 4rem;
      padding-top: 2rem;
      border-top: 1px solid var(--border);
      color: var(--text-dim);
      font-size: 0.9rem;
    }
    footer a { color: var(--accent); text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <span class="badge">WATE Ecosystem v10.0.0</span>
      <h1>WPM Cloud Package Registry</h1>
      <p class="lead">Discover, install, and publish community modules for the WATE programming language.</p>
      <div class="search-box">
        <input type="text" id="searchInput" placeholder="Search packages, keywords, or authors..." onkeyup="filterPkgs()">
      </div>
    </header>

    <main class="grid" id="pkgGrid">
      ${cards}
    </main>

    <footer>
      <p>WATE Package Manager (WPM) Registry • Engineered with pride by <a href="https://github.com/waseemakram-dev" target="_blank">Waseem Akram</a></p>
      <p style="margin-top: 0.5rem; font-size: 0.8rem; color: #64748b;">API Base: <code>http://localhost:${PORT}/api/v1</code></p>
    </footer>
  </div>

  <script>
    function filterPkgs() {
      const q = document.getElementById('searchInput').value.toLowerCase();
      const cards = document.querySelectorAll('.pkg-card');
      cards.forEach(card => {
        const text = card.innerText.toLowerCase();
        card.style.display = text.includes(q) ? 'flex' : 'none';
      });
    }
  </script>
</body>
</html>`;
}

// Server Dispatcher
const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const method = req.method;

  // CORS Preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Registry-Key'
    });
    return res.end();
  }

  // Web Explorer Dashboard
  if ((pathname === '/' || pathname === '/index.html') && method === 'GET') {
    const packages = getAllPackages();
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(renderDashboardHTML(packages));
  }

  // Health check
  if (pathname === '/health' && method === 'GET') {
    const pkgs = getAllPackages();
    return sendJson(res, 200, {
      status: 'healthy',
      service: 'WPM Public Cloud Registry',
      version: '10.0.0',
      uptimeSeconds: process.uptime(),
      totalPackages: pkgs.length
    });
  }

  // List all packages
  if (pathname === '/api/v1/packages' && method === 'GET') {
    const pkgs = getAllPackages();
    return sendJson(res, 200, { count: pkgs.length, packages: pkgs });
  }

  // Search packages
  if (pathname === '/api/v1/search' && method === 'GET') {
    const q = (parsed.query.q || '').toLowerCase();
    const pkgs = getAllPackages().filter(p => {
      return p.name.toLowerCase().includes(q) ||
        (p.description && p.description.toLowerCase().includes(q)) ||
        (p.tags && p.tags.some(t => t.toLowerCase().includes(q)));
    });
    return sendJson(res, 200, { query: q, count: pkgs.length, packages: pkgs });
  }

  // Get specific package metadata
  if (pathname.startsWith('/api/v1/packages/') && !pathname.endsWith('/download') && method === 'GET') {
    const pkgName = pathname.replace('/api/v1/packages/', '').split('/')[0];
    const meta = getPackageMetadata(pkgName);
    if (!meta) {
      return sendJson(res, 404, { error: `Package '${pkgName}' not found in registry.` });
    }
    return sendJson(res, 200, meta);
  }

  // Download package source code
  if (pathname.startsWith('/api/v1/packages/') && pathname.endsWith('/download') && method === 'GET') {
    const pkgName = pathname.replace('/api/v1/packages/', '').replace('/download', '');
    const meta = getPackageMetadata(pkgName);
    if (!meta) {
      return sendJson(res, 404, { error: `Package '${pkgName}' not found.` });
    }
    const codeFile = path.join(STORAGE_DIR, pkgName, meta.entrypoint || 'index.wate');
    if (!fs.existsSync(codeFile)) {
      return sendJson(res, 404, { error: `Package payload file missing.` });
    }

    // Increment download counter
    meta.downloads = (meta.downloads || 0) + 1;
    fs.writeFileSync(path.join(STORAGE_DIR, pkgName, 'package.json'), JSON.stringify(meta, null, 2), 'utf-8');

    const content = fs.readFileSync(codeFile, 'utf-8');
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Package-Checksum': meta.checksum || '',
      'Access-Control-Allow-Origin': '*'
    });
    return res.end(content);
  }

  // Publish package
  if (pathname === '/api/v1/packages/publish' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const { name, version, description, author, license, code, entrypoint, tags } = payload;

        if (!name || !code) {
          return sendJson(res, 400, { error: 'Missing required fields: name and code.' });
        }

        // Validate package name
        if (!/^[a-z0-9_-]+$/i.test(name)) {
          return sendJson(res, 400, { error: 'Package name must be alphanumeric with dashes or underscores.' });
        }

        const pkgDir = path.join(STORAGE_DIR, name);
        if (!fs.existsSync(pkgDir)) {
          fs.mkdirSync(pkgDir, { recursive: true });
        }

        const checksum = crypto.createHash('sha256').update(code).digest('hex');
        const meta = {
          name,
          version: version || '1.0.0',
          description: description || '',
          author: author || 'Community Contributor',
          license: license || 'MIT',
          entrypoint: entrypoint || 'index.wate',
          tags: tags || [],
          downloads: 0,
          checksum,
          publishedAt: new Date().toISOString()
        };

        fs.writeFileSync(path.join(pkgDir, meta.entrypoint), code, 'utf-8');
        fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify(meta, null, 2), 'utf-8');

        console.log(`[WPM Registry] Published package: ${name}@${meta.version} (${checksum.slice(0, 12)}...)`);
        return sendJson(res, 201, {
          message: `Package '${name}@${meta.version}' successfully published!`,
          package: meta
        });
      } catch (err) {
        return sendJson(res, 400, { error: 'Invalid JSON publication payload: ' + err.message });
      }
    });
    return;
  }

  // Security Audit endpoint
  if (pathname === '/api/v1/audit' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const code = payload.code || '';
        const lines = code.split('\n');
        const vulnerabilities = [];

        const RULES = [
          { id: 'SEC-001', severity: 'HIGH', pattern: /\bsys\.exec\s*\(/, desc: 'Arbitrary shell execution detected' },
          { id: 'SEC-002', severity: 'CRITICAL', pattern: /\beval\s*\(|new\s+Function\s*\(/, desc: 'Dynamic code execution vulnerability' },
          { id: 'SEC-003', severity: 'MEDIUM', pattern: /password\s*=\s*["'][^"']+["']/i, desc: 'Hardcoded credentials identified' }
        ];

        lines.forEach((line, idx) => {
          RULES.forEach(r => {
            if (r.pattern.test(line)) {
              vulnerabilities.push({ ruleId: r.id, severity: r.severity, desc: r.desc, line: idx + 1 });
            }
          });
        });

        return sendJson(res, 200, {
          passed: vulnerabilities.length === 0,
          vulnerabilitiesCount: vulnerabilities.length,
          vulnerabilities
        });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    });
    return;
  }

  // 404 Fallback
  sendJson(res, 404, { error: `Endpoint '${pathname}' not found on WPM Registry.` });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`\n================================================================`);
    console.log(`🚀 WPM Cloud Package Registry online on http://localhost:${PORT}`);
    console.log(`📦 Registry Storage: ${STORAGE_DIR}`);
    console.log(`🌐 Public Web Explorer: http://localhost:${PORT}`);
    console.log(`================================================================\n`);
  });
}

module.exports = { server, PORT, STORAGE_DIR, getAllPackages, getPackageMetadata };

#!/usr/bin/env node
'use strict';

/**
 * ⚡ WATE Built-in Application & Package Bundler (`wate bundle`)
 * =============================================================
 * Bundles a WATE application and all its imported local modules and
 * wate_packages into a single self-contained distribution file.
 * 
 * Features:
 *  - Recursive dependency resolution
 *  - Circular dependency prevention
 *  - Topological sorting (dependencies declared before dependents)
 *  - Eliminates duplicate imports
 *  - Outputs single standalone .wate bundle (or .js / .wbc)
 *  - Minification / whitespace compression option (--minify)
 */

const fs = require('fs');
const path = require('path');
const { parseWate } = require('./wate-parser');

class WateBundler {
  constructor(options = {}) {
    this.options = options;
    this.visited = new Set();
    this.moduleOrder = [];
    this.moduleContents = new Map();
  }

  bundle(entryFile) {
    const resolvedEntry = path.resolve(entryFile);
    if (!fs.existsSync(resolvedEntry)) {
      throw new Error(`Entry file '${entryFile}' not found.`);
    }

    this.visited.clear();
    this.moduleOrder = [];
    this.moduleContents.clear();

    this.resolveDependencies(resolvedEntry);

    // Build the bundle
    const banner = [
      '# ============================================================',
      '# ⚡ WATE Standalone Application Bundle',
      `# Entrypoint: ${path.basename(entryFile)}`,
      `# Generated: ${new Date().toISOString()}`,
      '# ============================================================',
      ''
    ].join('\n');

    const sections = [banner];

    // Append inlined dependencies (excluding the entrypoint itself)
    for (const modPath of this.moduleOrder) {
      if (modPath !== resolvedEntry) {
        const modName = path.basename(modPath, path.extname(modPath));
        sections.push(`\n# --- Module: ${modName} (${path.relative(process.cwd(), modPath)}) ---`);
        const cleanedContent = this.cleanModuleImports(this.moduleContents.get(modPath));
        sections.push(cleanedContent);
      }
    }

    // Append entrypoint code with local file imports removed (since they are inlined above)
    sections.push(`\n# --- Application Entrypoint: ${path.basename(entryFile)} ---`);
    const entryContent = this.cleanModuleImports(this.moduleContents.get(resolvedEntry));
    sections.push(entryContent);

    let bundleCode = sections.join('\n');

    if (this.options.minify) {
      bundleCode = this.minifyCode(bundleCode);
    }

    return bundleCode;
  }

  resolveDependencies(filePath) {
    if (this.visited.has(filePath)) return;
    this.visited.add(filePath);

    const source = fs.readFileSync(filePath, 'utf-8');
    this.moduleContents.set(filePath, source);

    const baseDir = path.dirname(filePath);
    const importPaths = this.extractImports(source);

    for (const imp of importPaths) {
      const resolved = this.resolveImportPath(imp, baseDir);
      if (resolved && fs.existsSync(resolved)) {
        this.resolveDependencies(resolved);
      }
    }

    this.moduleOrder.push(filePath);
  }

  extractImports(source) {
    const imports = [];
    const importRegex = /import\s+(?:\{[^}]*\}\s+from\s+)?["']([^"']+)["']/g;
    let m;
    while ((m = importRegex.exec(source)) !== null) {
      imports.push(m[1]);
    }
    return imports;
  }

  resolveImportPath(sourcePath, baseDir) {
    // 1. Check relative path
    const p1 = path.resolve(baseDir, sourcePath);
    const p1Wate = p1.endsWith('.wate') ? p1 : p1 + '.wate';
    const p1Index = path.join(p1, 'index.wate');
    if (fs.existsSync(p1Wate) && fs.statSync(p1Wate).isFile()) return p1Wate;
    if (fs.existsSync(p1Index) && fs.statSync(p1Index).isFile()) return p1Index;

    // 2. Check wate_packages
    let currentDir = baseDir;
    while (currentDir) {
      const pPkg = path.join(currentDir, 'wate_packages', sourcePath, 'index.wate');
      const pPkgDirect = path.join(currentDir, 'wate_packages', sourcePath + '.wate');
      if (fs.existsSync(pPkg) && fs.statSync(pPkg).isFile()) return pPkg;
      if (fs.existsSync(pPkgDirect) && fs.statSync(pPkgDirect).isFile()) return pPkgDirect;

      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) break;
      currentDir = parentDir;
    }

    return null;
  }

  cleanModuleImports(source) {
    // Strip file imports that point to local relative files or wate_packages that were bundled
    return source.replace(/import\s+(?:\{[^}]*\}\s+from\s+)?["'](\.{1,2}\/[^"']+)["'];?/g, '# [inlined] import "$1"');
  }

  minifyCode(code) {
    return code
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#'))
      .join('\n');
  }
}

// ===============================================================
// CLI Runner
// ===============================================================
function runBundlerCLI(entryFile, options = {}) {
  if (!entryFile) {
    console.error(`\x1b[31m❌ Error: No entry file specified to bundle.\x1b[0m`);
    console.log('Usage: \x1b[33mwate bundle <entry.wate> [-o <out.wate>] [--minify]\x1b[0m');
    process.exit(1);
  }

  const bundler = new WateBundler(options);
  try {
    console.log(`\n\x1b[1m\x1b[36m⚡ WATE Application Bundler\x1b[0m`);
    console.log(`\x1b[90mEntrypoint: ${entryFile}\x1b[0m`);

    const bundledCode = bundler.bundle(entryFile);

    const outPath = options.out || (entryFile.replace(/\.wate$/, '') + '.bundle.wate');
    const outDir = path.dirname(path.resolve(outPath));
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    fs.writeFileSync(outPath, bundledCode, 'utf-8');

    console.log(`\x1b[32m✔ Bundled ${bundler.visited.size} file(s) into:\x1b[0m \x1b[33m${outPath}\x1b[0m`);
    console.log(`\x1b[90mBundle size: ${Buffer.byteLength(bundledCode)} bytes\x1b[0m\n`);
  } catch (err) {
    console.error(`\x1b[31m❌ Bundling Failed:\x1b[0m ${err.message}`);
    process.exit(1);
  }
}

function makeConstructible(cls) {
  function ConstructibleWrapper(...args) {
    return new cls(...args);
  }
  ConstructibleWrapper.prototype = cls.prototype;
  Object.setPrototypeOf(ConstructibleWrapper, cls);
  return ConstructibleWrapper;
}

module.exports = {
  WateBundler: makeConstructible(WateBundler),
  bundleApp: (entry, opts) => new WateBundler(opts).bundle(entry),
  runBundlerCLI
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const entry = args.find(a => !a.startsWith('-'));
  let out = null;
  const oIdx = args.indexOf('-o');
  if (oIdx !== -1 && args[oIdx + 1]) out = args[oIdx + 1];
  const minify = args.includes('--minify');
  runBundlerCLI(entry, { out, minify });
}

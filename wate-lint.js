#!/usr/bin/env node
'use strict';

/**
 * ⚡ WATE Built-in Syntax & Style Linter (`wate lint`)
 * ===================================================
 * Static code analyzer and style checker for WATE scripts.
 * 
 * Rules:
 *  - no-unused-vars: Flag declared variables that are never read (ignores `_` prefix)
 *  - no-unused-funcs: Flag functions that are never called
 *  - no-unused-imports: Flag imported modules/symbols that are never referenced
 *  - no-unreachable: Flag dead code statements after return/throw/break/continue
 *  - naming-convention: PascalCase for Classes/Enums, camelCase/snake_case for vars/funcs, UPPER_CASE for const
 *  - no-empty-block: Warn on empty blocks without statements or explanations
 *  - no-shadowing: Alert when local variable shadows an existing outer scope variable
 *  - no-self-assign: Alert on redundant `x = x` assignments
 *  - prefer-const: Suggest `const` for `set` variables that are never reassigned
 *  - style/trailing-whitespace: Warn on redundant trailing spaces
 */

const fs = require('fs');
const path = require('path');
const { parseWate, tokenizeWate, TT } = require('./wate-parser');

const LINT_RULES = [
  { id: 'no-unused-vars', name: 'No Unused Variables', severity: 'warn', desc: 'Variables declared with set/const that are never referenced' },
  { id: 'no-unused-funcs', name: 'No Unused Functions', severity: 'warn', desc: 'Functions declared locally that are never called' },
  { id: 'no-unused-imports', name: 'No Unused Imports', severity: 'warn', desc: 'Imported symbols or modules that are never referenced' },
  { id: 'no-unreachable', name: 'No Unreachable Code', severity: 'error', desc: 'Statements placed after return, throw, break, or continue' },
  { id: 'naming-convention', name: 'Naming Conventions', severity: 'warn', desc: 'Enforces PascalCase for classes, camelCase/snake_case for variables' },
  { id: 'no-empty-block', name: 'No Empty Blocks', severity: 'warn', desc: 'Control flow blocks or functions containing no executable statements' },
  { id: 'no-shadowing', name: 'No Variable Shadowing', severity: 'warn', desc: 'Inner block variables shadowing an outer scope variable' },
  { id: 'no-self-assign', name: 'No Self-Assignment', severity: 'error', desc: 'Redundant assignment of a variable to itself (x = x)' },
  { id: 'prefer-const', name: 'Prefer Const', severity: 'info', desc: 'Variables declared with set that are never reassigned' },
  { id: 'style/trailing-whitespace', name: 'No Trailing Whitespace', severity: 'warn', desc: 'Lines containing useless whitespace at the end' },
  { id: 'syntax-error', name: 'Syntax Error', severity: 'error', desc: 'Source code syntax parsing errors' }
];

class LintScope {
  constructor(parent = null, type = 'block') {
    this.parent = parent;
    this.type = type; // 'global', 'function', 'class', 'block'
    this.variables = new Map(); // name -> { kind, loc, referenced: boolean, reassigned: boolean, node }
    this.functions = new Map(); // name -> { loc, referenced: boolean, node }
    this.imports = new Map();   // name -> { loc, referenced: boolean, source }
  }

  declareVar(name, meta) {
    this.variables.set(name, {
      referenced: false,
      reassigned: false,
      ...meta
    });
  }

  declareFunc(name, meta) {
    this.functions.set(name, {
      referenced: false,
      ...meta
    });
  }

  declareImport(name, meta) {
    this.imports.set(name, {
      referenced: false,
      ...meta
    });
  }

  reference(name) {
    let curr = this;
    while (curr) {
      if (curr.variables.has(name)) {
        curr.variables.get(name).referenced = true;
        return true;
      }
      if (curr.functions.has(name)) {
        curr.functions.get(name).referenced = true;
        return true;
      }
      if (curr.imports.has(name)) {
        curr.imports.get(name).referenced = true;
        return true;
      }
      curr = curr.parent;
    }
    return false;
  }

  reassign(name) {
    let curr = this;
    while (curr) {
      if (curr.variables.has(name)) {
        curr.variables.get(name).reassigned = true;
        return true;
      }
      curr = curr.parent;
    }
    return false;
  }

  lookup(name) {
    let curr = this;
    while (curr) {
      if (curr.variables.has(name) || curr.functions.has(name) || curr.imports.has(name)) {
        return true;
      }
      curr = curr.parent;
    }
    return false;
  }

  lookupParent(name) {
    let curr = this.parent;
    while (curr) {
      if (curr.variables.has(name) || curr.functions.has(name) || curr.imports.has(name)) {
        return true;
      }
      curr = curr.parent;
    }
    return false;
  }
}

class WateLinter {
  constructor(options = {}) {
    this.options = {
      strict: false,
      fix: false,
      json: false,
      ...options
    };
    this.diagnostics = [];
    this.currentScope = null;
    this.scopes = [];
    this.sourceCode = '';
    this.lines = [];
    this.filePath = '<input>';
  }

  addDiagnostic(ruleId, message, loc, severity = 'warn', fix = null) {
    const line = loc ? (loc.line || 1) : 1;
    const col = loc ? (loc.col || 1) : 1;
    this.diagnostics.push({
      ruleId,
      message,
      line,
      col,
      severity,
      fix
    });
  }

  lint(sourceCode, filePath = '<input>') {
    this.diagnostics = [];
    this.sourceCode = sourceCode;
    this.lines = sourceCode.split('\n');
    this.filePath = filePath;
    this.currentScope = new LintScope(null, 'global');
    this.scopes = [this.currentScope];

    // 1. Text & Token level checks (e.g. trailing whitespace)
    this.checkTextRules();

    // 2. Parse AST & Catch syntax errors
    let ast = null;
    try {
      ast = parseWate(sourceCode, filePath);
    } catch (err) {
      const line = err.token ? err.token.line : (err.loc ? err.loc.line : 1);
      const col = err.token ? err.token.col : (err.loc ? err.loc.col : 1);
      this.addDiagnostic('syntax-error', err.message, { line, col }, 'error');
      return {
        filePath,
        diagnostics: this.diagnostics,
        errorCount: this.diagnostics.filter(d => d.severity === 'error').length,
        warnCount: this.diagnostics.filter(d => d.severity === 'warn').length,
        infoCount: this.diagnostics.filter(d => d.severity === 'info').length
      };
    }

    // 3. AST static inspection & scope analysis
    this.traverse(ast);

    // 4. Post-traversal checks across all scopes (unused vars/funcs/imports, prefer-const)
    this.checkUnusedEntities();

    // Sort diagnostics by line, col
    this.diagnostics.sort((a, b) => (a.line - b.line) || (a.col - b.col));

    const errorCount = this.diagnostics.filter(d => d.severity === 'error').length;
    const warnCount = this.diagnostics.filter(d => d.severity === 'warn').length;
    const infoCount = this.diagnostics.filter(d => d.severity === 'info').length;

    return {
      filePath,
      diagnostics: this.diagnostics,
      errorCount,
      warnCount,
      infoCount,
      fixedCode: this.options.fix ? this.applyFixes() : null
    };
  }

  checkTextRules() {
    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];
      if (/\s+$/.test(line)) {
        this.addDiagnostic(
          'style/trailing-whitespace',
          'Trailing whitespace detected at end of line',
          { line: i + 1, col: line.trimEnd().length + 1 },
          'warn',
          { type: 'remove-trailing', line: i }
        );
      }
    }
  }

  applyFixes() {
    let lines = [...this.lines];
    for (const diag of this.diagnostics) {
      if (diag.fix && diag.fix.type === 'remove-trailing') {
        lines[diag.fix.line] = lines[diag.fix.line].trimEnd();
      }
    }
    return lines.join('\n');
  }

  pushScope(type = 'block') {
    const newScope = new LintScope(this.currentScope, type);
    this.currentScope = newScope;
    this.scopes.push(newScope);
    return newScope;
  }

  popScope() {
    if (this.currentScope.parent) {
      this.currentScope = this.currentScope.parent;
    }
  }

  traverse(node) {
    if (!node) return;

    switch (node.type) {
      case 'Program': {
        this.traverseStatements(node.body);
        break;
      }

      case 'Block':
      case 'BlockStatement': {
        this.pushScope('block');
        if (!node.body || node.body.length === 0) {
          this.addDiagnostic('no-empty-block', 'Empty code block statement', node.loc, 'warn');
        } else {
          this.traverseStatements(node.body);
        }
        this.popScope();
        break;
      }

      case 'VariableDeclaration': {
        const kind = node.kind; // 'let', 'const', 'set'
        for (const decl of node.declarations) {
          this.checkVariableDeclaration(decl, kind, node.loc);
        }
        break;
      }

      case 'FunctionDeclaration': {
        const name = node.name;
        if (name) {
          // Check naming convention
          if (!this.isValidIdentifierName(name, 'function')) {
            this.addDiagnostic('naming-convention', `Function name '${name}' should follow camelCase or snake_case`, node.loc, 'warn');
          }
          if (this.currentScope.lookupParent(name)) {
            this.addDiagnostic('no-shadowing', `Function '${name}' shadows an outer scope symbol`, node.loc, 'warn');
          }
          this.currentScope.declareFunc(name, { loc: node.loc, node });
        }

        this.pushScope('function');
        // Register parameters
        if (node.params) {
          for (const p of node.params) {
            const pName = typeof p === 'string' ? p : (p.name || (p.type === 'RestElement' ? p.argument.name : null));
            if (pName) {
              this.currentScope.declareVar(pName, { kind: 'param', loc: node.loc, node: p });
            }
          }
        }

        if (node.body) {
          if (node.body.type === 'Block' || node.body.type === 'BlockStatement') {
            if (!node.body.body || node.body.body.length === 0) {
              this.addDiagnostic('no-empty-block', `Function '${name || 'anonymous'}' has an empty body`, node.loc, 'warn');
            } else {
              this.traverseStatements(node.body.body);
            }
          } else {
            this.traverse(node.body);
          }
        }
        this.popScope();
        break;
      }

      case 'ClassDeclaration': {
        const name = node.name;
        if (name && !/^[A-Z][A-Za-z0-9]*$/.test(name)) {
          this.addDiagnostic('naming-convention', `Class '${name}' should follow PascalCase`, node.loc, 'warn');
        }
        if (name) {
          this.currentScope.declareVar(name, { kind: 'class', loc: node.loc, node });
        }

        this.pushScope('class');
        this.currentScope.declareVar('this', { kind: 'var', loc: node.loc, node });
        this.currentScope.declareVar('super', { kind: 'var', loc: node.loc, node });

        if (node.methods) {
          for (const m of node.methods) {
            this.traverse(m);
          }
        }
        this.popScope();
        break;
      }

      case 'EnumDeclaration': {
        const name = node.name;
        if (name && !/^[A-Z][A-Za-z0-9]*$/.test(name)) {
          this.addDiagnostic('naming-convention', `Enum '${name}' should follow PascalCase`, node.loc, 'warn');
        }
        if (name) {
          this.currentScope.declareVar(name, { kind: 'const', loc: node.loc, node });
        }
        break;
      }

      case 'InterfaceDeclaration': {
        const name = node.name;
        if (name && !/^[A-Z][A-Za-z0-9]*$/.test(name)) {
          this.addDiagnostic('naming-convention', `Interface '${name}' should follow PascalCase`, node.loc, 'warn');
        }
        break;
      }

      case 'ImportStatement':
      case 'ImportBlock': {
        if (node.alias) {
          this.currentScope.declareImport(node.alias, { loc: node.loc, source: node.source });
        }
        if (node.specifiers && node.specifiers.length > 0) {
          for (const s of node.specifiers) {
            this.currentScope.declareImport(s.local, { loc: node.loc, source: node.source });
          }
        }
        if (!node.alias && (!node.specifiers || node.specifiers.length === 0)) {
          const modName = path.basename(node.source, path.extname(node.source)).replace(/[^a-zA-Z0-9_$]/g, '_');
          this.currentScope.declareImport(modName, { loc: node.loc, source: node.source });
        }
        break;
      }

      case 'BinaryExpression': {
        if (node.operator === '=' || node.operator === ':=') {
          if (node.left && node.right) {
            if (node.left.type === 'Identifier' && node.right.type === 'Identifier' && node.left.name === node.right.name) {
              this.addDiagnostic('no-self-assign', `Redundant self-assignment '${node.left.name} = ${node.right.name}'`, node.loc, 'error');
            }
            if (node.left.type === 'Identifier') {
              this.currentScope.reassign(node.left.name);
            }
          }
        }
        this.traverse(node.left);
        this.traverse(node.right);
        break;
      }

      case 'AssignExpression': {
        if (node.left && node.right) {
          if (node.left.type === 'Identifier' && node.right.type === 'Identifier' && node.left.name === node.right.name) {
            this.addDiagnostic('no-self-assign', `Redundant self-assignment '${node.left.name} = ${node.right.name}'`, node.loc, 'error');
          }
          if (node.left.type === 'Identifier') {
            this.currentScope.reassign(node.left.name);
          }
        }
        this.traverse(node.left);
        this.traverse(node.right);
        break;
      }

      case 'UpdateExpression': {
        if (node.argument && node.argument.type === 'Identifier') {
          this.currentScope.reassign(node.argument.name);
          this.currentScope.reference(node.argument.name);
        }
        this.traverse(node.argument);
        break;
      }

      case 'Identifier': {
        this.currentScope.reference(node.name);
        break;
      }

      case 'IfStatement': {
        this.traverse(node.test);
        this.traverse(node.consequent);
        if (node.alternate) this.traverse(node.alternate);
        break;
      }

      case 'WhileStatement':
      case 'DoWhileStatement': {
        this.traverse(node.test);
        this.traverse(node.body);
        break;
      }

      case 'ForeachStatement': {
        this.pushScope('block');
        if (node.item) {
          this.currentScope.declareVar(node.item, { kind: 'let', loc: node.loc });
        }
        this.traverse(node.iterable);
        this.traverse(node.body);
        this.popScope();
        break;
      }

      case 'TryCatchStatement': {
        this.traverse(node.block);
        if (node.handler) {
          this.pushScope('block');
          if (node.param) {
            this.currentScope.declareVar(node.param, { kind: 'let', loc: node.loc });
          }
          this.traverse(node.handler);
          this.popScope();
        }
        if (node.finalizer) {
          this.traverse(node.finalizer);
        }
        break;
      }

      default: {
        for (const key in node) {
          if (key === 'loc' || key === 'type') continue;
          const val = node[key];
          if (Array.isArray(val)) {
            for (const c of val) {
              if (c && typeof c === 'object') this.traverse(c);
            }
          } else if (val && typeof val === 'object') {
            this.traverse(val);
          }
        }
      }
    }
  }

  traverseStatements(stmts) {
    if (!stmts || !Array.isArray(stmts)) return;
    let reachedTerminal = false;

    for (let i = 0; i < stmts.length; i++) {
      const stmt = stmts[i];
      if (!stmt) continue;

      if (reachedTerminal) {
        this.addDiagnostic('no-unreachable', 'Unreachable code detected after terminating statement', stmt.loc, 'error');
      }

      this.traverse(stmt);

      if (['ReturnStatement', 'ThrowStatement', 'BreakStatement', 'ContinueStatement'].includes(stmt.type)) {
        reachedTerminal = true;
      }
    }
  }

  checkVariableDeclaration(decl, kind, loc) {
    if (decl.id && decl.id.type === 'Identifier') {
      const name = decl.id.name;

      // Naming convention
      if (kind === 'const') {
        if (!/^[A-Z0-9_]+$/.test(name) && !this.isValidIdentifierName(name, 'var')) {
          this.addDiagnostic('naming-convention', `Constant '${name}' should follow UPPER_SNAKE_CASE or camelCase`, decl.id.loc || loc, 'warn');
        }
      } else {
        if (!this.isValidIdentifierName(name, 'var')) {
          this.addDiagnostic('naming-convention', `Variable '${name}' should follow camelCase or snake_case`, decl.id.loc || loc, 'warn');
        }
      }

      // Shadowing check
      if (this.currentScope.lookupParent(name)) {
        this.addDiagnostic('no-shadowing', `Variable '${name}' shadows a variable in outer scope`, decl.id.loc || loc, 'warn');
      }

      this.currentScope.declareVar(name, {
        kind,
        loc: decl.id.loc || loc,
        node: decl
      });
    }

    if (decl.init) {
      this.traverse(decl.init);
    }
  }

  checkUnusedEntities() {
    for (const scope of this.scopes) {
      // 1. Unused variables & prefer-const
      for (const [name, meta] of scope.variables) {
        if (name.startsWith('_') || name === 'this' || name === 'super') continue;

        if (!meta.referenced) {
          const isParam = meta.kind === 'param';
          const msg = isParam
            ? `Parameter '${name}' is declared but never used (prefix with '_' to ignore)`
            : `Variable '${name}' is declared but its value is never read`;
          this.addDiagnostic('no-unused-vars', msg, meta.loc, 'warn');
        } else if (meta.kind === 'let' && !meta.reassigned && scope.type !== 'global') {
          // Suggest prefer-const for non-global, non-reassigned variables
          this.addDiagnostic('prefer-const', `Variable '${name}' is never reassigned; consider using 'const' instead`, meta.loc, 'info');
        }
      }

      // 2. Unused functions
      for (const [name, meta] of scope.functions) {
        if (name.startsWith('_')) continue;
        if (scope.type !== 'global' && !meta.referenced) {
          this.addDiagnostic('no-unused-funcs', `Function '${name}' is defined but never called`, meta.loc, 'warn');
        }
      }

      // 3. Unused imports
      for (const [name, meta] of scope.imports) {
        if (!meta.referenced) {
          this.addDiagnostic('no-unused-imports', `Imported symbol '${name}' from "${meta.source}" is never used`, meta.loc, 'warn');
        }
      }
    }
  }

  isValidIdentifierName(name, type) {
    if (name.startsWith('_')) return true;
    if (type === 'function' || type === 'var') {
      // camelCase or snake_case
      return /^[a-z][a-zA-Z0-9]*$/.test(name) || /^[a-z][a-z0-9_]*$/.test(name);
    }
    return true;
  }
}

// ===============================================================
// Terminal Formatter & Reporter
// ===============================================================
class LintReporter {
  static format(result, options = {}) {
    const { filePath, diagnostics, errorCount, warnCount, infoCount } = result;

    if (options.json) {
      return JSON.stringify(result, null, 2);
    }

    const lines = [];
    lines.push(`\n\x1b[1m\x1b[4m${path.resolve(filePath)}\x1b[0m`);

    if (diagnostics.length === 0) {
      lines.push(`  \x1b[32m✔ No linting or style issues found.\x1b[0m\n`);
      return lines.join('\n');
    }

    const fileContent = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
    const srcLines = fileContent.split('\n');

    for (const diag of diagnostics) {
      const { line, col, severity, message, ruleId } = diag;
      let badge = '\x1b[33mWARN \x1b[0m';
      if (severity === 'error') badge = '\x1b[31mERROR\x1b[0m';
      if (severity === 'info') badge = '\x1b[36mINFO \x1b[0m';

      lines.push(`  \x1b[90mLine ${line}:${col}\x1b[0m  ${badge}  ${message}  \x1b[90m(${ruleId})\x1b[0m`);

      // Caret preview
      if (srcLines[line - 1]) {
        const codeLine = srcLines[line - 1];
        lines.push(`    \x1b[90m${line} |\x1b[0m ${codeLine}`);
        const caretPad = ' '.repeat(Math.max(0, col - 1));
        const pointerColor = severity === 'error' ? '\x1b[31m' : (severity === 'info' ? '\x1b[36m' : '\x1b[33m');
        lines.push(`    \x1b[90m  |\x1b[0m ${caretPad}${pointerColor}^\x1b[0m`);
      }
    }

    const total = errorCount + warnCount + infoCount;
    const summaryColor = errorCount > 0 ? '\x1b[31m' : (warnCount > 0 ? '\x1b[33m' : '\x1b[32m');
    lines.push(`\n${summaryColor}✖ ${total} problem${total === 1 ? '' : 's'} (${errorCount} error${errorCount === 1 ? '' : 's'}, ${warnCount} warning${warnCount === 1 ? '' : 's'}, ${infoCount} info)\x1b[0m\n`);

    return lines.join('\n');
  }

  static printRules() {
    console.log(`\n\x1b[1m\x1b[36m⚡ WATE Built-in Linter Rules Reference\x1b[0m\n`);
    console.log('-----------------------------------------------------------------------------------------');
    console.log(
      'Rule ID'.padEnd(28) +
      'Severity'.padEnd(12) +
      'Description'
    );
    console.log('-----------------------------------------------------------------------------------------');
    for (const rule of LINT_RULES) {
      const sevColor = rule.severity === 'error' ? '\x1b[31m' : (rule.severity === 'info' ? '\x1b[36m' : '\x1b[33m');
      console.log(
        `\x1b[33m${rule.id.padEnd(28)}\x1b[0m` +
        `${sevColor}${rule.severity.toUpperCase().padEnd(12)}\x1b[0m` +
        `${rule.desc}`
      );
    }
    console.log('-----------------------------------------------------------------------------------------\n');
  }
}

// ===============================================================
// CLI Runner: Scan single file or recursive directory
// ===============================================================
function runLinter(target, options = {}) {
  if (options.rules) {
    LintReporter.printRules();
    process.exit(0);
  }

  let targetPath = target ? path.resolve(process.cwd(), target) : process.cwd();
  let filesToLint = [];

  const IGNORE_DIRS = ['node_modules', '.git', '.wate_cache', 'dist', 'build'];

  function scanDir(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isDirectory()) {
        if (!IGNORE_DIRS.includes(ent.name)) {
          scanDir(path.join(dir, ent.name));
        }
      } else if (ent.isFile() && ent.name.endsWith('.wate')) {
        filesToLint.push(path.join(dir, ent.name));
      }
    }
  }

  if (fs.existsSync(targetPath)) {
    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      scanDir(targetPath);
    } else if (stat.isFile()) {
      filesToLint.push(targetPath);
    }
  } else {
    console.error(`\x1b[31m❌ Error: Target '${target}' does not exist.\x1b[0m`);
    process.exit(1);
  }

  if (filesToLint.length === 0) {
    console.log(`\x1b[33m⚠️ No .wate files found to lint in: ${targetPath}\x1b[0m`);
    process.exit(0);
  }

  let totalErrors = 0;
  let totalWarnings = 0;
  let totalInfos = 0;
  const allResults = [];

  for (const file of filesToLint) {
    const code = fs.readFileSync(file, 'utf-8');
    const linter = new WateLinter(options);
    const result = linter.lint(code, file);
    allResults.push(result);

    totalErrors += result.errorCount;
    totalWarnings += result.warnCount;
    totalInfos += result.infoCount;

    if (options.fix && result.fixedCode && result.fixedCode !== code) {
      fs.writeFileSync(file, result.fixedCode, 'utf-8');
      console.log(`\x1b[32m✔ Auto-fixed formatting in: ${file}\x1b[0m`);
    }

    if (!options.json) {
      if (result.diagnostics.length > 0 || filesToLint.length === 1) {
        console.log(LintReporter.format(result, options));
      }
    }
  }

  if (options.json) {
    console.log(JSON.stringify(allResults, null, 2));
  } else if (filesToLint.length > 1) {
    console.log(`\n\x1b[1m════════════════════════════════════════════════════════════════\x1b[0m`);
    console.log(`📊 \x1b[1mWATE Lint Summary:\x1b[0m ${filesToLint.length} files scanned`);
    if (totalErrors === 0 && totalWarnings === 0) {
      console.log(`   \x1b[32m✔ All scanned files passed cleanly with zero issues!\x1b[0m\n`);
    } else {
      console.log(`   \x1b[31mErrors: ${totalErrors}\x1b[0m | \x1b[33mWarnings: ${totalWarnings}\x1b[0m | \x1b[36mInfo: ${totalInfos}\x1b[0m\n`);
    }
  }

  if (totalErrors > 0 || (options.strict && totalWarnings > 0)) {
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

// Module exports
module.exports = {
  WateLinter: makeConstructible(WateLinter),
  LintReporter: makeConstructible(LintReporter),
  LintScope: makeConstructible(LintScope),
  LINT_RULES,
  runLinter
};

// Standalone CLI runner when executed directly
if (require.main === module) {
  const args = process.argv.slice(2);
  const target = args.find(a => !a.startsWith('-'));
  const strict = args.includes('--strict');
  const fix = args.includes('--fix');
  const json = args.includes('--json');
  const rules = args.includes('--rules') || args.includes('-r');
  runLinter(target, { strict, fix, json, rules });
}

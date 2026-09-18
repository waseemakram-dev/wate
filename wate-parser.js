#!/usr/bin/env node
'use strict';

/**
 * WATE Recursive Descent AST Parser & Transpiler v10.5
 * ------------------------------------------------------------
 * Features:
 *  - Fully AST-based: Lexer -> Parser -> AST -> JS Code Generator
 *  - Premium Visual Errors with code caret pointing
 *  - Supports f-strings (single, double, and triple quotes) recursively
 *  - Labeled loops, guard clauses, match statements, list comprehensions
 *  - All Level 1 & Level 2 features fully covered with absolute stability
 */

const fs = typeof require === 'function' ? (function(){ try { return require('fs'); } catch(e){ return null; } })() : null;
const path = typeof require === 'function' ? (function(){ try { return require('path'); } catch(e){ return null; } })() : null;

// ============================================================
// Token Types
// ============================================================
const TT = Object.freeze({
  EOF: 'EOF',
  IDENT: 'IDENT',
  NUMBER: 'NUMBER',
  STRING: 'STRING',
  F_STRING: 'F_STRING',
  KEYWORD: 'KEYWORD',
  OP: 'OP',
  PUNC: 'PUNC',
  NEWLINE: 'NEWLINE'
});

const KEYWORDS = new Set([
  'set', 'const', 'fn', 'async', 'return',
  'if', 'else', 'elseif', 'elif', 'while', 'loop',
  'foreach', 'for', 'in', 'repeat', 'times',
  'import', 'try', 'catch', 'finally', 'throw', 'class', 'extends', 'static',
  'break', 'continue', 'await', 'do',
  'True', 'False', 'true', 'false', 'Null', 'None', 'null', 'Undefined', 'undefined',
  'and', 'or', 'not', 'is', 'guard', 'match', 'default',
  'interface', 'implements', 'method',
  'macro', 'as', 'export', 'from',
  'enum', 'type', 'yield'
]);

const BOOLEAN_NULL_MAP = Object.freeze({
  True: 'true', False: 'false',
  true: 'true', false: 'false',
  Null: 'null', None: 'null', null: 'null',
  Undefined: 'undefined', undefined: 'undefined'
});

if (!global.WateClasses) {
  global.WateClasses = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'CustomError']);
}

// ============================================================
// Premium Errors with Line Caret
// ============================================================
class WateSyntaxError extends Error {
  constructor(message, token, filePath, source = '') {
    super(message);
    this.name = 'WateSyntaxError';
    this.token = token;
    this.filePath = filePath;
    this.source = source;
  }
}

class WateCompilationError extends Error {
  constructor(errors, filePath, source = '') {
    const summary = errors.map((e, idx) => {
      const line = e.token ? e.token.line : '?';
      const col = e.token ? e.token.col : '?';
      return `  [Error ${idx + 1}] Line ${line}, Col ${col}: ${e.message}`;
    }).join('\n');
    super(`WATE Compilation failed with ${errors.length} syntax error(s):\n${summary}`);
    this.name = 'WateCompilationError';
    this.errors = errors;
    this.filePath = filePath;
    this.source = source;
  }
}

// ============================================================
// Lexer / Tokenizer
// ============================================================
class Lexer {
  constructor(input, filePath = '<input>') {
    this.input = String(input || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    this.filePath = filePath;
    this.i = 0;
    this.line = 1;
    this.col = 1;
  }

  eof() { return this.i >= this.input.length; }
  peek(n = 0) { return this.input[this.i + n] || ''; }

  advance() {
    const ch = this.input[this.i++];
    if (ch === '\n') { this.line++; this.col = 1; }
    else this.col++;
    return ch;
  }

  token(type, value, line, col) {
    return { type, value, line, col };
  }

  isAlpha(ch) { return /[A-Za-z_]/.test(ch); }
  isDigit(ch) { return /[0-9]/.test(ch); }
  isAlphaNum(ch) { return /[A-Za-z0-9_]/.test(ch); }

  skipSpacesAndComments() {
    while (!this.eof()) {
      const ch = this.peek();
      if (ch === ' ' || ch === '\t' || ch === '\v' || ch === '\f') {
        this.advance();
        continue;
      }
      if (ch === '#') {
        if (this.isAlpha(this.peek(1))) {
          break;
        }
        while (!this.eof() && this.peek() !== '\n') this.advance();
        continue;
      }
      break;
    }
  }

  readNumber() {
    const line = this.line, col = this.col;
    let value = '';
    while (!this.eof() && this.isDigit(this.peek())) value += this.advance();
    if (this.peek() === '.' && this.isDigit(this.peek(1))) {
      value += this.advance();
      while (!this.eof() && this.isDigit(this.peek())) value += this.advance();
    }
    return this.token(TT.NUMBER, value, line, col);
  }

  readIdentifier() {
    const line = this.line, col = this.col;
    let value = '';
    while (!this.eof() && this.isAlphaNum(this.peek())) value += this.advance();
    return this.token(KEYWORDS.has(value) ? TT.KEYWORD : TT.IDENT, value, line, col);
  }

  readStringLiteral(isFString) {
    const line = this.line, col = this.col;
    const quote = this.peek();
    let isTriple = false;

    if (this.peek(0) === quote && this.peek(1) === quote && this.peek(2) === quote) {
      isTriple = true;
      this.advance(); this.advance(); this.advance();
    } else {
      this.advance();
    }

    let value = '';
    while (!this.eof()) {
      if (isTriple) {
        if (this.peek(0) === quote && this.peek(1) === quote && this.peek(2) === quote) {
          this.advance(); this.advance(); this.advance();
          return this.token(isFString ? TT.F_STRING : TT.STRING, value, line, col);
        }
      } else {
        if (this.peek() === quote) {
          this.advance();
          return this.token(isFString ? TT.F_STRING : TT.STRING, value, line, col);
        }
      }

      const nextCh = this.advance();
      if (nextCh === '\\') {
        const next = this.advance();
        const escapes = { n: '\n', r: '\r', t: '\t', '\\': '\\', '"': '"', "'": "'" };
        value += escapes[next] !== undefined ? escapes[next] : next;
      } else {
        value += nextCh;
      }
    }
    throw new WateSyntaxError(`Unterminated ${isFString ? 'f-' : ''}string literal`, { line, col }, this.filePath, this.input);
  }

  nextToken() {
    this.skipSpacesAndComments();
    if (this.eof()) return this.token(TT.EOF, '', this.line, this.col);

    const line = this.line, col = this.col;
    const ch = this.peek();

    if (ch === '\n') { this.advance(); return this.token(TT.NEWLINE, '\n', line, col); }

    // F-strings detection
    if (ch === 'f' && (this.peek(1) === '"' || this.peek(1) === "'")) {
      this.advance(); // consume 'f'
      return this.readStringLiteral(true);
    }

    if (ch === '#' && this.isAlpha(this.peek(1))) {
      this.advance();
      const line = this.line, col = this.col - 1;
      let value = '#';
      while (!this.eof() && this.isAlphaNum(this.peek())) {
        value += this.advance();
      }
      return this.token(TT.IDENT, value, line, col);
    }

    if (this.isDigit(ch)) return this.readNumber();
    if (this.isAlpha(ch)) return this.readIdentifier();
    if (ch === '"' || ch === "'") return this.readStringLiteral(false);

    const three = ch + this.peek(1) + this.peek(2);
    const two = ch + this.peek(1);
    const ops3 = ['===', '!==', '>>>', '...', '??='];
    const ops2 = ['==', '!=', '<=', '>=', '&&', '||', '++', '--', '+=', '-=', '*=', '/=', '%=', '=>', '**', ':=', '<<', '>>', '&=', '|=', '^=', '?.', '??'];
    const singles = '{}[](),.;:?@'; // @ added for decorators
    const oneOps = '+-*/%<>=!.&|^~';

    if (ops3.includes(three)) {
      this.advance(); this.advance(); this.advance();
      return this.token(TT.OP, three, line, col);
    }
    if (ops2.includes(two)) {
      this.advance(); this.advance();
      return this.token(TT.OP, two, line, col);
    }
    if (singles.includes(ch)) {
      this.advance();
      return this.token(TT.PUNC, ch, line, col);
    }
    if (oneOps.includes(ch)) {
      this.advance();
      return this.token(TT.OP, ch, line, col);
    }

    throw new WateSyntaxError(`Unexpected character '${ch}'`, { line, col }, this.filePath, this.input);
  }

  tokenize() {
    const tokens = [];
    let t;
    do {
      t = this.nextToken();
      tokens.push(t);
    } while (t.type !== TT.EOF);
    return tokens;
  }
}

// ============================================================
// Parser
// ============================================================
class Parser {
  constructor(tokens, filePath = '<input>', source = '') {
    this.tokens = tokens;
    this.filePath = filePath;
    this.source = source;
    this.pos = 0;
    this.errors = [];
  }

  current() { return this.tokens[this.pos] || this.tokens[this.tokens.length - 1]; }
  prev() { return this.tokens[this.pos - 1]; }
  eof() { return this.current().type === TT.EOF; }

  error(msg, token = this.current()) {
    const err = new WateSyntaxError(msg, token, this.filePath, this.source);
    this.errors.push(err);
    throw err;
  }

  match(type, value = null) {
    const t = this.current();
    if (t && t.type === type && (value === null || t.value === value)) {
      this.pos++;
      return t;
    }
    return null;
  }

  advance() {
    const t = this.current();
    if (!this.eof()) this.pos++;
    return t;
  }

  check(type, value = null) {
    const t = this.current();
    return t && t.type === type && (value === null || t.value === value);
  }

  expect(type, value = null, msg = null) {
    const t = this.match(type, value);
    if (!t) this.error(msg || `Expected ${value || type}, got '${this.current().value}'`);
    return t;
  }

  skipNewlines() { while (this.match(TT.NEWLINE)) {} }

  synchronize() {
    this.pos++;
    while (!this.eof()) {
      if (this.prev().type === TT.NEWLINE || (this.prev().type === TT.PUNC && this.prev().value === ';')) {
        return;
      }
      const t = this.current();
      if (t.type === TT.KEYWORD && ['set', 'const', 'fn', 'async', 'return', 'if', 'while', 'for', 'foreach', 'repeat', 'class', 'import', 'macro', 'try', 'interface', 'export'].includes(t.value)) {
        return;
      }
      if (t.type === TT.PUNC && (t.value === '}' || t.value === ';')) {
        this.pos++;
        return;
      }
      this.pos++;
    }
  }

  parseProgram() {
    const body = [];
    this.skipNewlines();
    while (!this.eof()) {
      try {
        body.push(this.parseStatement());
      } catch (err) {
        if (err.name === 'WateSyntaxError') {
          this.synchronize();
        } else {
          throw err;
        }
      }
      this.skipNewlines();
    }
    if (this.errors.length > 0) {
      if (this.errors.length === 1) throw this.errors[0];
      throw new WateCompilationError(this.errors, this.filePath, this.source);
    }
    return { type: 'Program', body };
  }

  parseStatement() {
    this.skipNewlines();
    const t = this.current();

    // Labeled loop statement check (outer: loop...)
    if (t.type === TT.IDENT && this.tokens[this.pos + 1] && this.tokens[this.pos + 1].type === TT.PUNC && this.tokens[this.pos + 1].value === ':') {
      const label = this.expect(TT.IDENT).value;
      this.expect(TT.PUNC, ':');
      const body = this.parseStatement();
      return { type: 'LabeledStatement', label, body, loc: t };
    }

    if (this.check(TT.KEYWORD, 'set')) {
      const next1 = this.tokens[this.pos + 1];
      const next2 = this.tokens[this.pos + 2];
      if (next1 && next1.type === TT.IDENT && next2 && next2.type === TT.PUNC && (next2.value === '.' || next2.value === '[')) {
        this.pos++;
        const expr = this.parseExpression();
        this.match(TT.PUNC, ';');
        return { type: 'ExpressionStatement', expression: expr, loc: t };
      }
    }

    if (this.check(TT.PUNC, '@')) {
      const decorators = this.parseDecorators();
      if (this.check(TT.KEYWORD, 'class')) return this.parseClassDeclaration(decorators);
      if (this.check(TT.KEYWORD, 'async') || this.check(TT.KEYWORD, 'fn')) return this.parseFunctionDeclaration(decorators);
      if (this.check(TT.KEYWORD, 'export')) {
        const exp = this.parseExport();
        exp.decorators = decorators;
        return exp;
      }
    }

    if (this.check(TT.KEYWORD, 'enum')) return this.parseEnumDeclaration();
    if (this.check(TT.KEYWORD, 'type')) return this.parseTypeAlias();
    if (this.check(TT.KEYWORD, 'for') && this.tokens[this.pos + 1] && this.tokens[this.pos + 1].value === 'await') {
      return this.parseForAwait();
    }

    if (this.check(TT.KEYWORD, 'import')) return this.parseImport();
    if (this.check(TT.KEYWORD, 'export')) return this.parseExport();
    if (this.check(TT.KEYWORD, 'macro')) return this.parseMacro();
    if (this.check(TT.KEYWORD, 'set') || this.check(TT.KEYWORD, 'const')) return this.parseVariableDeclaration();
    if (this.check(TT.KEYWORD, 'async') || this.check(TT.KEYWORD, 'fn')) return this.parseFunctionDeclaration();
    if (this.check(TT.KEYWORD, 'return')) return this.parseReturn();
    if (this.check(TT.KEYWORD, 'break')) return this.parseBreak();
    if (this.check(TT.KEYWORD, 'continue')) return this.parseContinue();
    if (this.check(TT.KEYWORD, 'throw')) return this.parseThrow();
    if (this.check(TT.KEYWORD, 'do')) return this.parseDoWhile();
    if (this.check(TT.KEYWORD, 'if')) return this.parseIf();
    if (this.check(TT.KEYWORD, 'while')) return this.parseWhile();
    if (this.check(TT.KEYWORD, 'loop')) return this.parseLoop();
    if (this.check(TT.KEYWORD, 'repeat')) return this.parseRepeat();
    if (this.check(TT.KEYWORD, 'foreach')) return this.parseForeach();
    if (this.check(TT.KEYWORD, 'try')) return this.parseTryCatch();
    if (this.check(TT.KEYWORD, 'class')) return this.parseClassDeclaration();
    if (this.check(TT.KEYWORD, 'interface')) return this.parseInterface();
    if (this.check(TT.KEYWORD, 'guard')) return this.parseGuard();
    if (this.check(TT.KEYWORD, 'match')) return this.parseMatch();
    if (this.check(TT.PUNC, '{')) return this.parseBlock();

    const expr = this.parseExpression();
    this.match(TT.PUNC, ';');
    return { type: 'ExpressionStatement', expression: expr, loc: t };
  }

  parseDecorators() {
    const decorators = [];
    while (this.match(TT.PUNC, '@')) {
      const loc = this.prev();
      let name = this.expect(TT.IDENT, null, 'Expected decorator name').value;
      while (this.match(TT.PUNC, '.')) {
        name += '.' + this.expect(TT.IDENT, null, 'Expected decorator property name').value;
      }
      let args = null;
      if (this.match(TT.PUNC, '(')) {
        args = [];
        if (!this.check(TT.PUNC, ')')) {
          do {
            this.skipNewlines();
            args.push(this.parseExpression());
            this.skipNewlines();
          } while (this.match(TT.PUNC, ','));
        }
        this.expect(TT.PUNC, ')');
      }
      decorators.push({ name, args, loc });
      this.skipNewlines();
    }
    return decorators;
  }

  parseEnumDeclaration() {
    const loc = this.expect(TT.KEYWORD, 'enum');
    const name = this.expect(TT.IDENT, null, 'Expected enum name').value;
    this.expect(TT.PUNC, '{');
    this.skipNewlines();
    const members = [];
    let autoVal = 0;
    while (!this.check(TT.PUNC, '}') && !this.eof()) {
      const key = this.expect(TT.IDENT, null, 'Expected enum member name').value;
      let val = autoVal++;
      if (this.match(TT.OP, '=')) {
        const valNode = this.parseExpression();
        if (valNode.type === 'Literal') {
          val = valNode.value;
          if (typeof val === 'number') autoVal = val + 1;
        } else if (valNode.type === 'RawLiteral') {
          val = valNode.raw;
        } else {
          val = valNode;
        }
      }
      members.push({ key, value: val });
      this.match(TT.PUNC, ',');
      this.skipNewlines();
    }
    this.expect(TT.PUNC, '}');
    return { type: 'EnumDeclaration', name, members, loc };
  }

  parseTypeAlias() {
    const loc = this.expect(TT.KEYWORD, 'type');
    const name = this.expect(TT.IDENT, null, 'Expected type alias name').value;
    let typeParams = [];
    if (this.match(TT.OP, '<')) {
      do {
        typeParams.push(this.expect(TT.IDENT).value);
      } while (this.match(TT.PUNC, ','));
      this.expect(TT.OP, '>');
    }
    this.expect(TT.OP, '=');
    let typeDefTokens = [];
    while (!this.check(TT.PUNC, ';') && !this.check(TT.NEWLINE) && !this.check(TT.EOF)) {
      typeDefTokens.push(this.advance().value);
    }
    this.match(TT.PUNC, ';');
    return { type: 'TypeAliasDeclaration', name, typeParams, typeDefinition: typeDefTokens.join(' '), loc };
  }

  parseForAwait() {
    const loc = this.expect(TT.KEYWORD, 'for');
    this.expect(TT.KEYWORD, 'await');
    const hasParen = this.match(TT.PUNC, '(');
    if (this.check(TT.KEYWORD, 'set') || this.check(TT.KEYWORD, 'const')) this.advance();
    const item = this.expect(TT.IDENT, null, 'Expected iteration variable').value;
    this.expect(TT.KEYWORD, 'in', 'Expected in');
    const iterable = this.parseExpression();
    if (hasParen) this.expect(TT.PUNC, ')');
    const body = this.parseBlock();
    return { type: 'ForAwaitStatement', item, iterable, body, loc };
  }

  parseTypeAnnotation() {
    if (this.check(TT.IDENT) || this.check(TT.KEYWORD)) {
      this.advance();
      if (this.match(TT.OP, '<')) {
        let depth = 1;
        while (depth > 0 && !this.eof()) {
          if (this.match(TT.OP, '<')) depth++;
          else if (this.match(TT.OP, '>')) depth--;
          else this.advance();
        }
      }
    }
  }

  parseExport() {
    const loc = this.expect(TT.KEYWORD, 'export');
    const declaration = this.parseStatement();
    return { type: 'ExportNamedDeclaration', declaration, loc };
  }

  parseMacro() {
    const loc = this.expect(TT.KEYWORD, 'macro');
    const name = this.expect(TT.IDENT, null, 'Expected macro name identifier').value;
    this.expect(TT.PUNC, '(', 'Expected ( after macro name');
    const params = [];
    if (!this.check(TT.PUNC, ')')) {
      do {
        params.push(this.expect(TT.IDENT, null, 'Expected macro parameter name').value);
      } while (this.match(TT.PUNC, ','));
    }
    this.expect(TT.PUNC, ')', 'Expected )');
    const body = this.parseBlock();
    return { type: 'MacroDeclaration', name, params, body, loc };
  }

  parseImport() {
    const loc = this.expect(TT.KEYWORD, 'import');
    
    let isNpm = false;
    if (this.check(TT.IDENT, 'npm') || this.check(TT.KEYWORD, 'npm')) {
      this.pos++;
      isNpm = true;
    }

    let specifiers = null;
    let source = '';
    let alias = null;

    if (this.match(TT.PUNC, '{')) {
      specifiers = [];
      do {
        this.skipNewlines();
        if (this.check(TT.PUNC, '}')) break;
        const imported = this.expect(TT.IDENT, null, 'Expected imported identifier').value;
        let local = imported;
        if (this.match(TT.KEYWORD, 'as')) {
          local = this.expect(TT.IDENT, null, 'Expected local alias identifier').value;
        }
        specifiers.push({ imported, local });
        this.skipNewlines();
      } while (this.match(TT.PUNC, ','));
      this.expect(TT.PUNC, '}', 'Expected closing }');
      this.expect(TT.KEYWORD, 'from', 'Expected from after import specifiers');
      source = this.expect(TT.STRING, null, 'Expected import path string').value;
    } else {
      source = this.expect(TT.STRING, null, 'Expected import path string').value;
      if (this.match(TT.KEYWORD, 'as')) {
        alias = this.expect(TT.IDENT, null, 'Expected alias identifier after as').value;
      }
    }
    this.match(TT.PUNC, ';');

    if (isNpm) {
      return { type: 'ImportStatement', source, isNpm: true, alias, specifiers, loc };
    }

    let resolvedPath = null;

    // Check #1: Relative file path or nested path
    if (this.filePath && this.filePath !== '<input>') {
      const baseDir = path.dirname(path.resolve(this.filePath));
      const p = path.resolve(baseDir, source);
      const pWate = p.endsWith('.wate') ? p : p + '.wate';
      const pIndex = path.join(p, 'index.wate');
      if (fs && fs.existsSync(pWate) && fs.statSync(pWate).isFile()) resolvedPath = pWate;
      else if (fs && fs.existsSync(pIndex) && fs.statSync(pIndex).isFile()) resolvedPath = pIndex;
      else if (fs && fs.existsSync(p) && fs.statSync(p).isFile()) resolvedPath = p;
    }

    // Check #2: Walk up directory tree to find wate_packages
    if (!resolvedPath && fs) {
      const searchDirs = [];
      if (this.filePath && this.filePath !== '<input>') {
        searchDirs.push(path.dirname(path.resolve(this.filePath)));
      }
      if (typeof process !== 'undefined' && process.cwd) {
        searchDirs.push(process.cwd());
      }

      for (let startDir of searchDirs) {
        let currentDir = startDir;
        while (currentDir) {
          const p1 = path.join(currentDir, 'wate_packages', source, 'index.wate');
          const p2 = path.join(currentDir, 'wate_packages', source + '.wate');
          const p3 = path.join(currentDir, 'wate_packages', source);
          if (fs.existsSync(p1) && fs.statSync(p1).isFile()) { resolvedPath = p1; break; }
          if (fs.existsSync(p2) && fs.statSync(p2).isFile()) { resolvedPath = p2; break; }
          if (fs.existsSync(p3) && fs.statSync(p3).isFile()) { resolvedPath = p3; break; }
          
          const parentDir = path.dirname(currentDir);
          if (parentDir === currentDir) break; // Reached root
          currentDir = parentDir;
        }
        if (resolvedPath) break;
      }
    }

    // Perform Recursive AST Inlining with AST caching if resolved!
    if (resolvedPath && fs && fs.existsSync(resolvedPath)) {
      const sourceCode = fs.readFileSync(resolvedPath, 'utf-8');
      const importedAST = getCachedModuleAST(resolvedPath, sourceCode);
      return { type: 'ImportBlock', source, resolvedPath, alias, specifiers, body: importedAST.body, loc };
    }

    return { type: 'ImportStatement', source, alias, specifiers, loc };
  }

  parseVariableDeclaration() {
    const kindTok = this.current();
    const kind = this.match(TT.KEYWORD, 'const') ? 'const' : (this.expect(TT.KEYWORD, 'set'), 'let');
    const declarations = [];

    do {
      const id = this.parseBindingPattern();
      let init = null;
      if (this.match(TT.OP, '=') || this.match(TT.OP, ':=')) {
        if (id.type === 'ArrayPattern' && !id.isDestructuring) {
          const elements = [];
          do {
            elements.push(this.parseExpression());
          } while (this.match(TT.PUNC, ','));
          init = { type: 'ArrayExpression', elements };
        } else {
          init = this.parseExpression();
        }
      }
      declarations.push({ id, init });
    } while (this.match(TT.PUNC, ',') && !this.check(TT.NEWLINE));

    this.match(TT.PUNC, ';');
    return { type: 'VariableDeclaration', kind, declarations, loc: kindTok };
  }

  parseBindingPattern() {
    // Array destructuring
    if (this.match(TT.PUNC, '[')) {
      const elements = [];
      if (!this.check(TT.PUNC, ']')) {
        do {
          this.skipNewlines();
          if (this.match(TT.OP, '...')) {
            const restId = this.expect(TT.IDENT, null, 'Expected identifier after ...').value;
            elements.push({ type: 'RestElement', argument: { type: 'Identifier', name: restId } });
            break;
          }
          if (this.check(TT.PUNC, ',')) {
            elements.push(null);
            continue;
          }
          const elemId = this.expect(TT.IDENT, null, 'Expected identifier in array pattern').value;
          if (this.match(TT.OP, '=')) {
            const defaultVal = this.parseExpression();
            elements.push({ type: 'AssignmentPattern', left: { type: 'Identifier', name: elemId }, right: defaultVal });
          } else {
            elements.push({ type: 'Identifier', name: elemId });
          }
        } while (this.match(TT.PUNC, ','));
      }
      this.expect(TT.PUNC, ']');
      return { type: 'ArrayPattern', elements, isDestructuring: true };
    }
    // Object destructuring
    if (this.match(TT.PUNC, '{')) {
      const properties = [];
      if (!this.check(TT.PUNC, '}')) {
        do {
          this.skipNewlines();
          if (this.match(TT.OP, '...')) {
            const restId = this.expect(TT.IDENT, null, 'Expected identifier after ... in object pattern').value;
            properties.push({ type: 'RestElement', argument: { type: 'Identifier', name: restId } });
            break;
          }
          const key = this.expect(TT.IDENT, null, 'Expected property name in object pattern').value;
          let target = key;
          let defaultVal = null;
          if (this.match(TT.PUNC, ':')) {
            target = this.expect(TT.IDENT, null, 'Expected target identifier in object pattern').value;
          }
          if (this.match(TT.OP, '=')) {
            defaultVal = this.parseExpression();
          }
          properties.push({ type: 'PropertyPattern', key, target, default: defaultVal });
        } while (this.match(TT.PUNC, ','));
      }
      this.expect(TT.PUNC, '}');
      return { type: 'ObjectPattern', properties, isDestructuring: true };
    }
    // Multiple comma-separated inline assignments (e.g. set a, b, c)
    const firstIdent = this.expect(TT.IDENT, null, 'Expected variable name').value;
    if (this.match(TT.PUNC, ':')) {
      this.parseTypeAnnotation();
    }
    if (this.check(TT.PUNC, ',')) {
      const elements = [firstIdent];
      while (this.match(TT.PUNC, ',')) {
        elements.push(this.expect(TT.IDENT, null, 'Expected variable name').value);
      }
      return { type: 'ArrayPattern', elements, isDestructuring: false };
    }
    return { type: 'Identifier', name: firstIdent };
  }

  parseFunctionDeclaration(decorators = []) {
    const loc = this.current();
    let async = false, generator = false;
    if (this.match(TT.KEYWORD, 'async')) async = true;
    this.expect(TT.KEYWORD, 'fn', 'Expected fn');
    if (this.match(TT.OP, '*')) generator = true;
    let name = '';
    if (this.check(TT.IDENT)) {
      name = this.match(TT.IDENT).value;
    }
    let typeParameters = [];
    if (this.match(TT.OP, '<')) {
      do {
        typeParameters.push(this.expect(TT.IDENT, null, 'Expected type parameter').value);
      } while (this.match(TT.PUNC, ','));
      this.expect(TT.OP, '>');
    }
    const params = this.parseParams();
    if (this.match(TT.PUNC, ':')) {
      this.parseTypeAnnotation();
    }
    const body = this.parseBlock();

    // Tail Call Optimization (TCO) detection
    let hasTailCalls = false;
    if (name && body && body.body) {
      const checkStmt = (s) => {
        if (!s) return;
        if (s.type === 'ReturnStatement' && s.argument && s.argument.type === 'CallExpression') {
          if (s.argument.callee.type === 'Identifier' && s.argument.callee.name === name) {
            s.argument.isTailCall = true;
            hasTailCalls = true;
          }
        } else if (s.type === 'IfStatement') {
          const listC = s.consequent ? (s.consequent.body || [s.consequent]) : [];
          for (const item of listC) checkStmt(item);
          const listA = s.alternate ? (s.alternate.body || [s.alternate]) : [];
          for (const item of listA) checkStmt(item);
        }
      };
      for (const stmt of body.body) checkStmt(stmt);
    }
    return { type: 'FunctionDeclaration', name, params, body, async, generator, hasTailCalls, typeParameters, decorators, loc };
  }

  parseParams() {
    this.expect(TT.PUNC, '(', 'Expected (');
    const params = [];
    if (!this.check(TT.PUNC, ')')) {
      do {
        this.skipNewlines();
        if (this.match(TT.OP, '...')) {
          const name = this.expect(TT.IDENT, null, 'Expected rest parameter name').value;
          params.push({ type: 'RestElement', argument: { type: 'Identifier', name } });
          break;
        }
        if (this.check(TT.PUNC, '[') || this.check(TT.PUNC, '{')) {
          params.push(this.parseBindingPattern());
        } else {
          const name = this.expect(TT.IDENT, null, 'Expected parameter name').value;
          if (this.match(TT.PUNC, ':')) {
            this.parseTypeAnnotation();
          }
          if (this.match(TT.OP, '=')) {
            const defVal = this.parseExpression();
            params.push({ type: 'AssignmentPattern', left: { type: 'Identifier', name }, right: defVal });
          } else {
            params.push({ type: 'Identifier', name });
          }
        }
      } while (this.match(TT.PUNC, ','));
    }
    this.expect(TT.PUNC, ')', 'Expected )');
    return params;
  }

  parseReturn() {
    const loc = this.expect(TT.KEYWORD, 'return');
    let argument = null;
    if (!this.check(TT.NEWLINE) && !this.check(TT.PUNC, '}') && !this.check(TT.PUNC, ';') && !this.check(TT.EOF)) {
      argument = this.parseExpression();
    }
    this.match(TT.PUNC, ';');
    return { type: 'ReturnStatement', argument, loc };
  }

  parseBreak() {
    const loc = this.expect(TT.KEYWORD, 'break');
    this.match(TT.PUNC, ';');
    return { type: 'BreakStatement', loc };
  }

  parseContinue() {
    const loc = this.expect(TT.KEYWORD, 'continue');
    this.match(TT.PUNC, ';');
    return { type: 'ContinueStatement', loc };
  }

  parseThrow() {
    const loc = this.expect(TT.KEYWORD, 'throw');
    const argument = this.parseExpression();
    this.match(TT.PUNC, ';');
    return { type: 'ThrowStatement', argument, loc };
  }

  parseDoWhile() {
    const loc = this.expect(TT.KEYWORD, 'do');
    const body = this.parseBlock();
    this.expect(TT.KEYWORD, 'while', 'Expected while after do block');
    const test = this.parseParenOrLooseExpression();
    this.match(TT.PUNC, ';');
    return { type: 'DoWhileStatement', test, body, loc };
  }

  parseIf() {
    const loc = this.expect(TT.KEYWORD, 'if');
    const test = this.parseParenOrLooseExpression();
    const consequent = this.parseBlock();
    let alternate = null;

    if (this.match(TT.KEYWORD, 'elseif') || this.match(TT.KEYWORD, 'elif')) {
      this.pos--;
      const alias = this.current().value;
      this.current().value = 'if';
      alternate = this.parseIf();
      this.current().value = alias;
    } else if (this.match(TT.KEYWORD, 'else')) {
      alternate = this.check(TT.KEYWORD, 'if') ? this.parseIf() : this.parseBlock();
    }

    return { type: 'IfStatement', test, consequent, alternate, loc };
  }

  parseWhile() {
    const loc = this.expect(TT.KEYWORD, 'while');
    const test = this.parseParenOrLooseExpression();
    const body = this.parseBlock();
    return { type: 'WhileStatement', test, body, loc };
  }

  parseLoop() {
    const loc = this.expect(TT.KEYWORD, 'loop');
    this.expect(TT.PUNC, '(');
    const count = this.parseExpression();
    this.expect(TT.PUNC, ')');
    const body = this.parseBlock();
    return { type: 'LoopStatement', count, body, loc };
  }

  parseRepeat() {
    const loc = this.expect(TT.KEYWORD, 'repeat');
    const count = this.parseExpression();
    this.expect(TT.KEYWORD, 'times', 'Expected times after repeat count');
    const body = this.parseBlock();
    return { type: 'RepeatStatement', count, body, loc };
  }

  parseForeach() {
    const loc = this.expect(TT.KEYWORD, 'foreach');
    let isAwait = false;
    if (this.match(TT.KEYWORD, 'await')) isAwait = true;
    const hasParen = this.match(TT.PUNC, '(');
    if (this.check(TT.KEYWORD, 'set') || this.check(TT.KEYWORD, 'const')) this.advance();
    const item = this.expect(TT.IDENT, null, 'Expected foreach variable').value;
    this.expect(TT.KEYWORD, 'in', 'Expected in');
    const iterable = this.parseExpression();
    if (hasParen) this.expect(TT.PUNC, ')');
    const body = this.parseBlock();
    if (isAwait) {
      return { type: 'ForAwaitStatement', item, iterable, body, loc };
    }
    return { type: 'ForeachStatement', item, iterable, body, loc };
  }

  parseTryCatch() {
    const loc = this.expect(TT.KEYWORD, 'try');
    const block = this.parseBlock();
    
    let param = null;
    let handler = null;
    if (this.match(TT.KEYWORD, 'catch')) {
      this.expect(TT.PUNC, '(');
      param = this.expect(TT.IDENT, null, 'Expected catch parameter').value;
      this.expect(TT.PUNC, ')');
      handler = this.parseBlock();
    }
    
    let finalizer = null;
    if (this.match(TT.KEYWORD, 'finally')) {
      finalizer = this.parseBlock();
    }
    
    if (!handler && !finalizer) {
      this.error('Expected catch or finally after try block');
    }
    
    return { type: 'TryCatchStatement', block, param, handler, finalizer, loc };
  }

  parseGuard() {
    const loc = this.expect(TT.KEYWORD, 'guard');
    const test = this.parseExpression();
    this.expect(TT.KEYWORD, 'else', 'Expected else after guard condition');
    const body = this.parseBlock();
    return { type: 'GuardStatement', test, body, loc };
  }

  parseMatch() {
    const loc = this.expect(TT.KEYWORD, 'match');
    const discriminant = this.parseExpression();
    this.expect(TT.PUNC, '{');
    this.skipNewlines();
    const cases = [];
    while (!this.check(TT.PUNC, '}') && !this.eof()) {
      const pattern = this.parseMatchPattern();
      this.expect(TT.OP, '=>');
      const consequent = this.parseStatement();
      cases.push({ pattern, consequent });
      this.skipNewlines();
    }
    this.expect(TT.PUNC, '}');
    return { type: 'MatchStatement', discriminant, cases, loc };
  }

  parseMatchPattern() {
    const t = this.current();
    if (this.match(TT.IDENT, '_') || this.match(TT.KEYWORD, 'default') || this.match(TT.KEYWORD, '_')) {
      return { type: 'MatchDefaultPattern' };
    }
    if (this.match(TT.PUNC, '{')) {
      const properties = [];
      if (!this.check(TT.PUNC, '}')) {
        do {
          const key = this.expect(TT.IDENT, null, 'Expected property key').value;
          this.expect(TT.PUNC, ':');
          const value = this.parseExpression();
          properties.push({ key, value });
        } while (this.match(TT.PUNC, ','));
      }
      this.expect(TT.PUNC, '}');
      return { type: 'MatchObjectPattern', properties };
    }
    return { type: 'MatchValuePattern', value: this.parseExpression() };
  }

  parseClassDeclaration(decorators = []) {
    const loc = this.expect(TT.KEYWORD, 'class');
    const name = this.expect(TT.IDENT, null, 'Expected class name').value;
    let typeParameters = [];
    if (this.match(TT.OP, '<')) {
      do {
        typeParameters.push(this.expect(TT.IDENT, null, 'Expected type parameter').value);
      } while (this.match(TT.PUNC, ','));
      this.expect(TT.OP, '>');
    }
    let superClass = null;
    if (this.match(TT.KEYWORD, 'extends')) {
      superClass = this.expect(TT.IDENT, null, 'Expected superclass name').value;
      if (this.match(TT.OP, '<')) {
        while (!this.check(TT.OP, '>') && !this.eof()) this.advance();
        this.match(TT.OP, '>');
      }
    }

    if (!global.WateClasses) global.WateClasses = new Set();
    global.WateClasses.add(name);

    const interfaces = [];
    if (this.match(TT.KEYWORD, 'implements')) {
      do {
        interfaces.push(this.expect(TT.IDENT, null, 'Expected interface name').value);
      } while (this.match(TT.PUNC, ','));
    }

    this.expect(TT.PUNC, '{');
    const methods = [];
    this.skipNewlines();
    while (!this.check(TT.PUNC, '}') && !this.eof()) {
      let methodDecorators = [];
      if (this.check(TT.PUNC, '@')) {
        methodDecorators = this.parseDecorators();
      }

      let isStatic = false, async = false, generator = false;
      if (this.match(TT.KEYWORD, 'static')) isStatic = true;
      if (this.match(TT.KEYWORD, 'async')) async = true;
      if (this.match(TT.KEYWORD, 'fn')) {
        if (this.match(TT.OP, '*')) generator = true;
      }

      let kind = 'method';
      if ((this.check(TT.IDENT, 'get') || this.check(TT.KEYWORD, 'get')) && this.tokens[this.pos + 1] && (this.tokens[this.pos + 1].type === TT.IDENT || this.tokens[this.pos + 1].type === TT.KEYWORD)) {
        this.pos++;
        kind = 'get';
      } else if ((this.check(TT.IDENT, 'set') || this.check(TT.KEYWORD, 'set')) && this.tokens[this.pos + 1] && (this.tokens[this.pos + 1].type === TT.IDENT || this.tokens[this.pos + 1].type === TT.KEYWORD)) {
        this.pos++;
        kind = 'set';
      }

      const tok = this.current();
      let fieldOrMethodName = '';
      if (this.match(TT.IDENT) || this.match(TT.KEYWORD)) {
        fieldOrMethodName = tok.value;
      } else {
        this.error('Expected field or method name');
      }

      let methodTypeParams = [];
      if (this.match(TT.OP, '<')) {
        do {
          methodTypeParams.push(this.expect(TT.IDENT, null, 'Expected method type parameter').value);
        } while (this.match(TT.PUNC, ','));
        this.expect(TT.OP, '>');
      }

      if (this.check(TT.PUNC, '(')) {
        const params = this.parseParams();
        if (this.match(TT.PUNC, ':')) {
          this.parseTypeAnnotation();
        }
        const body = this.parseBlock();
        methods.push({ type: 'MethodDefinition', name: fieldOrMethodName, params, body, isStatic, async, generator, kind, decorators: methodDecorators, typeParameters: methodTypeParams });
      } else {
        let value = null;
        if (this.match(TT.OP, '=')) {
          value = this.parseExpression();
        }
        this.match(TT.PUNC, ';');
        methods.push({ type: 'FieldDefinition', name: fieldOrMethodName, value, isStatic, decorators: methodDecorators });
      }
      this.skipNewlines();
    }
    this.expect(TT.PUNC, '}');

    // --- COMPILE-TIME INTERFACE VALIDATION ---
    if (interfaces.length > 0) {
      const declaredMethodNames = new Set(methods.filter(m => m.type === 'MethodDefinition').map(m => m.name));
      const registered = global.WateInterfaces || {};

      for (const iface of interfaces) {
        const required = registered[iface];
        if (required) {
          const missing = required.filter(m => !declaredMethodNames.has(m));
          if (missing.length > 0) {
            throw new WateSyntaxError(
              `Class '${name}' implements interface '${iface}' but is missing required methods: [${missing.join(', ')}]`,
              loc,
              this.filePath,
              this.source
            );
          }
        }
      }
    }

    return { type: 'ClassDeclaration', name, superClass, interfaces, methods, decorators, loc };
  }

  parseInterface() {
    const loc = this.expect(TT.KEYWORD, 'interface');
    const name = this.expect(TT.IDENT, null, 'Expected interface name').value;
    this.expect(TT.PUNC, '{');
    const methods = [];
    this.skipNewlines();
    while (!this.check(TT.PUNC, '}') && !this.eof()) {
      this.expect(TT.KEYWORD, 'method');
      const methodName = this.expect(TT.IDENT, null, 'Expected method name').value;
      this.match(TT.PUNC, ';');
      methods.push(methodName);
      this.skipNewlines();
    }
    this.expect(TT.PUNC, '}');

    if (!global.WateInterfaces) global.WateInterfaces = {};
    global.WateInterfaces[name] = methods;

    return { type: 'InterfaceDeclaration', name, methods, loc };
  }

  parseParenOrLooseExpression() {
    if (this.match(TT.PUNC, '(')) {
      const expr = this.parseExpression();
      this.expect(TT.PUNC, ')');
      return expr;
    }
    return this.parseExpression();
  }

  parseBlock() {
    this.expect(TT.PUNC, '{', 'Expected block opening {');
    const body = [];
    this.skipNewlines();
    while (!this.check(TT.PUNC, '}') && !this.eof()) {
      body.push(this.parseStatement());
      this.skipNewlines();
    }
    this.expect(TT.PUNC, '}', 'Expected block closing }');
    return { type: 'BlockStatement', body };
  }

  parseExpression(precedence = 0) {
    let left = this.parsePrefix();

    while (true) {
      const t = this.current();
      if (!t) break;

      // Conditional (Ternary) Operator `? :` has precedence 1.5
      if (precedence < 1.5 && this.match(TT.PUNC, '?')) {
        const consequent = this.parseExpression();
        this.expect(TT.PUNC, ':', 'Expected : in ternary expression');
        const alternate = this.parseExpression(1);
        left = { type: 'ConditionalExpression', test: left, consequent, alternate };
        continue;
      }

      if (this.check(TT.PUNC, '(')) {
        left = this.finishCall(left);
        continue;
      }
      if (this.match(TT.PUNC, '.')) {
        const propTok = this.current();
        if (this.match(TT.IDENT) || this.match(TT.KEYWORD)) {
          left = { type: 'MemberExpression', object: left, property: { type: 'Identifier', name: propTok.value }, computed: false, optional: false };
        } else {
          this.error('Expected property name');
        }
        continue;
      }
      if (this.match(TT.OP, '?.')) {
        if (this.match(TT.PUNC, '[')) {
          const prop = this.parseExpression();
          this.expect(TT.PUNC, ']');
          left = { type: 'MemberExpression', object: left, property: prop, computed: true, optional: true };
        } else if (this.check(TT.PUNC, '(')) {
          left = this.finishCall(left, true);
        } else {
          const propTok = this.current();
          if (this.match(TT.IDENT) || this.match(TT.KEYWORD)) {
            left = { type: 'MemberExpression', object: left, property: { type: 'Identifier', name: propTok.value }, computed: false, optional: true };
          } else {
            this.error('Expected property name after ?.');
          }
        }
        continue;
      }
      if (this.match(TT.PUNC, '[')) {
        const prop = this.parseExpression();
        this.expect(TT.PUNC, ']');
        left = { type: 'MemberExpression', object: left, property: prop, computed: true, optional: false };
        continue;
      }

      const opInfo = this.currentBinaryOp();
      if (!opInfo || opInfo.prec < precedence) break;

      this.pos += opInfo.consumeCount;
      const right = this.parseExpression(opInfo.prec + (opInfo.rightAssoc ? 0 : 1));
      left = { type: 'BinaryExpression', operator: opInfo.op, left, right, loc: t };
    }

    return left;
  }

  currentBinaryOp() {
    const t = this.current();
    if (!t) return null;

    // Check for "is not"
    if (t.type === TT.KEYWORD && t.value === 'is') {
      const next = this.tokens[this.pos + 1];
      if (next && next.type === TT.KEYWORD && next.value === 'not') {
        return { op: 'is not', prec: 4, rightAssoc: false, consumeCount: 2 };
      }
      return { op: 'is', prec: 4, rightAssoc: false, consumeCount: 1 };
    }

    // Check for "not in"
    if (t.type === TT.KEYWORD && t.value === 'not') {
      const next = this.tokens[this.pos + 1];
      if (next && next.type === TT.KEYWORD && next.value === 'in') {
        return { op: 'not in', prec: 5, rightAssoc: false, consumeCount: 2 };
      }
    }

    const map = {
      '=': [1, true], '+=': [1, true], '-=': [1, true], '*=': [1, true], '/=': [1, true], '%=': [1, true], ':=': [1, true],
      '&=': [1, true], '|=': [1, true], '^=': [1, true], '??=': [1, true],
      'or': [2, false], '||': [2, false],
      '??': [2.5, false],
      'and': [3, false], '&&': [3, false],
      '|': [3.2, false],
      '^': [3.4, false],
      '&': [3.6, false],
      '==': [4, false], '!=': [4, false], '===': [4, false], '!==': [4, false],
      '<': [5, false], '<=': [5, false], '>': [5, false], '>=': [5, false], 'in': [5, false],
      '<<': [5.5, false], '>>': [5.5, false], '>>>': [5.5, false],
      '+': [6, false], '-': [6, false],
      '*': [7, false], '/': [7, false], '%': [7, false],
      '**': [8, true]
    };
    const key = t.value;
    if ((t.type === TT.OP || t.type === TT.KEYWORD) && map[key]) {
      const [prec, rightAssoc] = map[key];
      return { op: key, prec, rightAssoc, consumeCount: 1 };
    }
    return null;
  }

  parsePrefix() {
    const t = this.current();

    // Anonymous / Expression Function Closure (e.g. fn(req, res) { ... })
    if (this.check(TT.KEYWORD, 'fn') || (this.check(TT.KEYWORD, 'async') && this.tokens[this.pos + 1] && this.tokens[this.pos + 1].type === TT.KEYWORD && this.tokens[this.pos + 1].value === 'fn')) {
      let async = false;
      if (this.match(TT.KEYWORD, 'async')) async = true;
      this.expect(TT.KEYWORD, 'fn');
      let generator = false;
      if (this.match(TT.OP, '*')) generator = true;
      let name = '';
      if (this.check(TT.IDENT)) {
        name = this.match(TT.IDENT).value;
      }
      const params = this.parseParams();
      const body = this.parseBlock();
      return { type: 'FunctionDeclaration', name, params, body, async, generator };
    }

    // Yield expression
    if (this.match(TT.KEYWORD, 'yield')) {
      let delegate = false;
      if (this.match(TT.OP, '*')) delegate = true;
      let argument = null;
      if (!this.check(TT.NEWLINE) && !this.check(TT.PUNC, ';') && !this.check(TT.PUNC, '}') && !this.check(TT.PUNC, ')') && !this.check(TT.PUNC, ']') && !this.check(TT.EOF)) {
        argument = this.parseExpression();
      }
      return { type: 'YieldExpression', argument, delegate };
    }

    // Spread expression
    if (this.match(TT.OP, '...')) {
      return { type: 'SpreadElement', argument: this.parseExpression() };
    }

    if (this.match(TT.OP, '!') || this.match(TT.KEYWORD, 'not') || this.match(TT.KEYWORD, 'await') || this.match(TT.OP, '-') || this.match(TT.OP, '+') || this.match(TT.OP, '~')) {
      const prevTok = this.prev();
      if (prevTok.value === 'await') {
        return { type: 'AwaitExpression', argument: this.parseExpression(9) };
      }
      const op = prevTok.value === 'not' ? '!' : prevTok.value;
      return { type: 'UnaryExpression', operator: op, argument: this.parseExpression(9) };
    }

    if (this.match(TT.NUMBER)) return { type: 'Literal', value: Number(t.value), raw: t.value };
    if (this.match(TT.STRING)) return { type: 'Literal', value: t.value, raw: JSON.stringify(t.value) };

    if (t.type === TT.F_STRING) {
      this.pos++;
      return this.parseFString(t);
    }

    if (t.type === TT.KEYWORD && BOOLEAN_NULL_MAP[t.value]) {
      this.pos++;
      return { type: 'RawLiteral', raw: BOOLEAN_NULL_MAP[t.value] };
    }

    if (this.match(TT.IDENT) || (t.type === TT.KEYWORD && ['out', 'print', 'err', 'warn', 'input', 'type', 'log'].includes(t.value) && (this.pos++, true))) {
      return { type: 'Identifier', name: t.value };
    }

    if (this.match(TT.PUNC, '(')) {
      const expr = this.parseExpression();
      this.expect(TT.PUNC, ')');
      return expr;
    }

    if (this.match(TT.PUNC, '[')) return this.parseArrayLiteral();
    if (this.match(TT.PUNC, '{')) return this.parseObjectLiteral();

    this.error(`Unexpected token '${t.value}' in expression`, t);
  }

  parseFString(token) {
    const value = token.value;
    const parts = [];
    let lastIdx = 0;
    let i = 0;
    while (i < value.length) {
      if (value[i] === '{') {
        if (i > lastIdx) {
          parts.push({ type: 'Literal', value: value.slice(lastIdx, i) });
        }
        i++;
        let start = i;
        let depth = 1;
        while (i < value.length && depth > 0) {
          if (value[i] === '{') depth++;
          else if (value[i] === '}') {
            depth--;
            if (depth === 0) break;
          }
          i++;
        }
        if (i >= value.length) {
          this.error('Unterminated interpolation in f-string', token);
        }
        const exprStr = value.slice(start, i);
        i++;
        lastIdx = i;

        const subTokens = new Lexer(exprStr, this.filePath).tokenize();
        const subParser = new Parser(subTokens.filter(st => st.type !== TT.EOF), this.filePath, exprStr);
        const exprNode = subParser.parseExpression();
        parts.push({ type: 'Interpolation', expression: exprNode });
      } else {
        i++;
      }
    }
    if (i > lastIdx) {
      parts.push({ type: 'Literal', value: value.slice(lastIdx, i) });
    }
    return { type: 'TemplateLiteral', parts };
  }

  parseArrayLiteral() {
    // List comprehension lookahead check
    let isComprehension = false;
    let depth = 1;
    for (let j = this.pos; j < this.tokens.length; j++) {
      const t = this.tokens[j];
      if (t.type === TT.PUNC && t.value === '[') depth++;
      if (t.type === TT.PUNC && t.value === ']') depth--;
      if (depth === 0) break;
      if (depth === 1 && t.type === TT.KEYWORD && t.value === 'for') {
        isComprehension = true;
        break;
      }
    }

    if (isComprehension) {
      const expr = this.parseExpression();
      this.expect(TT.KEYWORD, 'for');
      const item = this.expect(TT.IDENT, null, 'Expected iteration variable').value;
      this.expect(TT.KEYWORD, 'in');
      const iterable = this.parseExpression();
      let filter = null;
      if (this.match(TT.KEYWORD, 'if')) {
        filter = this.parseExpression();
      }
      this.expect(TT.PUNC, ']');
      return { type: 'ListComprehension', expression: expr, item, iterable, filter };
    }

    const elements = [];
    this.skipNewlines();
    if (!this.check(TT.PUNC, ']')) {
      do {
        this.skipNewlines();
        elements.push(this.parseExpression());
        this.skipNewlines();
      } while (this.match(TT.PUNC, ','));
    }
    this.skipNewlines();
    this.expect(TT.PUNC, ']');
    return { type: 'ArrayExpression', elements };
  }

  parseObjectLiteral() {
    const properties = [];
    this.skipNewlines();
    if (!this.check(TT.PUNC, '}')) {
      do {
        this.skipNewlines();
        if (this.match(TT.OP, '...')) {
          const argument = this.parseExpression();
          properties.push({ type: 'SpreadProperty', argument });
          this.skipNewlines();
          continue;
        }
        const keyTok = this.current();
        let key;
        if (this.match(TT.IDENT) || this.match(TT.STRING) || this.match(TT.KEYWORD)) key = keyTok.value;
        else this.error('Expected object key');
        
        let value;
        if (this.match(TT.PUNC, ':')) {
          value = this.parseExpression();
        } else {
          value = { type: 'Identifier', name: key };
        }
        properties.push({ key, value });
        this.skipNewlines();
      } while (this.match(TT.PUNC, ','));
    }
    this.skipNewlines();
    this.expect(TT.PUNC, '}');
    return { type: 'ObjectExpression', properties };
  }

  finishCall(callee, optional = false) {
    this.expect(TT.PUNC, '(');
    const args = [];
    if (!this.check(TT.PUNC, ')')) {
      do {
        this.skipNewlines();
        if (this.match(TT.OP, '...')) {
          args.push({ type: 'SpreadElement', argument: this.parseExpression() });
        } else {
          args.push(this.parseExpression());
        }
        this.skipNewlines();
      } while (this.match(TT.PUNC, ','));
    }
    this.expect(TT.PUNC, ')');
    return { type: 'CallExpression', callee, arguments: args, optional };
  }
}

// ============================================================
// JavaScript Code Generator
// ============================================================
class CodeGenerator {
  constructor(options = {}) {
    this.loopId = 0;
    this.options = options;
  }

  generate(ast) {
    const code = this.gen(ast);
    const helpers = `
function __wate_decorate(decorators, target) {
  for (let i = decorators.length - 1; i >= 0; i--) {
    const dec = decorators[i];
    if (typeof dec === 'function') {
      const res = dec(target);
      if (res !== undefined) target = res;
    }
  }
  return target;
}
function __wate_decorateMethod(decorators, proto, prop) {
  let desc = Object.getOwnPropertyDescriptor(proto, prop) || { value: proto[prop], writable: true, enumerable: false, configurable: true };
  for (let i = decorators.length - 1; i >= 0; i--) {
    const dec = decorators[i];
    if (typeof dec === 'function') {
      const res = dec(proto, prop, desc);
      if (res !== undefined) desc = res;
    }
  }
  if (desc) Object.defineProperty(proto, prop, desc);
}
`;
    if (code.includes('__wate_decorate')) {
      return helpers + '\n' + code;
    }
    return code;
  }

  gen(node) {
    if (!node) return '';
    let code = this.genRaw(node);
    const statements = [
      'VariableDeclaration', 'ExpressionStatement', 'ReturnStatement', 
      'ThrowStatement', 'IfStatement', 'WhileStatement', 'RepeatStatement', 
      'ForeachStatement', 'TryCatchStatement', 'FunctionDeclaration', 'ClassDeclaration',
      'EnumDeclaration', 'ForAwaitStatement'
    ];
    if (statements.includes(node.type) && node.loc && node.loc.line) {
      code += ` /* WATE_LINE:${node.loc.line} */`;
      if (this.options && this.options.coverage) {
        const fp = JSON.stringify(this.options.filePath || '<file>');
        code = `globalThis.__wate_cov && globalThis.__wate_cov.hit(${fp}, ${node.loc.line}); ` + code;
      }
    }
    return code;
  }

  genRaw(node) {
    if (!node) return '';
    switch (node.type) {
      case 'Program': return node.body.map(n => this.gen(n)).join('\n');
      case 'BlockStatement': return `{\n${this.indent(node.body.map(n => this.gen(n)).join('\n'))}\n}`;
      case 'ImportStatement': {
        const BUILTINS = ['file', 'sys', 'http', 'math', 'str', 'input', 'json', 'date', 'color', 'os', 'env', 'regex', 'crypto', 'wpath', 'list', 'num', 'assert', 'timer', 'stack', 'queue', 'table', 'type', 'every', 'thread', 'stream', 'ws', 'jwt', 'orm', 'args', 'logger', 'xml', 'yaml', 'img', 'pdf', 'i18n'];
        const isBuiltin = BUILTINS.includes(node.source);
        const modRef = isBuiltin
          ? `(typeof ${node.source} !== 'undefined' ? ${node.source} : require(${JSON.stringify(node.source)}))`
          : `require(${JSON.stringify(node.source)})`;

        if (node.alias) {
          return `// [WATE AST Import: ${node.source} as ${node.alias}]\nvar ${node.alias} = ${modRef};`;
        }
        if (node.specifiers && node.specifiers.length > 0) {
          const specStr = node.specifiers.map(s => s.imported === s.local ? s.imported : `${s.imported}: ${s.local}`).join(', ');
          return `// [WATE AST Selective Import: ${node.source}]\nvar { ${specStr} } = ${modRef};`;
        }
        const identifier = node.source.replace(/[^a-zA-Z0-9_$]/g, '_');
        return `// [WATE AST Import] ${node.source}\nvar ${identifier} = ${modRef};`;
      }
      case 'ImportBlock': {
        let code = `// [WATE AST Inlined Import: ${node.source}]\n${node.body.map(n => this.gen(n)).join('\n')}\n`;
        if (node.alias) {
          const exportNames = [];
          for (const s of node.body) {
            const decl = s.type === 'ExportNamedDeclaration' ? s.declaration : s;
            if (!decl) continue;
            if (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') exportNames.push(decl.name);
            else if (decl.type === 'VariableDeclaration') {
              for (const d of decl.declarations) if (d.id && d.id.type === 'Identifier') exportNames.push(d.id.name);
            }
          }
          const uniqueNames = [...new Set(exportNames)];
          const objProps = uniqueNames.join(', ');
          code += `var ${node.alias} = { ${objProps} };\n`;
        }
        if (node.specifiers && node.specifiers.length > 0) {
          for (const s of node.specifiers) {
            if (s.imported !== s.local) {
              code += `var ${s.local} = ${s.imported};\n`;
            }
          }
        }
        code += `// [End Import]`;
        return code;
      }
      case 'ExportNamedDeclaration': return `/* export */ ${this.gen(node.declaration)}`;
      case 'MacroDeclaration': return `/* macro ${node.name} expanded at compile-time */`;
      case 'VariableDeclaration': return this.genVar(node);
      case 'FunctionDeclaration': {
        const params = (node.params || []).map(p => this.genParam(p)).join(', ');
        if (node.hasTailCalls && !node.generator && !node.async) {
          const bodyCode = this.genTcoBody(node.body, node.name, node.params);
          return `function ${node.name}(${params}) {\n  _tco_loop: while (true) {\n${this.indent(bodyCode)}\n  break;\n  }\n}`;
        }
        let fnCode = `${node.async ? 'async ' : ''}function${node.generator ? '*' : ''} ${node.name}(${params}) ${this.gen(node.body)}`;
        if (node.decorators && node.decorators.length > 0) {
          const decCalls = node.decorators.map(d => d.args ? `${d.name}(${d.args.map(a => this.gen(a)).join(', ')})` : d.name);
          fnCode += `\n${node.name} = __wate_decorate([${decCalls.join(', ')}], ${node.name});`;
        }
        return fnCode;
      }
      case 'ClassDeclaration': return this.genClass(node);
      case 'InterfaceDeclaration': return `// [WATE AST Interface] ${node.name}`;
      case 'EnumDeclaration': return this.genEnum(node);
      case 'TypeAliasDeclaration': return `/* type ${node.name} = ${node.typeDefinition} */`;
      case 'ReturnStatement': return `return${node.argument ? ' ' + this.gen(node.argument) : ''};`;
      case 'BreakStatement': return 'break;';
      case 'ContinueStatement': return 'continue;';
      case 'ThrowStatement': return `throw ${this.gen(node.argument)};`;
      case 'DoWhileStatement': return `do ${this.gen(node.body)} while (${this.gen(node.test)});`;
      case 'AwaitExpression': return `await ${this.gen(node.argument)}`;
      case 'YieldExpression': return `(yield${node.delegate ? '*' : ''}${node.argument ? ' ' + this.gen(node.argument) : ''})`;
      case 'SpreadElement': return `...${this.gen(node.argument)}`;
      case 'IfStatement': return this.genIf(node);
      case 'WhileStatement': return `while (${this.gen(node.test)}) ${this.gen(node.body)}`;
      case 'LoopStatement': return this.genCountLoop(node.count, node.body, '_wl');
      case 'RepeatStatement': return this.genCountLoop(node.count, node.body, '_wr');
      case 'ForeachStatement': return `for (let ${node.item} of ${this.gen(node.iterable)}) ${this.gen(node.body)}`;
      case 'ForAwaitStatement': return `for await (const ${node.item} of ${this.gen(node.iterable)}) ${this.gen(node.body)}`;
      case 'TryCatchStatement': {
        let code = `try ${this.gen(node.block)}`;
        if (node.handler) code += ` catch (${node.param}) ${this.gen(node.handler)}`;
        if (node.finalizer) code += ` finally ${this.gen(node.finalizer)}`;
        return code;
      }
      case 'ExpressionStatement': return `${this.gen(node.expression)};`;
      case 'Identifier': return node.name;
      case 'Literal': return typeof node.value === 'string' ? JSON.stringify(node.value) : String(node.value);
      case 'RawLiteral': return node.raw;
      case 'ArrayExpression': return `[${node.elements.map(e => this.gen(e)).join(', ')}]`;
      case 'ObjectExpression': return `{ ${node.properties.map(p => p.type === 'SpreadProperty' ? '...' + this.gen(p.argument) : `${this.safeKey(p.key)}: ${this.gen(p.value)}`).join(', ')} }`;
      case 'CallExpression': return this.genCall(node);
      case 'MemberExpression': {
        const obj = this.gen(node.object);
        if (node.optional) {
          return node.computed ? `${obj}?.[${this.gen(node.property)}]` : `${obj}?.${this.gen(node.property)}`;
        }
        return `${obj}${node.computed ? `[${this.gen(node.property)}]` : `.${this.gen(node.property)}`}`;
      }
      case 'UnaryExpression': return `${node.operator}${this.gen(node.argument)}`;
      case 'BinaryExpression': return this.genBinary(node);
      case 'ArrayPattern':
        return `[${(node.elements || []).map(e => {
          if (!e) return '';
          if (e.type === 'RestElement') return `...${e.argument.name || this.gen(e.argument)}`;
          if (e.type === 'AssignmentPattern') return `${e.left.name || this.gen(e.left)} = ${this.gen(e.right)}`;
          return e.name || this.gen(e);
        }).join(', ')}]`;
      case 'ObjectPattern':
        return `{ ${(node.properties || []).map(p => {
          if (typeof p === 'string') return p;
          if (p.type === 'RestElement') return `...${p.argument.name || this.gen(p.argument)}`;
          const keyPart = p.key === p.target ? p.key : `${p.key}: ${p.target}`;
          return p.default ? `${keyPart} = ${this.gen(p.default)}` : keyPart;
        }).join(', ')} }`;
      case 'GuardStatement': return `if (!(${this.gen(node.test)})) ${this.gen(node.body)}`;
      case 'LabeledStatement': return `${node.label}: ${this.gen(node.body)}`;
      case 'TemplateLiteral':
        return '`' + node.parts.map(p => {
          if (p.type === 'Literal') {
            return p.value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
          } else {
            return '${' + this.gen(p.expression) + '}';
          }
        }).join('') + '`';
      case 'ListComprehension':
        const filterStr = node.filter ? `.filter(${node.item} => ${this.gen(node.filter)})` : '';
        return `${this.gen(node.iterable)}${filterStr}.map(${node.item} => ${this.gen(node.expression)})`;
      case 'ConditionalExpression':
        return `(${this.gen(node.test)} ? ${this.gen(node.consequent)} : ${this.gen(node.alternate)})`;
      case 'MatchStatement': return this.genMatch(node);
      default: throw new Error(`Unknown AST node: ${node.type}`);
    }
  }

  genVar(node) {
    const parts = node.declarations.map(d => `${this.gen(d.id)}${d.init ? ' = ' + this.gen(d.init) : ''}`);
    return `${node.kind} ${parts.join(', ')};`;
  }

  genClass(node) {
    const head = `class ${node.name}${node.superClass ? ' extends ' + node.superClass : ''}`;
    let hasIter = false, isIterAsync = false;
    const members = [];

    for (const m of node.methods) {
      if (m.type === 'FieldDefinition') {
        members.push(`${m.isStatic ? 'static ' : ''}${m.name}${m.value ? ' = ' + this.gen(m.value) : ''};`);
        continue;
      }
      if (m.name === '__iter__') {
        hasIter = true;
        isIterAsync = !!m.async;
      }
      let mName = m.name;
      if (mName === 'init') mName = 'constructor';
      const prefix = `${m.isStatic ? 'static ' : ''}${m.kind === 'get' ? 'get ' : m.kind === 'set' ? 'set ' : ''}${m.async ? 'async ' : ''}${m.generator ? '*' : ''}`;
      const params = (m.params || []).map(p => this.genParam(p)).join(', ');
      let bodyCode = this.gen(m.body);
      if (mName === 'constructor' && node.superClass && !bodyCode.includes('super(')) {
        bodyCode = bodyCode.replace(/^\{\s*/, '{\n  super();\n  ');
      }
      members.push(`${prefix}${mName}(${params}) ${bodyCode}`);
    }

    if (hasIter) {
      if (isIterAsync) {
        members.push(`[Symbol.asyncIterator]() { return this.__iter__(); }`);
      } else {
        members.push(`[Symbol.iterator]() { return this.__iter__(); }`);
      }
    }

    let classCode = `${head} {\n${this.indent(members.join('\n'))}\n}`;

    for (const m of node.methods) {
      if (m.decorators && m.decorators.length > 0) {
        const decCalls = m.decorators.map(d => d.args ? `${d.name}(${d.args.map(a => this.gen(a)).join(', ')})` : d.name);
        const targetObj = m.isStatic ? node.name : `${node.name}.prototype`;
        classCode += `\n__wate_decorateMethod([${decCalls.join(', ')}], ${targetObj}, ${JSON.stringify(m.name)});`;
      }
    }

    if (node.decorators && node.decorators.length > 0) {
      const decCalls = node.decorators.map(d => d.args ? `${d.name}(${d.args.map(a => this.gen(a)).join(', ')})` : d.name);
      classCode += `\n${node.name} = __wate_decorate([${decCalls.join(', ')}], ${node.name});`;
    }

    return classCode;
  }

  genIf(node) {
    let out = `if (${this.gen(node.test)}) ${this.gen(node.consequent)}`;
    if (node.alternate) {
      if (node.alternate.type === 'IfStatement') out += ` else ${this.gen(node.alternate)}`;
      else out += ` else ${this.gen(node.alternate)}`;
    }
    return out;
  }

  genCountLoop(countNode, body, prefix) {
    const v = `${prefix}${this.loopId++}`;
    return `for (let ${v} = 0; ${v} < ${this.gen(countNode)}; ${v}++) ${this.gen(body)}`;
  }

  genParam(p) {
    if (!p) return '';
    if (typeof p === 'string') return p;
    if (p.type === 'RestElement') return `...${p.argument.name || this.gen(p.argument)}`;
    if (p.type === 'AssignmentPattern') return `${p.left.name || this.gen(p.left)} = ${this.gen(p.right)}`;
    if (p.type === 'ArrayPattern') {
      return `[${(p.elements || []).map(e => this.genParam(e)).join(', ')}]`;
    }
    if (p.type === 'ObjectPattern') {
      return `{ ${(p.properties || []).map(prop => {
        if (typeof prop === 'string') return prop;
        if (prop.type === 'RestElement') return `...${prop.argument.name || this.gen(prop.argument)}`;
        const keyPart = prop.key === prop.target ? prop.key : `${prop.key}: ${prop.target}`;
        return prop.default ? `${keyPart} = ${this.gen(prop.default)}` : keyPart;
      }).join(', ')} }`;
    }
    return p.name || this.gen(p);
  }

  genEnum(node) {
    const lines = [];
    const keys = [];
    const values = [];
    for (const m of node.members) {
      const valRep = typeof m.value === 'string' ? JSON.stringify(m.value) : (typeof m.value === 'number' ? m.value : this.gen(m.value));
      lines.push(`${JSON.stringify(m.key)}: ${valRep}`);
      keys.push(JSON.stringify(m.key));
      values.push(valRep);
      if (typeof m.value === 'number') {
        lines.push(`${m.value}: ${JSON.stringify(m.key)}`);
      }
    }
    lines.push(`keys() { return [${keys.join(', ')}]; }`);
    lines.push(`values() { return [${values.join(', ')}]; }`);
    return `const ${node.name} = Object.freeze({\n${this.indent(lines.join(',\n'))}\n});`;
  }

  genCall(node) {
    let callee = this.gen(node.callee);
    if (callee === 'out' || callee === 'print') callee = 'console.log';
    if (callee === 'err') callee = 'console.error';
    if (callee === 'warn') callee = 'console.warn';
    const isClass = global.WateClasses && global.WateClasses.has(callee);
    const args = (node.arguments || []).map(a => a.type === 'SpreadElement' ? `...${this.gen(a.argument)}` : this.gen(a)).join(', ');
    const opt = node.optional ? '?.' : '';
    return `${isClass ? 'new ' : ''}${callee}${opt}(${args})`;
  }

  genBinary(node) {
    let op = node.operator;
    if (op === 'and') op = '&&';
    if (op === 'or') op = '||';
    if (op === 'is') {
      const rightGen = this.gen(node.right);
      const isClass = global.WateClasses && global.WateClasses.has(rightGen);
      if (isClass) {
        return `(${this.gen(node.left)} instanceof ${rightGen})`;
      }
      return `(${this.gen(node.left)} === ${rightGen})`;
    }
    if (op === 'is not') op = '!==';
    if (op === ':=') op = '=';
    if (op === '??') return `(${this.gen(node.left)} ?? ${this.gen(node.right)})`;
    if (op === '??=') return `(${this.gen(node.left)} ??= ${this.gen(node.right)})`;
    if (op === 'not in') return `!${this.gen(node.right)}.includes(${this.gen(node.left)})`;
    if (op === 'in') return `${this.gen(node.right)}.includes(${this.gen(node.left)})`;
    return `(${this.gen(node.left)} ${op} ${this.gen(node.right)})`;
  }

  genMatch(node) {
    const discName = `_matchDisc`;
    let out = `{\n  const ${discName} = ${this.gen(node.discriminant)};\n`;
    let first = true;
    for (const c of node.cases) {
      let cond = '';
      if (c.pattern.type === 'MatchDefaultPattern') {
        cond = 'true';
      } else if (c.pattern.type === 'MatchObjectPattern') {
        cond = c.pattern.properties.map(p => `${discName}.${p.key} === ${this.gen(p.value)}`).join(' && ');
      } else {
        cond = `${discName} === ${this.gen(c.pattern.value)}`;
      }

      if (first) {
        out += `  if (${cond}) ${this.gen(c.consequent)}\n`;
        first = false;
      } else {
        out += `  else if (${cond}) ${this.gen(c.consequent)}\n`;
      }
    }
    out += `}`;
    return out;
  }

  genTcoBody(bodyNode, fname, params) {
    if (!bodyNode) return '';
    const stmts = bodyNode.body || (Array.isArray(bodyNode) ? bodyNode : [bodyNode]);
    return stmts.map(stmt => {
      if (stmt.type === 'ReturnStatement' && stmt.argument && stmt.argument.type === 'CallExpression') {
        if (stmt.argument.callee.type === 'Identifier' && stmt.argument.callee.name === fname) {
          const args = stmt.argument.arguments || [];
          const temps = args.map((a, i) => `var _tco_${i} = ${this.gen(a)};`).join(' ');
          const assigns = (params || []).map((p, i) => {
            const pName = typeof p === 'string' ? p : (p.name || (p.type === 'Identifier' ? p.name : this.gen(p)));
            return `${pName} = _tco_${i};`;
          }).join(' ');
          return `${temps} ${assigns} continue _tco_loop;`;
        }
      }
      if (stmt.type === 'IfStatement') {
        let res = `if (${this.gen(stmt.test)}) `;
        const transformBranch = (b) => {
          if (!b) return '{}';
          if (b.type === 'BlockStatement' || b.type === 'Block') {
            return `{\n${this.indent(this.genTcoBody(b, fname, params))}\n}`;
          }
          return `{\n${this.indent(this.genTcoBody({ body: [b] }, fname, params))}\n}`;
        };
        res += transformBranch(stmt.consequent);
        if (stmt.alternate) {
          res += ` else ${transformBranch(stmt.alternate)}`;
        }
        return res;
      }
      return this.gen(stmt);
    }).join('\n');
  }

  safeKey(k) { return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : JSON.stringify(k); }
  indent(s) { return String(s || '').split('\n').map(l => l ? '  ' + l : l).join('\n'); }
}

// ============================================================
// Scope Resolver & Symbol Table Static Analyzer
// ============================================================
class Scope {
  constructor(parent = null) {
    this.bindings = new Map();
    this.parent = parent;
  }
  define(name, symbol) {
    if (this.bindings.has(name)) return false;
    this.bindings.set(name, symbol);
    return true;
  }
  lookup(name) {
    let current = this;
    while (current) {
      if (current.bindings.has(name)) return current.bindings.get(name);
      current = current.parent;
    }
    return null;
  }
}

class SemanticAnalyzer {
  constructor(filePath, source, options = {}) {
    this.filePath = filePath;
    this.source = source;
    this.options = options;
    this.currentScope = new Scope();
  }

  error(msg, node) {
    throw new WateSyntaxError(msg, node ? node.loc : null, this.filePath, this.source);
  }

  inferType(node) {
    if (!node) return 'any';
    const type = node.type;

    switch (type) {
      case 'Literal': {
        const valType = typeof node.value;
        if (valType === 'number') return 'number';
        if (valType === 'string') return 'string';
        if (valType === 'boolean') return 'boolean';
        return 'any';
      }
      case 'RawLiteral': {
        if (node.raw === 'true' || node.raw === 'false') return 'boolean';
        if (node.raw === 'null') return 'null';
        return 'any';
      }
      case 'ArrayExpression':
        return 'array';
      case 'ObjectExpression':
        return 'object';
      case 'FunctionDeclaration':
        return 'function';
      case 'Identifier': {
        const name = node.name;
        const symbol = this.currentScope.lookup(name);
        if (symbol) return symbol.type || 'any';
        if (['math', 'num'].includes(name)) return 'object';
        if (['str'].includes(name)) return 'object';
        return 'any';
      }
      case 'BinaryExpression': {
        const leftType = this.inferType(node.left);
        const rightType = this.inferType(node.right);
        const op = node.operator;
        
        if (['+', '-', '*', '/', '%', '**'].includes(op)) {
          if (leftType === 'number' && rightType === 'number') return 'number';
          if (op === '+' && (leftType === 'string' || rightType === 'string')) return 'string';
          return 'any';
        }
        if (['==', '!=', '===', '!==', 'is', 'is not', '<', '<=', '>', '>=', 'and', 'or', 'in', 'not in'].includes(op)) {
          return 'boolean';
        }
        return 'any';
      }
      case 'PrefixExpression':
      case 'UnaryExpression': {
        const op = node.operator;
        if (op === '!') return 'boolean';
        if (op === '-') return 'number';
        return 'any';
      }
      case 'CallExpression': {
        if (node.callee.type === 'Identifier') {
          const calleeName = node.callee.name;
          if (calleeName === 'every') return 'object';
        }
        return 'any';
      }
      default:
        return 'any';
    }
  }

  analyze(ast) {
    this.visit(ast);
  }

  visit(node) {
    if (!node) return;
    const type = node.type;

    switch (type) {
      case 'Program':
      case 'BlockStatement':
      case 'Block':
      case 'ImportBlock': {
        const oldScope = this.currentScope;
        if (type === 'BlockStatement' || type === 'Block') {
          this.currentScope = new Scope(oldScope);
        }
        for (const stmt of node.body) {
          this.visit(stmt);
        }
        if (type === 'BlockStatement' || type === 'Block') {
          this.currentScope = oldScope;
        }
        if (type === 'ImportBlock') {
          if (node.alias) {
            this.currentScope.define(node.alias, { kind: 'var', type: 'object', node });
          }
          if (node.specifiers && node.specifiers.length > 0) {
            for (const s of node.specifiers) {
              this.currentScope.define(s.local, { kind: 'var', type: 'any', node });
            }
          }
        }
        break;
      }

      case 'VariableDeclaration': {
        for (const decl of node.declarations) {
          if (decl.id.type === 'Identifier') {
            const name = decl.id.name;
            this.visit(decl.init);
            const inferred = this.inferType(decl.init);
            const kind = node.kind;
            if (!this.currentScope.define(name, { kind, type: inferred, node: decl })) {
              this.error(`Redeclaration of '${name}' is not allowed in this scope.`, decl.id);
            }
          } else if (decl.id.type === 'ArrayPattern') {
            this.visit(decl.init);
            for (const el of decl.id.elements) {
              if (!el) continue;
              const elName = typeof el === 'string' ? el : (el.type === 'Identifier' ? el.name : (el.type === 'RestElement' ? el.argument.name : (el.type === 'AssignmentPattern' ? el.left.name : null)));
              if (elName && !this.currentScope.define(elName, { kind: node.kind, type: 'any', node: decl })) {
                this.error(`Redeclaration of '${elName}' is not allowed in this scope.`, decl.id);
              }
            }
          } else if (decl.id.type === 'ObjectPattern') {
            this.visit(decl.init);
            for (const prop of decl.id.properties) {
              if (!prop) continue;
              const propName = typeof prop === 'string' ? prop : (prop.type === 'RestElement' ? prop.argument.name : (prop.target || prop.key));
              if (propName && !this.currentScope.define(propName, { kind: node.kind, type: 'any', node: decl })) {
                this.error(`Redeclaration of '${propName}' is not allowed in this scope.`, decl.id);
              }
            }
          }
        }
        break;
      }

      case 'FunctionDeclaration': {
        const name = node.name;
        if (name) {
          if (!this.currentScope.define(name, { kind: 'fn', type: 'function', node })) {
            this.error(`Redeclaration of function '${name}' in this scope.`, node);
          }
        }
        const oldScope = this.currentScope;
        this.currentScope = new Scope(oldScope);
        for (const p of node.params) {
          if (!p) continue;
          if (typeof p === 'string') {
            this.currentScope.define(p, { kind: 'param', type: 'any', node });
          } else if (p.type === 'Identifier') {
            this.currentScope.define(p.name, { kind: 'param', type: 'any', node });
          } else if (p.type === 'RestElement') {
            this.currentScope.define(p.argument.name, { kind: 'param', type: 'any', node });
          } else if (p.type === 'AssignmentPattern') {
            this.currentScope.define(p.left.name, { kind: 'param', type: 'any', node });
          } else if (p.type === 'ArrayPattern') {
            for (const el of p.elements) {
              if (!el) continue;
              const n = typeof el === 'string' ? el : (el.type === 'Identifier' ? el.name : (el.type === 'RestElement' ? el.argument.name : (el.type === 'AssignmentPattern' ? el.left.name : null)));
              if (n) this.currentScope.define(n, { kind: 'param', type: 'any', node });
            }
          } else if (p.type === 'ObjectPattern') {
            for (const prop of p.properties) {
              if (!prop) continue;
              const n = typeof prop === 'string' ? prop : (prop.type === 'RestElement' ? prop.argument.name : (prop.target || prop.key));
              if (n) this.currentScope.define(n, { kind: 'param', type: 'any', node });
            }
          }
        }
        this.visit(node.body);
        this.currentScope = oldScope;
        break;
      }

      case 'ClassDeclaration': {
        const name = node.name;
        if (!this.currentScope.define(name, { kind: 'class', type: 'object', node })) {
          this.error(`Redeclaration of class '${name}'.`, node);
        }
        const oldScope = this.currentScope;
        this.currentScope = new Scope(oldScope);
        this.currentScope.define('this', { kind: 'var', type: 'object', node });
        this.currentScope.define('super', { kind: 'fn', type: 'function', node });
        if (node.methods) {
          for (const member of node.methods) {
            this.visit(member);
          }
        }
        this.currentScope = oldScope;
        break;
      }

      case 'InterfaceDeclaration': {
        const name = node.name;
        if (!this.currentScope.define(name, { kind: 'interface', node })) {
          this.error(`Redeclaration of interface '${name}'.`, node);
        }
        break;
      }

      case 'EnumDeclaration': {
        const name = node.name;
        if (!this.currentScope.define(name, { kind: 'const', type: 'object', node })) {
          this.error(`Redeclaration of enum '${name}'.`, node);
        }
        break;
      }

      case 'TypeAliasDeclaration': {
        const name = node.name;
        this.currentScope.define(name, { kind: 'type', type: 'any', node });
        break;
      }

      case 'ForAwaitStatement': {
        const oldScope = this.currentScope;
        this.currentScope = new Scope(oldScope);
        this.currentScope.define(node.item, { kind: 'var', type: 'any', node });
        this.visit(node.iterable);
        this.visit(node.body);
        this.currentScope = oldScope;
        break;
      }

      case 'YieldExpression':
      case 'SpreadElement': {
        if (node.argument) this.visit(node.argument);
        break;
      }

      case 'AssignExpression': {
        if (node.left.type === 'Identifier') {
          const name = node.left.name;
          const symbol = this.currentScope.lookup(name);
          if (!symbol && this.filePath !== '<repl>') {
            this.error(`Variable '${name}' is not defined. You must declare it using 'set' first.`, node.left);
          }
          if (symbol && symbol.kind === 'const') {
            this.error(`Cannot assign to constant variable '${name}'.`, node.left);
          }
        } else {
          this.visit(node.left);
        }
        this.visit(node.right);
        break;
      }

      case 'UpdateExpression': {
        if (node.argument.type === 'Identifier') {
          const name = node.argument.name;
          const symbol = this.currentScope.lookup(name);
          if (!symbol && this.filePath !== '<repl>') {
            this.error(`Variable '${name}' is not defined. You must declare it using 'set' first.`, node.argument);
          }
          if (symbol && symbol.kind === 'const') {
            this.error(`Cannot assign to constant variable '${name}'.`, node.argument);
          }
        } else {
          this.visit(node.argument);
        }
        this.visit(node.value);
        break;
      }

      case 'Identifier': {
        const name = node.name;
        if (name === 'this' || name === 'super') return;
        const symbol = this.currentScope.lookup(name);
        if (!symbol && this.filePath !== '<repl>') {
          const globals = ['file', 'sys', 'http', 'math', 'str', 'input', 'json', 'date', 'color', 'os', 'env', 'regex', 'crypto', 'wpath', 'list', 'num', 'assert', 'timer', 'stack', 'queue', 'table', 'type', 'every', 'out', 'print', 'True', 'False', 'null', 'Bot', 'Database', 'AIClient', 'SQLiteDatabase', 'MySQLClient', 'PostgresClient', 'MongoClient', 'csv', 'excel', 'pdf', 'img', 'bot', 'WebApp', 'thread', 'stream', 'readonly', 'log', 'route', 'deprecated', 'Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'CustomError', 'ws', 'jwt', 'orm', 'args', 'logger', 'xml', 'yaml', 'i18n', 'module', 'exports'];
          if (globals.includes(name)) return;
          this.error(`Variable '${name}' is not defined.`, node);
        }
        break;
      }

      case 'ExpressionStatement':
        this.visit(node.expression);
        break;
      case 'ReturnStatement':
      case 'ThrowStatement':
        if (node.argument) this.visit(node.argument);
        break;
      case 'IfStatement':
        this.visit(node.test);
        this.visit(node.consequent);
        if (node.alternate) this.visit(node.alternate);
        break;
      case 'WhileStatement':
      case 'DoWhileStatement':
        this.visit(node.test);
        this.visit(node.body);
        break;
      case 'RepeatStatement':
        this.visit(node.count);
        this.visit(node.body);
        break;
      case 'ForeachStatement': {
        const oldScope = this.currentScope;
        this.currentScope = new Scope(oldScope);
        const name = node.item;
        this.currentScope.define(name, { kind: 'var', type: 'any', node: node.item });
        this.visit(node.iterable);
        this.visit(node.body);
        this.currentScope = oldScope;
        break;
      }
      case 'ListComprehension': {
        const oldScope = this.currentScope;
        this.currentScope = new Scope(oldScope);
        const name = node.item;
        this.currentScope.define(name, { kind: 'var', type: 'any', node: node.item });
        this.visit(node.iterable);
        this.visit(node.expression);
        if (node.filter) this.visit(node.filter);
        this.currentScope = oldScope;
        break;
      }
      case 'TryCatchStatement':
        this.visit(node.block);
        if (node.handler) {
          const oldScope = this.currentScope;
          this.currentScope = new Scope(oldScope);
          const paramName = node.param;
          if (paramName) {
            this.currentScope.define(paramName, { kind: 'var', type: 'object', node });
          }
          this.visit(node.handler);
          this.currentScope = oldScope;
        }
        if (node.finalizer) {
          this.visit(node.finalizer);
        }
        break;
      case 'MatchStatement':
        this.visit(node.discriminant);
        for (const c of node.cases) {
          this.visit(c.consequent);
        }
        break;
      case 'GuardStatement':
        this.visit(node.test);
        this.visit(node.consequent);
        break;
      case 'CallExpression': {
        this.visit(node.callee);
        for (const arg of node.arguments) {
          this.visit(arg);
        }
        if (node.callee.type === 'Identifier') {
          const fnSymbol = this.currentScope.lookup(node.callee.name);
          if (fnSymbol && fnSymbol.kind === 'function' && fnSymbol.node && fnSymbol.node.params) {
            const expected = fnSymbol.node.params.length;
            const actual = node.arguments.length;
            if (actual < expected) {
              const msg = `Type Warning [WATE Function Arity]: Function '${node.callee.name}' expects ${expected} arguments, but got ${actual}.`;
              if (this.options && this.options.strictTypes) this.error(msg, node);
              else console.warn(`\n⚠️ \x1b[33m${msg}\x1b[0m`);
            }
          }
        }
        break;
      }
      case 'MemberExpression':
        this.visit(node.object);
        break;
      case 'BinaryExpression':
      case 'LogicalExpression': {
        this.visit(node.left);
        this.visit(node.right);
        const leftType = this.inferType(node.left);
        const rightType = this.inferType(node.right);
        const op = node.operator;
        if (['-', '*', '/', '%', '**'].includes(op)) {
          if ((leftType === 'string' && leftType !== 'any') || (rightType === 'string' && rightType !== 'any')) {
            const msg = `Type Warning [WATE Static Type Inference]: Cannot apply arithmetic operator '${op}' on type 'string'.`;
            if (this.options && this.options.strictTypes) this.error(msg, node);
            else console.warn(`\n⚠️ \x1b[33m${msg}\x1b[0m`);
          }
        }
        break;
      }
      case 'PrefixExpression':
        this.visit(node.right);
        break;
      case 'ArrayExpression':
        for (const el of node.elements) this.visit(el);
        break;
      case 'ObjectExpression':
        for (const p of node.properties) this.visit(p.value);
        break;
      case 'TemplateLiteral':
        for (const part of node.parts) {
          if (part.type === 'Interpolation') {
            this.visit(part.expression);
          }
        }
        break;
      case 'ClassMethod': {
        const oldScope = this.currentScope;
        this.currentScope = new Scope(oldScope);
        for (const param of node.params) {
          const pName = param;
          this.currentScope.define(pName, { kind: 'param', type: 'any', node: param });
        }
        this.visit(node.body);
        this.currentScope = oldScope;
        break;
      }
      case 'ImportStatement': {
        if (node.alias) {
          this.currentScope.define(node.alias, { kind: 'var', type: 'object', node });
        }
        if (node.specifiers && node.specifiers.length > 0) {
          for (const s of node.specifiers) {
            this.currentScope.define(s.local, { kind: 'var', type: 'any', node });
          }
        }
        const identifier = node.source.replace(/[^a-zA-Z0-9_$]/g, '_');
        this.currentScope.define(identifier, { kind: 'var', type: 'object', node });
        break;
      }
    }
  }
}

// ============================================================
// Public API & Module AST Caching Layer
// ============================================================
function registerClassesFromAST(node) {
  if (!node) return;
  if (!global.WateClasses) global.WateClasses = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'CustomError']);
  if (node.type === 'ClassDeclaration' && node.name) {
    global.WateClasses.add(node.name);
  }
  if (node.body && Array.isArray(node.body)) {
    for (const child of node.body) registerClassesFromAST(child);
  }
}

function getCachedModuleAST(resolvedPath, sourceCode) {
  if (typeof process === 'undefined' || !fs) {
    return parseWate(sourceCode, resolvedPath);
  }
  try {
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(sourceCode).digest('hex');
    const cacheDir = path.resolve(process.cwd(), '.wate_cache');
    const cacheFile = path.join(cacheDir, `ast_${hash}.json`);
    if (fs.existsSync(cacheFile)) {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      registerClassesFromAST(cached);
      return cached;
    }
    const ast = parseWate(sourceCode, resolvedPath);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    fs.writeFileSync(cacheFile, JSON.stringify(ast), 'utf8');
    return ast;
  } catch (e) {
    return parseWate(sourceCode, resolvedPath);
  }
}

function parseWate(source, filePath = '<input>') {
  const tokens = new Lexer(source, filePath).tokenize();
  return new Parser(tokens, filePath, source).parseProgram();
}

function tokenizeWate(source, filePath = '<input>') {
  return new Lexer(source, filePath).tokenize();
}

function generateJS(ast, options = {}) {
  return new CodeGenerator(options).generate(ast);
}

// ============================================================
// Macro Expander (Metaprogramming)
// ============================================================
class MacroExpander {
  constructor() {
    this.macros = new Map();
  }

  expand(ast) {
    if (!ast || !ast.body) return ast;
    const remainingBody = [];
    for (const stmt of ast.body) {
      if (stmt.type === 'MacroDeclaration') {
        this.macros.set(stmt.name, stmt);
      } else {
        remainingBody.push(stmt);
      }
    }
    ast.body = remainingBody;

    if (this.macros.size > 0) {
      this.transform(ast);
    }
    return ast;
  }

  transform(node) {
    if (!node) return node;

    if (node.body && Array.isArray(node.body)) {
      const newBody = [];
      for (let stmt of node.body) {
        if (stmt.type === 'ExpressionStatement' && stmt.expression.type === 'CallExpression' && stmt.expression.callee.type === 'Identifier' && this.macros.has(stmt.expression.callee.name)) {
          const expanded = this.expandMacroCall(stmt.expression);
          if (Array.isArray(expanded)) newBody.push(...expanded);
          else if (expanded) newBody.push(expanded);
        } else {
          this.transform(stmt);
          newBody.push(stmt);
        }
      }
      node.body = newBody;
    }

    for (const key in node) {
      if (key === 'loc' || key === 'type') continue;
      const child = node[key];
      if (child && typeof child === 'object') {
        if (child.type === 'CallExpression' && child.callee && child.callee.type === 'Identifier' && this.macros.has(child.callee.name)) {
          node[key] = this.expandMacroExpr(child);
        } else if (Array.isArray(child)) {
          for (let i = 0; i < child.length; i++) {
            const item = child[i];
            if (item && item.type === 'CallExpression' && item.callee && item.callee.type === 'Identifier' && this.macros.has(item.callee.name)) {
              child[i] = this.expandMacroExpr(item);
            } else if (item && typeof item === 'object') {
              this.transform(item);
            }
          }
        } else {
          this.transform(child);
        }
      }
    }
    return node;
  }

  expandMacroExpr(callNode) {
    const macro = this.macros.get(callNode.callee.name);
    const bindings = new Map();
    macro.params.forEach((p, idx) => {
      bindings.set(p, callNode.arguments[idx] || { type: 'RawLiteral', raw: 'null' });
    });

    const clonedBody = JSON.parse(JSON.stringify(macro.body));
    this.substituteIdentifiers(clonedBody, bindings);

    if (clonedBody.body && clonedBody.body.length === 1 && clonedBody.body[0].type === 'ReturnStatement') {
      return clonedBody.body[0].argument;
    }
    if (clonedBody.body && clonedBody.body.length === 1 && clonedBody.body[0].type === 'ExpressionStatement') {
      return clonedBody.body[0].expression;
    }
    return clonedBody;
  }

  expandMacroCall(callNode) {
    const macro = this.macros.get(callNode.callee.name);
    const bindings = new Map();
    macro.params.forEach((p, idx) => {
      bindings.set(p, callNode.arguments[idx] || { type: 'RawLiteral', raw: 'null' });
    });

    const clonedBody = JSON.parse(JSON.stringify(macro.body));
    this.substituteIdentifiers(clonedBody, bindings);
    return clonedBody.body || [];
  }

  substituteIdentifiers(node, bindings) {
    if (!node) return;
    for (const key in node) {
      if (key === 'loc') continue;
      const val = node[key];
      if (val && typeof val === 'object') {
        if (val.type === 'Identifier' && bindings.has(val.name)) {
          node[key] = JSON.parse(JSON.stringify(bindings.get(val.name)));
        } else {
          this.substituteIdentifiers(val, bindings);
        }
      }
    }
  }
}

// ============================================================
// Constant Folding Optimizer
// ============================================================
class ConstFolder {
  fold(node) {
    if (!node) return node;

    for (const key in node) {
      if (key === 'loc') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (let i = 0; i < child.length; i++) {
          if (child[i] && typeof child[i] === 'object') {
            child[i] = this.fold(child[i]);
          }
        }
      } else if (child && typeof child === 'object') {
        node[key] = this.fold(child);
      }
    }

    if (node.type === 'BinaryExpression') {
      const left = node.left;
      const right = node.right;
      const op = node.operator;

      if (left.type === 'Literal' && right.type === 'Literal') {
        const lv = left.value;
        const rv = right.value;

        if (typeof lv === 'number' && typeof rv === 'number') {
          let res = null;
          switch (op) {
            case '+': res = lv + rv; break;
            case '-': res = lv - rv; break;
            case '*': res = lv * rv; break;
            case '/': if (rv !== 0) res = lv / rv; break;
            case '%': if (rv !== 0) res = lv % rv; break;
            case '**': res = Math.pow(lv, rv); break;
            case '&': res = (lv & rv); break;
            case '|': res = (lv | rv); break;
            case '^': res = (lv ^ rv); break;
            case '<<': res = (lv << rv); break;
            case '>>': res = (lv >> rv); break;
            case '>>>': res = (lv >>> rv); break;
            case '<': res = lv < rv; break;
            case '<=': res = lv <= rv; break;
            case '>': res = lv > rv; break;
            case '>=': res = lv >= rv; break;
            case '==': case '===': res = lv === rv; break;
            case '!=': case '!==': res = lv !== rv; break;
          }
          if (res !== null) {
            return { type: 'Literal', value: res, raw: String(res), loc: node.loc };
          }
        }

        if (typeof lv === 'string' && typeof rv === 'string' && op === '+') {
          return { type: 'Literal', value: lv + rv, raw: JSON.stringify(lv + rv), loc: node.loc };
        }
      }

      if ((left.type === 'Literal' || left.type === 'RawLiteral') && (right.type === 'Literal' || right.type === 'RawLiteral')) {
        const lb = left.value !== undefined ? Boolean(left.value) : (left.raw === 'true');
        const rb = right.value !== undefined ? Boolean(right.value) : (right.raw === 'true');
        if (op === 'and' || op === '&&') {
          const val = lb && rb;
          return { type: 'RawLiteral', raw: val ? 'true' : 'false', loc: node.loc };
        }
        if (op === 'or' || op === '||') {
          const val = lb || rb;
          return { type: 'RawLiteral', raw: val ? 'true' : 'false', loc: node.loc };
        }
      }

      if (op === '??') {
        if (left.type === 'RawLiteral' && (left.raw === 'null' || left.raw === 'undefined')) {
          return right;
        }
        if (left.type === 'Literal' && left.value !== null && left.value !== undefined) {
          return left;
        }
      }
    }

    if (node.type === 'PrefixExpression' || node.type === 'UnaryExpression') {
      const arg = node.right || node.argument;
      const op = node.operator;
      if (arg && (arg.type === 'Literal' || arg.type === 'RawLiteral')) {
        if (op === 'not' || op === '!') {
          const val = arg.value !== undefined ? !arg.value : (arg.raw !== 'true');
          return { type: 'RawLiteral', raw: val ? 'true' : 'false', loc: node.loc };
        }
        if (op === '-' && typeof arg.value === 'number') {
          return { type: 'Literal', value: -arg.value, raw: String(-arg.value), loc: node.loc };
        }
      }
    }

    return node;
  }
}

// ============================================================
// Tree Shaking v2 (Dead Code Elimination)
// ============================================================
class ASTTreeShaker {
  constructor() {
    this.declared = new Map();
    this.referenced = new Set();
  }

  shake(ast) {
    this.collect(ast);
    this.prune(ast);
    return ast;
  }

  collect(node) {
    if (!node) return;
    if (node.type === 'Identifier') {
      this.referenced.add(node.name);
      return;
    }
    if (node.type === 'FunctionDeclaration') {
      this.declared.set(node.name, node);
      this.collect(node.body);
      return;
    }
    if (node.type === 'VariableDeclaration') {
      for (const decl of node.declarations) {
        if (decl.id.type === 'Identifier') this.declared.set(decl.id.name, decl);
        this.collect(decl.init);
      }
      return;
    }
    for (const key in node) {
      if (key === 'loc' || key === 'type') continue;
      const val = node[key];
      if (Array.isArray(val)) {
        for (const child of val) {
          if (child && typeof child === 'object') this.collect(child);
        }
      } else if (val && typeof val === 'object') {
        this.collect(val);
      }
    }
  }

  prune(node) {
    if (!node) return;
    if (node.body && Array.isArray(node.body)) {
      // 1. Unreachable code elimination: statements after return, throw, break, continue
      const reachable = [];
      for (const stmt of node.body) {
        reachable.push(stmt);
        if (['ReturnStatement', 'ThrowStatement', 'BreakStatement', 'ContinueStatement'].includes(stmt.type)) {
          break;
        }
      }
      node.body = reachable;

      // 2. Unused variables, functions, dead conditional blocks
      node.body = node.body.filter(stmt => {
        if (stmt.type === 'FunctionDeclaration') {
          if (!this.referenced.has(stmt.name)) return false;
        }
        if (stmt.type === 'VariableDeclaration') {
          const activeDecls = stmt.declarations.filter(decl => {
            if (decl.id.type === 'Identifier') return this.referenced.has(decl.id.name);
            return true;
          });
          if (activeDecls.length === 0) return false;
          stmt.declarations = activeDecls;
        }
        if (stmt.type === 'IfStatement') {
          if (stmt.test.type === 'RawLiteral' && stmt.test.raw === 'false') {
            return stmt.alternate !== null;
          }
        }
        return true;
      });

      for (let i = 0; i < node.body.length; i++) {
        const stmt = node.body[i];
        if (stmt.type === 'IfStatement' && stmt.test.type === 'RawLiteral') {
          if (stmt.test.raw === 'true' && stmt.consequent) {
            node.body[i] = stmt.consequent;
          } else if (stmt.test.raw === 'false' && stmt.alternate) {
            node.body[i] = stmt.alternate;
          }
        }
      }

      for (const stmt of node.body) this.prune(stmt);
    }
  }
}

// ============================================================
// Source Map Generator (V3 Format)
// ============================================================
class SourceMapGenerator {
  static encodeVLQ(value) {
    const VLQ_BASE_SHIFT = 5;
    const VLQ_BASE = 1 << VLQ_BASE_SHIFT;
    const VLQ_BASE_MASK = VLQ_BASE - 1;
    const VLQ_CONTINUATION_BIT = VLQ_BASE;
    const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

    let vlq = value < 0 ? ((-value) << 1) | 1 : (value << 1);
    let encoded = '';
    do {
      let digit = vlq & VLQ_BASE_MASK;
      vlq >>>= VLQ_BASE_SHIFT;
      if (vlq > 0) digit |= VLQ_CONTINUATION_BIT;
      encoded += BASE64_CHARS[digit];
    } while (vlq > 0);
    return encoded;
  }

  static generate(jsCode, sourceFile, sourceCode) {
    const lines = jsCode.split('\n');
    const mappings = [];
    let prevSourceLine = 0;

    for (let genLine = 0; genLine < lines.length; genLine++) {
      const line = lines[genLine];
      const match = line.match(/\/\*\s*WATE_LINE:(\d+)\s*\*\//);
      if (match) {
        const srcLine = parseInt(match[1], 10) - 1;
        const lineDiff = srcLine - prevSourceLine;
        prevSourceLine = srcLine;
        const segment = this.encodeVLQ(0) + this.encodeVLQ(0) + this.encodeVLQ(lineDiff) + this.encodeVLQ(0);
        mappings.push(segment);
      } else {
        mappings.push('');
      }
    }

    const baseName = (typeof path !== 'undefined' && path.basename) ? path.basename(sourceFile) : sourceFile;
    const map = {
      version: 3,
      file: baseName.replace(/\.wate$/, '.js'),
      sourceRoot: '',
      sources: [baseName],
      sourcesContent: [sourceCode || ''],
      names: [],
      mappings: mappings.join(';')
    };

    const mapJson = JSON.stringify(map);
    const inline = `//# sourceMappingURL=data:application/json;charset=utf-8;base64,${typeof Buffer !== 'undefined' ? Buffer.from(mapJson).toString('base64') : btoa(mapJson)}`;
    return { map, mapJson, inline };
  }
}

// ============================================================
// Public Transpilation Pipeline
// ============================================================
function transpileWate(source, filePath = '<input>', options = {}) {
  options.filePath = options.filePath || filePath;
  const ast = parseWate(source, filePath);

  // 1. Macro Expansion Pass
  new MacroExpander().expand(ast);

  // 2. Const Folding Pass
  new ConstFolder().fold(ast);

  // 3. Semantic Analysis & Type Checking
  new SemanticAnalyzer(filePath, source, options).analyze(ast);

  // 4. Tree Shaking v2 (Dead code elimination)
  if (filePath !== '<repl>') {
    new ASTTreeShaker().shake(ast);
  }

  // 5. Code Generation
  let js = generateJS(ast, options);

  // 6. Source Map Generation (optional)
  if (options.sourceMap) {
    const sm = SourceMapGenerator.generate(js, filePath, source);
    js += '\n' + sm.inline;
    return { code: js, map: sm.map, mapJson: sm.mapJson, inlineMap: sm.inline };
  }

  return js;
}

const wateExports = {
  TT,
  Lexer,
  Parser,
  CodeGenerator,
  WateSyntaxError,
  WateCompilationError,
  tokenizeWate,
  parseWate,
  generateJS,
  transpileWate,
  MacroExpander,
  ConstFolder,
  ASTTreeShaker,
  SourceMapGenerator,
  SemanticAnalyzer
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = wateExports;
}
if (typeof globalThis !== 'undefined') {
  globalThis.WateParser = wateExports;
}

// ============================================================
// CLI Runner
// ============================================================
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  const args = typeof process !== 'undefined' && process.argv ? process.argv.slice(2) : [];
  const debug = args.includes('--debug');
  const astOnly = args.includes('--ast');
  const tokensOnly = args.includes('--tokens');
  const file = args.find(a => !a.startsWith('--'));

  if (!file) {
    console.log(`WATE Parser v10.5\nUsage:\n  node wate-parser.js file.wate\n  node wate-parser.js file.wate --debug`);
    process.exit(0);
  }

  try {
    const source = fs.readFileSync(file, 'utf8');
    const tokens = tokenizeWate(source, file);
    if (tokensOnly) {
      console.log(JSON.stringify(tokens, null, 2));
      process.exit(0);
    }
    const ast = new Parser(tokens, file, source).parseProgram();
    if (astOnly) {
      console.log(JSON.stringify(ast, null, 2));
      process.exit(0);
    }
    const js = generateJS(ast);
    if (debug) {
      console.log('\n===== TOKENS =====');
      console.log(tokens.map(t => `${t.type}:${t.value}`).join(' | '));
      console.log('\n===== AST =====');
      console.log(JSON.stringify(ast, null, 2));
      console.log('\n===== JS =====');
    }
    console.log(js);
  } catch (err) {
    if (err.name === 'WateSyntaxError') {
      const token = err.token;
      const line = token ? token.line : '?';
      const col = token ? token.col : '?';
      const fp = err.filePath || '<input>';
      const source = err.source || '';

      console.error(`\x1b[31m❌ WATE Syntax Error\x1b[0m`);
      console.error(`\x1b[36mLine ${line} | Column ${col}\x1b[0m`);
      console.error(`\x1b[90mFile: ${fp}\x1b[0m\n`);
      console.error(`  \x1b[91mUnexpected token: ${err.message}\x1b[0m`);

      if (source && token) {
        const lines = source.split('\n');
        const errorLine = lines[token.line - 1] || '';
        const caret = ' '.repeat(token.col - 1) + '^';
        console.error(`\n\x1b[90m${token.line} | \x1b[0m${errorLine}`);
        console.error(`\x1b[90m${' '.repeat(String(token.line).length)} | \x1b[31m${caret}\x1b[0m\n`);
      }
    } else {
      console.error(`🔥 WATE Runtime Crash:\n${err.stack || err.message}`);
    }
    process.exit(1);
  }
}

#!/usr/bin/env node
'use strict';

/**
 * ⚡ WATE Built-in Code Formatter (`wate fmt`)
 * ============================================
 * Go-style automatic source code formatter for WATE scripts.
 * 
 * Features:
 *  - Enforces consistent 4-space indentation
 *  - Normalizes operator spacing (=, +, -, *, /, ==, !=, <=, >=, etc.)
 *  - Normalizes control flow spacing (if, while, for, foreach, class, fn)
 *  - Collapses consecutive blank lines into single blank lines
 *  - Strips trailing whitespace
 *  - Ensures single trailing newline at end of file
 *  - CLI supports --check, --write, and recursive directory scanning
 */

const fs = require('fs');
const path = require('path');

class WateFormatter {
  constructor(options = {}) {
    this.indentSize = options.indentSize || 4;
    this.indentChar = ' '.repeat(this.indentSize);
  }

  format(sourceCode) {
    if (!sourceCode) return '';
    const rawLines = sourceCode.replace(/\r\n/g, '\n').split('\n');
    const formattedLines = [];
    let indentLevel = 0;
    let prevWasBlank = false;
    let inMultiComment = false;

    for (let i = 0; i < rawLines.length; i++) {
      let raw = rawLines[i];
      let trimmed = raw.trim();

      // Handle multiline comments
      if (inMultiComment) {
        formattedLines.push(this.indentChar.repeat(indentLevel) + trimmed);
        if (trimmed.includes('*/')) inMultiComment = false;
        continue;
      }
      if (trimmed.startsWith('/*')) {
        formattedLines.push(this.indentChar.repeat(indentLevel) + trimmed);
        if (!trimmed.includes('*/') || trimmed.length <= 3) inMultiComment = true;
        continue;
      }

      // Handle empty lines (collapse consecutive blanks to 1)
      if (trimmed.length === 0) {
        if (!prevWasBlank && formattedLines.length > 0) {
          formattedLines.push('');
          prevWasBlank = true;
        }
        continue;
      }
      prevWasBlank = false;

      // Check closing braces on this line to decrease indent before printing
      const leadingCloses = (trimmed.match(/^\}+/) || [''])[0].length;
      const currentIndent = Math.max(0, indentLevel - leadingCloses);

      // Format line content
      let formattedText = this.formatLine(trimmed);

      formattedLines.push(this.indentChar.repeat(currentIndent) + formattedText);

      // Adjust indent for next lines based on net braces (excluding strings/comments)
      const cleanLine = this.stripStringsAndComments(trimmed);
      const openCount = (cleanLine.match(/\{/g) || []).length;
      const closeCount = (cleanLine.match(/\}/g) || []).length;
      indentLevel = Math.max(0, indentLevel + (openCount - closeCount));
    }

    // Ensure ending single newline
    while (formattedLines.length > 0 && formattedLines[formattedLines.length - 1] === '') {
      formattedLines.pop();
    }
    return formattedLines.join('\n') + '\n';
  }

  formatLine(line) {
    // If it's pure comment, preserve as-is
    if (line.startsWith('#') || line.startsWith('//')) {
      return line;
    }

    // Separate code from trailing comment
    let comment = '';
    let code = line;
    const hashIdx = line.indexOf('#');
    const slashIdx = line.indexOf('//');
    const commentIdx = hashIdx !== -1 && slashIdx !== -1
      ? Math.min(hashIdx, slashIdx)
      : (hashIdx !== -1 ? hashIdx : slashIdx);

    if (commentIdx !== -1 && !this.isInString(line, commentIdx)) {
      code = line.slice(0, commentIdx).trimEnd();
      comment = ' ' + line.slice(commentIdx).trim();
    }

    // Format code part
    code = this.normalizeSpacing(code);

    return code + comment;
  }

  normalizeSpacing(code) {
    // 1. Collapse multiple consecutive spaces for keywords
    code = code.replace(/\b(fn|function|class|set|const|return)\s+/g, '$1 ');

    // 2. Normalize function signature spacing: fn foo ( a , b ) -> fn foo(a, b)
    code = code.replace(/\b(fn|function)\s+([a-zA-Z0-9_]+)\s*\(/g, '$1 $2(');
    code = code.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');

    // 3. Ensure space before opening brace
    code = code.replace(/([^\s])\{/g, '$1 {');

    // 4. Keyword spacing: if( -> if (, while( -> while (, for( -> for (
    code = code.replace(/\b(if|while|for|foreach|repeat|catch|match|guard)\s*\(/g, '$1 (');

    // 5. Spacing around commas
    code = code.replace(/\s*,\s*/g, ', ');

    // 6. Binary operator spacing: normalize = += -= *= /= == != <= >= + - * /
    code = code.replace(/([a-zA-Z0-9_\)\]])\s*(=|\+=|-=|\*=|(?<!\/)\/=(?!\/)|==|!=|<=|>=|:=)\s*([a-zA-Z0-9_\(\["'])/g, '$1 $2 $3');
    code = code.replace(/([a-zA-Z0-9_\)\]])\s*(\+|\-|\*|(?<!\/)\/(?!\/))\s*([a-zA-Z0-9_\(\["'])/g, '$1 $2 $3');

    // 7. Arrow functions: fn()=> or fn() =>
    code = code.replace(/\)\s*=>\s*/g, ') => ');

    return code.trim();
  }

  stripStringsAndComments(str) {
    return str
      .replace(/"(?:\\.|[^"\\])*"/g, '""')
      .replace(/'(?:\\.|[^'\\])*'/g, "''")
      .replace(/#.*$/, '')
      .replace(/\/\/.*$/, '');
  }

  isInString(line, index) {
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < index; i++) {
      const ch = line[i];
      if (ch === '"' && !inSingle && (i === 0 || line[i - 1] !== '\\')) inDouble = !inDouble;
      else if (ch === "'" && !inDouble && (i === 0 || line[i - 1] !== '\\')) inSingle = !inSingle;
    }
    return inSingle || inDouble;
  }
}

// ===============================================================
// CLI Runner
// ===============================================================
function runFormatter(target, options = {}) {
  const formatter = new WateFormatter(options);
  const isCheck = options.check || false;
  const isWrite = options.write !== false && !isCheck;

  let targetPath = target ? path.resolve(process.cwd(), target) : process.cwd();
  let filesToFormat = [];

  const IGNORE_DIRS = ['node_modules', '.git', '.wate_cache', 'dist', 'build'];

  function scan(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isDirectory()) {
        if (!IGNORE_DIRS.includes(ent.name)) scan(path.join(dir, ent.name));
      } else if (ent.isFile() && ent.name.endsWith('.wate')) {
        filesToFormat.push(path.join(dir, ent.name));
      }
    }
  }

  if (fs.existsSync(targetPath)) {
    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) scan(targetPath);
    else if (stat.isFile()) filesToFormat.push(targetPath);
  } else {
    console.error(`\x1b[31m❌ Error: Target '${target}' not found.\x1b[0m`);
    process.exit(1);
  }

  if (filesToFormat.length === 0) {
    console.log(`\x1b[33m⚠️ No .wate files found in: ${targetPath}\x1b[0m`);
    process.exit(0);
  }

  let unformattedCount = 0;
  let formattedCount = 0;

  for (const file of filesToFormat) {
    const content = fs.readFileSync(file, 'utf-8');
    const formatted = formatter.format(content);

    if (content !== formatted) {
      unformattedCount++;
      if (isCheck) {
        console.log(`  \x1b[31m✖ Unformatted:\x1b[0m ${path.relative(process.cwd(), file)}`);
      } else if (isWrite) {
        fs.writeFileSync(file, formatted, 'utf-8');
        formattedCount++;
        console.log(`  \x1b[32m✔ Formatted:\x1b[0m ${path.relative(process.cwd(), file)}`);
      }
    }
  }

  if (isCheck) {
    if (unformattedCount > 0) {
      console.log(`\n\x1b[31m❌ ${unformattedCount} file(s) need formatting. Run 'wate fmt' to format them.\x1b[0m\n`);
      process.exit(1);
    } else {
      console.log(`\n\x1b[32m✔ All ${filesToFormat.length} file(s) are cleanly formatted!\x1b[0m\n`);
      process.exit(0);
    }
  } else {
    if (formattedCount === 0) {
      console.log(`\x1b[32m✔ All ${filesToFormat.length} file(s) already cleanly formatted!\x1b[0m`);
    } else {
      console.log(`\n\x1b[32m✨ Successfully formatted ${formattedCount} file(s).\x1b[0m\n`);
    }
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
  WateFormatter: makeConstructible(WateFormatter),
  formatCode: (code, opts) => new WateFormatter(opts).format(code),
  runFormatter
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const target = args.find(a => !a.startsWith('-'));
  const check = args.includes('--check') || args.includes('-c');
  const write = !check;
  runFormatter(target, { check, write });
}

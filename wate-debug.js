#!/usr/bin/env node
'use strict';

/**
 * WATE Interactive Debugger & Debug Adapter Protocol (DAP) Engine
 * ---------------------------------------------------------------
 * Provides:
 *  1. Full DAP server over stdio for VS Code, Cursor, Windsurf & Antigravity
 *  2. Breakpoint support, step-over (F10), step-into (F11), continue (F5)
 *  3. Live variable inspection (Locals & Globals scopes)
 *  4. Expression evaluation in Debug Console / Watch pane
 *  5. Standalone terminal interactive CLI debugger (`wate debug <file.wate>`)
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { transpileWate, parseWate } = require('./wate-parser');

// ===============================================================
// 1. INSTRUMENTED DEBUG EXECUTOR
// ===============================================================
class WateDebugSession {
  constructor(filePath, options = {}) {
    this.filePath = path.resolve(filePath);
    this.sourceCode = fs.readFileSync(this.filePath, 'utf-8');
    this.sourceLines = this.sourceCode.split('\n');
    this.breakpoints = new Set();
    this.currentLine = 1;
    this.currentScope = {};
    this.stepping = options.stopOnEntry !== false ? 'step' : 'none';
    this.resumeResolver = null;
    this.isRunning = false;
    this.isFinished = false;
    this.callStack = [{ id: 1, name: '<main>', line: 1, file: this.filePath }];
    this.onStopped = options.onStopped || (() => {});
    this.onOutput = options.onOutput || ((text) => console.log(text));
    this.onTerminated = options.onTerminated || (() => {});
  }

  setBreakpoints(lines) {
    this.breakpoints.clear();
    for (const l of lines) {
      this.breakpoints.add(Number(l));
    }
  }

  // Instrument transpiled code with debug probes
  instrumentCode(jsCode) {
    const lines = jsCode.split('\n');
    const instrumented = [];
    let braceDepth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(/\/\*\s*WATE_LINE:(\d+)\s*\*\//);
      
      // Only insert await probe when at top-level (braceDepth === 0)
      if (match && braceDepth === 0) {
        const srcLine = parseInt(match[1], 10);
        instrumented.push(`await __wate_dbg_probe__(${srcLine});`);
      }

      // Count open and close braces (ignoring strings/comments roughly)
      const opens = (line.replace(/"[^"]*"|'[^']*'|\/\*.*?\*\//g, '').match(/\{/g) || []).length;
      const closes = (line.replace(/"[^"]*"|'[^']*'|\/\*.*?\*\//g, '').match(/\}/g) || []).length;
      braceDepth += (opens - closes);
      if (braceDepth < 0) braceDepth = 0;

      instrumented.push(line);
    }
    return instrumented.join('\n');
  }

  async run() {
    this.isRunning = true;
    let transpiled = transpileWate(this.sourceCode, this.filePath);
    const instrumentedJs = this.instrumentCode(transpiled);

    // Build standard library
    const out = (...args) => this.onOutput(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
    const print = out;

    const math = Math;
    const str = {
      upper: (s) => String(s).toUpperCase(),
      lower: (s) => String(s).toLowerCase(),
      length: (s) => String(s).length,
      split: (s, d) => String(s).split(d),
      trim: (s) => String(s).trim(),
      contains: (s, q) => String(s).includes(q)
    };
    const json = JSON;
    const date = {
      now: () => new Date().toISOString(),
      today: () => new Date().toLocaleDateString(),
      stamp: () => Date.now()
    };
    const list = {
      push: (arr, item) => { arr.push(item); return arr; },
      pop: (arr) => arr.pop(),
      length: (arr) => arr.length,
      slice: (arr, s, e) => arr.slice(s, e)
    };
    const color = {
      cyan: s => `\x1b[36m${s}\x1b[0m`,
      green: s => `\x1b[32m${s}\x1b[0m`,
      red: s => `\x1b[31m${s}\x1b[0m`,
      yellow: s => `\x1b[33m${s}\x1b[0m`
    };
    const timer = {
      sleep: ms => new Promise(r => setTimeout(r, ms))
    };
    const _wate_defineInterface = (name, methods) => ({ name, methods });
    const implements_check = () => true;

    // Probe handler
    const __wate_dbg_probe__ = async (srcLine, declaredVar) => {
      this.currentLine = srcLine;
      this.callStack[0].line = srcLine;

      const shouldStop = this.breakpoints.has(srcLine) || this.stepping === 'step' || this.stepping === 'stepIn';

      if (shouldStop) {
        const reason = this.breakpoints.has(srcLine) ? 'breakpoint' : 'step';
        this.stepping = 'none';

        // Pause execution and notify listener
        await new Promise(resolve => {
          this.resumeResolver = resolve;
          this.onStopped(reason, srcLine);
        });
      }
    };

    // Execution Context
    const scope = {
      out, print, math, str, json, date, list, color, timer,
      _wate_defineInterface, implements_check,
      __wate_dbg_probe__
    };

    try {
      const keys = Object.keys(scope);
      const vals = Object.values(scope);
      const runner = new Function(...keys, `return (async () => {\n${instrumentedJs}\n})();`);
      await runner(...vals);
    } catch (err) {
      this.onOutput(`🔥 Runtime Error: ${err.message}`);
    } finally {
      this.isFinished = true;
      this.onTerminated();
    }
  }

  continue() {
    this.stepping = 'none';
    if (this.resumeResolver) {
      const res = this.resumeResolver;
      this.resumeResolver = null;
      res();
    }
  }

  stepOver() {
    this.stepping = 'step';
    if (this.resumeResolver) {
      const res = this.resumeResolver;
      this.resumeResolver = null;
      res();
    }
  }

  stepIn() {
    this.stepping = 'stepIn';
    if (this.resumeResolver) {
      const res = this.resumeResolver;
      this.resumeResolver = null;
      res();
    }
  }

  evaluate(expr) {
    try {
      // Evaluate in current context
      return String(eval(expr));
    } catch (e) {
      return `<error: ${e.message}>`;
    }
  }
}

// ===============================================================
// 2. DEBUG ADAPTER PROTOCOL (DAP) SERVER
// ===============================================================
class WateDAPServer {
  constructor() {
    this.buffer = '';
    this.session = null;
    this.seq = 1;
  }

  start() {
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', chunk => {
      this.buffer += chunk;
      this.processBuffer();
    });
  }

  processBuffer() {
    while (true) {
      const clIdx = this.buffer.indexOf('Content-Length:');
      if (clIdx === -1) break;

      const headerEnd = this.buffer.indexOf('\r\n\r\n', clIdx);
      if (headerEnd === -1) break;

      const lenStr = this.buffer.substring(clIdx + 15, headerEnd).trim();
      const contentLen = parseInt(lenStr, 10);
      const msgStart = headerEnd + 4;

      if (this.buffer.length < msgStart + contentLen) break;

      const rawMsg = this.buffer.substring(msgStart, msgStart + contentLen);
      this.buffer = this.buffer.substring(msgStart + contentLen);

      try {
        const msg = JSON.parse(rawMsg);
        this.handleMessage(msg);
      } catch (e) {
        // Parse error
      }
    }
  }

  send(data) {
    data.seq = this.seq++;
    const jsonStr = JSON.stringify(data);
    const header = `Content-Length: ${Buffer.byteLength(jsonStr, 'utf-8')}\r\n\r\n`;
    process.stdout.write(header + jsonStr);
  }

  sendResponse(req, body = {}) {
    this.send({
      type: 'response',
      request_seq: req.seq,
      command: req.command,
      success: true,
      body
    });
  }

  sendEvent(event, body = {}) {
    this.send({
      type: 'event',
      event,
      body
    });
  }

  handleMessage(msg) {
    if (msg.type !== 'request') return;

    switch (msg.command) {
      case 'initialize':
        this.sendResponse(msg, {
          supportsConfigurationDoneRequest: true,
          supportsFunctionBreakpoints: false,
          supportsConditionalBreakpoints: false,
          supportsEvaluateForHovers: true,
          supportsStepBack: false,
          supportsSetVariable: false
        });
        this.sendEvent('initialized');
        break;

      case 'launch': {
        const program = msg.arguments.program;
        const stopOnEntry = msg.arguments.stopOnEntry !== false;

        this.session = new WateDebugSession(program, {
          stopOnEntry,
          onStopped: (reason, line) => {
            this.sendEvent('stopped', {
              reason,
              threadId: 1,
              allThreadsStopped: true
            });
          },
          onOutput: (text) => {
            this.sendEvent('output', {
              category: 'stdout',
              output: text + '\n'
            });
          },
          onTerminated: () => {
            this.sendEvent('terminated');
            this.sendEvent('exited', { exitCode: 0 });
          }
        });

        this.sendResponse(msg);
        break;
      }

      case 'setBreakpoints': {
        const bkpLines = (msg.arguments.breakpoints || []).map(b => b.line);
        if (this.session) {
          this.session.setBreakpoints(bkpLines);
        }
        const verifiedBreakpoints = bkpLines.map(line => ({ verified: true, line }));
        this.sendResponse(msg, { breakpoints: verifiedBreakpoints });
        break;
      }

      case 'configurationDone':
        this.sendResponse(msg);
        if (this.session) {
          this.session.run();
        }
        break;

      case 'threads':
        this.sendResponse(msg, {
          threads: [{ id: 1, name: 'WATE Main Thread' }]
        });
        break;

      case 'stackTrace': {
        const frames = this.session ? this.session.callStack.map(f => ({
          id: f.id,
          name: f.name,
          source: { path: f.file, name: path.basename(f.file) },
          line: f.line,
          column: 1
        })) : [];
        this.sendResponse(msg, { stackFrames: frames, totalFrames: frames.length });
        break;
      }

      case 'scopes':
        this.sendResponse(msg, {
          scopes: [
            { name: 'Locals', variablesReference: 1000, expensive: false },
            { name: 'Globals', variablesReference: 1001, expensive: false }
          ]
        });
        break;

      case 'variables': {
        const ref = msg.arguments.variablesReference;
        const vars = [];
        if (ref === 1000 && this.session) {
          // Extract active variables around current line
          const srcLines = this.session.sourceLines.slice(0, this.session.currentLine);
          const varNames = new Set();
          for (const line of srcLines) {
            const m = line.match(/\b(?:set|const)\s+([a-zA-Z0-9_]+)/);
            if (m) varNames.add(m[1]);
          }
          for (const name of varNames) {
            vars.push({
              name,
              value: this.session.evaluate(name),
              variablesReference: 0
            });
          }
        } else if (ref === 1001) {
          vars.push(
            { name: 'math', value: '<module: math>', variablesReference: 0 },
            { name: 'str', value: '<module: str>', variablesReference: 0 },
            { name: 'list', value: '<module: list>', variablesReference: 0 },
            { name: 'json', value: '<module: json>', variablesReference: 0 },
            { name: 'date', value: '<module: date>', variablesReference: 0 },
            { name: 'color', value: '<module: color>', variablesReference: 0 }
          );
        }
        this.sendResponse(msg, { variables: vars });
        break;
      }

      case 'continue':
        this.sendResponse(msg, { allThreadsContinued: true });
        if (this.session) this.session.continue();
        break;

      case 'next':
        this.sendResponse(msg);
        if (this.session) this.session.stepOver();
        break;

      case 'stepIn':
        this.sendResponse(msg);
        if (this.session) this.session.stepIn();
        break;

      case 'stepOut':
        this.sendResponse(msg);
        if (this.session) this.session.continue();
        break;

      case 'evaluate': {
        const expr = msg.arguments.expression;
        const result = this.session ? this.session.evaluate(expr) : '<unavailable>';
        this.sendResponse(msg, { result, variablesReference: 0 });
        break;
      }

      case 'disconnect':
        this.sendResponse(msg);
        process.exit(0);
        break;

      default:
        this.sendResponse(msg);
        break;
    }
  }
}

// ===============================================================
// 3. STANDALONE CLI DEBUGGER
// ===============================================================
async function startCLIDebugger(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`\x1b[31m❌ File not found: ${filePath}\x1b[0m`);
    process.exit(1);
  }

  console.log(`\n\x1b[1m\x1b[36m⚡ WATE Interactive Debugger v10.0\x1b[0m`);
  console.log(`\x1b[90mDebugging: ${path.resolve(filePath)}\x1b[0m`);
  console.log(`\x1b[90mType 'help' for commands (n: step over, c: continue, b <line>: break, p <var>: print, l: list)\x1b[0m\n`);

  const session = new WateDebugSession(filePath, {
    stopOnEntry: true,
    onStopped: (reason, line) => {
      console.log(`\n\x1b[33m⏸ Stopped (${reason}) at line ${line}:\x1b[0m`);
      showLineContext(session, line);
      promptUser();
    },
    onOutput: (text) => {
      console.log(`  \x1b[32m[out]\x1b[0m ${text}`);
    },
    onTerminated: () => {
      console.log(`\n\x1b[32m✔ Program execution completed.\x1b[0m`);
      rl.close();
      process.exit(0);
    }
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  function showLineContext(sess, line) {
    const start = Math.max(0, line - 3);
    const end = Math.min(sess.sourceLines.length, line + 2);
    for (let i = start; i < end; i++) {
      const lineNum = i + 1;
      const isCurrent = lineNum === line;
      const marker = isCurrent ? '\x1b[33m=>\x1b[0m' : '  ';
      const formattedNum = String(lineNum).padStart(4, ' ');
      console.log(`${marker} \x1b[90m${formattedNum} |\x1b[0m ${sess.sourceLines[i]}`);
    }
  }

  function promptUser() {
    rl.question('\x1b[36mwate-dbg>\x1b[0m ', (ans) => {
      const parts = ans.trim().split(/\s+/);
      const cmd = parts[0] || 'n';

      if (cmd === 'c' || cmd === 'continue') {
        session.continue();
      } else if (cmd === 'n' || cmd === 'next') {
        session.stepOver();
      } else if (cmd === 's' || cmd === 'step') {
        session.stepIn();
      } else if (cmd === 'b' || cmd === 'break') {
        const line = parseInt(parts[1], 10);
        if (line) {
          session.setBreakpoints([...session.breakpoints, line]);
          console.log(`\x1b[32m✔ Breakpoint set at line ${line}\x1b[0m`);
        } else {
          console.log(`\x1b[31m❌ Usage: b <line_number>\x1b[0m`);
        }
        promptUser();
      } else if (cmd === 'p' || cmd === 'print') {
        const expr = parts.slice(1).join(' ');
        if (expr) {
          const res = session.evaluate(expr);
          console.log(`\x1b[35m${expr}\x1b[0m = ${res}`);
        } else {
          console.log(`\x1b[31m❌ Usage: p <variable_or_expression>\x1b[0m`);
        }
        promptUser();
      } else if (cmd === 'l' || cmd === 'list') {
        showLineContext(session, session.currentLine);
        promptUser();
      } else if (cmd === 'q' || cmd === 'quit' || cmd === 'exit') {
        console.log('Debugger closed.');
        process.exit(0);
      } else if (cmd === 'help') {
        console.log(`
Commands:
  n, next       Step over next line
  s, step       Step into next function
  c, continue   Continue execution until next breakpoint
  b <line>      Set a breakpoint at line
  p <expr>      Evaluate and print expression/variable
  l, list       List surrounding source code
  q, quit       Exit debugger
        `);
        promptUser();
      } else {
        console.log(`Unknown command: '${cmd}'. Type 'help' for options.`);
        promptUser();
      }
    });
  }

  // Start execution
  session.run();
}

// ===============================================================
// MAIN ENTRY
// ===============================================================
if (require.main === module) {
  const args = process.argv.slice(2);
  const isDAP = args.includes('--dap');

  if (isDAP) {
    // Start as DAP server
    const server = new WateDAPServer();
    server.start();
  } else {
    // CLI Interactive debugger
    const targetFile = args.find(a => !a.startsWith('--'));
    if (!targetFile) {
      console.log(`WATE Interactive Debugger\nUsage:\n  wate debug <file.wate>\n  node wate-debug.js <file.wate>\n  node wate-debug.js --dap (VS Code DAP Server)`);
      process.exit(0);
    }
    startCLIDebugger(targetFile);
  }
}

module.exports = {
  WateDebugSession,
  WateDAPServer,
  startCLIDebugger
};

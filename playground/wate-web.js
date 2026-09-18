/**
 * WATE Web Playground Runtime & Execution Sandbox
 * ------------------------------------------------------------
 * Bridges wate-parser.js in the browser, providing standard libraries,
 * console output interception, ANSI color rendering, and execution timing.
 */

(function(global) {
  'use strict';

  // ANSI to HTML color converter
  function ansiToHtml(text) {
    if (!text) return '';
    const ansiMap = {
      '0': '</span>',
      '1': '<span style="font-weight:bold;">',
      '2': '<span style="opacity:0.7;">',
      '30': '<span style="color:#64748b;">',
      '31': '<span style="color:#ef4444;">',
      '32': '<span style="color:#10b981;">',
      '33': '<span style="color:#f59e0b;">',
      '34': '<span style="color:#3b82f6;">',
      '35': '<span style="color:#a855f7;">',
      '36': '<span style="color:#06b6d4;">',
      '37': '<span style="color:#f8fafc;">',
      '90': '<span style="color:#94a3b8;">',
      '91': '<span style="color:#f87171;">',
      '92': '<span style="color:#34d399;">',
      '93': '<span style="color:#fbbf24;">',
      '94': '<span style="color:#60a5fa;">',
      '95': '<span style="color:#c084fc;">',
      '96': '<span style="color:#22d3ee;">',
      '41': '<span style="background-color:#7f1d1d;padding:1px 4px;border-radius:3px;">',
      '42': '<span style="background-color:#064e3b;padding:1px 4px;border-radius:3px;">',
      '44': '<span style="background-color:#1e3a8a;padding:1px 4px;border-radius:3px;">'
    };

    let html = '';
    let inSpan = false;
    let i = 0;
    while (i < text.length) {
      if (text[i] === '\x1b' && text[i+1] === '[') {
        const mIndex = text.indexOf('m', i + 2);
        if (mIndex !== -1) {
          const codes = text.substring(i + 2, mIndex).split(';');
          for (const code of codes) {
            if (code === '0') {
              if (inSpan) { html += '</span>'; inSpan = false; }
            } else if (ansiMap[code]) {
              html += ansiMap[code];
              inSpan = true;
            }
          }
          i = mIndex + 1;
          continue;
        }
      }
      // Escape HTML
      const c = text[i];
      if (c === '<') html += '&lt;';
      else if (c === '>') html += '&gt;';
      else if (c === '&') html += '&amp;';
      else html += c;
      i++;
    }
    if (inSpan) html += '</span>';
    return html;
  }

  function createWebLibs(outputCallback) {
    const emit = (type, ...args) => {
      const msg = args.map(a => {
        if (typeof a === 'object' && a !== null) {
          try { return JSON.stringify(a, null, 2); } catch(e) { return String(a); }
        }
        return String(a);
      }).join(' ');
      outputCallback({ type, text: msg, html: ansiToHtml(msg), timestamp: new Date().toLocaleTimeString() });
    };

    const out = (...args) => emit('stdout', ...args);
    const print = (...args) => emit('stdout', ...args);

    const math = {
      sqrt: Math.sqrt, round: Math.round, floor: Math.floor, ceil: Math.ceil,
      abs: Math.abs, pow: Math.pow, random: Math.random, min: Math.min,
      max: Math.max, pi: Math.PI
    };

    const str = {
      upper: (s) => String(s).toUpperCase(),
      lower: (s) => String(s).toLowerCase(),
      length: (s) => String(s).length,
      split: (s, d) => String(s).split(d),
      trim: (s) => String(s).trim(),
      replace: (s, a, b) => String(s).replaceAll ? String(s).replaceAll(a, b) : String(s).replace(new RegExp(a, 'g'), b),
      contains: (s, q) => String(s).includes(q),
      startsWith: (s, q) => String(s).startsWith(q),
      endsWith: (s, q) => String(s).endsWith(q),
      reverse: (s) => String(s).split('').reverse().join('')
    };

    const json = {
      parse: (s) => JSON.parse(s),
      stringify: (o, indent) => JSON.stringify(o, null, indent || 0),
      isValid: (s) => { try { JSON.parse(s); return true; } catch { return false; } }
    };

    const date = {
      now: () => new Date().toISOString(),
      today: () => new Date().toLocaleDateString(),
      time: () => new Date().toLocaleTimeString(),
      year: () => new Date().getFullYear(),
      month: () => new Date().getMonth() + 1,
      day: () => new Date().getDate(),
      stamp: () => Date.now(),
      format: (d) => new Date(d).toLocaleString(),
      diff: (a, b) => Math.abs(new Date(a) - new Date(b))
    };

    const color = {
      red: (s) => `\x1b[31m${s}\x1b[0m`,
      green: (s) => `\x1b[32m${s}\x1b[0m`,
      yellow: (s) => `\x1b[33m${s}\x1b[0m`,
      blue: (s) => `\x1b[34m${s}\x1b[0m`,
      magenta: (s) => `\x1b[35m${s}\x1b[0m`,
      cyan: (s) => `\x1b[36m${s}\x1b[0m`,
      white: (s) => `\x1b[37m${s}\x1b[0m`,
      bold: (s) => `\x1b[1m${s}\x1b[0m`,
      dim: (s) => `\x1b[2m${s}\x1b[0m`,
      bg: {
        red: (s) => `\x1b[41m${s}\x1b[0m`,
        green: (s) => `\x1b[42m${s}\x1b[0m`,
        blue: (s) => `\x1b[44m${s}\x1b[0m`,
      }
    };

    const list = {
      push: (arr, item) => { arr.push(item); return arr; },
      pop: (arr) => arr.pop(),
      shift: (arr) => arr.shift(),
      length: (arr) => arr.length,
      join: (arr, sep) => arr.join(sep !== undefined ? sep : ','),
      reverse: (arr) => [...arr].reverse(),
      sort: (arr) => [...arr].sort(),
      slice: (arr, s, e) => arr.slice(s, e),
      includes: (arr, item) => arr.includes(item),
      filter: (arr, fn) => arr.filter(fn),
      map: (arr, fn) => arr.map(fn),
      find: (arr, fn) => arr.find(fn),
      flat: (arr) => arr.flat(),
      unique: (arr) => [...new Set(arr)]
    };

    const num = {
      parse: (s) => parseFloat(s),
      parseInt: (s, r) => parseInt(s, r || 10),
      isNaN: (n) => isNaN(n),
      isFinite: (n) => isFinite(n),
      toFixed: (n, d) => Number(n).toFixed(d || 2),
      format: (n) => Number(n).toLocaleString()
    };

    let _testsPassed = 0, _testsFailed = 0;
    const assert = {
      equal: (a, b, msg) => {
        if (a === b) { _testsPassed++; emit('stdout', `\x1b[32m✅ PASS\x1b[0m ${msg || ''}`); }
        else { _testsFailed++; emit('stderr', `\x1b[31m❌ FAIL\x1b[0m ${msg || ''} | Expected: ${b} | Got: ${a}`); }
      },
      notEqual: (a, b, msg) => {
        if (a !== b) { _testsPassed++; emit('stdout', `\x1b[32m✅ PASS\x1b[0m ${msg || ''}`); }
        else { _testsFailed++; emit('stderr', `\x1b[31m❌ FAIL\x1b[0m ${msg || ''} | Values should not be equal: ${a}`); }
      },
      isTrue: (val, msg) => {
        if (val === true) { _testsPassed++; emit('stdout', `\x1b[32m✅ PASS\x1b[0m ${msg || ''}`); }
        else { _testsFailed++; emit('stderr', `\x1b[31m❌ FAIL\x1b[0m ${msg || ''} | Expected true, got: ${val}`); }
      },
      isFalse: (val, msg) => {
        if (val === false) { _testsPassed++; emit('stdout', `\x1b[32m✅ PASS\x1b[0m ${msg || ''}`); }
        else { _testsFailed++; emit('stderr', `\x1b[31m❌ FAIL\x1b[0m ${msg || ''} | Expected false, got: ${val}`); }
      },
      throws: (fn, msg) => {
        try { fn(); _testsFailed++; emit('stderr', `\x1b[31m❌ FAIL\x1b[0m ${msg || ''} | Should have thrown`); }
        catch { _testsPassed++; emit('stdout', `\x1b[32m✅ PASS\x1b[0m ${msg || ''}`); }
      },
      summary: () => emit('stdout', `\n📊 Test Results: \x1b[32m${_testsPassed} passed\x1b[0m | \x1b[31m${_testsFailed} failed\x1b[0m`)
    };

    const _timers = {};
    const timer = {
      start: (name) => { _timers[name || 'default'] = Date.now(); },
      stop: (name) => {
        const key = name || 'default';
        const elapsed = Date.now() - (_timers[key] || Date.now());
        emit('stdout', `⏱️ Timer [${key}]: ${elapsed}ms`);
        return elapsed;
      },
      sleep: (ms) => new Promise(r => setTimeout(r, ms))
    };

    const sys = {
      clear: () => emit('clear'),
      info: () => emit('stdout', `🌐 Environment: Browser Playground | WATE Web Engine v10.0`)
    };

    const http = {
      get: async (url) => {
        try {
          const res = await fetch(url);
          return await res.text();
        } catch (e) {
          emit('stderr', `❌ HTTP GET Error: ${e.message}`);
          throw e;
        }
      },
      post: async (url, body) => {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: typeof body === 'string' ? body : JSON.stringify(body)
          });
          return await res.text();
        } catch (e) {
          emit('stderr', `❌ HTTP POST Error: ${e.message}`);
          throw e;
        }
      }
    };

    const input = (prompt) => {
      const val = window.prompt(prompt || 'Enter WATE input:');
      return val !== null ? val : '';
    };

    const _wate_defineInterface = (name, methods) => ({ name, methods });
    const implements_check = (cls, iface) => true;

    return {
      out, print, math, str, json, date, color, list, num,
      assert, timer, sys, http, input, _wate_defineInterface, implements_check
    };
  }

  // WATE Web API Engine
  const WateWeb = {
    ansiToHtml,

    tokenize(source) {
      if (!global.WateParser) throw new Error("WateParser library not loaded in browser.");
      return global.WateParser.tokenizeWate(source, 'playground.wate');
    },

    parse(source) {
      if (!global.WateParser) throw new Error("WateParser library not loaded in browser.");
      return global.WateParser.parseWate(source, 'playground.wate');
    },

    transpile(source) {
      if (!global.WateParser) throw new Error("WateParser library not loaded in browser.");
      return global.WateParser.transpileWate(source, 'playground.wate');
    },

    async run(source, outputCallback) {
      const logs = [];
      const onOutput = (item) => {
        logs.push(item);
        if (outputCallback) outputCallback(item);
      };

      const startTime = performance.now();
      try {
        const jsCode = this.transpile(source);
        const libs = createWebLibs(onOutput);

        // Scope bindings
        const scopeKeys = Object.keys(libs);
        const scopeValues = Object.values(libs);

        // Async Function execution wrapper
        const runner = new Function(...scopeKeys, `
          return (async () => {
            ${jsCode}
          })();
        `);

        const result = await runner(...scopeValues);
        const duration = (performance.now() - startTime).toFixed(2);

        return {
          success: true,
          result,
          duration,
          jsCode,
          logs
        };
      } catch (err) {
        const duration = (performance.now() - startTime).toFixed(2);
        let errorItem;

        if (err.name === 'WateSyntaxError') {
          const tok = err.token;
          const line = tok ? tok.line : '?';
          const col = tok ? tok.col : '?';
          const msg = `\x1b[31m❌ WATE Syntax Error:\x1b[0m ${err.message} \x1b[90m(Line ${line}, Col ${col})\x1b[0m`;
          errorItem = {
            type: 'error',
            text: `Line ${line}, Col ${col}: ${err.message}`,
            html: ansiToHtml(msg),
            line,
            col
          };
        } else {
          const msg = `\x1b[31m🔥 WATE Runtime Error:\x1b[0m ${err.message}`;
          errorItem = {
            type: 'error',
            text: err.message,
            html: ansiToHtml(msg)
          };
        }

        onOutput(errorItem);
        return {
          success: false,
          error: err,
          duration,
          logs
        };
      }
    }
  };

  global.WateWeb = WateWeb;
})(typeof window !== 'undefined' ? window : globalThis);

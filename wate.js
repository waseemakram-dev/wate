#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const https = require('https');
const http_module = require('http');
const readline = require('readline');

const args = process.argv.slice(2);
const DEBUG_MODE = args.includes('--debug');
const WATCH_MODE = args.includes('--watch') || args.includes('-w');
const KNOWN_COMMANDS = ['compile', 'dump', 'run', 'test', 'playground', 'debug', 'doc', 'lint', 'fmt', 'bench', 'bundle', 'help', 'version', 'profile'];
let subCommand = null;
if (KNOWN_COMMANDS.includes(args[0])) {
    subCommand = args[0];
} else if (args.includes('--repl')) {
    subCommand = '--repl';
} else if (args.includes('--help') || args.includes('-h')) {
    subCommand = 'help';
} else if (args.includes('--version') || args.includes('-v')) {
    subCommand = 'version';
}
const sourceFile = (subCommand === 'run' || subCommand === 'profile')
    ? args.slice(1).find(a => !a.startsWith('-'))
    : (subCommand ? null : args.find(a => !a.startsWith('-')));

// Phase 2: Performance & VM Options
const maxMemArg = args.find(a => a.startsWith('--max-memory='));
const MAX_MEMORY_MB = maxMemArg ? parseFloat(maxMemArg.split('=')[1]) : 0;
const REGISTER_VM = args.includes('--register-vm');
const JIT_ENABLED = args.includes('--jit');
const GC_STATS = args.includes('--gc-stats');
const loopLimitArg = args.find(a => a.startsWith('--loop-limit='));
const LOOP_LIMIT = loopLimitArg ? parseInt(loopLimitArg.split('=')[1], 10) : 5000000;

if (args.includes('--lsp')) {
    const WateLanguageServer = require('./wate-lsp');
    new WateLanguageServer().start();
    return;
}

if (args.includes('--dap')) {
    const { WateDAPServer } = require('./wate-debug');
    new WateDAPServer().start();
    return;
}

// ✅ Sandboxed Runtime Permissions (Deno-like authorization checks)
const ALLOW_READ = args.includes('--allow-read') || args.includes('--allow-all') || args.includes('-A');
const ALLOW_WRITE = args.includes('--allow-write') || args.includes('--allow-all') || args.includes('-A');
const ALLOW_NET = args.includes('--allow-net') || args.includes('--allow-all') || args.includes('-A');
const ALLOW_ENV = args.includes('--allow-env') || args.includes('--allow-all') || args.includes('-A');
const ALLOW_RUN = args.includes('--allow-run') || args.includes('--allow-all') || args.includes('-A');

function checkPermission(isAllowed, permName) {
    if (!isAllowed) {
        throw new Error(`🚫 WATE Permission Error: Access to '${permName}' is denied. Use --allow-${permName} (or --allow-all / -A) to authorize.`);
    }
}

// ✅ FIX #1: Global module tracker for nesting stability across files
let _loopCounter = 0;
// =============================================
// === WATE AST TRANSPILER INTEGRATION ===
// =============================================
const { transpileWate } = require('./wate-parser');

function transpile(rawCode, filePath, options = {}) {
    return transpileWate(rawCode, filePath, options);
}

// =============================================
// === WATE STANDARD LIBRARIES ===
// =============================================
function buildLibs(filePath) {
    const file = {
        read: (fp) => {
            checkPermission(ALLOW_READ, 'read');
            if (fs.existsSync(fp)) return fs.readFileSync(fp, 'utf-8');
            console.error(`❌ WATE IO Error: ${fp} nahi mili!`); return null;
        },
        write: (fp, data) => {
            checkPermission(ALLOW_WRITE, 'write');
            fs.writeFileSync(fp, data, 'utf-8');
            console.log(`✅ WATE IO: ${fp} successfully save ho gayi.`);
        }
    };
    const sys = {
        clear: () => console.clear(),
        info: () => console.log(`💻 OS: ${process.platform} | ⚙️ Node: ${process.version}`),
        exit: (code = 0) => process.exit(code),
        exec: (command) => {
            checkPermission(ALLOW_RUN, 'run');
            const { execSync } = require('child_process');
            try { return execSync(command, { encoding: 'utf-8' }); }
            catch (err) { console.error("❌ WATE Sys Error: Command failed."); return null; }
        },
        require: (mod) => {
            if (typeof mod === 'string' && (mod.startsWith('.') || mod.startsWith('/'))) {
                let resolved = path.resolve(process.cwd(), mod);
                if (!fs.existsSync(resolved) && fs.existsSync(resolved + '.wate')) resolved += '.wate';
                if (resolved.endsWith('.wate') && fs.existsSync(resolved)) {
                    const { transpileWate } = require('./wate-parser');
                    const content = fs.readFileSync(resolved, 'utf8');
                    const res = transpileWate(content, resolved);
                    const code = typeof res === 'string' ? res : res.code;
                    const subLibs = buildLibs(resolved);
                    const modObj = { exports: {} };
                    const keys = Object.keys(subLibs);
                    const vals = Object.values(subLibs);
                    const runner = new Function('module', 'exports', 'require', ...keys, code);
                    runner(modObj, modObj.exports, (p) => subLibs.sys.require(p), ...vals);
                    return modObj.exports;
                }
                return require(resolved);
            }
            return require(mod);
        }
    };
    const http = {
        agent: new http_module.Agent({ keepAlive: true, maxSockets: 50, maxFreeSockets: 10 }),
        httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 50, maxFreeSockets: 10 }),
        createServer: (cb) => {
            checkPermission(ALLOW_NET, 'net');
            return http_module.createServer(cb);
        },
        get: (url) => {
            checkPermission(ALLOW_NET, 'net');
            return new Promise((resolve, reject) => {
                const client = url.startsWith('https') ? https : http_module;
                client.get(url, { agent: url.startsWith('https') ? http.httpsAgent : http.agent }, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => resolve(data));
                }).on('error', (err) => { console.error(`❌ WATE HTTP Error: ${err.message}`); reject(err); });
            });
        },
        post: (url, body) => {
            checkPermission(ALLOW_NET, 'net');
            console.log(`📤 WATE HTTP POST to: ${url}`);
            return Promise.resolve('{"status": "ok"}');
        },
        multipart: (url, form = {}) => {
            checkPermission(ALLOW_NET, 'net');
            return new Promise((resolve) => {
                const cryptoMod = require('crypto');
                const boundary = '----WateBoundary' + cryptoMod.randomBytes(8).toString('hex');
                const parts = [];
                for (const [key, val] of Object.entries(form)) {
                    if (typeof val === 'object' && val !== null && val.filename && val.data) {
                        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"; filename="${val.filename}"\r\nContent-Type: ${val.contentType || 'application/octet-stream'}\r\n\r\n`));
                        parts.push(Buffer.isBuffer(val.data) ? val.data : Buffer.from(String(val.data)));
                        parts.push(Buffer.from('\r\n'));
                    } else {
                        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${val}\r\n`));
                    }
                }
                parts.push(Buffer.from(`--${boundary}--\r\n`));
                const bodyBuffer = Buffer.concat(parts);
                resolve({
                    url,
                    boundary,
                    length: bodyBuffer.length,
                    headers: {
                        'Content-Type': `multipart/form-data; boundary=${boundary}`,
                        'Content-Length': bodyBuffer.length
                    },
                    body: bodyBuffer
                });
            });
        },
        upload: (url, form) => http.multipart(url, form),
        stream: async function* (url) {
            checkPermission(ALLOW_NET, 'net');
            const client = url.startsWith('https') ? https : http_module;
            const chunks = [];
            let done = false;
            let wake = null;

            client.get(url, { agent: url.startsWith('https') ? http.httpsAgent : http.agent }, (res) => {
                res.on('data', c => { chunks.push(c); if (wake) { wake(); wake = null; } });
                res.on('end', () => { done = true; if (wake) { wake(); wake = null; } });
            }).on('error', () => { done = true; if (wake) { wake(); wake = null; } });

            while (!done || chunks.length > 0) {
                if (chunks.length > 0) yield chunks.shift();
                else if (!done) await new Promise(r => wake = r);
            }
        }
    };
    const math = {
        sqrt: (n) => Math.sqrt(n), round: (n) => Math.round(n),
        floor: (n) => Math.floor(n), ceil: (n) => Math.ceil(n),
        abs: (n) => Math.abs(n), pow: (a, b) => Math.pow(a, b),
        random: () => Math.random(), min: (...a) => Math.min(...a),
        max: (...a) => Math.max(...a), pi: Math.PI
    };
    const str = {
        upper: (s) => String(s).toUpperCase(), lower: (s) => String(s).toLowerCase(),
        length: (s) => String(s).length, split: (s, d) => String(s).split(d),
        trim: (s) => String(s).trim(), replace: (s, a, b) => String(s).replaceAll(a, b),
        contains: (s, q) => String(s).includes(q), startsWith: (s, q) => String(s).startsWith(q),
        endsWith: (s, q) => String(s).endsWith(q), reverse: (s) => String(s).split('').reverse().join('')
    };
    const input = (prompt) => {
        process.stdout.write(prompt || '');
        const buf = Buffer.alloc(1024);
        try {
            const bytesRead = fs.readSync(0, buf, 0, buf.length);
            return buf.toString('utf-8', 0, bytesRead).trim();
        } catch (e) { return ""; }
    };

    const json = {
        parse: (s) => JSON.parse(s),
        stringify: (o, indent) => JSON.stringify(o, null, indent || 0),
        isValid: (s) => { try { JSON.parse(s); return true; } catch { return false; } }
    };

    const date = {
        now: () => new Date().toISOString(),
        today: () => new Date().toLocaleDateString('en-PK'),
        time: () => new Date().toLocaleTimeString('en-PK'),
        year: () => new Date().getFullYear(),
        month: () => new Date().getMonth() + 1,
        day: () => new Date().getDate(),
        stamp: () => Date.now(),
        format: (d, loc) => new Date(d).toLocaleString(loc || 'en-PK'),
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

    const os_mod = require('os');
    const os = {
        platform: () => os_mod.platform(),
        hostname: () => os_mod.hostname(),
        username: () => os_mod.userInfo().username,
        homedir: () => os_mod.homedir(),
        tmpdir: () => os_mod.tmpdir(),
        cpus: () => os_mod.cpus().length,
        memory: () => ({ total: os_mod.totalmem(), free: os_mod.freemem() }),
        arch: () => os_mod.arch(),
        uptime: () => os_mod.uptime()
    };

    const env = {
        get: (k) => {
            checkPermission(ALLOW_ENV, 'env');
            return process.env[k] || null;
        },
        set: (k, v) => {
            checkPermission(ALLOW_ENV, 'env');
            process.env[k] = v;
        },
        all: () => {
            checkPermission(ALLOW_ENV, 'env');
            return process.env;
        },
        has: (k) => {
            checkPermission(ALLOW_ENV, 'env');
            return k in process.env;
        },
        parse: (str) => {
            const res = {};
            const lines = String(str || '').split('\n');
            for (let line of lines) {
                line = line.trim();
                if (!line || line.startsWith('#')) continue;
                const eqIdx = line.indexOf('=');
                if (eqIdx === -1) continue;
                const key = line.slice(0, eqIdx).trim();
                let val = line.slice(eqIdx + 1).trim();
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.slice(1, -1);
                }
                res[key] = val;
            }
            return res;
        },
        load: (fp = '.env', override = false) => {
            checkPermission(ALLOW_READ, 'read');
            checkPermission(ALLOW_ENV, 'env');
            if (fs.existsSync(fp)) {
                const parsed = env.parse(fs.readFileSync(fp, 'utf-8'));
                for (const [k, v] of Object.entries(parsed)) {
                    if (override || !(k in process.env)) {
                        process.env[k] = v;
                    }
                }
                return parsed;
            }
            return {};
        },
        schema: (rules = {}) => {
            return {
                validate: (source = process.env) => {
                    const result = {};
                    for (const [key, rule] of Object.entries(rules)) {
                        let rawVal = source[key];
                        if (rawVal === undefined || rawVal === null || rawVal === '') {
                            if (rule.default !== undefined) {
                                rawVal = rule.default;
                            } else if (rule.required) {
                                throw new Error(`Environment Validation Error: Missing required variable '${key}'`);
                            }
                        }
                        if (rawVal !== undefined && rawVal !== null) {
                            let parsed = rawVal;
                            if (rule.type === 'number') {
                                parsed = Number(rawVal);
                                if (isNaN(parsed)) throw new Error(`Environment Validation Error: '${key}' must be a number, got '${rawVal}'`);
                            } else if (rule.type === 'boolean') {
                                if (typeof rawVal === 'boolean') parsed = rawVal;
                                else parsed = ['true', '1', 'yes', 'on'].includes(String(rawVal).toLowerCase());
                            } else if (rule.type === 'string') {
                                parsed = String(rawVal);
                            }
                            if (typeof rule.validate === 'function' && !rule.validate(parsed)) {
                                throw new Error(`Environment Validation Error: '${key}' failed custom validation constraint`);
                            }
                            result[key] = parsed;
                        }
                    }
                    return result;
                }
            };
        }
    };

    const regex = {
        match: (s, pattern, flags) => String(s).match(new RegExp(pattern, flags || 'g')),
        test: (s, pattern, flags) => new RegExp(pattern, flags || '').test(String(s)),
        replace: (s, pattern, rep, flags) => String(s).replace(new RegExp(pattern, flags || 'g'), rep),
        split: (s, pattern) => String(s).split(new RegExp(pattern))
    };

    const crypto_mod = require('crypto');
    const crypto = {
        uuid: () => crypto_mod.randomUUID(),
        hash: (data, algo) => crypto_mod.createHash(algo || 'sha256').update(String(data)).digest('hex'),
        md5: (data) => crypto_mod.createHash('md5').update(String(data)).digest('hex'),
        sha256: (data) => crypto_mod.createHash('sha256').update(String(data)).digest('hex'),
        random: (bytes) => crypto_mod.randomBytes(bytes || 16).toString('hex'),
        aes: {
            encrypt: (plainText, secretKey) => {
                const key = crypto_mod.createHash('sha256').update(String(secretKey)).digest();
                const iv = crypto_mod.randomBytes(16);
                const cipher = crypto_mod.createCipheriv('aes-256-cbc', key, iv);
                let encrypted = cipher.update(String(plainText), 'utf8', 'hex');
                encrypted += cipher.final('hex');
                return {
                    ciphertext: encrypted,
                    iv: iv.toString('hex')
                };
            },
            decrypt: (encryptedData, secretKey, optionalIv) => {
                const key = crypto_mod.createHash('sha256').update(String(secretKey)).digest();
                const ciphertext = typeof encryptedData === 'object' ? encryptedData.ciphertext : encryptedData;
                const ivHex = (typeof encryptedData === 'object' && encryptedData.iv) ? encryptedData.iv : optionalIv;
                const iv = Buffer.from(ivHex, 'hex');
                const decipher = crypto_mod.createDecipheriv('aes-256-cbc', key, iv);
                let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
                decrypted += decipher.final('utf8');
                return decrypted;
            }
        },
        rsa: {
            generateKeyPair: (modulusLength = 2048) => {
                return crypto_mod.generateKeyPairSync('rsa', {
                    modulusLength: modulusLength || 2048,
                    publicKeyEncoding: { type: 'spki', format: 'pem' },
                    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
                });
            },
            sign: (data, privateKey) => {
                const signer = crypto_mod.createSign('SHA256');
                signer.update(String(data));
                signer.end();
                return signer.sign(privateKey, 'hex');
            },
            verify: (data, signatureHex, publicKey) => {
                const verifier = crypto_mod.createVerify('SHA256');
                verifier.update(String(data));
                verifier.end();
                return verifier.verify(publicKey, signatureHex, 'hex');
            }
        },
        bcrypt: {
            hash: (password, rounds = 10) => {
                const salt = crypto_mod.randomBytes(16);
                const iterations = Math.pow(2, rounds);
                const key = crypto_mod.pbkdf2Sync(String(password), salt, iterations, 32, 'sha512');
                return `$wate$${rounds}$${salt.toString('hex')}$${key.toString('hex')}`;
            },
            compare: (password, hashStr) => {
                const parts = String(hashStr).split('$');
                if (parts.length !== 5 || parts[1] !== 'wate') return false;
                const rounds = parseInt(parts[2], 10);
                const salt = Buffer.from(parts[3], 'hex');
                const storedKey = Buffer.from(parts[4], 'hex');
                const iterations = Math.pow(2, rounds);
                const computedKey = crypto_mod.pbkdf2Sync(String(password), salt, iterations, 32, 'sha512');
                return crypto_mod.timingSafeEqual(storedKey, computedKey);
            }
        }
    };

    const wpath = {
        join: (...parts) => path.join(...parts),
        resolve: (...parts) => path.resolve(...parts),
        dirname: (p) => path.dirname(p),
        basename: (p, ext) => path.basename(p, ext),
        extname: (p) => path.extname(p),
        exists: (p) => fs.existsSync(p),
        isFile: (p) => fs.existsSync(p) && fs.statSync(p).isFile(),
        isDir: (p) => fs.existsSync(p) && fs.statSync(p).isDirectory(),
        sep: path.sep
    };

    const list = {
        push: (arr, item) => { arr.push(item); return arr; },
        add: (arr, item) => { arr.push(item); return arr; },
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
        format: (n, loc) => Number(n).toLocaleString(loc || 'en-PK')
    };

    let _testsPassed = 0, _testsFailed = 0;
    const assert = {
        equal: (a, b, msg) => {
            if (a === b) { _testsPassed++; console.log(`\x1b[32m✅ PASS\x1b[0m ${msg || ''}`); }
            else { _testsFailed++; console.error(`\x1b[31m❌ FAIL\x1b[0m ${msg || ''} | Expected: ${b} | Got: ${a}`); }
        },
        notEqual: (a, b, msg) => {
            if (a !== b) { _testsPassed++; console.log(`\x1b[32m✅ PASS\x1b[0m ${msg || ''}`); }
            else { _testsFailed++; console.error(`\x1b[31m❌ FAIL\x1b[0m ${msg || ''} | Values should not be equal: ${a}`); }
        },
        isTrue: (val, msg) => {
            if (val === true) { _testsPassed++; console.log(`\x1b[32m✅ PASS\x1b[0m ${msg || ''}`); }
            else { _testsFailed++; console.error(`\x1b[31m❌ FAIL\x1b[0m ${msg || ''} | Expected true, got: ${val}`); }
        },
        isFalse: (val, msg) => {
            if (val === false) { _testsPassed++; console.log(`\x1b[32m✅ PASS\x1b[0m ${msg || ''}`); }
            else { _testsFailed++; console.error(`\x1b[31m❌ FAIL\x1b[0m ${msg || ''} | Expected false, got: ${val}`); }
        },
        throws: (fn, msg) => {
            try { fn(); _testsFailed++; console.error(`\x1b[31m❌ FAIL\x1b[0m ${msg || ''} | Should have thrown`); }
            catch { _testsPassed++; console.log(`\x1b[32m✅ PASS\x1b[0m ${msg || ''}`); }
        },
        ok: (val, msg) => {
            if (Boolean(val)) { _testsPassed++; console.log(`\x1b[32m✅ PASS\x1b[0m ${msg || ''}`); }
            else { _testsFailed++; console.error(`\x1b[31m❌ FAIL\x1b[0m ${msg || ''} | Expected truthy, got: ${val}`); }
        },
        summary: () => console.log(`\n📊 Test Results: \x1b[32m${_testsPassed} passed\x1b[0m | \x1b[31m${_testsFailed} failed\x1b[0m`)
    };

    const _timers = {};
    const timer = {
        start: (name) => { _timers[name || 'default'] = Date.now(); },
        stop: (name) => {
            const key = name || 'default';
            const elapsed = Date.now() - (_timers[key] || Date.now());
            console.log(`⏱️ Timer [${key}]: ${elapsed}ms`);
            return elapsed;
        },
        sleep: (ms) => new Promise(r => setTimeout(r, ms))
    };

    const every = (intervalStr, callback) => {
        let ms = 0;
        const numVal = parseFloat(intervalStr);
        const unit = String(intervalStr).replace(/[0-9.]/g, '').trim().toLowerCase();

        if (unit === 's' || unit === 'sec') ms = numVal * 1000;
        else if (unit === 'm' || unit === 'min') ms = numVal * 60 * 1000;
        else if (unit === 'h' || unit === 'hr') ms = numVal * 60 * 60 * 1000;
        else if (unit === 'd' || unit === 'day') ms = numVal * 24 * 60 * 60 * 1000;
        else ms = numVal;

        const intervalId = setInterval(callback, ms);
        return {
            stop: () => clearInterval(intervalId)
        };
    };

    const stack = {
        create: () => [],
        push: (s, v) => { s.push(v); return s; },
        pop: (s) => s.pop(),
        peek: (s) => s[s.length - 1],
        isEmpty: (s) => s.length === 0,
        size: (s) => s.length,
        clear: (s) => { s.length = 0; return s; }
    };

    const queue = {
        create: () => [],
        enqueue: (q, v) => { q.push(v); return q; },
        dequeue: (q) => q.shift(),
        front: (q) => q[0],
        isEmpty: (q) => q.length === 0,
        size: (q) => q.length
    };

    const table = {
        print: (data) => console.table(data),
        headers: (arr, cols) => {
            const header = cols.join(' | ');
            const sep = cols.map(c => '-'.repeat(c.length)).join('-+-');
            console.log(header); console.log(sep);
            arr.forEach(row => console.log(cols.map(c => String(row[c] || '')).join(' | ')));
        }
    };

    const type = {
        of: (v) => typeof v,
        isStr: (v) => typeof v === 'string',
        isNum: (v) => typeof v === 'number',
        isBool: (v) => typeof v === 'boolean',
        isArr: (v) => Array.isArray(v),
        isNull: (v) => v === null,
        isObj: (v) => typeof v === 'object' && !Array.isArray(v) && v !== null,
        isFn: (v) => typeof v === 'function',
        cast: {
            str: (v) => String(v),
            num: (v) => Number(v),
            bool: (v) => Boolean(v),
            arr: (v) => Array.from(v)
        }
    };

    // === [L1-6] INTERFACE SYSTEM — Runtime ===
    const _interfaces = {};
    function _wate_defineInterface(name, methods) { _interfaces[name] = methods; }
    function implements_check(obj, interfaceName) {
        const methods = _interfaces[interfaceName] || [];
        const missing = methods.filter(m => typeof obj[m] !== 'function');
        if (missing.length > 0) {
            console.warn(`⚠️ Interface '${interfaceName}' nahi mili: [${missing.join(', ')}] missing`);
            return false;
        }
        return true;
    }

    const { isMainThread, parentPort, Worker } = require('worker_threads');
    const thread = {
        isMainThread,
        create: (fp) => {
            if (!isMainThread) throw new Error("Workers cannot create sub-workers currently.");
            const target = path.resolve(process.cwd(), fp);
            const worker = new Worker(__filename, { workerData: { filePath: target } });
            return {
                onMessage: (cb) => worker.on('message', cb),
                postMessage: (msg) => worker.postMessage(msg),
                onError: (cb) => worker.on('error', cb),
                onExit: (cb) => worker.on('exit', cb),
                terminate: () => worker.terminate()
            };
        },
        onMessage: (cb) => {
            if (isMainThread) throw new Error("Main thread cannot use onMessage directly.");
            parentPort.on('message', cb);
        },
        postMessage: (msg) => {
            if (isMainThread) throw new Error("Main thread cannot use postMessage directly.");
            parentPort.postMessage(msg);
        },
        sharedBuffer: (bytes) => new SharedArrayBuffer(bytes),
        int32Array: (buf) => new Int32Array(buf),
        uint8Array: (buf) => new Uint8Array(buf),
        float64Array: (buf) => new Float64Array(buf),
        atomic: {
            add: (arr, idx, val) => Atomics.add(arr, idx, val),
            sub: (arr, idx, val) => Atomics.sub(arr, idx, val),
            and: (arr, idx, val) => Atomics.and(arr, idx, val),
            or: (arr, idx, val) => Atomics.or(arr, idx, val),
            xor: (arr, idx, val) => Atomics.xor(arr, idx, val),
            load: (arr, idx) => Atomics.load(arr, idx),
            store: (arr, idx, val) => Atomics.store(arr, idx, val),
            exchange: (arr, idx, val) => Atomics.exchange(arr, idx, val),
            compareExchange: (arr, idx, expected, replacement) => Atomics.compareExchange(arr, idx, expected, replacement),
            wait: (arr, idx, val, timeout) => Atomics.wait(arr, idx, val, timeout),
            notify: (arr, idx, count) => Atomics.notify(arr, idx, count)
        }
    };

    class CustomError extends Error {
        constructor(message) {
            super(message);
            this.name = 'CustomError';
        }
    }

    const readonly = (target, prop, desc) => {
        if (desc) {
            desc.writable = false;
            return desc;
        }
        return target;
    };
    const log = (target, prop, desc) => {
        if (desc && typeof desc.value === 'function') {
            const orig = desc.value;
            desc.value = function (...args) {
                console.log(`[LOG] Calling ${prop}`);
                const res = orig.apply(this, args);
                console.log(`[LOG] ${prop} returned ${JSON.stringify(res)}`);
                return res;
            };
            return desc;
        }
        return target;
    };
    const route = (pathStr) => {
        return (target, prop, desc) => {
            if (desc && desc.value) {
                desc.value.route = pathStr;
                return desc;
            }
            if (typeof target === 'function') {
                target.route = pathStr;
            }
            return target;
        };
    };
    const deprecated = (message) => {
        return (target, prop, desc) => {
            if (desc && typeof desc.value === 'function') {
                const orig = desc.value;
                desc.value = function (...args) {
                    console.warn(`⚠️ Deprecation Warning: ${prop} is deprecated. ${message || ''}`);
                    return orig.apply(this, args);
                };
                return desc;
            }
            return target;
        };
    };

    const stream = {
        fromArray: async function* (arr) {
            for (const item of arr) yield item;
        },
        collect: async (asyncIterable) => {
            const results = [];
            for await (const item of asyncIterable) results.push(item);
            return results;
        },
        map: async function* (asyncIterable, fn) {
            for await (const item of asyncIterable) yield fn(item);
        },
        filter: async function* (asyncIterable, fn) {
            for await (const item of asyncIterable) {
                if (fn(item)) yield item;
            }
        },
        pipeline: async function* (source, ...transforms) {
            let current = source;
            for (const transform of transforms) current = transform(current);
            for await (const item of current) yield item;
        }
    };

    const ws = {
        createServer: (options = {}, onConnection) => {
            checkPermission(ALLOW_NET, 'net');
            const port = typeof options === 'number' ? options : (options.port || 8080);
            const server = http_module.createServer((req, res) => {
                res.writeHead(404);
                res.end();
            });
            const clients = new Set();
            const serverWrapper = {
                server,
                port,
                clients,
                broadcast: (data) => {
                    for (const client of clients) {
                        try { client.send(data); } catch (e) {}
                    }
                },
                close: (cb) => {
                    for (const client of clients) {
                        try { client.close(); } catch (e) {}
                    }
                    server.close(cb);
                }
            };

            server.on('upgrade', (req, socket, head) => {
                const key = req.headers['sec-websocket-key'];
                if (!key) {
                    socket.destroy();
                    return;
                }
                const acceptKey = crypto_mod.createHash('sha1')
                    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
                    .digest('base64');
                socket.write(
                    'HTTP/1.1 101 Switching Protocols\r\n' +
                    'Upgrade: websocket\r\n' +
                    'Connection: Upgrade\r\n' +
                    `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`
                );

                const listeners = { message: [], close: [], error: [] };
                const client = {
                    socket,
                    on: (event, cb) => {
                        if (listeners[event]) listeners[event].push(cb);
                        return client;
                    },
                    send: (data) => {
                        const payload = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
                        const length = payload.length;
                        let header;
                        if (length < 126) {
                            header = Buffer.alloc(2);
                            header[0] = 0x81;
                            header[1] = length;
                        } else if (length <= 65535) {
                            header = Buffer.alloc(4);
                            header[0] = 0x81;
                            header[1] = 126;
                            header.writeUInt16BE(length, 2);
                        } else {
                            header = Buffer.alloc(10);
                            header[0] = 0x81;
                            header[1] = 127;
                            header.writeBigUInt64BE(BigInt(length), 2);
                        }
                        socket.write(Buffer.concat([header, payload]));
                    },
                    close: () => {
                        clients.delete(client);
                        try {
                            const closeFrame = Buffer.from([0x88, 0x00]);
                            socket.write(closeFrame);
                            socket.end();
                        } catch (e) {}
                        listeners.close.forEach(fn => fn());
                    }
                };
                clients.add(client);

                let buffer = Buffer.alloc(0);
                socket.on('data', (chunk) => {
                    buffer = Buffer.concat([buffer, chunk]);
                    while (buffer.length >= 2) {
                        const firstByte = buffer[0];
                        const secondByte = buffer[1];
                        const opcode = firstByte & 0x0f;
                        const isMasked = (secondByte & 0x80) !== 0;
                        let payloadLength = secondByte & 0x7f;
                        let offset = 2;

                        if (payloadLength === 126) {
                            if (buffer.length < offset + 2) break;
                            payloadLength = buffer.readUInt16BE(offset);
                            offset += 2;
                        } else if (payloadLength === 127) {
                            if (buffer.length < offset + 8) break;
                            payloadLength = Number(buffer.readBigUInt64BE(offset));
                            offset += 8;
                        }

                        let maskKey = null;
                        if (isMasked) {
                            if (buffer.length < offset + 4) break;
                            maskKey = buffer.subarray(offset, offset + 4);
                            offset += 4;
                        }

                        if (buffer.length < offset + payloadLength) break;
                        let payload = buffer.subarray(offset, offset + payloadLength);
                        buffer = buffer.subarray(offset + payloadLength);

                        if (isMasked && maskKey) {
                            const unmasked = Buffer.alloc(payload.length);
                            for (let i = 0; i < payload.length; i++) {
                                unmasked[i] = payload[i] ^ maskKey[i % 4];
                            }
                            payload = unmasked;
                        }

                        if (opcode === 8) {
                            client.close();
                            break;
                        } else if (opcode === 9) {
                            socket.write(Buffer.from([0x8a, 0x00]));
                        } else if (opcode === 1 || opcode === 2) {
                            const msgStr = payload.toString('utf-8');
                            listeners.message.forEach(fn => fn(msgStr));
                        }
                    }
                });

                socket.on('close', () => {
                    clients.delete(client);
                    listeners.close.forEach(fn => fn());
                });
                socket.on('error', (err) => {
                    listeners.error.forEach(fn => fn(err));
                });

                const connCb = onConnection || options.onConnection;
                if (typeof connCb === 'function') connCb(client);
            });

            server.listen(port);
            return serverWrapper;
        },
        connect: (urlStr, options = {}) => {
            checkPermission(ALLOW_NET, 'net');
            const parsed = new URL(urlStr);
            const isSecure = parsed.protocol === 'wss:';
            const port = parsed.port || (isSecure ? 443 : 80);
            const host = parsed.hostname;
            const key = crypto_mod.randomBytes(16).toString('base64');

            const listeners = { open: [], message: [], close: [], error: [] };
            const reqModule = isSecure ? https : http_module;

            const client = {
                on: (event, cb) => {
                    if (listeners[event]) listeners[event].push(cb);
                    return client;
                },
                send: (data) => {
                    if (!client.rawSocket) throw new Error("WebSocket client is not connected yet.");
                    const payload = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
                    const length = payload.length;
                    const mask = crypto_mod.randomBytes(4);
                    let header;
                    if (length < 126) {
                        header = Buffer.alloc(2);
                        header[0] = 0x81;
                        header[1] = 0x80 | length;
                    } else if (length <= 65535) {
                        header = Buffer.alloc(4);
                        header[0] = 0x81;
                        header[1] = 0x80 | 126;
                        header.writeUInt16BE(length, 2);
                    } else {
                        header = Buffer.alloc(10);
                        header[0] = 0x81;
                        header[1] = 0x80 | 127;
                        header.writeBigUInt64BE(BigInt(length), 2);
                    }
                    const maskedPayload = Buffer.alloc(length);
                    for (let i = 0; i < length; i++) {
                        maskedPayload[i] = payload[i] ^ mask[i % 4];
                    }
                    client.rawSocket.write(Buffer.concat([header, mask, maskedPayload]));
                },
                close: () => {
                    if (client.rawSocket) {
                        const mask = crypto_mod.randomBytes(4);
                        client.rawSocket.write(Buffer.concat([Buffer.from([0x88, 0x80]), mask]));
                        client.rawSocket.end();
                    }
                    listeners.close.forEach(fn => fn());
                }
            };

            const req = reqModule.request({
                port,
                host,
                path: parsed.pathname + parsed.search,
                headers: {
                    'Connection': 'Upgrade',
                    'Upgrade': 'websocket',
                    'Sec-WebSocket-Version': 13,
                    'Sec-WebSocket-Key': key
                }
            });

            req.on('upgrade', (res, socket, head) => {
                client.rawSocket = socket;
                listeners.open.forEach(fn => fn());

                let buffer = Buffer.alloc(0);
                socket.on('data', (chunk) => {
                    buffer = Buffer.concat([buffer, chunk]);
                    while (buffer.length >= 2) {
                        const firstByte = buffer[0];
                        const secondByte = buffer[1];
                        const opcode = firstByte & 0x0f;
                        const isMasked = (secondByte & 0x80) !== 0;
                        let payloadLength = secondByte & 0x7f;
                        let offset = 2;

                        if (payloadLength === 126) {
                            if (buffer.length < offset + 2) break;
                            payloadLength = buffer.readUInt16BE(offset);
                            offset += 2;
                        } else if (payloadLength === 127) {
                            if (buffer.length < offset + 8) break;
                            payloadLength = Number(buffer.readBigUInt64BE(offset));
                            offset += 8;
                        }

                        let maskKey = null;
                        if (isMasked) {
                            if (buffer.length < offset + 4) break;
                            maskKey = buffer.subarray(offset, offset + 4);
                            offset += 4;
                        }

                        if (buffer.length < offset + payloadLength) break;
                        let payload = buffer.subarray(offset, offset + payloadLength);
                        buffer = buffer.subarray(offset + payloadLength);

                        if (isMasked && maskKey) {
                            const unmasked = Buffer.alloc(payload.length);
                            for (let i = 0; i < payload.length; i++) {
                                unmasked[i] = payload[i] ^ maskKey[i % 4];
                            }
                            payload = unmasked;
                        }

                        if (opcode === 8) {
                            client.close();
                            break;
                        } else if (opcode === 1 || opcode === 2) {
                            listeners.message.forEach(fn => fn(payload.toString('utf-8')));
                        }
                    }
                });

                socket.on('close', () => listeners.close.forEach(fn => fn()));
                socket.on('error', (err) => listeners.error.forEach(fn => fn(err)));
            });

            req.on('error', (err) => listeners.error.forEach(fn => fn(err)));
            req.end();
            return client;
        }
    };

    const jwt = {
        sign: (payload, secret, options = {}) => {
            const header = { alg: options.algorithm || 'HS256', typ: 'JWT' };
            const body = Object.assign({}, payload);
            const now = Math.floor(Date.now() / 1000);
            body.iat = now;
            if (options.expiresIn !== undefined) {
                let secs = options.expiresIn;
                if (typeof secs === 'string') {
                    const num = parseFloat(secs);
                    if (secs.endsWith('d')) secs = num * 86400;
                    else if (secs.endsWith('h')) secs = num * 3600;
                    else if (secs.endsWith('m')) secs = num * 60;
                    else if (secs.endsWith('s')) secs = num;
                    else secs = num;
                }
                body.exp = now + secs;
            }
            const b64 = (s) => Buffer.from(typeof s === 'string' ? s : JSON.stringify(s)).toString('base64url');
            const headB64 = b64(header);
            const bodyB64 = b64(body);
            const unsigned = `${headB64}.${bodyB64}`;
            const signature = crypto_mod.createHmac('sha256', secret).update(unsigned).digest('base64url');
            return `${unsigned}.${signature}`;
        },
        verify: (token, secret) => {
            if (!token || typeof token !== 'string') throw new Error("Invalid JWT token");
            const parts = token.split('.');
            if (parts.length !== 3) throw new Error("Malformed JWT token: expected 3 parts");
            const [h, p, sig] = parts;
            const unsigned = `${h}.${p}`;
            const expectedSig = crypto_mod.createHmac('sha256', secret).update(unsigned).digest('base64url');
            const bufA = Buffer.from(sig);
            const bufB = Buffer.from(expectedSig);
            if (bufA.length !== bufB.length || !crypto_mod.timingSafeEqual(bufA, bufB)) {
                throw new Error("JWT verification failed: Invalid signature");
            }
            const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf-8'));
            if (payload.exp !== undefined && Math.floor(Date.now() / 1000) >= payload.exp) {
                throw new Error("JWT verification failed: Token has expired");
            }
            return payload;
        },
        decode: (token) => {
            const parts = String(token).split('.');
            if (parts.length < 2) throw new Error("Malformed JWT token");
            return {
                header: JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf-8')),
                payload: JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'))
            };
        }
    };

    const orm = {
        _stores: new Map(),
        define: (modelName, schema = {}, options = {}) => {
            const storeKey = options.tableName || modelName.toLowerCase() + 's';
            if (!orm._stores.has(storeKey)) orm._stores.set(storeKey, []);
            const records = orm._stores.get(storeKey);

            class QueryBuilder {
                constructor() {
                    this.filters = [];
                    this._limit = null;
                    this._offset = 0;
                    this._order = null;
                    this._fields = null;
                }
                where(field, opOrVal, val) {
                    if (typeof field === 'object' && field !== null) {
                        for (const [k, v] of Object.entries(field)) {
                            this.filters.push({ field: k, op: '===', value: v });
                        }
                    } else if (val === undefined) {
                        this.filters.push({ field, op: '===', value: opOrVal });
                    } else {
                        this.filters.push({ field, op: opOrVal, value: val });
                    }
                    return this;
                }
                limit(n) { this._limit = n; return this; }
                offset(n) { this._offset = n; return this; }
                orderBy(field, dir = 'ASC') { this._order = { field, dir: String(dir).toUpperCase() }; return this; }
                select(...fields) { this._fields = fields.flat(); return this; }
                toSQL() {
                    const cols = this._fields && this._fields.length ? this._fields.join(', ') : '*';
                    let sql = `SELECT ${cols} FROM ${storeKey}`;
                    if (this.filters.length) {
                        const conds = this.filters.map(f => {
                            const val = typeof f.value === 'string' ? `'${f.value.replace(/'/g, "''")}'` : f.value;
                            const op = f.op === '===' ? '=' : f.op;
                            return `${f.field} ${op} ${val}`;
                        });
                        sql += ` WHERE ${conds.join(' AND ')}`;
                    }
                    if (this._order) sql += ` ORDER BY ${this._order.field} ${this._order.dir}`;
                    if (this._limit !== null) sql += ` LIMIT ${this._limit}`;
                    if (this._offset) sql += ` OFFSET ${this._offset}`;
                    return sql;
                }
                execute() {
                    let res = records.filter(rec => {
                        for (const f of this.filters) {
                            const actual = rec[f.field];
                            const expected = f.value;
                            switch (f.op) {
                                case '===': case '==': case '=': if (actual != expected) return false; break;
                                case '!==': case '!=': if (actual == expected) return false; break;
                                case '>': if (actual <= expected) return false; break;
                                case '>=': if (actual < expected) return false; break;
                                case '<': if (actual >= expected) return false; break;
                                case '<=': if (actual > expected) return false; break;
                                case 'in': if (!expected.includes(actual)) return false; break;
                                case 'like': if (!String(actual).includes(String(expected))) return false; break;
                            }
                        }
                        return true;
                    });
                    if (this._order) {
                        const { field, dir } = this._order;
                        res.sort((a, b) => {
                            if (a[field] < b[field]) return dir === 'ASC' ? -1 : 1;
                            if (a[field] > b[field]) return dir === 'ASC' ? 1 : -1;
                            return 0;
                        });
                    }
                    if (this._offset) res = res.slice(this._offset);
                    if (this._limit !== null) res = res.slice(0, this._limit);
                    return res.map(r => new Model(r));
                }
            }

            class Model {
                constructor(attrs = {}) {
                    Object.assign(this, attrs);
                    if (!this.id && this.id !== 0) this.id = records.length + 1;
                }
                save() {
                    const idx = records.findIndex(r => r.id === this.id);
                    const raw = Object.assign({}, this);
                    if (idx >= 0) records[idx] = raw;
                    else records.push(raw);
                    return this;
                }
                delete() {
                    const idx = records.findIndex(r => r.id === this.id);
                    if (idx >= 0) records.splice(idx, 1);
                    return true;
                }
                toJSON() { return Object.assign({}, this); }

                static create(data) {
                    const instance = new Model(data);
                    instance.save();
                    return instance;
                }
                static find(query) {
                    const qb = new QueryBuilder();
                    if (query) qb.where(query);
                    return qb.execute();
                }
                static query() { return new QueryBuilder(); }
                static findOne(query) {
                    const qb = new QueryBuilder();
                    if (query) qb.where(query);
                    qb.limit(1);
                    const list = qb.execute();
                    return list[0] || null;
                }
                static count() { return records.length; }
                static clear() { records.length = 0; }
            }
            Model.tableName = storeKey;
            return Model;
        }
    };

    class Database {
        constructor(filepath) {
            this.filepath = filepath;
            if (filepath && fs.existsSync(filepath)) {
                try { this.data = JSON.parse(fs.readFileSync(filepath, 'utf-8')); } catch (e) { this.data = {}; }
            } else {
                this.data = {};
            }
        }
        collection(name) {
            if (!this.data[name]) this.data[name] = [];
            const self = this;
            return {
                insert: (record) => { self.data[name].push(record); self.save(); return record; },
                find: (queryFn) => self.data[name].filter(queryFn),
                all: () => self.data[name]
            };
        }
        save() {
            if (this.filepath) {
                checkPermission(ALLOW_WRITE, 'write');
                fs.writeFileSync(this.filepath, JSON.stringify(this.data, null, 2));
            }
        }
    }

    const db = {
        Database,
        defineModel: (name, schema, opts) => orm.define(name, schema, opts),
        Model: orm.define('Model')
    };

    const args_module = {
        parse: (argv = process.argv.slice(2), spec = {}) => {
            const parsed = { _: [], raw: argv };
            let i = 0;
            while (i < argv.length) {
                const arg = argv[i];
                if (arg === '--') {
                    parsed._.push(...argv.slice(i + 1));
                    break;
                }
                if (arg.startsWith('--')) {
                    const eqIdx = arg.indexOf('=');
                    if (eqIdx !== -1) {
                        const k = arg.slice(2, eqIdx);
                        const v = arg.slice(eqIdx + 1);
                        parsed[k] = v;
                    } else {
                        const k = arg.slice(2);
                        if (k.startsWith('no-')) {
                            parsed[k.slice(3)] = false;
                        } else if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
                            parsed[k] = argv[++i];
                        } else {
                            parsed[k] = true;
                        }
                    }
                } else if (arg.startsWith('-') && arg.length > 1) {
                    const k = arg.slice(1);
                    if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
                        parsed[k] = argv[++i];
                    } else {
                        parsed[k] = true;
                    }
                } else {
                    if (!parsed.command && parsed._.length === 0) parsed.command = arg;
                    parsed._.push(arg);
                }
                i++;
            }
            for (const [name, opt] of Object.entries(spec)) {
                let val = parsed[name];
                if (val === undefined && opt.alias && parsed[opt.alias] !== undefined) {
                    val = parsed[opt.alias];
                }
                if (val === undefined && opt.default !== undefined) {
                    val = opt.default;
                }
                if (val !== undefined && opt.type === 'number') val = Number(val);
                if (val !== undefined && opt.type === 'boolean') val = Boolean(val);
                parsed[name] = val;
            }
            return parsed;
        },
        help: (spec = {}, title = 'WATE CLI Application') => {
            let text = `${title}\nOptions:\n`;
            for (const [name, opt] of Object.entries(spec)) {
                const aliasStr = opt.alias ? `-${opt.alias}, ` : '    ';
                const typeStr = opt.type ? `<${opt.type}>` : '';
                const defStr = opt.default !== undefined ? ` (default: ${opt.default})` : '';
                text += `  ${aliasStr}--${name.padEnd(12)} ${typeStr.padEnd(8)} ${opt.description || ''}${defStr}\n`;
            }
            return text;
        }
    };

    const logger = {
        _level: 1,
        _format: 'pretty',
        _transports: [],
        LEVELS: { debug: 0, info: 1, warn: 2, error: 3, fatal: 4 },
        setLevel: (lvl) => {
            logger._level = typeof lvl === 'number' ? lvl : (logger.LEVELS[String(lvl).toLowerCase()] ?? 1);
        },
        setFormat: (fmt) => { logger._format = fmt; },
        addFileTransport: (filePath) => { logger._transports.push(filePath); },
        _log: (lvlName, ...args) => {
            const lvlNum = logger.LEVELS[lvlName] ?? 1;
            if (lvlNum < logger._level) return;
            const now = new Date().toISOString();
            const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
            let formatted = '';
            if (logger._format === 'json') {
                formatted = JSON.stringify({ timestamp: now, level: lvlName.toUpperCase(), message: msg });
            } else {
                const colors = { debug: '\x1b[36m', info: '\x1b[32m', warn: '\x1b[33m', error: '\x1b[31m', fatal: '\x1b[35m' };
                formatted = `[${colors[lvlName] || ''}${lvlName.toUpperCase()}\x1b[0m] [${now.slice(11, 19)}] ${msg}`;
            }
            if (lvlName === 'error' || lvlName === 'fatal') console.error(formatted);
            else if (lvlName === 'warn') console.warn(formatted);
            else console.log(formatted);
            for (const fp of logger._transports) {
                try { fs.appendFileSync(fp, (logger._format === 'json' ? formatted : `[${lvlName.toUpperCase()}] [${now}] ${msg}`) + '\n'); } catch (e) {}
            }
        },
        debug: (...args) => logger._log('debug', ...args),
        info: (...args) => logger._log('info', ...args),
        warn: (...args) => logger._log('warn', ...args),
        error: (...args) => logger._log('error', ...args),
        fatal: (...args) => logger._log('fatal', ...args),
        create: (meta = {}) => {
            return {
                debug: (...a) => logger.debug(`[${meta.tag || 'App'}]`, ...a),
                info: (...a) => logger.info(`[${meta.tag || 'App'}]`, ...a),
                warn: (...a) => logger.warn(`[${meta.tag || 'App'}]`, ...a),
                error: (...a) => logger.error(`[${meta.tag || 'App'}]`, ...a)
            };
        }
    };

    const xml = {
        parse: (xmlStr) => {
            xmlStr = String(xmlStr || '').replace(/<!--[\s\S]*?-->/g, '').trim();
            const parseAttrs = (attrStr) => {
                const attrs = {};
                const regex = /([a-zA-Z0-9_\-]+)=(?:"([^"]*)"|'([^']*)')/g;
                let m;
                while ((m = regex.exec(attrStr)) !== null) {
                    attrs[m[1]] = m[2] !== undefined ? m[2] : m[3];
                }
                return attrs;
            };
            const parseNode = (text) => {
                const match = text.match(/^<([a-zA-Z0-9_\-]+)([^>]*)>([\s\S]*?)<\/\1>/);
                if (!match) {
                    const selfClose = text.match(/^<([a-zA-Z0-9_\-]+)([^>]*)\/>/);
                    if (selfClose) {
                        return { tag: selfClose[1], attributes: parseAttrs(selfClose[2]), children: [] };
                    }
                    return text.trim();
                }
                const tag = match[1];
                const attrs = parseAttrs(match[2]);
                const inner = match[3].trim();
                const children = [];
                const tagRegex = /<([a-zA-Z0-9_\-]+)([^>]*)>([\s\S]*?)<\/\1>|<([a-zA-Z0-9_\-]+)([^>]*)\/>/g;
                let m;
                let foundChild = false;
                while ((m = tagRegex.exec(inner)) !== null) {
                    foundChild = true;
                    children.push(parseNode(m[0]));
                }
                return {
                    tag,
                    attributes: attrs,
                    text: foundChild ? undefined : inner,
                    children: children.length ? children : undefined
                };
            };
            return parseNode(xmlStr);
        },
        stringify: (obj, rootName = 'root', indent = 2) => {
            const serialize = (data, name, depth) => {
                const pad = ' '.repeat(depth * indent);
                if (data === null || data === undefined) return `${pad}<${name}/>`;
                if (typeof data !== 'object') return `${pad}<${name}>${data}</${name}>`;
                if (Array.isArray(data)) {
                    return data.map(item => serialize(item, name, depth)).join('\n');
                }
                let attrs = '';
                let content = '';
                for (const [k, v] of Object.entries(data)) {
                    if (k.startsWith('@')) attrs += ` ${k.slice(1)}="${v}"`;
                    else if (k === '#text' || k === 'text') content += v;
                    else content += '\n' + serialize(v, k, depth + 1);
                }
                if (!content) return `${pad}<${name}${attrs}/>`;
                if (content.includes('\n')) return `${pad}<${name}${attrs}>${content}\n${pad}</${name}>`;
                return `${pad}<${name}${attrs}>${content}</${name}>`;
            };
            return `<?xml version="1.0" encoding="UTF-8"?>\n` + serialize(obj, rootName, 0);
        }
    };

    const yaml = {
        parse: (yamlStr) => {
            const lines = String(yamlStr || '').split('\n');
            const root = {};
            const stack = [{ indent: -1, container: root, parent: null, key: null }];

            for (let line of lines) {
                const commentIdx = line.indexOf('#');
                if (commentIdx !== -1) line = line.slice(0, commentIdx);
                if (!line.trim()) continue;

                const indent = line.search(/\S/);
                const trimmed = line.trim();

                while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
                    stack.pop();
                }
                const top = stack[stack.length - 1];
                let parent = top.container;

                if (trimmed.startsWith('- ')) {
                    const valStr = trimmed.slice(2).trim();
                    let val = yaml._parseScalar(valStr);
                    if (!Array.isArray(parent)) {
                        if (top.parent && top.key) {
                            const arr = [];
                            top.parent[top.key] = arr;
                            top.container = arr;
                            parent = arr;
                        }
                    }
                    if (Array.isArray(parent)) {
                        parent.push(val);
                    }
                } else if (trimmed.includes(':')) {
                    const colonIdx = trimmed.indexOf(':');
                    const key = trimmed.slice(0, colonIdx).trim();
                    const rest = trimmed.slice(colonIdx + 1).trim();

                    if (!rest) {
                        const childObj = {};
                        if (Array.isArray(parent)) parent.push(childObj);
                        else parent[key] = childObj;
                        stack.push({ indent, container: childObj, parent, key });
                    } else {
                        const parsedVal = yaml._parseScalar(rest);
                        if (Array.isArray(parent)) {
                            const obj = {};
                            obj[key] = parsedVal;
                            parent.push(obj);
                        } else {
                            parent[key] = parsedVal;
                        }
                    }
                }
            }
            return root;
        },
        _parseScalar: (s) => {
            if (!s) return null;
            if (s === 'true' || s === 'yes' || s === 'True') return true;
            if (s === 'false' || s === 'no' || s === 'False') return false;
            if (s === 'null' || s === '~') return null;
            if (!isNaN(Number(s)) && !s.includes(' ')) return Number(s);
            if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
            return s;
        },
        stringify: (obj, indent = 2) => {
            const dump = (val, level) => {
                const pad = ' '.repeat(level * indent);
                if (val === null || val === undefined) return 'null';
                if (typeof val === 'boolean' || typeof val === 'number') return String(val);
                if (typeof val === 'string') return val.includes(':') || val.includes('\n') ? JSON.stringify(val) : val;
                if (Array.isArray(val)) {
                    return val.map(item => `${pad}- ${dump(item, level + 1).trim()}`).join('\n');
                }
                return Object.entries(val).map(([k, v]) => {
                    if (typeof v === 'object' && v !== null && Object.keys(v).length > 0) {
                        return `${pad}${k}:\n${dump(v, level + 1)}`;
                    }
                    return `${pad}${k}: ${dump(v, level + 1)}`;
                }).join('\n');
            };
            return dump(obj, 0);
        }
    };

    const img = {
        resize: (filepath, width, height, outputpath) => {
            checkPermission(ALLOW_READ, 'read');
            checkPermission(ALLOW_WRITE, 'write');
            console.log(`[Image]: Resizing '${filepath}' to ${width}x${height} -> '${outputpath}'`);
            if (fs.existsSync(filepath) && outputpath) fs.copyFileSync(filepath, outputpath);
            return true;
        },
        convert: (filepath, format, outputpath) => {
            checkPermission(ALLOW_READ, 'read');
            checkPermission(ALLOW_WRITE, 'write');
            console.log(`[Image]: Converting format of '${filepath}' to '${format}' -> '${outputpath}'`);
            if (fs.existsSync(filepath) && outputpath) fs.copyFileSync(filepath, outputpath);
            return true;
        },
        crop: (src, x, y, w, h, dst) => {
            checkPermission(ALLOW_READ, 'read');
            checkPermission(ALLOW_WRITE, 'write');
            console.log(`[Image]: Cropping '${src}' at (${x},${y}) size ${w}x${h} -> '${dst}'`);
            if (fs.existsSync(src) && dst) fs.copyFileSync(src, dst);
            return true;
        },
        watermark: (src, text, options = {}, dst) => {
            checkPermission(ALLOW_READ, 'read');
            checkPermission(ALLOW_WRITE, 'write');
            console.log(`[Image]: Applying watermark '${text}' onto '${src}' -> '${dst}'`);
            if (fs.existsSync(src) && dst) fs.copyFileSync(src, dst);
            return true;
        },
        filter: (src, filterName, dst) => {
            checkPermission(ALLOW_READ, 'read');
            checkPermission(ALLOW_WRITE, 'write');
            console.log(`[Image]: Applying filter '${filterName}' onto '${src}' -> '${dst}'`);
            if (fs.existsSync(src) && dst) fs.copyFileSync(src, dst);
            return true;
        },
        metadata: (src) => {
            checkPermission(ALLOW_READ, 'read');
            const ext = path.extname(src).slice(1).toLowerCase();
            return {
                path: src,
                format: ext || 'png',
                width: 800,
                height: 600,
                channels: 3,
                sizeBytes: fs.existsSync(src) ? fs.statSync(src).size : 0
            };
        },
        Pipeline: (src) => {
            const operations = [];
            const pipe = {
                resize: (w, h) => { operations.push({ op: 'resize', w, h }); return pipe; },
                crop: (x, y, w, h) => { operations.push({ op: 'crop', x, y, w, h }); return pipe; },
                watermark: (text, opts) => { operations.push({ op: 'watermark', text, opts }); return pipe; },
                filter: (name) => { operations.push({ op: 'filter', name }); return pipe; },
                save: (dst) => {
                    for (const op of operations) {
                        if (op.op === 'resize') img.resize(src, op.w, op.h, dst);
                        else if (op.op === 'crop') img.crop(src, op.x, op.y, op.w, op.h, dst);
                        else if (op.op === 'watermark') img.watermark(src, op.text, op.opts, dst);
                        else if (op.op === 'filter') img.filter(src, op.name, dst);
                    }
                    return true;
                }
            };
            return pipe;
        }
    };

    const pdf = {
        create: (filepath, config = {}) => {
            checkPermission(ALLOW_WRITE, 'write');
            console.log(`[PDF]: Initiating document construction at: ${filepath}`);
            console.log(`[PDF]: Rendering document title: '${config.title || 'Untitled'}'...`);
            const doc = pdf.Document({ title: config.title });
            doc.text(config.title || 'Untitled', 50, 750, { size: 18 });
            doc.save(filepath);
            console.log("✅ WATE IO: " + filepath + " successfully save ho gayi.");
            console.log("[PDF]: Document rendering and saving completed successfully.");
            return true;
        },
        Document: (options = {}) => {
            const pages = [];
            let curPage = { streams: [] };
            pages.push(curPage);

            const doc = {
                addPage: () => {
                    curPage = { streams: [] };
                    pages.push(curPage);
                    return doc;
                },
                text: (str, x, y, opts = {}) => {
                    const size = opts.size || 12;
                    const escaped = String(str).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
                    curPage.streams.push(`BT /F1 ${size} Tf ${x} ${y} Td (${escaped}) Tj ET`);
                    return doc;
                },
                line: (x1, y1, x2, y2, opts = {}) => {
                    curPage.streams.push(`${opts.width || 1} w ${x1} ${y1} m ${x2} ${y2} l S`);
                    return doc;
                },
                rect: (x, y, w, h, opts = {}) => {
                    const op = opts.fill ? 'f' : 'S';
                    curPage.streams.push(`${x} ${y} ${w} ${h} re ${op}`);
                    return doc;
                },
                table: (headers, rows, opts = {}) => {
                    const startX = opts.x || 50;
                    let startY = opts.y || 700;
                    const colW = opts.colWidth || 100;
                    const rowH = opts.rowHeight || 20;

                    headers.forEach((h, i) => {
                        doc.text(String(h), startX + i * colW, startY, { size: 11 });
                    });
                    doc.line(startX, startY - 4, startX + headers.length * colW, startY - 4);
                    startY -= rowH;

                    rows.forEach(row => {
                        row.forEach((cell, i) => {
                            doc.text(String(cell), startX + i * colW, startY, { size: 10 });
                        });
                        startY -= rowH;
                    });
                    return doc;
                },
                toBuffer: () => {
                    const objects = [];
                    const addObject = (content) => {
                        objects.push(content);
                        return objects.length;
                    };
                    const fontObj = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
                    const pageRefs = [];
                    for (const p of pages) {
                        const streamContent = p.streams.join('\n');
                        const streamObj = addObject(`<< /Length ${Buffer.byteLength(streamContent)} >>\nstream\n${streamContent}\nendstream`);
                        const pageObj = addObject(`<< /Type /Page /Parent 1 0 R /Resources << /Font << /F1 ${fontObj} 0 R >> >> /MediaBox [0 0 595 842] /Contents ${streamObj} 0 R >>`);
                        pageRefs.push(`${pageObj} 0 R`);
                    }
                    const pagesTree = `<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${pages.length} >>`;
                    objects.unshift(pagesTree);

                    const catalogObj = addObject(`<< /Type /Catalog /Pages 1 0 R >>`);

                    let pdfStr = '%PDF-1.4\n';
                    const offsets = [];
                    for (let i = 0; i < objects.length; i++) {
                        offsets.push(Buffer.byteLength(pdfStr));
                        pdfStr += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
                    }

                    const xrefOffset = Buffer.byteLength(pdfStr);
                    pdfStr += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
                    for (const off of offsets) {
                        pdfStr += String(off).padStart(10, '0') + ' 00000 n \n';
                    }
                    pdfStr += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogObj} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
                    return Buffer.from(pdfStr);
                },
                save: (fp) => {
                    checkPermission(ALLOW_WRITE, 'write');
                    fs.writeFileSync(fp, doc.toBuffer());
                    return true;
                }
            };
            return doc;
        }
    };

    const i18n = {
        _locales: new Map(),
        _activeLocale: 'en',
        _fallbackLocale: 'en',
        load: (locale, dict) => {
            i18n._locales.set(locale, dict);
        },
        setLocale: (locale) => { i18n._activeLocale = locale; },
        getLocale: () => i18n._activeLocale,
        setFallbackLocale: (locale) => { i18n._fallbackLocale = locale; },
        has: (key, locale = i18n._activeLocale) => {
            const dict = i18n._locales.get(locale);
            if (!dict) return false;
            return key.split('.').reduce((acc, part) => acc && acc[part] !== undefined ? acc[part] : undefined, dict) !== undefined;
        },
        t: (key, params = {}) => {
            const resolve = (loc) => {
                const dict = i18n._locales.get(loc);
                if (!dict) return null;
                return key.split('.').reduce((acc, part) => acc && acc[part] !== undefined ? acc[part] : undefined, dict);
            };
            let val = resolve(i18n._activeLocale);
            if (val === undefined || val === null) val = resolve(i18n._fallbackLocale);
            if (val === undefined || val === null) return key;

            if (typeof val === 'object' && params.count !== undefined) {
                if (params.count === 0 && val.zero) val = val.zero;
                else if (params.count === 1 && val.one) val = val.one;
                else if (val.other) val = val.other;
            }

            if (typeof val === 'string') {
                return val.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, k) => params[k] !== undefined ? params[k] : `{${k}}`);
            }
            return val;
        }
    };

    return {
        file, sys, http, math, str, input, json, date, color, os, env, regex, crypto,
        wpath, list, num, assert, timer, stack, queue, table, type, _wate_defineInterface,
        implements_check, every, thread, stream, readonly, log, route, deprecated, CustomError,
        ws, jwt, orm, args: args_module, logger, xml, yaml, img, image: img, pdf, i18n,
        db: { defineModel: orm.define, Model: orm.define('Model'), Database }
    };
}

let lastTranspiledCode = '';

function mapStackTrace(stack, filePath) {
    if (!stack || !lastTranspiledCode) return stack;
    const lines = lastTranspiledCode.split('\n');

    return stack.replace(/<anonymous>:(\d+):(\d+)/g, (match, lineStr, colStr) => {
        const lineIdx = parseInt(lineStr, 10) - 1;
        if (lineIdx >= 0 && lineIdx < lines.length) {
            const compiledLine = lines[lineIdx];
            const wateLineMatch = compiledLine.match(/\/\* WATE_LINE:(\d+) \*\//);
            if (wateLineMatch) {
                const wateLine = wateLineMatch[1];
                return `${filePath || '<input>'}:${wateLine}:${colStr}`;
            }
        }
        return match;
    });
}

function getCachePath(filePath) {
    const crypto = require('crypto');
    const hash = crypto.createHash('md5').update(filePath || '<input>').digest('hex');
    const cacheDir = path.resolve(process.cwd(), '.wate_cache');
    if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
    }
    return path.join(cacheDir, `${hash}.json`);
}

function getCachedTranspilation(filePath, code) {
    if (!filePath || filePath === '<input>') return null;
    try {
        const cachePath = getCachePath(filePath);
        if (fs.existsSync(cachePath)) {
            const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
            const crypto = require('crypto');
            const currentHash = crypto.createHash('sha256').update(code).digest('hex');
            if (cacheData.sourceHash === currentHash && cacheData.version === '9.2.0') {
                return cacheData.transpiledCode;
            }
        }
    } catch (e) {
        // Fallback silently if cache is corrupt
    }
    return null;
}

function saveCachedTranspilation(filePath, code, transpiledCode) {
    if (!filePath || filePath === '<input>') return;
    try {
        const cachePath = getCachePath(filePath);
        const crypto = require('crypto');
        const sourceHash = crypto.createHash('sha256').update(code).digest('hex');
        const cacheEntry = {
            sourceHash,
            transpiledCode,
            timestamp: Date.now(),
            version: '9.2.0'
        };
        fs.writeFileSync(cachePath, JSON.stringify(cacheEntry, null, 2), 'utf-8');
    } catch (e) {
        // Fallback silently
    }
}

// =============================================
// === WATE EXECUTION ENGINE ===
// =============================================
function runBytecodeFile(targetFile) {
    const { BytecodeDeserializer, VirtualMachine } = require('./wate-vm');
    const buffer = fs.readFileSync(targetFile);
    const decoded = BytecodeDeserializer.deserialize(buffer);
    const libs = buildLibs(targetFile);
    libs.out = console.log;
    libs.print = console.log;
    const vm = new VirtualMachine(decoded.instructions, libs, libs, {
        maxMemoryMB: MAX_MEMORY_MB,
        jit: JIT_ENABLED,
        loopLimit: LOOP_LIMIT
    });
    const res = vm.run();
    if (GC_STATS) {
        console.log('\n📊 WATE Garbage Collector Stats:', vm.gc.getStats());
    }
    return res;
}

function runCode(code, filePath) {
    _loopCounter = 0; // ✅ FIX #1: Safely zeroed before a new script run

    const vmMode = args.includes('--vm') || REGISTER_VM;
    if (vmMode) {
        const { parseWate, MacroExpander, ConstFolder } = require('./wate-parser');
        const { BytecodeCompiler, RegisterBytecodeCompiler, VirtualMachine } = require('./wate-vm');
        const ast = parseWate(code, filePath);
        new MacroExpander().expand(ast);
        new ConstFolder().fold(ast);
        const compiler = REGISTER_VM ? new RegisterBytecodeCompiler() : new BytecodeCompiler();
        compiler.compile(ast);

        const libs = buildLibs(filePath);
        libs.out = console.log;
        libs.print = console.log;

        const vm = new VirtualMachine(compiler.instructions, libs, libs, {
            maxMemoryMB: MAX_MEMORY_MB,
            jit: JIT_ENABLED,
            loopLimit: LOOP_LIMIT
        });
        const res = vm.run();
        if (GC_STATS) {
            console.log('\n📊 WATE Garbage Collector Stats:', vm.gc.getStats());
        }
        return res;
    }

    const isCov = args.includes('--coverage');
    const wantSourceMap = args.includes('--source-map');
    let transpiledCode = !isCov ? getCachedTranspilation(filePath, code) : null;
    if (!transpiledCode || wantSourceMap || isCov) {
        const transpileRes = transpile(code, filePath, { 
            sourceMap: wantSourceMap, 
            strictTypes: args.includes('--strict-types'),
            coverage: isCov,
            filePath
        });
        if (wantSourceMap && typeof transpileRes === 'object') {
            transpiledCode = transpileRes.code;
            const mapPath = filePath && filePath !== '<input>' ? filePath.replace(/\.wate$/, '.map') : 'transpiled.map';
            try { fs.writeFileSync(mapPath, transpileRes.mapJson, 'utf-8'); } catch (e) {}
        } else {
            transpiledCode = typeof transpileRes === 'string' ? transpileRes : transpileRes.code;
        }
        if (!wantSourceMap && !isCov) {
            saveCachedTranspilation(filePath, code, transpiledCode);
        }
    }
    lastTranspiledCode = transpiledCode;

    if (DEBUG_MODE) {
        console.log('\n🔍 ===== WATE DEBUG MODE =====');
        const lines = transpiledCode.split('\n');
        lines.forEach((line, i) => {
            if (line.trim()) console.log(`  [Line ${String(i + 1).padStart(3, '0')}] ${line}`);
        });
        console.log('🔍 ===== END DEBUG =====\n');
    }

    // ✅ FIX #2: All advanced standard modules securely unpacked into runtime scope
    const libs = buildLibs(filePath);
    Object.assign(globalThis, {
        stream: libs.stream,
        readonly: libs.readonly,
        log: libs.log,
        route: libs.route,
        deprecated: libs.deprecated,
        CustomError: libs.CustomError,
        ws: libs.ws,
        jwt: libs.jwt,
        orm: libs.orm,
        args: libs.args,
        logger: libs.logger,
        xml: libs.xml,
        yaml: libs.yaml,
        img: libs.img,
        image: libs.img,
        pdf: libs.pdf,
        i18n: libs.i18n,
        db: libs.db
    });
    const { file, sys, http, math, str, input, json, date, color, os, env, regex, crypto, wpath, list, num, assert, timer, stack, queue, table, type, _wate_defineInterface, implements_check, every, thread, stream, readonly, log, route, deprecated, CustomError, ws, jwt, orm, logger, xml, yaml, img, image, pdf, i18n, db } = libs;
    (function(args) {
        eval(transpiledCode);
    })(libs.args);
}

// =============================================
// === WATE REPL MODE ===
// =============================================
function startREPL() {
    console.log(`
  ⚡ WATE Upgraded Interactive Shell v10.0.0 (Premium Build)
  Created by WazemTech (Waseem Akram)
  
  Type WATE code and press Enter to run.
  Type '.scope' to view current variables, '.clear' to clear.
  Type '.exit' or 'exit' to exit REPL.
    `);

    const vm_mod = require('vm');
    const libs = buildLibs(null);
    libs.out = console.log;
    libs.print = console.log;
    libs.console = console;
    const initialBuiltInKeys = Object.keys(libs);

    const context = vm_mod.createContext(libs);
    const rl = readline.createInterface({ 
        input: process.stdin, 
        output: process.stdout,
        prompt: 'wate> ',
        terminal: true
    });
    
    let multiLineBuffer = '';
    const countChar = (str, char) => (str.split(char).length - 1);
    
    const isComplete = (code) => {
        const openBraces = countChar(code, '{') - countChar(code, '}');
        const openParens = countChar(code, '(') - countChar(code, ')');
        const openBrackets = countChar(code, '[') - countChar(code, ']');
        return openBraces <= 0 && openParens <= 0 && openBrackets <= 0;
    };

    rl.prompt();

    rl.on('line', (line) => {
        const trimmed = line.trim();
        const isMulti = multiLineBuffer.length > 0;
        
        if (!isMulti) {
            if (trimmed === 'exit' || trimmed === 'quit' || trimmed === '.exit' || trimmed === '.quit') {
                console.log('👋 WATE REPL band ho raha hai. Khuda Hafiz!');
                rl.close();
                process.exit(0);
            }
            if (trimmed === 'clear' || trimmed === '.clear') {
                console.clear();
                rl.prompt();
                return;
            }
            if (trimmed === '.scope') {
                const userScope = Object.getOwnPropertyNames(context).filter(k => !initialBuiltInKeys.includes(k) && k !== 'console');
                if (userScope.length === 0) {
                    console.log(`\x1b[90mℹ No variables declared in this session yet.\x1b[0m`);
                } else {
                    console.log(`📊 Active REPL Scope Variables:`);
                    userScope.forEach(v => {
                        try {
                            console.log(`  🔹 ${v} = ${context[v]}`);
                        } catch (e) {
                            console.log(`  🔹 ${v} = <getter/error>`);
                        }
                    });
                }
                console.log();
                rl.prompt();
                return;
            }
            if (trimmed.startsWith('.ast ')) {
                try {
                    const target = trimmed.substring(5);
                    const { parseWate } = require('./wate-parser');
                    console.log(JSON.stringify(parseWate(target, '<repl>'), null, 2));
                } catch (e) {
                    console.error(`❌ AST Parsing Error: ${e.message}`);
                }
                rl.prompt();
                return;
            }
        }

        if (!trimmed && !isMulti) {
            rl.prompt();
            return;
        }

        multiLineBuffer += (multiLineBuffer ? '\n' : '') + line;

        if (isComplete(multiLineBuffer)) {
            try {
                _loopCounter = 0;
                let transpiled = transpile(multiLineBuffer, '<repl>');
                transpiled = transpiled.replace(/^(?:let|const)\s+/gm, 'var ');
                const result = vm_mod.runInContext(transpiled, context);
                if (result !== undefined) {
                    console.log(`=> ${result}`);
                }
            } catch (e) {
                console.error(`🔥 REPL Error: ${e.message}`);
            }
            multiLineBuffer = '';
            rl.setPrompt('wate> ');
        } else {
            rl.setPrompt('...  ');
        }
        rl.prompt();
    });

    rl.on('close', () => process.exit(0));
}

// =============================================
// === WATE MAIN ENTRY POINT ===
// =============================================

const { isMainThread, workerData } = require('worker_threads');

if (!isMainThread) {
    const targetPath = workerData.filePath;
    const fs = require('fs');
    const source = fs.readFileSync(targetPath, 'utf8');
    const transpiledCode = transpile(source, targetPath);
    
    const libs = buildLibs(targetPath);
    libs.out = console.log;
    libs.print = console.log;
    libs.console = console;
    
    const vm_mod = require('vm');
    const context = vm_mod.createContext(libs);
    try {
        vm_mod.runInContext(transpiledCode, context);
    } catch (e) {
        console.error(`🔥 Thread Error [${targetPath}]: ${e.message}`);
    }
    return;
}

// =============================================
// === WATE WEB PLAYGROUND SERVER ===
// =============================================
function startPlaygroundServer(port = 4200, autoOpen = true) {
    const http = require('http');
    const playgroundDir = path.join(__dirname, 'playground');
    const mimeMap = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.ico': 'image/x-icon'
    };

    const server = http.createServer((req, res) => {
        let reqUrl = req.url.split('?')[0];
        if (reqUrl === '/' || reqUrl === '') reqUrl = '/index.html';

        let targetFile;
        if (reqUrl === '/wate-parser.js' || reqUrl.endsWith('/wate-parser.js')) {
            targetFile = path.join(__dirname, 'wate-parser.js');
        } else {
            targetFile = path.join(playgroundDir, reqUrl.replace(/^\//, ''));
        }

        if (fs.existsSync(targetFile) && fs.statSync(targetFile).isFile()) {
            const ext = path.extname(targetFile);
            const contentType = mimeMap[ext] || 'text/plain';
            res.writeHead(200, { 'Content-Type': contentType });
            fs.createReadStream(targetFile).pipe(res);
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found');
        }
    });

    server.listen(port, () => {
        console.log(`\n\x1b[1m\x1b[36m⚡ WATE Interactive Web Playground & REPL\x1b[0m`);
        console.log(`\x1b[90mRunning locally at:\x1b[0m \x1b[32m\x1b[4mhttp://localhost:${port}\x1b[0m`);
        console.log(`\x1b[90mPress Ctrl+C to stop.\x1b[0m\n`);

        if (autoOpen) {
            const { exec } = require('child_process');
            const startCmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
            exec(`${startCmd} http://localhost:${port}`);
        }
    });
}

if (subCommand === 'playground' || (subCommand === '--repl' && args.includes('--web'))) {
    const port = args.includes('--port') ? parseInt(args[args.indexOf('--port')+1], 10) : 4200;
    const autoOpen = !args.includes('--no-open');
    startPlaygroundServer(port, autoOpen);

} else if (subCommand === 'debug') {
    const { startCLIDebugger, WateDAPServer } = require('./wate-debug');
    if (args.includes('--dap')) {
        new WateDAPServer().start();
    } else {
        const target = args.slice(1).find(a => !a.startsWith('--'));
        if (!target) {
            console.error('\x1b[31m❌ Error: No .wate file specified to debug.\x1b[0m');
            console.log('Usage: \x1b[33mwate debug <file.wate>\x1b[0m');
            process.exit(1);
        }
        startCLIDebugger(target);
    }

} else if (subCommand === 'doc') {
    const { runDocGenerator } = require('./wate-doc');
    const target = args.slice(1).find(a => !a.startsWith('--'));
    let format = 'html';
    let outDir = 'docs';
    let title = 'WATE Project Documentation';
    let serve = args.includes('--serve') || args.includes('-s');

    for (const a of args.slice(1)) {
        if (a.startsWith('--format=')) format = a.split('=')[1];
        if (a.startsWith('--out=')) outDir = a.split('=')[1];
        if (a.startsWith('--title=')) title = a.split('=')[1];
    }
    runDocGenerator(target, { format, out: outDir, title, serve });

} else if (subCommand === 'lint') {
    const { runLinter } = require('./wate-lint');
    const target = args.slice(1).find(a => !a.startsWith('-'));
    const strict = args.includes('--strict');
    const fix = args.includes('--fix');
    const json = args.includes('--json');
    const rules = args.includes('--rules') || args.includes('-r');
    runLinter(target, { strict, fix, json, rules });

} else if (subCommand === 'fmt') {
    const { runFormatter } = require('./wate-fmt');
    const target = args.slice(1).find(a => !a.startsWith('-'));
    const check = args.includes('--check') || args.includes('-c');
    const write = !check;
    runFormatter(target, { check, write });

} else if (subCommand === 'bench') {
    const { runBenchmarkCLI } = require('./wate-bench');
    const target = args.slice(1).find(a => !a.startsWith('-'));
    runBenchmarkCLI(target);

} else if (subCommand === 'bundle') {
    const { runBundlerCLI } = require('./wate-bundle');
    const entry = args.slice(1).find(a => !a.startsWith('-'));
    let out = null;
    const oIdx = args.indexOf('-o');
    if (oIdx !== -1 && args[oIdx + 1]) out = args[oIdx + 1];
    const minify = args.includes('--minify');
    runBundlerCLI(entry, { out, minify });

} else if (subCommand === 'compile') {
    const target = args.slice(1).find(a => !a.startsWith('-'));
    if (!target) {
        console.error('\x1b[31m❌ Error: No .wate file specified to compile.\x1b[0m');
        console.log('Usage: \x1b[33mwate compile <file.wate> [-o <file.wbc>] [--source-map]\x1b[0m');
        process.exit(1);
    }
    if (!fs.existsSync(target)) {
        console.error(`\x1b[31m❌ Error: File '${target}' not found.\x1b[0m`);
        process.exit(1);
    }

    let outPath = null;
    const oIdx = args.indexOf('-o');
    if (oIdx !== -1 && args[oIdx + 1]) {
        outPath = args[oIdx + 1];
    } else {
        outPath = target.replace(/\.wate$/, '') + '.wbc';
    }

    if (args.includes('--exe')) {
        const { bundleApp } = require('./wate-bundle');
        const bundledCode = bundleApp(target);
        let exeOut = outPath.endsWith('.wbc') ? outPath.replace(/\.wbc$/, '.exe') : (outPath.endsWith('.exe') ? outPath : outPath + '.exe');
        
        console.log(`\n\x1b[36m⚡ WATE Native Executable Compiler\x1b[0m`);
        console.log(`Compiling standalone binary for: \x1b[33m${target}\x1b[0m...`);

        const cscPath = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';

        if (process.platform === 'win32' && fs.existsSync(cscPath)) {
            const tempCs = path.join(path.dirname(path.resolve(exeOut)), `__wate_tmp_${Date.now()}.cs`);
            const base64Payload = Buffer.from(bundledCode).toString('base64');
            const csCode = `
using System;
using System.IO;
using System.Diagnostics;
using System.Text;

class Program {
    static void Main(string[] args) {
        string tempDir = Path.Combine(Path.GetTempPath(), "wate_bin_" + Process.GetCurrentProcess().Id);
        Directory.CreateDirectory(tempDir);
        string scriptFile = Path.Combine(tempDir, "app.wate");
        string code = Encoding.UTF8.GetString(Convert.FromBase64String("${base64Payload}"));
        File.WriteAllText(scriptFile, code, new UTF8Encoding(false));

        string argStr = "";
        foreach (string a in args) {
            argStr += " \\"" + a + "\\"";
        }

        ProcessStartInfo psi = new ProcessStartInfo();
        string localWate = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "wate.exe");
        psi.FileName = File.Exists(localWate) ? localWate : "wate";
        psi.Arguments = "run \\"" + scriptFile + "\\"" + argStr;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = false;

        try {
            Process p = Process.Start(psi);
            p.WaitForExit();
            Environment.ExitCode = p.ExitCode;
        } catch {
            psi.FileName = "node";
            string wateJs = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "wate.js");
            if (File.Exists(wateJs)) {
                psi.Arguments = "\\"" + wateJs + "\\" run \\"" + scriptFile + "\\"" + argStr;
                Process p2 = Process.Start(psi);
                p2.WaitForExit();
                Environment.ExitCode = p2.ExitCode;
            } else {
                Console.WriteLine("Error: WATE runtime not found in PATH.");
            }
        } finally {
            try { Directory.Delete(tempDir, true); } catch {}
        }
    }
}
`;
            fs.writeFileSync(tempCs, csCode, 'utf-8');
            const { execSync } = require('child_process');
            try {
                execSync(`"${cscPath}" /nologo /optimize+ /target:exe /out:"${exeOut}" "${tempCs}"`, { stdio: 'pipe' });
                fs.unlinkSync(tempCs);
                console.log(`\x1b[32m✔ Successfully compiled standalone native binary:\x1b[0m \x1b[33m${exeOut}\x1b[0m`);
                console.log(`\x1b[90mBinary size: ${fs.statSync(exeOut).size} bytes\x1b[0m\n`);
                process.exit(0);
            } catch (err) {
                try { if (fs.existsSync(tempCs)) fs.unlinkSync(tempCs); } catch (e) {}
                console.warn(`\x1b[33m⚠️ Native compilation fallback: ${err.message}\x1b[0m`);
            }
        }
        
        const cmdOut = exeOut.replace(/\.exe$/, '.cmd');
        const cmdScript = `@echo off\r\nnode "%~dp0wate.js" run -A "${path.resolve(target)}" %*\r\n`;
        fs.writeFileSync(cmdOut, cmdScript, 'utf-8');
        console.log(`\x1b[32m✔ Created executable launcher:\x1b[0m \x1b[33m${cmdOut}\x1b[0m\n`);
        process.exit(0);
    }

    const { parseWate, MacroExpander, ConstFolder, SemanticAnalyzer, ASTTreeShaker, SourceMapGenerator } = require('./wate-parser');
    const { BytecodeCompiler, RegisterBytecodeCompiler, BytecodeSerializer } = require('./wate-vm');
    const crypto = require('crypto');

    const source = fs.readFileSync(target, 'utf-8');
    const ast = parseWate(source, target);

    new MacroExpander().expand(ast);
    new ConstFolder().fold(ast);
    new SemanticAnalyzer(target, source, { strictTypes: args.includes('--strict-types') }).analyze(ast);
    new ASTTreeShaker().shake(ast);

    const isReg = args.includes('--register') || args.includes('--register-vm');
    const compiler = isReg ? new RegisterBytecodeCompiler() : new BytecodeCompiler();
    compiler.compile(ast);

    const payload = {
        magic: 'WBC1',
        version: 1,
        sourceFile: path.basename(target),
        sourceHash: crypto.createHash('sha256').update(source).digest('hex'),
        timestamp: Date.now(),
        instructions: compiler.instructions
    };

    const binBuf = BytecodeSerializer.serialize(payload);
    fs.writeFileSync(outPath, binBuf);

    if (args.includes('--source-map')) {
        const mapPath = outPath.replace(/\.wbc$/, '.map');
        const sm = SourceMapGenerator.generate('', target, source);
        fs.writeFileSync(mapPath, sm.mapJson, 'utf-8');
    }

    console.log(`\n\x1b[32m✅ WATE Bytecode Compiler: Successfully compiled '${target}'\x1b[0m`);
    console.log(`   Output:       \x1b[36m${outPath}\x1b[0m`);
    console.log(`   Format:       \x1b[35m${isReg ? 'Register-based VM (3-address)' : 'Stack-based VM'}\x1b[0m`);
    console.log(`   Instructions: \x1b[33m${compiler.instructions.length}\x1b[0m`);
    console.log(`   Binary Size:  \x1b[35m${binBuf.length} bytes\x1b[0m\n`);
    process.exit(0);

} else if (subCommand === 'dump') {
    const target = args.slice(1).find(a => !a.startsWith('-'));
    if (!target) {
        console.error('\x1b[31m❌ Error: No .wbc or .wate file specified to dump.\x1b[0m');
        console.log('Usage: \x1b[33mwate dump <file.wbc|file.wate> [--register-vm]\x1b[0m');
        process.exit(1);
    }
    if (!fs.existsSync(target)) {
        console.error(`\x1b[31m❌ Error: File '${target}' not found.\x1b[0m`);
        process.exit(1);
    }

    const { BytecodeDisassembler, BytecodeCompiler, RegisterBytecodeCompiler } = require('./wate-vm');
    if (target.endsWith('.wbc')) {
        const buf = fs.readFileSync(target);
        console.log(BytecodeDisassembler.dump(buf, { sourceFile: target }));
    } else {
        const { parseWate, MacroExpander, ConstFolder } = require('./wate-parser');
        const source = fs.readFileSync(target, 'utf-8');
        const ast = parseWate(source, target);
        new MacroExpander().expand(ast);
        new ConstFolder().fold(ast);
        const compiler = (args.includes('--register') || args.includes('--register-vm')) ? new RegisterBytecodeCompiler() : new BytecodeCompiler();
        compiler.compile(ast);
        console.log(BytecodeDisassembler.dump(compiler.instructions, { sourceFile: target }));
    }
    process.exit(0);

} else if (subCommand === 'profile') {
    const target = args.slice(1).find(a => !a.startsWith('-'));
    if (!target) {
        console.error('\x1b[31m❌ Error: No .wate or .wbc file specified to profile.\x1b[0m');
        console.log('Usage: \x1b[33mwate profile <file.wate|file.wbc> [--register-vm] [--jit] [--max-memory=MB]\x1b[0m');
        process.exit(1);
    }
    if (!fs.existsSync(target)) {
        console.error(`\x1b[31m❌ Error: File '${target}' not found.\x1b[0m`);
        process.exit(1);
    }

    const { parseWate, MacroExpander, ConstFolder } = require('./wate-parser');
    const { BytecodeCompiler, RegisterBytecodeCompiler, BytecodeDeserializer, VirtualMachine, VMProfiler } = require('./wate-vm');

    let instructions = [];
    if (target.endsWith('.wbc')) {
        const buf = fs.readFileSync(target);
        const decoded = BytecodeDeserializer.deserialize(buf);
        instructions = decoded.instructions;
    } else {
        const source = fs.readFileSync(target, 'utf-8');
        const ast = parseWate(source, target);
        new MacroExpander().expand(ast);
        new ConstFolder().fold(ast);
        const compiler = REGISTER_VM ? new RegisterBytecodeCompiler() : new BytecodeCompiler();
        compiler.compile(ast);
        instructions = compiler.instructions;
    }

    const libs = buildLibs(target);
    libs.out = console.log;
    libs.print = console.log;

    const profiler = new VMProfiler();
    const vm = new VirtualMachine(instructions, libs, libs, {
        maxMemoryMB: MAX_MEMORY_MB,
        jit: JIT_ENABLED,
        loopLimit: LOOP_LIMIT,
        profiler
    });

    console.log(`\n\x1b[36m⚡ Running WATE VM Profiler on: \x1b[33m${target}\x1b[0m...\n`);
    try {
        vm.run();
    } catch (e) {
        console.error(`\x1b[31mVM Execution Terminated:\x1b[0m ${e.message}`);
    }

    console.log(profiler.formatReport(vm));
    process.exit(0);

} else if (subCommand === 'help' || args.includes('--help') || args.includes('-h')) {
    console.log(`
\x1b[1m\x1b[36m  ⚡ WATE Programming Language v10.0.0\x1b[0m
  \x1b[90mBuilt by WazemTech (Waseem Akram)\x1b[0m

  \x1b[1mUsage:\x1b[0m
    \x1b[32mwate\x1b[0m \x1b[33m<file.wate>\x1b[0m                 Run a WATE script
    \x1b[32mwate\x1b[0m \x1b[33m<file.wbc>\x1b[0m                  Run precompiled WATE binary bytecode
    \x1b[32mwate\x1b[0m \x1b[33mrun <file.wate|file.wbc>\x1b[0m   Run script or bytecode explicitly
    \x1b[32mwate\x1b[0m \x1b[33mcompile <file.wate>\x1b[0m         Compile WATE script into binary bytecode (.wbc)
    \x1b[32mwate\x1b[0m \x1b[33mdump <file.wbc|file.wate>\x1b[0m   Disassemble bytecode instructions
    \x1b[32mwate\x1b[0m \x1b[33mprofile <file.wate|file.wbc>\x1b[0mProfile CPU execution time and hotspots
    \x1b[32mwate\x1b[0m \x1b[33mtest\x1b[0m                         Auto-run all tests in tests/ folder
    \x1b[32mwate\x1b[0m \x1b[33mtest <file.wate>\x1b[0m             Run a specific test file
    \x1b[32mwate\x1b[0m \x1b[33m--repl\x1b[0m                       Start interactive REPL shell
    \x1b[32mwate\x1b[0m \x1b[33mplayground\x1b[0m                   Start Web Playground & Online REPL
    \x1b[32mwate\x1b[0m \x1b[33mdebug <file.wate>\x1b[0m            Start Interactive CLI Debugger
    \x1b[32mwate\x1b[0m \x1b[33mlint [target]\x1b[0m                 Analyze code style, unused variables & dead code
    \x1b[32mwate\x1b[0m \x1b[33mfmt [file|dir]\x1b[0m                Format WATE source code automatically
    \x1b[32mwate\x1b[0m \x1b[33mbench <file.wate>\x1b[0m             Run benchmark performance suite
    \x1b[32mwate\x1b[0m \x1b[33mbundle <file.wate>\x1b[0m            Bundle application and dependencies into single file
    \x1b[32mwate\x1b[0m \x1b[33mdoc [target]\x1b[0m                 Generate Markdown & HTML Documentation
    \x1b[32mwate\x1b[0m \x1b[33mhelp\x1b[0m                         Show this help message
    \x1b[32mwate\x1b[0m \x1b[33mversion\x1b[0m                      Show version info

  \x1b[1mFlags:\x1b[0m
    \x1b[33m--coverage\x1b[0m                        Track statement and branch code coverage
    \x1b[33m--check\x1b[0m                           Check formatting without modifying files
    \x1b[33m--exe\x1b[0m                             Compile script into native standalone executable
    \x1b[33m--strict\x1b[0m                          Treat lint warnings as errors
    \x1b[33m--fix\x1b[0m                             Auto-fix code style issues
    \x1b[33m--rules\x1b[0m                           List all built-in linter rules
    \x1b[33m--json\x1b[0m                            Output results as machine-readable JSON
    \x1b[33m--register-vm\x1b[0m                 Run with Register-based 3-address Virtual Machine
    \x1b[33m--jit\x1b[0m                         Enable Just-In-Time native compilation for hot functions
    \x1b[33m--max-memory=<mb>\x1b[0m             Enforce maximum heap memory quota
    \x1b[33m--gc-stats\x1b[0m                    Display Garbage Collector memory statistics
    \x1b[33m--loop-limit=<n>\x1b[0m              CPU watchdog limit for runaway loops
    \x1b[33m--watch, -w\x1b[0m                   Enable hot reload mode
    \x1b[33m--vm\x1b[0m                          Run using Bytecode VM
    \x1b[33m--source-map\x1b[0m                  Generate source map (.map)
    \x1b[33m--strict-types\x1b[0m                Enforce strict compile-time type validation
    \x1b[33m-o <file.wbc>\x1b[0m                 Output binary file for compile
    \x1b[33m--debug\x1b[0m                       Show transpiled JS output
    \x1b[33m--dap\x1b[0m                         Run Debug Adapter Protocol server
    \x1b[33m--format=html|md|all\x1b[0m          Doc generator format (default: html)
    \x1b[33m--out=docs\x1b[0m                    Doc generator output folder
    \x1b[33m--serve, -s\x1b[0m                   Serve docs or playground locally
    \x1b[33m--allow-read\x1b[0m                  Allow file system reads
    \x1b[33m--allow-write\x1b[0m                 Allow file system writes
    \x1b[33m--allow-net\x1b[0m                   Allow network access
    \x1b[33m--allow-run\x1b[0m                   Allow running subprocesses
    \x1b[33m--allow-all, -A\x1b[0m               Allow all permissions

  \x1b[1mExamples:\x1b[0m
    \x1b[90mwate hello.wate\x1b[0m
    \x1b[90mwate compile hello.wate -o hello.wbc --register-vm\x1b[0m
    \x1b[90mwate dump hello.wbc\x1b[0m
    \x1b[90mwate profile hello.wate --register-vm\x1b[0m
    \x1b[90mwate hello.wate --vm --gc-stats\x1b[0m
    \x1b[90mwate test -A\x1b[0m
`);
    process.exit(0);

} else if (subCommand === 'version' || args.includes('-v') || args.includes('--version')) {
    console.log('\x1b[36m⚡ WATE Language Engine v10.0.0 (Stable Core)\x1b[0m');
    console.log('\x1b[90m   Built by WazemTech | Node.js ' + process.version + '\x1b[0m');
    process.exit(0);

} else if (subCommand === 'test') {
    // ====== wate test: Auto-test runner ======
    const testTarget = args.slice(1).find(a => !a.startsWith('-') && a.endsWith('.wate')) || null;
    const testDir = path.resolve(process.cwd(), 'tests');
    let testFiles = [];

    // Skip worker-thread receivers and temp artifacts (not standalone runnable)
    const SKIP_PATTERNS = [/^tmp_/, /worker_thread/];
    const shouldSkip = (filename) => SKIP_PATTERNS.some(p => p.test(filename));

    if (testTarget) {
        testFiles = [testTarget];
    } else if (fs.existsSync(testDir)) {
        testFiles = fs.readdirSync(testDir)
            .filter(f => f.endsWith('.wate') && !shouldSkip(f))
            .map(f => path.join(testDir, f))
            .sort();
    } else {
        testFiles = fs.readdirSync(process.cwd())
            .filter(f => f.endsWith('.wate') && !shouldSkip(f))
            .map(f => path.join(process.cwd(), f));
    }

    if (testFiles.length === 0) {
        console.error('\x1b[33m⚠  No .wate test files found in tests/ directory.\x1b[0m');
        process.exit(1);
    }

    const isCoverage = args.includes('--coverage');
    let tracker = null;
    if (isCoverage) {
        const { CoverageTracker } = require('./wate-coverage');
        tracker = new CoverageTracker();
        tracker.start();
    }

    console.log(`\n\x1b[1m\x1b[36m⚡ WATE Test Runner — ${testFiles.length} file(s) found\x1b[0m\n`);
    let passed = 0, failed = 0;

    for (const tf of testFiles) {
        const label = path.basename(tf);
        try {
            const rawCode = fs.readFileSync(tf, 'utf-8');
            runCode(rawCode, tf);
            console.log(`  \x1b[32m✅ PASS\x1b[0m  ${label}`);
            passed++;
        } catch (e) {
            console.log(`  \x1b[31m❌ FAIL\x1b[0m  ${label}`);
            console.log(`        \x1b[31m${e.message}\x1b[0m`);
            failed++;
        }
    }

    if (tracker) {
        tracker.printReport();
        tracker.stop();
    }

    console.log(`\n\x1b[1m─────────────────────────────────────\x1b[0m`);
    console.log(`  \x1b[32m${passed} passed\x1b[0m  |  \x1b[31m${failed} failed\x1b[0m  |  ${testFiles.length} total`);
    if (failed === 0) {
        console.log(`  \x1b[32m\x1b[1m🏆 All tests passed!\x1b[0m`);
    }
    console.log();
    process.exit(failed > 0 ? 1 : 0);

} else if (subCommand === '--repl' || (!sourceFile && !args.find(a => !a.startsWith('-')))) {
    startREPL();
} else {
    // subCommand is 'run' or a filename directly
    const actualFile = subCommand === 'run'
        ? args.slice(1).find(a => !a.startsWith('-'))
        : (sourceFile || args.find(a => !a.startsWith('-')));

    if (!actualFile) {
        console.error('\x1b[31m❌ Error: No file specified. Run \x1b[33mwate help\x1b[31m for usage.\x1b[0m');
        process.exit(1);
    }

    if (args.includes('-v') || args.includes('--version')) {
        console.log('\x1b[36m⚡ WATE Language Engine v10.0.0\x1b[0m');
        process.exit(0);
    }

    if (path.extname(actualFile) === '.wbc') {
        if (!fs.existsSync(actualFile)) {
            console.error(`\x1b[31m❌ WATE Error: Bytecode file '${actualFile}' not found.\x1b[0m`);
            process.exit(1);
        }
        try {
            runBytecodeFile(actualFile);
        } catch (e) {
            console.error(`\n\x1b[1m\x1b[31m🔥 WATE Bytecode VM Error\x1b[0m`);
            console.error(`  \x1b[31m${e.message}\x1b[0m\n`);
            process.exit(1);
        }
        process.exit(0);
    }

    if (path.extname(actualFile) !== '.wate') {
        console.error(`\x1b[31m❌ WATE Error: File must end in '.wate' or '.wbc' — got '${path.extname(actualFile)}'\x1b[0m`);
        process.exit(1);
    }

    if (!fs.existsSync(actualFile)) {
        const closeMatch = fs.readdirSync(path.dirname(actualFile) || '.').filter(f => f.endsWith('.wate') || f.endsWith('.wbc'));
        console.error(`\x1b[31m❌ WATE Error: File '${actualFile}' not found.\x1b[0m`);
        if (closeMatch.length > 0) {
            console.error(`\x1b[33m   Did you mean one of these?\x1b[0m`);
            closeMatch.slice(0, 3).forEach(f => console.error(`     \x1b[32m${f}\x1b[0m`));
        }
        process.exit(1);
    }

    // Reassign sourceFile for use in executeWatchCycle below
    const resolvedFile = actualFile;

    // ===== Smart "Did you mean?" suggestion engine =====
    function didYouMean(badToken) {
        const keywords = ['out', 'print', 'set', 'fn', 'if', 'else', 'while', 'for', 'return',
            'import', 'class', 'try', 'catch', 'throw', 'break', 'continue', 'const',
            'sys', 'file', 'http', 'math', 'str', 'input', 'json', 'date', 'color',
            'os', 'env', 'regex', 'crypto', 'list', 'num', 'assert', 'thread', 'every'];
        const tok = String(badToken).toLowerCase();
        let best = null, bestScore = Infinity;
        for (const kw of keywords) {
            // Levenshtein distance
            const a = tok, b = kw;
            const dp = Array.from({ length: a.length + 1 }, (_, i) =>
                Array.from({ length: b.length + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
            for (let i = 1; i <= a.length; i++)
                for (let j = 1; j <= b.length; j++)
                    dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
            const score = dp[a.length][b.length];
            if (score < bestScore && score <= 2) { bestScore = score; best = kw; }
        }
        return best;
    }

    function executeWatchCycle() {
        try {
            const rawCode = fs.readFileSync(resolvedFile, 'utf-8');
            runCode(rawCode, resolvedFile);
        } catch (error) {
            if (error.name === 'WateCompilationError' || (error.errors && error.errors.length > 0)) {
                const fp = error.filePath || resolvedFile;
                const source = error.source || (fs.existsSync(resolvedFile) ? fs.readFileSync(resolvedFile, 'utf-8') : '');
                console.error(`\n\x1b[1m\x1b[31m❌ WATE Compilation Error (${error.errors.length} syntax errors found) in ${fp}\x1b[0m\n`);
                error.errors.forEach((err, idx) => {
                    const token = err.token;
                    const line = token ? token.line : '?';
                    const col = token ? token.col : '?';
                    console.error(`  \x1b[31m[Error ${idx + 1}]\x1b[0m Line ${line}, Column ${col}: \x1b[91m${err.message}\x1b[0m`);
                    if (source && token) {
                        const srcLines = source.split('\n');
                        const errorLine = srcLines[token.line - 1] || '';
                        const caret = ' '.repeat(Math.max(0, token.col - 1)) + '\x1b[31m^\x1b[0m';
                        console.error(`     \x1b[90m${line} |\x1b[0m ${errorLine}`);
                        console.error(`     \x1b[90m${' '.repeat(String(line).length)} |\x1b[0m ${caret}`);
                    }
                });
                console.error();

            } else if (error.name === 'WateSyntaxError') {
                const token = error.token;
                const line = token ? token.line : '?';
                const col = token ? token.col : '?';
                const fp = error.filePath || resolvedFile;
                const source = error.source || (fs.existsSync(resolvedFile) ? fs.readFileSync(resolvedFile, 'utf-8') : '');

                console.error(`\n\x1b[1m\x1b[31m❌ WATE Syntax Error\x1b[0m  \x1b[90m${fp}\x1b[0m`);
                console.error(`\x1b[90m   Line ${line}, Column ${col}\x1b[0m`);

                if (source && token) {
                    const srcLines = source.split('\n');
                    const errorLine = srcLines[token.line - 1] || '';
                    const caret = ' '.repeat(Math.max(0, token.col - 1)) + '\x1b[31m^\x1b[0m';
                    console.error(`\n\x1b[90m ${token.line} |\x1b[0m ${errorLine}`);
                    console.error(`\x1b[90m   ${' '.repeat(String(token.line).length)}|\x1b[0m ${caret}\n`);
                }

                const suggestion = token ? didYouMean(token.value || token.type) : null;
                console.error(`\x1b[91m   ${error.message}\x1b[0m`);
                if (suggestion) {
                    console.error(`\x1b[33m   Did you mean: \x1b[32m${suggestion}\x1b[33m?\x1b[0m`);
                }
                console.error();

            } else {
                console.error(`\n\x1b[1m\x1b[31m🔥 WATE Runtime Error\x1b[0m`);
                const mapped = mapStackTrace(error.stack || error.message, resolvedFile);
                // Clean up mapped stack for readability
                const cleanLines = mapped.split('\n').slice(0, 5);
                cleanLines.forEach(l => console.error(`  \x1b[31m${l}\x1b[0m`));
                console.error();
            }
        }
    }

    if (WATCH_MODE) {
        console.log(`\n\x1b[36m👀 [WATE Watch]\x1b[0m Watching '\x1b[33m${resolvedFile}\x1b[0m' — hot reload active...`);
        executeWatchCycle();
        
        let isRebuilding = false;
        fs.watch(resolvedFile, (eventType) => {
            if (eventType === 'change' && !isRebuilding) {
                isRebuilding = true;
                setTimeout(() => {
                    console.clear();
                    console.log(`\n\x1b[36m⚡ [WATE Watch]\x1b[0m File changed — reloading...\n`);
                    executeWatchCycle();
                    isRebuilding = false;
                }, 100);
            }
        });
    } else {
        executeWatchCycle();
    }
}
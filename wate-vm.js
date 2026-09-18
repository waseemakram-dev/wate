// ============================================================
// WATE Virtual Machine (VM) & Bytecode Engine
// Phase 2: Register VM, Inline Cache, GC, TCO, JIT, Bitwise,
// Tagged Values, Event Loop, Memory Sandboxing, Loop Guard, Profiler
// ============================================================

const fs = require('fs');
const path = require('path');

// ============================================================
// 1. Smart Float / Int Tagging (TaggedValue)
// ============================================================
class TaggedValue {
  static TAG_SMI = 1;     // Small 32-bit Integer
  static TAG_FLOAT = 2;   // 64-bit Floating Point
  static TAG_OBJECT = 3;  // Heap Reference (Object / Array / String)

  static isSmi(val) {
    return typeof val === 'number' && Number.isInteger(val) && val >= -2147483648 && val <= 2147483647;
  }

  static tag(val) {
    if (this.isSmi(val)) return { tag: this.TAG_SMI, val: val | 0 };
    if (typeof val === 'number') return { tag: this.TAG_FLOAT, val };
    return { tag: this.TAG_OBJECT, val };
  }

  static fastAdd(a, b) {
    if (typeof a === 'number' && typeof b === 'number') {
      const res = a + b;
      if (Number.isInteger(res) && res >= -2147483648 && res <= 2147483647) {
        return res | 0;
      }
      return res;
    }
    return a + b;
  }

  static fastSub(a, b) {
    if (typeof a === 'number' && typeof b === 'number') {
      const res = a - b;
      if (Number.isInteger(res) && res >= -2147483648 && res <= 2147483647) {
        return res | 0;
      }
      return res;
    }
    return a - b;
  }

  static fastMul(a, b) {
    if (typeof a === 'number' && typeof b === 'number') {
      const res = a * b;
      if (Number.isInteger(res) && res >= -2147483648 && res <= 2147483647) {
        return res | 0;
      }
      return res;
    }
    return a * b;
  }

  static fastBitAnd(a, b) { return (a & b) | 0; }
  static fastBitOr(a, b)  { return (a | b) | 0; }
  static fastBitXor(a, b) { return (a ^ b) | 0; }
  static fastBitNot(a)    { return (~a) | 0; }
  static fastBitShl(a, b) { return (a << b) | 0; }
  static fastBitShr(a, b) { return (a >> b) | 0; }
  static fastBitUshr(a, b){ return (a >>> b); }
}

// ============================================================
// 2. Inline Caching for Object Properties (InlineCache)
// Monomorphic / Polymorphic shape-based caching
// ============================================================
class InlineCache {
  constructor() {
    this.slots = new Map(); // siteId -> { type: 'mono'|'poly'|'mega', entries: [...] }
    this.hits = 0;
    this.misses = 0;
    this.shapeCounter = 1;
    this.shapeMap = new WeakMap();
  }

  getShape(obj) {
    if (!obj || (typeof obj !== 'object' && typeof obj !== 'function')) return 0;
    let shape = this.shapeMap.get(obj);
    if (!shape) {
      shape = this.shapeCounter++;
      this.shapeMap.set(obj, shape);
    }
    return shape;
  }

  getProperty(siteId, obj, prop) {
    if (obj === null || obj === undefined) {
      throw new Error(`VM Runtime Error: Cannot read property '${prop}' of ${obj}`);
    }

    const shape = this.getShape(obj);
    let slot = this.slots.get(siteId);

    if (slot) {
      if (slot.type === 'mono') {
        if (slot.shape === shape && slot.prop === prop) {
          this.hits++;
          return obj[prop];
        }
        // Polymorphic transition
        this.misses++;
        slot.type = 'poly';
        slot.entries = [{ shape: slot.shape, prop: slot.prop }, { shape, prop }];
        return obj[prop];
      } else if (slot.type === 'poly') {
        for (let i = 0; i < slot.entries.length; i++) {
          if (slot.entries[i].shape === shape && slot.entries[i].prop === prop) {
            this.hits++;
            return obj[prop];
          }
        }
        this.misses++;
        if (slot.entries.length < 4) {
          slot.entries.push({ shape, prop });
        } else {
          slot.type = 'mega';
        }
        return obj[prop];
      } else {
        // Megamorphic fallback
        this.misses++;
        return obj[prop];
      }
    }

    // Uninitialized -> Monomorphic
    this.slots.set(siteId, {
      type: 'mono',
      shape,
      prop
    });
    this.misses++;
    return obj[prop];
  }

  setProperty(siteId, obj, prop, val) {
    if (obj === null || obj === undefined) {
      throw new Error(`VM Runtime Error: Cannot set property '${prop}' on ${obj}`);
    }

    const shape = this.getShape(obj);
    let slot = this.slots.get(siteId);

    if (slot && slot.shape === shape && slot.prop === prop) {
      this.hits++;
      obj[prop] = val;
      return;
    }

    this.misses++;
    this.slots.set(siteId, { type: 'mono', shape, prop });
    obj[prop] = val;
  }

  getStats() {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? (this.hits / total * 100).toFixed(1) + '%' : '0.0%',
      activeSlots: this.slots.size
    };
  }
}

// ============================================================
// 3. Garbage Collection Tuning & Memory Limiter (GarbageCollector)
// Custom Mark-and-Sweep Heap Management
// ============================================================
class GarbageCollector {
  constructor(vm, options = {}) {
    this.vm = vm;
    this.maxMemoryBytes = options.maxMemoryMB ? options.maxMemoryMB * 1024 * 1024 : 0;
    this.allocatedObjects = new Set();
    this.totalAllocatedCount = 0;
    this.freedObjectsCount = 0;
    this.collectionsCount = 0;
    this.pauseTimeMs = 0;
    this.allocationsSinceLastGC = 0;
    this.gcThreshold = options.gcThreshold || 2000; // Auto GC every 2000 allocations
  }

  track(obj) {
    if (obj && (typeof obj === 'object' || typeof obj === 'function')) {
      this.allocatedObjects.add(obj);
      this.totalAllocatedCount++;
      this.allocationsSinceLastGC++;

      if (this.allocationsSinceLastGC >= this.gcThreshold) {
        this.collect();
      }

      if (this.maxMemoryBytes > 0) {
        this.checkMemoryLimit();
      }
    }
    return obj;
  }

  estimateMemory() {
    // Approximate heap footprint
    let bytes = this.allocatedObjects.size * 64;
    for (const obj of this.allocatedObjects) {
      if (Array.isArray(obj)) {
        bytes += obj.length * 8;
      } else if (typeof obj === 'object') {
        bytes += Object.keys(obj).length * 32;
      }
    }
    return bytes;
  }

  checkMemoryLimit() {
    const currentBytes = this.estimateMemory();
    if (currentBytes > this.maxMemoryBytes) {
      this.collect();
      const afterBytes = this.estimateMemory();
      if (afterBytes > this.maxMemoryBytes) {
        const currentMB = (afterBytes / (1024 * 1024)).toFixed(2);
        const maxMB = (this.maxMemoryBytes / (1024 * 1024)).toFixed(0);
        throw new Error(`WATE OutOfMemoryError: Memory limit sandboxing exceeded (${currentMB} MB used, maximum allowed is ${maxMB} MB).`);
      }
    }
  }

  collect() {
    const startTime = Date.now();
    this.collectionsCount++;
    this.allocationsSinceLastGC = 0;

    // Phase 1: Mark
    const marked = new Set();
    const markQueue = [];

    const mark = (val) => {
      if (!val || (typeof val !== 'object' && typeof val !== 'function')) return;
      if (!marked.has(val)) {
        marked.add(val);
        markQueue.push(val);
      }
    };

    // Roots: VM globals
    if (this.vm.globals) {
      for (const k of Object.keys(this.vm.globals)) {
        mark(this.vm.globals[k]);
      }
    }

    // Roots: VM variables map
    if (this.vm.variables) {
      if (this.vm.variables instanceof Map) {
        for (const v of this.vm.variables.values()) mark(v);
      } else if (typeof this.vm.variables.values === 'function') {
        const res = this.vm.variables.values();
        if (res && typeof res[Symbol.iterator] === 'function') {
          for (const v of res) mark(v);
        }
      } else if (typeof this.vm.variables === 'object') {
        for (const k of Object.keys(this.vm.variables)) mark(this.vm.variables[k]);
      }
    }

    // Roots: VM stack
    if (this.vm.stack) {
      for (const s of this.vm.stack) {
        mark(s);
      }
    }

    // Roots: VM registers
    if (this.vm.registers) {
      for (const r of this.vm.registers) {
        mark(r);
      }
    }

    // Traverse reference graph
    while (markQueue.length > 0) {
      const cur = markQueue.pop();
      if (Array.isArray(cur)) {
        for (const item of cur) mark(item);
      } else if (typeof cur === 'object') {
        for (const k of Object.keys(cur)) {
          mark(cur[k]);
        }
      }
    }

    // Phase 2: Sweep
    let freedInThisCycle = 0;
    for (const obj of this.allocatedObjects) {
      if (!marked.has(obj)) {
        this.allocatedObjects.delete(obj);
        freedInThisCycle++;
      }
    }

    this.freedObjectsCount += freedInThisCycle;
    this.pauseTimeMs += (Date.now() - startTime);
  }

  getStats() {
    return {
      collections: this.collectionsCount,
      liveObjects: this.allocatedObjects.size,
      freedObjects: this.freedObjectsCount,
      totalAllocated: this.totalAllocatedCount,
      pauseTimeMs: this.pauseTimeMs,
      estimatedHeapKB: (this.estimateMemory() / 1024).toFixed(1)
    };
  }
}

// ============================================================
// 4. CPU Throttling & Infinite Loop Guard (LoopGuard)
// ============================================================
class LoopGuard {
  constructor(limit = 10000000) {
    this.limit = limit;
    this.backwardJumps = 0;
    this.totalSteps = 0;
  }

  tick(ip, target) {
    this.totalSteps++;
    if (target !== undefined && target <= ip) {
      this.backwardJumps++;
      if (this.backwardJumps > this.limit) {
        throw new Error(`WATE Infinite Loop Guard: CPU execution threshold exceeded (${this.limit} loop iterations). Runaway infinite loop terminated.`);
      }
    }
  }

  reset() {
    this.backwardJumps = 0;
    this.totalSteps = 0;
  }
}

// ============================================================
// 5. Asynchronous Event Loop Core (WateEventLoop)
// Microtask and Macrotask non-blocking task runner
// ============================================================
class WateEventLoop {
  constructor(vm = null) {
    this.vm = vm || VirtualMachine.currentVM;
    this.microtasks = [];
    this.macrotasks = [];
    this.running = false;
  }

  enqueueMicrotask(fn) {
    this.microtasks.push({ fn, vm: VirtualMachine.currentVM || this.vm });
  }

  enqueueTask(fn, delay = 0) {
    const runAt = Date.now() + delay;
    this.macrotasks.push({ fn, runAt, vm: VirtualMachine.currentVM || this.vm });
  }

  tick() {
    // 1. Drain all microtasks
    while (this.microtasks.length > 0) {
      const item = this.microtasks.shift();
      const fn = item.fn || item;
      const curVm = item.vm || this.vm || VirtualMachine.currentVM;
      try {
        if (typeof fn === 'function') {
          fn();
        } else if (fn && fn.type === 'VM_FUNCTION') {
          const g = curVm ? curVm.globals : {};
          const l = curVm ? curVm.libs : {};
          const subVM = new VirtualMachine(fn.instructions, g, l);
          if (curVm && curVm.variables) {
            for (const [k, v] of curVm.variables.entries()) subVM.variables.set(k, v);
          }
          subVM.run();
          if (curVm && curVm.variables) {
            for (const [k, v] of subVM.variables.entries()) curVm.variables.set(k, v);
          }
        }
      } catch (e) { console.error('Microtask Error:', e); }
    }

    // 2. Process ready macrotasks
    const now = Date.now();
    const remaining = [];
    for (const item of this.macrotasks) {
      if (item.runAt <= now) {
        const fn = item.fn;
        const curVm = item.vm || this.vm || VirtualMachine.currentVM;
        try {
          if (typeof fn === 'function') {
            fn();
          } else if (fn && fn.type === 'VM_FUNCTION') {
            const g = curVm ? curVm.globals : {};
            const l = curVm ? curVm.libs : {};
            const subVM = new VirtualMachine(fn.instructions, g, l);
            if (curVm && curVm.variables) {
              for (const [k, v] of curVm.variables.entries()) subVM.variables.set(k, v);
            }
            subVM.run();
            if (curVm && curVm.variables) {
              for (const [k, v] of subVM.variables.entries()) curVm.variables.set(k, v);
            }
          }
        } catch (e) { console.error('Macrotask Error:', e); }
      } else {
        remaining.push(item);
      }
    }
    this.macrotasks = remaining;
  }

  async runUntilEmpty(maxTimeoutMs = 5000) {
    const start = Date.now();
    while (this.microtasks.length > 0 || this.macrotasks.length > 0) {
      this.tick();
      if (this.macrotasks.length > 0) {
        await new Promise(res => setTimeout(res, 10));
      }
      if (Date.now() - start > maxTimeoutMs) {
        break;
      }
    }
  }
}

// ============================================================
// 6. Just-In-Time (JIT) Compiler Prototype (JITCompiler)
// Compiles hot functions directly into optimized native JS
// ============================================================
class JITCompiler {
  constructor(vm, threshold = 25) {
    this.vm = vm;
    this.threshold = threshold;
    this.compiledCount = 0;
  }

  compile(fnObj) {
    if (!fnObj || !fnObj.instructions || fnObj.jitCompiled) return null;

    try {
      const isReg = fnObj.isRegister;
      const params = fnObj.params || [];
      const instructions = fnObj.instructions;

      let code = '';
      code += 'let registers = new Array(256).fill(null);\n';
      code += 'let stack = [];\n';
      code += 'let localVars = (vars instanceof Map) ? new Map(vars) : new Map(vars && typeof vars === "object" ? Object.entries(vars) : []);\n';

      // Load parameters
      for (let i = 0; i < params.length; i++) {
        const p = params[i];
        code += `localVars.set('${p}', args[${i}]);\n`;
        if (isReg) code += `registers[${i}] = args[${i}];\n`;
      }

      code += 'let ip = 0;\n';
      code += 'while (ip < instructions.length) {\n';
      code += '  const inst = instructions[ip++];\n';
      code += '  switch (inst.op) {\n';

      // Core register opcodes
      code += '    case "LOAD_CONST_R": registers[inst.dst] = inst.value; break;\n';
      code += '    case "LOAD_VAR_R": registers[inst.dst] = localVars.has(inst.name) ? localVars.get(inst.name) : (globals[inst.name] !== undefined ? globals[inst.name] : (libs[inst.name])); break;\n';
      code += '    case "STORE_VAR_R": localVars.set(inst.name, registers[inst.src]); break;\n';
      code += '    case "MOVE_R": registers[inst.dst] = registers[inst.src]; break;\n';
      code += '    case "BINARY_OP_R": {\n';
      code += '      const l = registers[inst.left], r = registers[inst.right];\n';
      code += '      switch (inst.operator) {\n';
      code += '        case "+": registers[inst.dst] = l + r; break;\n';
      code += '        case "-": registers[inst.dst] = l - r; break;\n';
      code += '        case "*": registers[inst.dst] = l * r; break;\n';
      code += '        case "/": registers[inst.dst] = l / r; break;\n';
      code += '        case "==": case "is": registers[inst.dst] = l === r; break;\n';
      code += '        case "!=": case "is not": registers[inst.dst] = l !== r; break;\n';
      code += '        case "<": registers[inst.dst] = l < r; break;\n';
      code += '        case "<=": registers[inst.dst] = l <= r; break;\n';
      code += '        case ">": registers[inst.dst] = l > r; break;\n';
      code += '        case ">=": registers[inst.dst] = l >= r; break;\n';
      code += '        case "??": registers[inst.dst] = (l !== null && l !== undefined) ? l : r; break;\n';
      code += '        default: registers[inst.dst] = l + r; break;\n';
      code += '      }\n';
      code += '      break;\n';
      code += '    }\n';
      code += '    case "BIT_AND_R": registers[inst.dst] = (registers[inst.left] & registers[inst.right]) | 0; break;\n';
      code += '    case "BIT_OR_R": registers[inst.dst] = (registers[inst.left] | registers[inst.right]) | 0; break;\n';
      code += '    case "BIT_XOR_R": registers[inst.dst] = (registers[inst.left] ^ registers[inst.right]) | 0; break;\n';
      code += '    case "BIT_NOT_R": registers[inst.dst] = (~registers[inst.src]) | 0; break;\n';
      code += '    case "BIT_SHL_R": registers[inst.dst] = (registers[inst.left] << registers[inst.right]) | 0; break;\n';
      code += '    case "BIT_SHR_R": registers[inst.dst] = (registers[inst.left] >> registers[inst.right]) | 0; break;\n';
      code += '    case "BIT_USHR_R": registers[inst.dst] = (registers[inst.left] >>> registers[inst.right]); break;\n';
      code += '    case "JUMP_R": ip = inst.offset; break;\n';
      code += '    case "JUMP_IF_FALSE_R": if (!registers[inst.cond]) ip = inst.offset; break;\n';
      code += '    case "RETURN_R": return registers[inst.src];\n';
      code += '    case "RETURN": return stack.pop();\n';
      code += '    default: {\n';
      code += '      // Fallback to VM interpretation for non-hot instructions\n';
      code += '      const subVM = new VirtualMachine([inst], globals, libs);\n';
      code += '      subVM.registers = registers;\n';
      code += '      subVM.variables = localVars;\n';
      code += '      subVM.stack = stack;\n';
      code += '      subVM.run();\n';
      code += '      break;\n';
      code += '    }\n';
      code += '  }\n';
      code += '}\n';
      code += 'return isReg ? registers[0] : (stack.length > 0 ? stack[stack.length - 1] : undefined);\n';

      const compiledFn = new Function('args', 'globals', 'libs', 'vars', 'instructions', 'VirtualMachine', code);
      fnObj.nativeCode = (callArgs, g, l, v) => compiledFn(callArgs, g, l, v, instructions, VirtualMachine);
      fnObj.jitCompiled = true;
      this.compiledCount++;
      return fnObj.nativeCode;
    } catch (err) {
      // Graceful fallback to interpreter
      return null;
    }
  }
}

// ============================================================
// 7. Execution VM Profiler (VMProfiler)
// ============================================================
class VMProfiler {
  constructor() {
    this.opcodeCounts = {};
    this.opcodeTimes = {};
    this.functionStats = new Map(); // name -> { calls, totalTimeMs }
    this.startTime = 0;
    this.endTime = 0;
    this.totalInstructions = 0;
  }

  start() {
    this.startTime = process.hrtime.bigint();
  }

  stop() {
    this.endTime = process.hrtime.bigint();
  }

  recordOpcode(op, elapsedNs) {
    this.totalInstructions++;
    this.opcodeCounts[op] = (this.opcodeCounts[op] || 0) + 1;
    this.opcodeTimes[op] = (this.opcodeTimes[op] || 0n) + BigInt(elapsedNs || 0);
  }

  recordFunctionCall(name, elapsedMs) {
    const stats = this.functionStats.get(name) || { calls: 0, totalTimeMs: 0 };
    stats.calls++;
    stats.totalTimeMs += elapsedMs;
    this.functionStats.set(name, stats);
  }

  formatReport(vm) {
    const totalDurationNs = Number(this.endTime - this.startTime);
    const totalDurationMs = (totalDurationNs / 1e6).toFixed(2);
    const mips = totalDurationNs > 0 ? ((this.totalInstructions / (totalDurationNs / 1e9)) / 1e6).toFixed(2) : '0.00';

    const lines = [];
    lines.push('\x1b[1m\x1b[36m======================================================================\x1b[0m');
    lines.push('\x1b[1m\x1b[32m⚡ WATE VM EXECUTION PROFILER REPORT\x1b[0m');
    lines.push('\x1b[1m\x1b[36m======================================================================\x1b[0m');
    lines.push(`Total Instructions Retired: \x1b[1m${this.totalInstructions.toLocaleString()}\x1b[0m`);
    lines.push(`Execution Time:             \x1b[1m${totalDurationMs} ms\x1b[0m`);
    lines.push(`Throughput:                 \x1b[1m${mips} MIPS\x1b[0m (Million Instructions/Sec)`);

    if (vm && vm.ic) {
      const icStats = vm.ic.getStats();
      lines.push(`Inline Cache Hit Rate:      \x1b[1m\x1b[33m${icStats.hitRate}\x1b[0m (${icStats.hits} hits / ${icStats.misses} misses across ${icStats.activeSlots} slots)`);
    }

    if (vm && vm.gc) {
      const gcStats = vm.gc.getStats();
      lines.push(`Garbage Collector:          \x1b[1m${gcStats.collections} cycles\x1b[0m, ${gcStats.freedObjects} swept, ${gcStats.liveObjects} live (${gcStats.estimatedHeapKB} KB)`);
    }

    if (vm && vm.jit) {
      lines.push(`JIT Native Compilations:    \x1b[1m${vm.jit.compiledCount} hot function(s)\x1b[0m`);
    }

    lines.push('\x1b[1m\x1b[36m----------------------------------------------------------------------\x1b[0m');
    lines.push('\x1b[1mTOP OPCODES EXECUTED:\x1b[0m');
    lines.push('  OPCODE                   COUNT          % TOTAL');
    lines.push('  --------------------------------------------------');

    const sortedOpcodes = Object.entries(this.opcodeCounts).sort((a, b) => b[1] - a[1]);
    for (const [op, count] of sortedOpcodes.slice(0, 10)) {
      const pct = ((count / (this.totalInstructions || 1)) * 100).toFixed(1);
      lines.push(`  ${op.padEnd(24)} ${String(count).padStart(10)}     ${pct.padStart(5)}%`);
    }

    if (this.functionStats.size > 0) {
      lines.push('\x1b[1m\x1b[36m----------------------------------------------------------------------\x1b[0m');
      lines.push('\x1b[1mFUNCTION HOTSPOTS:\x1b[0m');
      lines.push('  FUNCTION NAME            CALLS      TOTAL TIME (ms)');
      lines.push('  --------------------------------------------------');
      const sortedFns = Array.from(this.functionStats.entries()).sort((a, b) => b[1].totalTimeMs - a[1].totalTimeMs);
      for (const [name, data] of sortedFns) {
        lines.push(`  ${name.padEnd(24)} ${String(data.calls).padStart(6)}     ${data.totalTimeMs.toFixed(3).padStart(12)}`);
      }
    }

    lines.push('\x1b[1m\x1b[36m======================================================================\x1b[0m');
    return lines.join('\n');
  }
}

// ============================================================
// 8. Stack-Based Bytecode Compiler (Backward Compatibility)
// ============================================================
class BytecodeCompiler {
  constructor() {
    this.instructions = [];
    this.nextSiteId = 1;
  }

  compile(node) {
    if (!node) return;
    const type = node.type;

    switch (type) {
      case 'Program':
      case 'BlockStatement':
      case 'Block':
        for (const stmt of node.body) {
          this.compile(stmt);
        }
        break;

      case 'ImportBlock': {
        for (const stmt of node.body) {
          this.compile(stmt);
        }
        if (node.alias) {
          const exportNames = [];
          for (const s of node.body) {
            const decl = s.type === 'ExportNamedDeclaration' ? s.declaration : s;
            if (!decl) continue;
            if (decl.type === 'FunctionDeclaration') exportNames.push(decl.name);
            else if (decl.type === 'VariableDeclaration') {
              for (const d of decl.declarations) if (d.id && d.id.type === 'Identifier') exportNames.push(d.id.name);
            }
          }
          this.instructions.push({ op: 'BUILD_NAMESPACE', alias: node.alias, keys: exportNames });
        }
        if (node.specifiers && node.specifiers.length > 0) {
          for (const s of node.specifiers) {
            if (s.imported !== s.local) {
              this.instructions.push({ op: 'LOAD_VAR', name: s.imported });
              this.instructions.push({ op: 'STORE_VAR', name: s.local });
              this.instructions.push({ op: 'POP' });
            }
          }
        }
        break;
      }

      case 'ImportStatement': {
        if (node.alias) {
          this.instructions.push({ op: 'IMPORT_MODULE', source: node.source, alias: node.alias });
        }
        if (node.specifiers && node.specifiers.length > 0) {
          for (const s of node.specifiers) {
            this.instructions.push({ op: 'IMPORT_SPECIFIER', source: node.source, imported: s.imported, local: s.local });
          }
        }
        if (!node.alias && (!node.specifiers || node.specifiers.length === 0)) {
          const identifier = node.source.replace(/[^a-zA-Z0-9_$]/g, '_');
          this.instructions.push({ op: 'IMPORT_MODULE', source: node.source, alias: identifier });
        }
        break;
      }

      case 'VariableDeclaration':
        for (const decl of node.declarations) {
          if (decl.init) {
            this.compile(decl.init);
          } else {
            this.instructions.push({ op: 'PUSH_CONST', value: null });
          }
          this.instructions.push({ op: 'STORE_VAR', name: decl.id.name });
          this.instructions.push({ op: 'POP' });
        }
        break;

      case 'Identifier':
        this.instructions.push({ op: 'LOAD_VAR', name: node.name });
        break;

      case 'Literal':
        this.instructions.push({ op: 'PUSH_CONST', value: node.value });
        break;

      case 'RawLiteral':
        if (node.raw === 'true') this.instructions.push({ op: 'PUSH_CONST', value: true });
        else if (node.raw === 'false') this.instructions.push({ op: 'PUSH_CONST', value: false });
        else if (node.raw === 'null') this.instructions.push({ op: 'PUSH_CONST', value: null });
        break;

      case 'BinaryExpression': {
        const op = node.operator;
        if (op === '=' || op === ':=') {
          this.compile(node.right);
          if (node.left.type === 'Identifier') {
            this.instructions.push({ op: 'STORE_VAR', name: node.left.name });
          } else if (node.left.type === 'MemberExpression') {
            this.compile(node.left.object);
            if (node.left.property.type === 'Identifier') {
              this.instructions.push({ op: 'PUSH_CONST', value: node.left.property.name });
            } else {
              this.compile(node.left.property);
            }
            this.instructions.push({ op: 'SET_ITEM', siteId: this.nextSiteId++ });
          }
        } else {
          this.compile(node.left);
          this.compile(node.right);
          this.instructions.push({ op: 'BINARY_OP', operator: op });
        }
        break;
      }

      case 'PrefixExpression':
      case 'UnaryExpression':
        this.compile(node.argument || node.right);
        this.instructions.push({ op: 'UNARY_OP', operator: node.operator });
        break;

      case 'IfStatement': {
        this.compile(node.test);
        const jumpIfFalseInst = { op: 'JUMP_IF_FALSE', offset: 0 };
        this.instructions.push(jumpIfFalseInst);

        this.compile(node.consequent);

        if (node.alternate) {
          const jumpInst = { op: 'JUMP', offset: 0 };
          this.instructions.push(jumpInst);
          jumpIfFalseInst.offset = this.instructions.length;

          this.compile(node.alternate);
          jumpInst.offset = this.instructions.length;
        } else {
          jumpIfFalseInst.offset = this.instructions.length;
        }
        break;
      }

      case 'WhileStatement': {
        const loopStart = this.instructions.length;
        this.compile(node.test);
        const jumpIfFalseInst = { op: 'JUMP_IF_FALSE', offset: 0 };
        this.instructions.push(jumpIfFalseInst);

        this.compile(node.body);
        this.instructions.push({ op: 'JUMP', offset: loopStart });
        jumpIfFalseInst.offset = this.instructions.length;
        break;
      }

      case 'RepeatStatement': {
        this.compile(node.count);
        const loopIndexName = `_repeat_idx_${this.instructions.length}`;
        this.instructions.push({ op: 'STORE_VAR', name: loopIndexName });
        this.instructions.push({ op: 'POP' });

        const loopStart = this.instructions.length;
        this.instructions.push({ op: 'LOAD_VAR', name: loopIndexName });
        this.instructions.push({ op: 'PUSH_CONST', value: 0 });
        this.instructions.push({ op: 'BINARY_OP', operator: '>' });

        const jumpIfFalseInst = { op: 'JUMP_IF_FALSE', offset: 0 };
        this.instructions.push(jumpIfFalseInst);

        this.compile(node.body);

        this.instructions.push({ op: 'LOAD_VAR', name: loopIndexName });
        this.instructions.push({ op: 'PUSH_CONST', value: 1 });
        this.instructions.push({ op: 'BINARY_OP', operator: '-' });
        this.instructions.push({ op: 'STORE_VAR', name: loopIndexName });
        this.instructions.push({ op: 'POP' });

        this.instructions.push({ op: 'JUMP', offset: loopStart });
        jumpIfFalseInst.offset = this.instructions.length;
        break;
      }

      case 'ForeachStatement': {
        this.compile(node.iterable);
        const iterName = `_foreach_iter_${this.instructions.length}`;
        const idxName = `_foreach_idx_${this.instructions.length}`;

        this.instructions.push({ op: 'STORE_VAR', name: iterName });
        this.instructions.push({ op: 'POP' });
        this.instructions.push({ op: 'PUSH_CONST', value: 0 });
        this.instructions.push({ op: 'STORE_VAR', name: idxName });
        this.instructions.push({ op: 'POP' });

        const loopStart = this.instructions.length;

        this.instructions.push({ op: 'LOAD_VAR', name: idxName });
        this.instructions.push({ op: 'LOAD_VAR', name: iterName });
        this.instructions.push({ op: 'MEMBER_ACCESS', property: 'length', siteId: this.nextSiteId++ });

        this.instructions.push({ op: 'BINARY_OP', operator: '<' });
        const jumpIfFalseInst = { op: 'JUMP_IF_FALSE', offset: 0 };
        this.instructions.push(jumpIfFalseInst);

        this.instructions.push({ op: 'LOAD_VAR', name: iterName });
        this.instructions.push({ op: 'LOAD_VAR', name: idxName });
        this.instructions.push({ op: 'GET_ITEM' });
        this.instructions.push({ op: 'STORE_VAR', name: node.item });
        this.instructions.push({ op: 'POP' });

        this.compile(node.body);

        this.instructions.push({ op: 'LOAD_VAR', name: idxName });
        this.instructions.push({ op: 'PUSH_CONST', value: 1 });
        this.instructions.push({ op: 'BINARY_OP', operator: '+' });
        this.instructions.push({ op: 'STORE_VAR', name: idxName });
        this.instructions.push({ op: 'POP' });

        this.instructions.push({ op: 'JUMP', offset: loopStart });
        jumpIfFalseInst.offset = this.instructions.length;
        break;
      }

      case 'CallExpression': {
        for (const arg of node.arguments) {
          this.compile(arg);
        }
        this.compile(node.callee);
        this.instructions.push({ op: 'CALL', argCount: node.arguments.length });
        break;
      }

      case 'FunctionDeclaration': {
        const fnCompiler = new BytecodeCompiler();
        fnCompiler.compile(node.body);
        fnCompiler.instructions.push({ op: 'PUSH_CONST', value: null });
        fnCompiler.instructions.push({ op: 'RETURN' });
        const fnObj = {
          type: 'VM_FUNCTION',
          name: node.name || '<anonymous>',
          params: node.params || [],
          isRegister: false,
          instructions: fnCompiler.instructions
        };
        this.instructions.push({ op: 'PUSH_CONST', value: fnObj });
        if (node.name) {
          this.instructions.push({ op: 'STORE_VAR', name: node.name });
          this.instructions.push({ op: 'POP' });
        }
        break;
      }

      case 'ReturnStatement': {
        if (node.argument) {
          this.compile(node.argument);
        } else {
          this.instructions.push({ op: 'PUSH_CONST', value: null });
        }
        this.instructions.push({ op: 'RETURN' });
        break;
      }

      case 'TemplateLiteral': {
        if (!node.parts || node.parts.length === 0) {
          this.instructions.push({ op: 'PUSH_CONST', value: '' });
          break;
        }
        for (let i = 0; i < node.parts.length; i++) {
          const part = node.parts[i];
          if (part.type === 'Literal') {
            this.instructions.push({ op: 'PUSH_CONST', value: part.value });
          } else {
            this.compile(part.expression);
          }
          if (i > 0) {
            this.instructions.push({ op: 'BINARY_OP', operator: '+' });
          }
        }
        break;
      }

      case 'MemberExpression':
        this.compile(node.object);
        if (node.property.type === 'Identifier') {
          this.instructions.push({ op: 'MEMBER_ACCESS', property: node.property.name, optional: !!node.optional, siteId: this.nextSiteId++ });
        } else {
          this.compile(node.property);
          this.instructions.push({ op: 'GET_ITEM', optional: !!node.optional });
        }
        break;

      case 'ArrayExpression': {
        for (const el of node.elements) {
          this.compile(el);
        }
        this.instructions.push({ op: 'ARRAY_LIT', count: node.elements.length });
        break;
      }

      case 'ObjectExpression': {
        const keys = [];
        for (const prop of (node.properties || [])) {
          this.compile(prop.value);
          keys.push(prop.key);
        }
        this.instructions.push({ op: 'OBJECT_LIT', keys });
        break;
      }

      case 'TryCatchStatement': {
        const catchSetup = { op: 'SETUP_CATCH', offset: 0, param: node.param };
        this.instructions.push(catchSetup);
        this.compile(node.block);
        this.instructions.push({ op: 'POP_CATCH' });
        const jumpEnd = { op: 'JUMP', offset: 0 };
        this.instructions.push(jumpEnd);

        catchSetup.offset = this.instructions.length;
        if (node.handler) {
          this.compile(node.handler);
        }
        if (node.finalizer) {
          this.compile(node.finalizer);
        }
        jumpEnd.offset = this.instructions.length;
        break;
      }

      case 'ExpressionStatement':
        this.compile(node.expression);
        this.instructions.push({ op: 'POP' });
        break;
    }
  }
}

// ============================================================
// 9. Register-Based Bytecode Compiler (RegisterBytecodeCompiler)
// Translates AST into fast 3-address register opcodes
// ============================================================
class RegisterBytecodeCompiler {
  constructor(enclosingFnName = null) {
    this.instructions = [];
    this.nextReg = 0;
    this.nextSiteId = 1;
    this.enclosingFnName = enclosingFnName;
  }

  allocReg() {
    return this.nextReg++;
  }

  emit(inst) {
    this.instructions.push(inst);
    return inst;
  }

  compile(node) {
    if (!node) return;
    const type = node.type;

    switch (type) {
      case 'Program':
      case 'BlockStatement':
      case 'Block':
        for (const stmt of node.body) {
          this.compile(stmt);
        }
        break;

      case 'ImportBlock': {
        for (const stmt of node.body) {
          this.compile(stmt);
        }
        if (node.alias) {
          const exportNames = [];
          for (const s of node.body) {
            const decl = s.type === 'ExportNamedDeclaration' ? s.declaration : s;
            if (!decl) continue;
            if (decl.type === 'FunctionDeclaration') exportNames.push(decl.name);
            else if (decl.type === 'VariableDeclaration') {
              for (const d of decl.declarations) if (d.id && d.id.type === 'Identifier') exportNames.push(d.id.name);
            }
          }
          this.emit({ op: 'BUILD_NAMESPACE', alias: node.alias, keys: exportNames });
        }
        if (node.specifiers && node.specifiers.length > 0) {
          for (const s of node.specifiers) {
            if (s.imported !== s.local) {
              const r = this.allocReg();
              this.emit({ op: 'LOAD_VAR_R', dst: r, name: s.imported });
              this.emit({ op: 'STORE_VAR_R', name: s.local, src: r });
            }
          }
        }
        break;
      }

      case 'ImportStatement': {
        if (node.alias) {
          this.emit({ op: 'IMPORT_MODULE', source: node.source, alias: node.alias });
        }
        if (node.specifiers && node.specifiers.length > 0) {
          for (const s of node.specifiers) {
            this.emit({ op: 'IMPORT_SPECIFIER', source: node.source, imported: s.imported, local: s.local });
          }
        }
        if (!node.alias && (!node.specifiers || node.specifiers.length === 0)) {
          const identifier = node.source.replace(/[^a-zA-Z0-9_$]/g, '_');
          this.emit({ op: 'IMPORT_MODULE', source: node.source, alias: identifier });
        }
        break;
      }

      case 'VariableDeclaration':
        for (const decl of node.declarations) {
          let srcReg;
          if (decl.init) {
            srcReg = this.compileExpr(decl.init);
          } else {
            srcReg = this.allocReg();
            this.emit({ op: 'LOAD_CONST_R', dst: srcReg, value: null });
          }
          this.emit({ op: 'STORE_VAR_R', name: decl.id.name, src: srcReg });
        }
        break;

      case 'ExpressionStatement':
        this.compileExpr(node.expression);
        break;

      case 'IfStatement': {
        const condReg = this.compileExpr(node.test);
        const jumpIfFalse = { op: 'JUMP_IF_FALSE_R', cond: condReg, offset: 0 };
        this.emit(jumpIfFalse);

        this.compile(node.consequent);

        if (node.alternate) {
          const jump = { op: 'JUMP_R', offset: 0 };
          this.emit(jump);
          jumpIfFalse.offset = this.instructions.length;

          this.compile(node.alternate);
          jump.offset = this.instructions.length;
        } else {
          jumpIfFalse.offset = this.instructions.length;
        }
        break;
      }

      case 'WhileStatement': {
        const loopStart = this.instructions.length;
        const condReg = this.compileExpr(node.test);
        const jumpIfFalse = { op: 'JUMP_IF_FALSE_R', cond: condReg, offset: 0 };
        this.emit(jumpIfFalse);

        this.compile(node.body);
        this.emit({ op: 'JUMP_R', offset: loopStart });
        jumpIfFalse.offset = this.instructions.length;
        break;
      }

      case 'RepeatStatement': {
        const countReg = this.compileExpr(node.count);
        const loopVar = `_repeat_idx_${this.instructions.length}`;
        this.emit({ op: 'STORE_VAR_R', name: loopVar, src: countReg });

        const loopStart = this.instructions.length;
        const curReg = this.allocReg();
        this.emit({ op: 'LOAD_VAR_R', dst: curReg, name: loopVar });
        const zeroReg = this.allocReg();
        this.emit({ op: 'LOAD_CONST_R', dst: zeroReg, value: 0 });
        const cmpReg = this.allocReg();
        this.emit({ op: 'BINARY_OP_R', dst: cmpReg, left: curReg, right: zeroReg, operator: '>' });

        const jumpIfFalse = { op: 'JUMP_IF_FALSE_R', cond: cmpReg, offset: 0 };
        this.emit(jumpIfFalse);

        this.compile(node.body);

        const reloadReg = this.allocReg();
        this.emit({ op: 'LOAD_VAR_R', dst: reloadReg, name: loopVar });
        const oneReg = this.allocReg();
        this.emit({ op: 'LOAD_CONST_R', dst: oneReg, value: 1 });
        const decReg = this.allocReg();
        this.emit({ op: 'BINARY_OP_R', dst: decReg, left: reloadReg, right: oneReg, operator: '-' });
        this.emit({ op: 'STORE_VAR_R', name: loopVar, src: decReg });

        this.emit({ op: 'JUMP_R', offset: loopStart });
        jumpIfFalse.offset = this.instructions.length;
        break;
      }

      case 'ForeachStatement': {
        const iterReg = this.compileExpr(node.iterable);
        const iterVar = `_foreach_iter_${this.instructions.length}`;
        const idxVar = `_foreach_idx_${this.instructions.length}`;

        this.emit({ op: 'STORE_VAR_R', name: iterVar, src: iterReg });
        const zeroReg = this.allocReg();
        this.emit({ op: 'LOAD_CONST_R', dst: zeroReg, value: 0 });
        this.emit({ op: 'STORE_VAR_R', name: idxVar, src: zeroReg });

        const loopStart = this.instructions.length;
        const curIdxReg = this.allocReg();
        this.emit({ op: 'LOAD_VAR_R', dst: curIdxReg, name: idxVar });
        const curIterReg = this.allocReg();
        this.emit({ op: 'LOAD_VAR_R', dst: curIterReg, name: iterVar });
        const lenReg = this.allocReg();
        this.emit({ op: 'GET_PROP_R', dst: lenReg, obj: curIterReg, prop: 'length', siteId: this.nextSiteId++ });
        const cmpReg = this.allocReg();
        this.emit({ op: 'BINARY_OP_R', dst: cmpReg, left: curIdxReg, right: lenReg, operator: '<' });

        const jumpIfFalse = { op: 'JUMP_IF_FALSE_R', cond: cmpReg, offset: 0 };
        this.emit(jumpIfFalse);

        const elemIterReg = this.allocReg();
        this.emit({ op: 'LOAD_VAR_R', dst: elemIterReg, name: iterVar });
        const elemIdxReg = this.allocReg();
        this.emit({ op: 'LOAD_VAR_R', dst: elemIdxReg, name: idxVar });
        const elemReg = this.allocReg();
        this.emit({ op: 'GET_ELEM_R', dst: elemReg, obj: elemIterReg, index: elemIdxReg });
        this.emit({ op: 'STORE_VAR_R', name: node.item, src: elemReg });

        this.compile(node.body);

        const incIdxReg = this.allocReg();
        this.emit({ op: 'LOAD_VAR_R', dst: incIdxReg, name: idxVar });
        const oneReg = this.allocReg();
        this.emit({ op: 'LOAD_CONST_R', dst: oneReg, value: 1 });
        const nextIdxReg = this.allocReg();
        this.emit({ op: 'BINARY_OP_R', dst: nextIdxReg, left: incIdxReg, right: oneReg, operator: '+' });
        this.emit({ op: 'STORE_VAR_R', name: idxVar, src: nextIdxReg });

        this.emit({ op: 'JUMP_R', offset: loopStart });
        jumpIfFalse.offset = this.instructions.length;
        break;
      }

      case 'FunctionDeclaration': {
        const fnCompiler = new RegisterBytecodeCompiler(node.name);
        fnCompiler.compile(node.body);
        const nullReg = fnCompiler.allocReg();
        fnCompiler.emit({ op: 'LOAD_CONST_R', dst: nullReg, value: null });
        fnCompiler.emit({ op: 'RETURN_R', src: nullReg });

        const fnObj = {
          type: 'VM_FUNCTION',
          name: node.name,
          params: node.params || [],
          isRegister: true,
          instructions: fnCompiler.instructions
        };

        const r = this.allocReg();
        this.emit({ op: 'LOAD_CONST_R', dst: r, value: fnObj });
        this.emit({ op: 'STORE_VAR_R', name: node.name, src: r });
        break;
      }

      case 'ReturnStatement': {
        // Tail Call Optimization (TCO) Detection
        if (node.argument && node.argument.type === 'CallExpression' && this.enclosingFnName) {
          const calleeNode = node.argument.callee;
          if (calleeNode.type === 'Identifier' && calleeNode.name === this.enclosingFnName) {
            // Emitting TAIL_CALL_R directly!
            const calleeReg = this.compileExpr(calleeNode);
            const argRegs = (node.argument.arguments || []).map(a => this.compileExpr(a));
            this.emit({ op: 'TAIL_CALL_R', callee: calleeReg, args: argRegs, fnName: this.enclosingFnName });
            break;
          }
        }

        if (node.argument) {
          const srcReg = this.compileExpr(node.argument);
          this.emit({ op: 'RETURN_R', src: srcReg });
        } else {
          const r = this.allocReg();
          this.emit({ op: 'LOAD_CONST_R', dst: r, value: null });
          this.emit({ op: 'RETURN_R', src: r });
        }
        break;
      }

      case 'TryCatchStatement': {
        const catchSetup = { op: 'SETUP_CATCH_R', offset: 0, param: node.param };
        this.emit(catchSetup);
        this.compile(node.block);
        this.emit({ op: 'POP_CATCH_R' });
        const jumpEnd = { op: 'JUMP_R', offset: 0 };
        this.emit(jumpEnd);

        catchSetup.offset = this.instructions.length;
        if (node.handler) {
          this.compile(node.handler);
        }
        if (node.finalizer) {
          this.compile(node.finalizer);
        }
        jumpEnd.offset = this.instructions.length;
        break;
      }
    }
  }

  compileExpr(node) {
    if (!node) {
      const r = this.allocReg();
      this.emit({ op: 'LOAD_CONST_R', dst: r, value: null });
      return r;
    }

    switch (node.type) {
      case 'Literal': {
        const r = this.allocReg();
        this.emit({ op: 'LOAD_CONST_R', dst: r, value: node.value });
        return r;
      }

      case 'RawLiteral': {
        const r = this.allocReg();
        let val = null;
        if (node.raw === 'true') val = true;
        else if (node.raw === 'false') val = false;
        this.emit({ op: 'LOAD_CONST_R', dst: r, value: val });
        return r;
      }

      case 'Identifier': {
        const r = this.allocReg();
        this.emit({ op: 'LOAD_VAR_R', dst: r, name: node.name });
        return r;
      }

      case 'BinaryExpression': {
        const op = node.operator;
        if (op === '=' || op === ':=') {
          const valReg = this.compileExpr(node.right);
          if (node.left.type === 'Identifier') {
            this.emit({ op: 'STORE_VAR_R', name: node.left.name, src: valReg });
            return valReg;
          } else if (node.left.type === 'MemberExpression') {
            const objReg = this.compileExpr(node.left.object);
            if (node.left.property.type === 'Identifier') {
              this.emit({ op: 'SET_PROP_R', obj: objReg, prop: node.left.property.name, val: valReg, siteId: this.nextSiteId++ });
            } else {
              const idxReg = this.compileExpr(node.left.property);
              this.emit({ op: 'SET_ELEM_R', obj: objReg, index: idxReg, val: valReg });
            }
            return valReg;
          }
        }

        const leftReg = this.compileExpr(node.left);
        const rightReg = this.compileExpr(node.right);
        const dstReg = this.allocReg();

        // Direct bitwise opcodes
        if (op === '&') this.emit({ op: 'BIT_AND_R', dst: dstReg, left: leftReg, right: rightReg });
        else if (op === '|') this.emit({ op: 'BIT_OR_R', dst: dstReg, left: leftReg, right: rightReg });
        else if (op === '^') this.emit({ op: 'BIT_XOR_R', dst: dstReg, left: leftReg, right: rightReg });
        else if (op === '<<') this.emit({ op: 'BIT_SHL_R', dst: dstReg, left: leftReg, right: rightReg });
        else if (op === '>>') this.emit({ op: 'BIT_SHR_R', dst: dstReg, left: leftReg, right: rightReg });
        else if (op === '>>>') this.emit({ op: 'BIT_USHR_R', dst: dstReg, left: leftReg, right: rightReg });
        else this.emit({ op: 'BINARY_OP_R', dst: dstReg, left: leftReg, right: rightReg, operator: op });

        return dstReg;
      }

      case 'PrefixExpression':
      case 'UnaryExpression': {
        const srcReg = this.compileExpr(node.argument || node.right);
        const dstReg = this.allocReg();
        const op = node.operator;

        if (op === '~') this.emit({ op: 'BIT_NOT_R', dst: dstReg, src: srcReg });
        else this.emit({ op: 'UNARY_OP_R', dst: dstReg, src: srcReg, operator: op });

        return dstReg;
      }

      case 'CallExpression': {
        const calleeReg = this.compileExpr(node.callee);
        const argRegs = (node.arguments || []).map(arg => this.compileExpr(arg));
        const dstReg = this.allocReg();
        this.emit({ op: 'CALL_R', dst: dstReg, callee: calleeReg, args: argRegs });
        return dstReg;
      }

      case 'MemberExpression': {
        const objReg = this.compileExpr(node.object);
        const dstReg = this.allocReg();
        if (node.property.type === 'Identifier') {
          this.emit({ op: 'GET_PROP_R', dst: dstReg, obj: objReg, prop: node.property.name, optional: !!node.optional, siteId: this.nextSiteId++ });
        } else {
          const idxReg = this.compileExpr(node.property);
          this.emit({ op: 'GET_ELEM_R', dst: dstReg, obj: objReg, index: idxReg, optional: !!node.optional });
        }
        return dstReg;
      }

      case 'ArrayExpression': {
        const elemRegs = (node.elements || []).map(el => this.compileExpr(el));
        const dstReg = this.allocReg();
        this.emit({ op: 'ARRAY_LIT_R', dst: dstReg, elements: elemRegs });
        return dstReg;
      }

      case 'ObjectExpression': {
        const propRegs = [];
        for (const prop of (node.properties || [])) {
          const valReg = this.compileExpr(prop.value);
          propRegs.push({ key: prop.key, reg: valReg });
        }
        const dstReg = this.allocReg();
        this.emit({ op: 'OBJECT_LIT_R', dst: dstReg, properties: propRegs });
        return dstReg;
      }

      case 'TemplateLiteral': {
        const dstReg = this.allocReg();
        if (!node.parts || node.parts.length === 0) {
          this.emit({ op: 'LOAD_CONST_R', dst: dstReg, value: '' });
          return dstReg;
        }

        let accReg = null;
        for (let i = 0; i < node.parts.length; i++) {
          const part = node.parts[i];
          let partReg;
          if (part.type === 'Literal') {
            partReg = this.allocReg();
            this.emit({ op: 'LOAD_CONST_R', dst: partReg, value: part.value });
          } else {
            partReg = this.compileExpr(part.expression);
          }

          if (i === 0) {
            accReg = partReg;
          } else {
            const nextAcc = this.allocReg();
            this.emit({ op: 'BINARY_OP_R', dst: nextAcc, left: accReg, right: partReg, operator: '+' });
            accReg = nextAcc;
          }
        }
        return accReg;
      }

      case 'FunctionDeclaration': {
        const fnCompiler = new RegisterBytecodeCompiler(node.name);
        fnCompiler.compile(node.body);
        const nullReg = fnCompiler.allocReg();
        fnCompiler.emit({ op: 'LOAD_CONST_R', dst: nullReg, value: null });
        fnCompiler.emit({ op: 'RETURN_R', src: nullReg });

        const fnObj = {
          type: 'VM_FUNCTION',
          name: node.name || '<anonymous>',
          params: node.params || [],
          isRegister: true,
          instructions: fnCompiler.instructions
        };

        const r = this.allocReg();
        this.emit({ op: 'LOAD_CONST_R', dst: r, value: fnObj });
        if (node.name) {
          this.emit({ op: 'STORE_VAR_R', name: node.name, src: r });
        }
        return r;
      }

      default: {
        const r = this.allocReg();
        this.emit({ op: 'LOAD_CONST_R', dst: r, value: null });
        return r;
      }
    }
  }
}

// ============================================================
// 10. Unified High-Performance Virtual Machine (VirtualMachine)
// Seamlessly executes both Register Bytecode and Legacy Stack Bytecode
// ============================================================
class VirtualMachine {
  constructor(instructions, globals = {}, libs = {}, options = {}) {
    this.instructions = instructions || [];
    this.globals = globals || {};
    this.libs = libs || {};
    this.options = options;

    // Registers frame: 256 flat registers for high-speed indexing
    this.registers = new Array(256).fill(undefined);
    this.stack = [];
    this.variables = new Map();
    this.ip = 0;
    this.currentFnName = options.currentFnName || null;

    // Phase 2 Subsystems
    this.ic = options.ic || new InlineCache();
    this.gc = options.gc || new GarbageCollector(this, options);
    this.loopGuard = options.loopGuard || new LoopGuard(options.loopLimit || 5000000);
    this.jit = options.jitCompiler || new JITCompiler(this);
    this.profiler = options.profiler || null;
    this.eventLoop = options.eventLoop || new WateEventLoop(this);
    this.enableJit = options.jit === true;
    this.catchHandlers = [];
  }

  run() {
    const prevVM = VirtualMachine.currentVM;
    VirtualMachine.currentVM = this;
    if (this.profiler) this.profiler.start();

    try {
      while (this.ip < this.instructions.length) {
      const inst = this.instructions[this.ip];
      const curIp = this.ip;
      this.ip++;

      let opStartNs = 0n;
      if (this.profiler) opStartNs = process.hrtime.bigint();

      try {
      // ==========================================
      // A. REGISTER-BASED OPCODES
      // ==========================================
      switch (inst.op) {
        case 'LOAD_CONST_R':
          this.registers[inst.dst] = inst.value;
          break;

        case 'LOAD_VAR_R':
          if (this.variables.has(inst.name)) {
            this.registers[inst.dst] = this.variables.get(inst.name);
          } else if (inst.name in this.globals) {
            this.registers[inst.dst] = this.globals[inst.name];
          } else if (inst.name in this.libs) {
            this.registers[inst.dst] = this.libs[inst.name];
          } else {
            throw new Error(`VM Runtime Error: Variable '${inst.name}' is not defined.`);
          }
          break;

        case 'STORE_VAR_R':
          this.variables.set(inst.name, this.registers[inst.src]);
          break;

        case 'MOVE_R':
          this.registers[inst.dst] = this.registers[inst.src];
          break;

        case 'BINARY_OP_R': {
          const left = this.registers[inst.left];
          const right = this.registers[inst.right];
          const op = inst.operator;

          if (op === '+') this.registers[inst.dst] = TaggedValue.fastAdd(left, right);
          else if (op === '-') this.registers[inst.dst] = TaggedValue.fastSub(left, right);
          else if (op === '*') this.registers[inst.dst] = TaggedValue.fastMul(left, right);
          else if (op === '/') this.registers[inst.dst] = left / right;
          else if (op === 'is' || op === '==') this.registers[inst.dst] = left === right;
          else if (op === 'is not' || op === '!=') this.registers[inst.dst] = left !== right;
          else if (op === '<') this.registers[inst.dst] = left < right;
          else if (op === '<=') this.registers[inst.dst] = left <= right;
          else if (op === '>') this.registers[inst.dst] = left > right;
          else if (op === '>=') this.registers[inst.dst] = left >= right;
          else if (op === '&') this.registers[inst.dst] = TaggedValue.fastBitAnd(left, right);
          else if (op === '|') this.registers[inst.dst] = TaggedValue.fastBitOr(left, right);
          else if (op === '^') this.registers[inst.dst] = TaggedValue.fastBitXor(left, right);
          else if (op === '<<') this.registers[inst.dst] = TaggedValue.fastBitShl(left, right);
          else if (op === '>>') this.registers[inst.dst] = TaggedValue.fastBitShr(left, right);
          else if (op === '>>>') this.registers[inst.dst] = TaggedValue.fastBitUshr(left, right);
          else if (op === '??') this.registers[inst.dst] = (left !== null && left !== undefined) ? left : right;
          else throw new Error(`VM Runtime Error: Unsupported binary operator '${op}'`);
          break;
        }

        // Direct Bitwise Register Instructions
        case 'BIT_AND_R':
          this.registers[inst.dst] = TaggedValue.fastBitAnd(this.registers[inst.left], this.registers[inst.right]);
          break;
        case 'BIT_OR_R':
          this.registers[inst.dst] = TaggedValue.fastBitOr(this.registers[inst.left], this.registers[inst.right]);
          break;
        case 'BIT_XOR_R':
          this.registers[inst.dst] = TaggedValue.fastBitXor(this.registers[inst.left], this.registers[inst.right]);
          break;
        case 'BIT_NOT_R':
          this.registers[inst.dst] = TaggedValue.fastBitNot(this.registers[inst.src]);
          break;
        case 'BIT_SHL_R':
          this.registers[inst.dst] = TaggedValue.fastBitShl(this.registers[inst.left], this.registers[inst.right]);
          break;
        case 'BIT_SHR_R':
          this.registers[inst.dst] = TaggedValue.fastBitShr(this.registers[inst.left], this.registers[inst.right]);
          break;
        case 'BIT_USHR_R':
          this.registers[inst.dst] = TaggedValue.fastBitUshr(this.registers[inst.left], this.registers[inst.right]);
          break;

        case 'UNARY_OP_R': {
          const val = this.registers[inst.src];
          const op = inst.operator;
          if (op === '!') this.registers[inst.dst] = !val;
          else if (op === '-') this.registers[inst.dst] = -val;
          else if (op === '~') this.registers[inst.dst] = TaggedValue.fastBitNot(val);
          else throw new Error(`VM Runtime Error: Unsupported unary operator '${op}'`);
          break;
        }

        case 'JUMP_R':
          if (this.loopGuard) this.loopGuard.tick(curIp, inst.offset);
          this.ip = inst.offset;
          break;

        case 'JUMP_IF_FALSE_R':
          if (!this.registers[inst.cond]) {
            if (this.loopGuard) this.loopGuard.tick(curIp, inst.offset);
            this.ip = inst.offset;
          }
          break;

        case 'JUMP_IF_TRUE_R':
          if (this.registers[inst.cond]) {
            if (this.loopGuard) this.loopGuard.tick(curIp, inst.offset);
            this.ip = inst.offset;
          }
          break;

        case 'CALL_R': {
          const func = this.registers[inst.callee];
          const args = (inst.args || []).map(r => this.registers[r]);

          if (typeof func === 'function') {
            const res = func(...args);
            this.registers[inst.dst] = res;
          } else if (func && func.type === 'VM_FUNCTION') {
            // JIT check
            func.invocationCount = (func.invocationCount || 0) + 1;
            if (this.enableJit && !func.nativeCode && func.invocationCount >= this.jit.threshold) {
              this.jit.compile(func);
            }

            if (func.nativeCode) {
              const res = func.nativeCode(args, this.globals, this.libs, this.variables);
              this.registers[inst.dst] = res;
            } else {
              const subVM = new VirtualMachine(func.instructions, this.globals, this.libs, {
                ...this.options,
                ic: this.ic,
                gc: this.gc,
                loopGuard: this.loopGuard,
                currentFnName: func.name
              });
              for (const [k, v] of this.variables.entries()) {
                subVM.variables.set(k, v);
              }
              for (let i = 0; i < (func.params || []).length; i++) {
                subVM.variables.set(func.params[i], args[i]);
                subVM.registers[i] = args[i];
              }
              const fnStart = Date.now();
              const res = subVM.run();
              if (this.profiler) this.profiler.recordFunctionCall(func.name || '<anonymous>', Date.now() - fnStart);
              this.registers[inst.dst] = res;
            }
          } else {
            throw new Error(`VM Runtime Error: Callee is not callable.`);
          }
          break;
        }

        // Tail Call Optimization (TCO): Frame reuse without stack overflow
        case 'TAIL_CALL_R': {
          const func = this.registers[inst.callee];
          const args = (inst.args || []).map(r => this.registers[r]);

          if (func && func.type === 'VM_FUNCTION' && func.name === this.currentFnName) {
            // Rebind arguments into parameter registers & variables
            for (let i = 0; i < (func.params || []).length; i++) {
              this.variables.set(func.params[i], args[i]);
              this.registers[i] = args[i];
            }
            if (this.loopGuard) this.loopGuard.tick(curIp, 0);
            this.ip = 0; // Jump back to start of function frame!
          } else if (typeof func === 'function') {
            return func(...args);
          } else if (func && func.type === 'VM_FUNCTION') {
            const subVM = new VirtualMachine(func.instructions, this.globals, this.libs, {
              ...this.options,
              ic: this.ic,
              gc: this.gc,
              loopGuard: this.loopGuard,
              currentFnName: func.name
            });
            for (const [k, v] of this.variables.entries()) subVM.variables.set(k, v);
            for (let i = 0; i < (func.params || []).length; i++) {
              subVM.variables.set(func.params[i], args[i]);
              subVM.registers[i] = args[i];
            }
            return subVM.run();
          } else {
            throw new Error(`VM Runtime Error: Tail callee is not callable.`);
          }
          break;
        }

        case 'RETURN_R':
          if (this.profiler) this.profiler.stop();
          return this.registers[inst.src];

        case 'GET_PROP_R': {
          const obj = this.registers[inst.obj];
          if (inst.optional && (obj === null || obj === undefined)) {
            this.registers[inst.dst] = undefined;
            break;
          }
          let val = this.ic.getProperty(inst.siteId || 0, obj, inst.prop);
          if (typeof val === 'function' && obj) {
            const bound = val.bind(obj);
            Object.setPrototypeOf(bound, val);
            Object.assign(bound, val);
            val = bound;
          }
          this.registers[inst.dst] = val;
          break;
        }

        case 'SET_PROP_R': {
          const obj = this.registers[inst.obj];
          const val = this.registers[inst.val];
          this.ic.setProperty(inst.siteId || 0, obj, inst.prop, val);
          break;
        }

        case 'GET_ELEM_R': {
          const arr = this.registers[inst.obj];
          const idx = this.registers[inst.index];
          if (inst.optional && (arr === null || arr === undefined)) {
            this.registers[inst.dst] = undefined;
            break;
          }
          if (arr === undefined || arr === null) {
            throw new Error(`VM Runtime Error: Cannot read index '${idx}' of ${arr}`);
          }
          this.registers[inst.dst] = arr[idx];
          break;
        }

        case 'SET_ELEM_R': {
          const arr = this.registers[inst.obj];
          const idx = this.registers[inst.index];
          const val = this.registers[inst.val];
          if (arr === undefined || arr === null) {
            throw new Error(`VM Runtime Error: Cannot set index '${idx}' of ${arr}`);
          }
          arr[idx] = val;
          break;
        }

        case 'ARRAY_LIT_R': {
          const arr = (inst.elements || []).map(r => this.registers[r]);
          this.gc.track(arr);
          this.registers[inst.dst] = arr;
          break;
        }

        case 'OBJECT_LIT_R': {
          const obj = {};
          for (const item of (inst.properties || [])) {
            obj[item.key] = this.registers[item.reg];
          }
          this.gc.track(obj);
          this.registers[inst.dst] = obj;
          break;
        }

        // ==========================================
        // B. STACK-BASED OPCODES (Backward Compatibility)
        // ==========================================
        case 'PUSH_CONST':
          this.stack.push(inst.value);
          break;

        case 'IMPORT_MODULE': {
          let mod = this.globals[inst.source];
          if (!mod) {
            try { mod = require(inst.source); } catch (e) {}
          }
          this.variables.set(inst.alias, mod);
          break;
        }

        case 'IMPORT_SPECIFIER': {
          let mod = this.globals[inst.source];
          if (!mod) {
            try { mod = require(inst.source); } catch (e) {}
          }
          const val = mod ? mod[inst.imported] : undefined;
          this.variables.set(inst.local, val);
          break;
        }

        case 'BUILD_NAMESPACE': {
          const ns = {};
          for (const k of inst.keys) {
            if (this.variables.has(k)) ns[k] = this.variables.get(k);
          }
          this.variables.set(inst.alias, ns);
          break;
        }

        case 'LOAD_VAR': {
          if (this.variables.has(inst.name)) {
            this.stack.push(this.variables.get(inst.name));
          } else if (inst.name in this.globals) {
            this.stack.push(this.globals[inst.name]);
          } else if (inst.name in this.libs) {
            this.stack.push(this.libs[inst.name]);
          } else {
            throw new Error(`VM Runtime Error: Variable '${inst.name}' is not defined.`);
          }
          break;
        }

        case 'STORE_VAR': {
          const val = this.stack[this.stack.length - 1]; // Peek
          this.variables.set(inst.name, val);
          break;
        }

        case 'BINARY_OP': {
          const right = this.stack.pop();
          const left = this.stack.pop();
          const op = inst.operator;

          let res;
          if (op === '+') res = TaggedValue.fastAdd(left, right);
          else if (op === '-') res = TaggedValue.fastSub(left, right);
          else if (op === '*') res = TaggedValue.fastMul(left, right);
          else if (op === '/') res = left / right;
          else if (op === 'is' || op === '==') res = left === right;
          else if (op === 'is not' || op === '!=') res = left !== right;
          else if (op === '<') res = left < right;
          else if (op === '<=') res = left <= right;
          else if (op === '>') res = left > right;
          else if (op === '>=') res = left >= right;
          else if (op === '&') res = TaggedValue.fastBitAnd(left, right);
          else if (op === '|') res = TaggedValue.fastBitOr(left, right);
          else if (op === '^') res = TaggedValue.fastBitXor(left, right);
          else if (op === '<<') res = TaggedValue.fastBitShl(left, right);
          else if (op === '>>') res = TaggedValue.fastBitShr(left, right);
          else if (op === '>>>') res = TaggedValue.fastBitUshr(left, right);
          else if (op === '??') res = (left !== null && left !== undefined) ? left : right;
          else throw new Error(`VM Runtime Error: Unsupported binary operator '${op}'`);

          this.stack.push(res);
          break;
        }

        case 'UNARY_OP': {
          const val = this.stack.pop();
          const op = inst.operator;
          let res;
          if (op === '!') res = !val;
          else if (op === '-') res = -val;
          else if (op === '~') res = TaggedValue.fastBitNot(val);
          else throw new Error(`VM Runtime Error: Unsupported unary operator '${op}'`);
          this.stack.push(res);
          break;
        }

        case 'JUMP_IF_FALSE': {
          const cond = this.stack.pop();
          if (!cond) {
            if (this.loopGuard) this.loopGuard.tick(curIp, inst.offset);
            this.ip = inst.offset;
          }
          break;
        }

        case 'JUMP':
          if (this.loopGuard) this.loopGuard.tick(curIp, inst.offset);
          this.ip = inst.offset;
          break;

        case 'RETURN':
          if (this.profiler) this.profiler.stop();
          return this.stack.pop();

        case 'CALL': {
          const func = this.stack.pop();
          const args = [];
          for (let i = 0; i < inst.argCount; i++) {
            args.unshift(this.stack.pop());
          }
          if (typeof func === 'function') {
            const res = func(...args);
            this.stack.push(res);
          } else if (func && func.type === 'VM_FUNCTION') {
            func.invocationCount = (func.invocationCount || 0) + 1;
            if (this.enableJit && !func.nativeCode && func.invocationCount >= this.jit.threshold) {
              this.jit.compile(func);
            }

            if (func.nativeCode) {
              const res = func.nativeCode(args, this.globals, this.libs, this.variables);
              this.stack.push(res);
            } else {
              const subVM = new VirtualMachine(func.instructions, this.globals, this.libs, {
                ...this.options,
                ic: this.ic,
                gc: this.gc,
                loopGuard: this.loopGuard,
                currentFnName: func.name
              });
              for (const [k, v] of this.variables.entries()) subVM.variables.set(k, v);
              for (let i = 0; i < (func.params || []).length; i++) {
                subVM.variables.set(func.params[i], args[i]);
                subVM.registers[i] = args[i];
              }
              const fnStart = Date.now();
              const res = subVM.run();
              if (this.profiler) this.profiler.recordFunctionCall(func.name || '<anonymous>', Date.now() - fnStart);
              this.stack.push(res);
            }
          } else {
            throw new Error(`VM Runtime Error: Callee is not callable.`);
          }
          break;
        }

        case 'MEMBER_ACCESS': {
          const obj = this.stack.pop();
          let val = this.ic.getProperty(inst.siteId || 0, obj, inst.property);
          if (typeof val === 'function' && obj) {
            const bound = val.bind(obj);
            Object.setPrototypeOf(bound, val);
            Object.assign(bound, val);
            val = bound;
          }
          this.stack.push(val);
          break;
        }

        case 'GET_ITEM': {
          const idx = this.stack.pop();
          const arr = this.stack.pop();
          if (arr === undefined || arr === null) {
            throw new Error(`VM Runtime Error: Cannot read index '${idx}' of ${arr}`);
          }
          this.stack.push(arr[idx]);
          break;
        }

        case 'SET_ITEM': {
          const key = this.stack.pop();
          const obj = this.stack.pop();
          const val = this.stack[this.stack.length - 1]; // Peek
          this.ic.setProperty(inst.siteId || 0, obj, key, val);
          break;
        }

        case 'ARRAY_LIT': {
          const elements = [];
          for (let i = 0; i < inst.count; i++) {
            elements.unshift(this.stack.pop());
          }
          this.gc.track(elements);
          this.stack.push(elements);
          break;
        }

        case 'OBJECT_LIT': {
          const obj = {};
          for (let i = (inst.keys || []).length - 1; i >= 0; i--) {
            obj[inst.keys[i]] = this.stack.pop();
          }
          this.gc.track(obj);
          this.stack.push(obj);
          break;
        }

        case 'POP':
          this.stack.pop();
          break;

        case 'SETUP_CATCH_R':
        case 'SETUP_CATCH':
          this.catchHandlers.push({ offset: inst.offset, param: inst.param });
          break;

        case 'POP_CATCH_R':
        case 'POP_CATCH':
          this.catchHandlers.pop();
          break;
      }

      } catch (err) {
        if (this.catchHandlers && this.catchHandlers.length > 0) {
          const handler = this.catchHandlers.pop();
          if (handler.param) {
            this.variables.set(handler.param, err.message || err);
          }
          this.ip = handler.offset;
          continue;
        }
        throw err;
      }

      if (this.profiler) {
        const opElapsed = process.hrtime.bigint() - opStartNs;
        this.profiler.recordOpcode(inst.op, opElapsed);
      }
    }

    return this.stack.length > 0 ? this.stack[this.stack.length - 1] : this.registers[0];
    } finally {
      if (this.profiler) this.profiler.stop();
      VirtualMachine.currentVM = prevVM;
    }
  }
}

class RegisterVM extends VirtualMachine {
  constructor(instructions, globals = {}, libs = {}, options = {}) {
    super(instructions, globals, libs, options);
  }
}

// ============================================================
// 11. WBC Binary Serializer & Deserializer
// ============================================================
class BytecodeSerializer {
  static serialize(payload) {
    const magic = Buffer.from('WBC1', 'utf8');
    const verBuf = Buffer.alloc(2);
    verBuf.writeUInt16BE(1, 0);

    const jsonStr = JSON.stringify(payload);
    const dataBuf = Buffer.from(jsonStr, 'utf8');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(dataBuf.length, 0);

    return Buffer.concat([magic, verBuf, lenBuf, dataBuf]);
  }
}

class BytecodeDeserializer {
  static deserialize(buffer) {
    if (!Buffer.isBuffer(buffer)) {
      buffer = Buffer.from(buffer);
    }
    if (buffer.length < 10) {
      throw new Error('Invalid WBC file: Buffer is too small to contain a valid WBC header.');
    }
    const magic = buffer.slice(0, 4).toString('utf8');
    if (magic !== 'WBC1') {
      throw new Error(`Invalid WBC format: Expected magic header 'WBC1', got '${magic}'`);
    }
    const version = buffer.readUInt16BE(4);
    const payloadLen = buffer.readUInt32BE(6);
    const dataBuf = buffer.slice(10, 10 + payloadLen);
    const parsed = JSON.parse(dataBuf.toString('utf8'));
    parsed.headerVersion = version;
    return parsed;
  }
}

// ============================================================
// 12. Bytecode Disassembler (Register & Stack)
// ============================================================
class BytecodeDisassembler {
  static disassemble(instructions, meta = {}) {
    const out = [];
    out.push('======================================================================');
    out.push('⚡ WATE BYTECODE DISASSEMBLER (WBC v2.0 - Register & Stack)');
    if (meta.sourceFile) out.push(`Source: ${meta.sourceFile}`);
    out.push(`Total Instructions: ${instructions.length}`);
    out.push('======================================================================');
    out.push('ADDR    OPCODE             OPERAND / DETAILS');
    out.push('----------------------------------------------------------------------');

    instructions.forEach((inst, index) => {
      const addr = String(index).padStart(4, '0');
      const op = (inst.op || '').padEnd(18, ' ');
      let operand = '';

      switch (inst.op) {
        // Register opcodes
        case 'LOAD_CONST_R': operand = `R${inst.dst} = ${JSON.stringify(inst.value)}`; break;
        case 'LOAD_VAR_R': operand = `R${inst.dst} = ${inst.name}`; break;
        case 'STORE_VAR_R': operand = `${inst.name} = R${inst.src}`; break;
        case 'MOVE_R': operand = `R${inst.dst} = R${inst.src}`; break;
        case 'BINARY_OP_R': operand = `R${inst.dst} = R${inst.left} ${inst.operator} R${inst.right}`; break;
        case 'BIT_AND_R': operand = `R${inst.dst} = R${inst.left} & R${inst.right}`; break;
        case 'BIT_OR_R': operand = `R${inst.dst} = R${inst.left} | R${inst.right}`; break;
        case 'BIT_XOR_R': operand = `R${inst.dst} = R${inst.left} ^ R${inst.right}`; break;
        case 'BIT_NOT_R': operand = `R${inst.dst} = ~R${inst.src}`; break;
        case 'BIT_SHL_R': operand = `R${inst.dst} = R${inst.left} << R${inst.right}`; break;
        case 'BIT_SHR_R': operand = `R${inst.dst} = R${inst.left} >> R${inst.right}`; break;
        case 'BIT_USHR_R': operand = `R${inst.dst} = R${inst.left} >>> R${inst.right}`; break;
        case 'UNARY_OP_R': operand = `R${inst.dst} = ${inst.operator}R${inst.src}`; break;
        case 'JUMP_R': operand = `-> @${String(inst.offset).padStart(4, '0')}`; break;
        case 'JUMP_IF_FALSE_R': operand = `R${inst.cond} -> @${String(inst.offset).padStart(4, '0')}`; break;
        case 'CALL_R': operand = `R${inst.dst} = R${inst.callee}(${(inst.args || []).map(r => 'R' + r).join(', ')})`; break;
        case 'TAIL_CALL_R': operand = `TAIL_CALL R${inst.callee}(${(inst.args || []).map(r => 'R' + r).join(', ')})`; break;
        case 'RETURN_R': operand = `R${inst.src}`; break;
        case 'GET_PROP_R': operand = `R${inst.dst} = R${inst.obj}.${inst.prop}`; break;
        case 'SET_PROP_R': operand = `R${inst.obj}.${inst.prop} = R${inst.val}`; break;
        case 'GET_ELEM_R': operand = `R${inst.dst} = R${inst.obj}[R${inst.index}]`; break;
        case 'SET_ELEM_R': operand = `R${inst.obj}[R${inst.index}] = R${inst.val}`; break;
        case 'ARRAY_LIT_R': operand = `R${inst.dst} = [${(inst.elements || []).map(r => 'R' + r).join(', ')}]`; break;
        case 'OBJECT_LIT_R': operand = `R${inst.dst} = { ${(inst.properties || []).map(p => p.key + ': R' + p.reg).join(', ')} }`; break;

        // Stack opcodes
        case 'PUSH_CONST': operand = JSON.stringify(inst.value); break;
        case 'LOAD_VAR':
        case 'STORE_VAR': operand = inst.name; break;
        case 'BINARY_OP':
        case 'UNARY_OP': operand = inst.operator; break;
        case 'JUMP':
        case 'JUMP_IF_FALSE': operand = `-> @${String(inst.offset).padStart(4, '0')}`; break;
        case 'CALL': operand = `argCount: ${inst.argCount}`; break;
        case 'MEMBER_ACCESS': operand = `.${inst.property}`; break;
        case 'ARRAY_LIT': operand = `count: ${inst.count}`; break;
        case 'OBJECT_LIT': operand = `keys: ${(inst.keys || []).join(', ')}`; break;
        case 'IMPORT_MODULE': operand = `${inst.source} as ${inst.alias}`; break;
        case 'IMPORT_SPECIFIER': operand = `${inst.source} -> ${inst.imported} as ${inst.local}`; break;
        case 'BUILD_NAMESPACE': operand = `${inst.alias} (${(inst.keys || []).join(', ')})`; break;
        default: operand = '';
      }

      out.push(`${addr}    ${op} ${operand}`);
    });

    out.push('======================================================================');
    return out.join('\n');
  }

  static dump(input, meta = {}) {
    if (Array.isArray(input)) {
      return this.disassemble(input, meta);
    }
    if (Buffer.isBuffer(input)) {
      const decoded = BytecodeDeserializer.deserialize(input);
      return this.disassemble(decoded.instructions, {
        sourceFile: decoded.sourceFile || meta.sourceFile,
        ...meta
      });
    }
    throw new Error('Invalid input to BytecodeDisassembler.dump: expected instruction array or WBC Buffer');
  }
}

function makeConstructible(Cls) {
  if (typeof Cls !== 'function') return Cls;
  return new Proxy(Cls, {
    apply(target, thisArg, argList) {
      return new target(...argList);
    },
    construct(target, argList, newTarget) {
      return Reflect.construct(target, argList, newTarget);
    }
  });
}

module.exports = {
  TaggedValue: makeConstructible(TaggedValue),
  InlineCache: makeConstructible(InlineCache),
  GarbageCollector: makeConstructible(GarbageCollector),
  LoopGuard: makeConstructible(LoopGuard),
  WateEventLoop: makeConstructible(WateEventLoop),
  VMProfiler: makeConstructible(VMProfiler),
  JITCompiler: makeConstructible(JITCompiler),
  BytecodeCompiler: makeConstructible(BytecodeCompiler),
  RegisterBytecodeCompiler: makeConstructible(RegisterBytecodeCompiler),
  VirtualMachine: makeConstructible(VirtualMachine),
  RegisterVM: makeConstructible(RegisterVM),
  BytecodeSerializer,
  BytecodeDeserializer,
  BytecodeDisassembler
};

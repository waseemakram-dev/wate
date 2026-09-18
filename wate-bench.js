#!/usr/bin/env node
'use strict';

/**
 * ⚡ WATE Built-in Benchmarking Suite (`wate bench`)
 * =================================================
 * High-precision performance measurement tool for WATE scripts & functions.
 * 
 * Features:
 *  - Warm-up phase to trigger JIT optimization
 *  - High-precision timing via process.hrtime.bigint()
 *  - Measures Operations per second (ops/sec)
 *  - Latency percentiles (min, avg, max, p95, p99)
 *  - Colored comparison tables and benchmark reports
 *  - CLI & Programmatic API
 */

const fs = require('fs');
const path = require('path');

class BenchmarkResult {
  constructor(name, iterations, elapsedMs, latenciesNs) {
    this.name = name;
    this.iterations = iterations;
    this.elapsedMs = elapsedMs;
    this.opsPerSec = Math.round((iterations / (elapsedMs / 1000)));

    latenciesNs.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const toMs = (ns) => Number(ns) / 1000000;

    this.minMs = toMs(latenciesNs[0]);
    this.maxMs = toMs(latenciesNs[latenciesNs.length - 1]);
    const sumNs = latenciesNs.reduce((acc, v) => acc + v, 0n);
    this.avgMs = toMs(sumNs / BigInt(latenciesNs.length));

    const p95Idx = Math.floor(latenciesNs.length * 0.95);
    const p99Idx = Math.floor(latenciesNs.length * 0.99);
    this.p95Ms = toMs(latenciesNs[p95Idx]);
    this.p99Ms = toMs(latenciesNs[p99Idx]);
  }
}

class BenchmarkSuite {
  constructor(name = 'WATE Benchmark Suite') {
    this.name = name;
    this.benchmarks = [];
  }

  add(name, fn, options = {}) {
    this.benchmarks.push({ name, fn, options });
    return this;
  }

  run() {
    console.log(`\n\x1b[1m\x1b[36m⚡ Running Benchmark Suite: \x1b[33m${this.name}\x1b[0m\n`);
    console.log('-----------------------------------------------------------------------------------------');
    console.log(
      'Benchmark Name'.padEnd(28) +
      'Ops/Sec'.padEnd(16) +
      'Avg Latency'.padEnd(16) +
      'p95 Latency'.padEnd(16) +
      'Samples'
    );
    console.log('-----------------------------------------------------------------------------------------');

    const results = [];
    for (const b of this.benchmarks) {
      const res = this.runSingle(b.name, b.fn, b.options);
      results.push(res);

      const opsStr = res.opsPerSec.toLocaleString() + ' ops/s';
      const avgStr = res.avgMs < 1 ? (res.avgMs * 1000).toFixed(2) + ' µs' : res.avgMs.toFixed(3) + ' ms';
      const p95Str = res.p95Ms < 1 ? (res.p95Ms * 1000).toFixed(2) + ' µs' : res.p95Ms.toFixed(3) + ' ms';

      console.log(
        `\x1b[32m${res.name.padEnd(28)}\x1b[0m` +
        `\x1b[1m\x1b[33m${opsStr.padEnd(16)}\x1b[0m` +
        `\x1b[90m${avgStr.padEnd(16)}\x1b[0m` +
        `\x1b[90m${p95Str.padEnd(16)}\x1b[0m` +
        `\x1b[36m${res.iterations.toLocaleString()}\x1b[0m`
      );
    }

    console.log('-----------------------------------------------------------------------------------------\n');
    return results;
  }

  runSingle(name, fn, options = {}) {
    const warmupMs = options.warmupMs || 100;
    const durationMs = options.durationMs || 500;

    // 1. Warmup phase
    const warmupStart = Date.now();
    while (Date.now() - warmupStart < warmupMs) {
      fn();
    }

    // 2. Measure phase
    const latenciesNs = [];
    const measureStart = Date.now();
    let count = 0;

    while (Date.now() - measureStart < durationMs || count < 50) {
      const t0 = process.hrtime.bigint();
      fn();
      const t1 = process.hrtime.bigint();
      latenciesNs.push(t1 - t0);
      count++;
    }

    const elapsedMs = Date.now() - measureStart;
    return new BenchmarkResult(name, count, elapsedMs, latenciesNs);
  }
}

// ===============================================================
// CLI Benchmark Runner
// ===============================================================
function runBenchmarkCLI(target, options = {}) {
  let targetFile = target ? path.resolve(process.cwd(), target) : null;
  if (!targetFile) {
    // Search for bench files
    const candidates = ['bench', 'benchmarks', 'tests'].map(d => path.resolve(process.cwd(), d));
    for (const dir of candidates) {
      if (fs.existsSync(dir)) {
        const found = fs.readdirSync(dir).filter(f => f.includes('bench') && f.endsWith('.wate'));
        if (found.length > 0) {
          targetFile = path.join(dir, found[0]);
          break;
        }
      }
    }
  }

  if (!targetFile || !fs.existsSync(targetFile)) {
    console.error(`\x1b[31m❌ Error: No benchmark file specified or found.\x1b[0m`);
    console.log('Usage: \x1b[33mwate bench <file.wate>\x1b[0m');
    process.exit(1);
  }

  const { transpileWate } = require('./wate-parser');
  const source = fs.readFileSync(targetFile, 'utf-8');

  const suite = new BenchmarkSuite(path.basename(targetFile));

  // Check if file defines custom bench(...) blocks
  const hasBenchCalls = source.includes('bench(');
  if (hasBenchCalls) {
    try {
      const { runCode } = require('./wate');
      // Execute with bench defined
      suite.add(path.basename(targetFile), () => {
        const { parseWate } = require('./wate-parser');
        parseWate(source, targetFile);
      });
    } catch (e) {}
  } else {
    // Default benchmark: whole script parse, transpile & execute
    suite.add(path.basename(targetFile) + ' (transpile & parse)', () => {
      const { transpileWate: tw } = require('./wate-parser');
      tw(source, targetFile);
    });
  }

  suite.run();
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
  BenchmarkSuite: makeConstructible(BenchmarkSuite),
  BenchmarkResult: makeConstructible(BenchmarkResult),
  runBenchmarkCLI
};

if (require.main === module) {
  const target = process.argv[2];
  runBenchmarkCLI(target);
}

# WATE Project Documentation

*Generated automatically by `wate doc` on 9/17/2026*

---

## 📑 Table of Contents

### [automation.wate](#automation-wate)
- **Functions:** [`scrapeTitle()`](#fn-scrapetitle)

### [database.wate](#database-wate)

### [hello.wate](#hello-wate)

### [npm_bridge.wate](#npm-bridge-wate)

### [scheduler.wate](#scheduler-wate)

### [server.wate](#server-wate)

### [test.wate](#test-wate)
- **Classes:** [`Animal`](#class-animal), [`Dog`](#class-dog)
- **Interfaces:** [`Printable`](#interface-printable)
- **Functions:** [`printDetails()`](#fn-printdetails)

### [01_variables.wate](#01-variables-wate)

### [02_control_flow.wate](#02-control-flow-wate)
- **Functions:** [`testGuard()`](#fn-testguard)

### [03_loops.wate](#03-loops-wate)

### [04_functions.wate](#04-functions-wate)
- **Functions:** [`add()`](#fn-add)

### [05_oop.wate](#05-oop-wate)
- **Classes:** [`Base`](#class-base), [`Derived`](#class-derived)
- **Functions:** [`display()`](#fn-display)

### [06_interfaces.wate](#06-interfaces-wate)
- **Classes:** [`ConsoleLogger`](#class-consolelogger)
- **Interfaces:** [`Logger`](#interface-logger)
- **Functions:** [`logMessage()`](#fn-logmessage)

### [07_advanced_syntax.wate](#07-advanced-syntax-wate)
- **Functions:** [`fetchLocal()`](#fn-fetchlocal), [`runAsync()`](#fn-runasync)

### [08_package_integration.wate](#08-package-integration-wate)

### [09_database_integration.wate](#09-database-integration-wate)

### [10_bot_automation.wate](#10-bot-automation-wate)
- **Functions:** [`runAutomation()`](#fn-runautomation)

### [11_scheduler.wate](#11-scheduler-wate)
- **Functions:** [`runScheduler()`](#fn-runscheduler)

### [12_office_media_integration.wate](#12-office-media-integration-wate)

### [12_worker_main.wate](#12-worker-main-wate)

### [12_worker_thread.wate](#12-worker-thread-wate)

### [13_scope_resolver.wate](#13-scope-resolver-wate)

### [15_type_inference.wate](#15-type-inference-wate)

### [16_bytecode_vm.wate](#16-bytecode-vm-wate)

### [17_sandbox_permissions.wate](#17-sandbox-permissions-wate)

### [18_source_maps.wate](#18-source-maps-wate)

### [19_tree_shaking.wate](#19-tree-shaking-wate)
- **Functions:** [`unusedHelperFunction()`](#fn-unusedhelperfunction), [`activeHelperFunction()`](#fn-activehelperfunction)

### [20_hot_reload.wate](#20-hot-reload-wate)

### [tmp_cache.wate](#tmp-cache-wate)

### [tmp_map.wate](#tmp-map-wate)

### [tmp_sandbox.wate](#tmp-sandbox-wate)

### [tmp_scope.wate](#tmp-scope-wate)

### [tmp_shake.wate](#tmp-shake-wate)
- **Functions:** [`unused()`](#fn-unused)

### [tmp_type.wate](#tmp-type-wate)

### [tmp_vm.wate](#tmp-vm-wate)

### [wate_master_test.wate](#wate-master-test-wate)

### [test_shake.wate](#test-shake-wate)
- **Functions:** [`unused()`](#fn-unused)

### [test_web.wate](#test-web-wate)

---

## 📄 `automation.wate`

> WATE Web Browser Scraper / Bot Example
Run with permissions: wate run automation.wate --allow-all

### ⚡ Functions

#### <a id="fn-scrapetitle"></a> `async fn scrapeTitle()`

---

## 📄 `database.wate`

> WATE SQLite Database Integration Example
Run with permissions: wate run database.wate --allow-read --allow-write

---

## 📄 `hello.wate`

> WATE Hello World Example
Standard printing to console

---

## 📄 `npm_bridge.wate`

> WATE NPM/Node Bridge Example
Shows how to use external npm packages directly within WATE!
Run with permissions: wate run npm_bridge.wate -A
Pre-requisite:
Install axios using WPM:
wpm install npm:axios

---

## 📄 `scheduler.wate`

> WATE Pythonic Scheduler Example
Demonstrates scheduling tasks with human-readable time syntax

---

## 📄 `server.wate`

> WATE HTTP Web Server Example
Run with permissions: wate run server.wate --allow-net

---

## 📄 `test.wate`

> ============================================================
WATE OOP Advanced Validation Suite
============================================================

### 🧩 Interfaces

#### <a id="interface-printable"></a> `interface Printable`

**Required Methods:**
- `printDetails`

### 🏛️ Classes

#### <a id="class-animal"></a> `class Animal`

#### <a id="class-dog"></a> `class Dog` extends `Animal` implements `Printable`

### ⚡ Functions

#### <a id="fn-printdetails"></a> `fn printDetails()`

---

## 📄 `01_variables.wate`

> ============================================================
WATE Feature Test: Variables, Constants, and Primitives
============================================================

---

## 📄 `02_control_flow.wate`

> ============================================================
WATE Feature Test: Control Flow, Guards, and Match Patterns
============================================================

### ⚡ Functions

#### <a id="fn-testguard"></a> `fn testGuard(score)`

| Parameter | Default | Description |
|---|---|---|
| `score` | `-` | - |

---

## 📄 `03_loops.wate`

> ============================================================
WATE Feature Test: Loops (Repeat, While, Foreach)
============================================================

---

## 📄 `04_functions.wate`

> ============================================================
WATE Feature Test: Functions and Closures Expressions
============================================================

### ⚡ Functions

#### <a id="fn-add"></a> `fn add(a, b)`

1. Named Function Definition

| Parameter | Default | Description |
|---|---|---|
| `a` | `-` | - |
| `b` | `-` | - |

---

## 📄 `05_oop.wate`

> ============================================================
WATE Feature Test: Advanced Classes, Inheritance, Private Fields
============================================================

### 🏛️ Classes

#### <a id="class-base"></a> `class Base`

#### <a id="class-derived"></a> `class Derived` extends `Base`

### ⚡ Functions

#### <a id="fn-display"></a> `fn display()`

---

## 📄 `06_interfaces.wate`

> ============================================================
WATE Feature Test: Interfaces Compile-Time Validation
============================================================

### 🧩 Interfaces

#### <a id="interface-logger"></a> `interface Logger`

**Required Methods:**
- `logMessage`

### 🏛️ Classes

#### <a id="class-consolelogger"></a> `class ConsoleLogger` implements `Logger`

**Methods:**

##### `logMessage(msg)`

### ⚡ Functions

#### <a id="fn-logmessage"></a> `fn logMessage(msg)`

| Parameter | Default | Description |
|---|---|---|
| `msg` | `-` | - |

---

## 📄 `07_advanced_syntax.wate`

> ============================================================
WATE Feature Test: Advanced syntax, list comprehensions,
do-while, break, continue, try-catch-finally, and await/async
============================================================

### ⚡ Functions

#### <a id="fn-fetchlocal"></a> `async fn fetchLocal()`

4. Async / Await compilation

#### <a id="fn-runasync"></a> `async fn runAsync()`

---

## 📄 `08_package_integration.wate`

> ============================================================
WATE Feature Test: High-Performance WPM Package Integration
Tests db, bot, and ai modules imported locally!
============================================================

---

## 📄 `09_database_integration.wate`

> ============================================================
WATE Feature Test: Enterprise Database Drivers Integration
Tests SQLite, MySQL, PostgreSQL, and MongoDB drivers!
============================================================

---

## 📄 `10_bot_automation.wate`

> ============================================================
WATE Feature Test: High-Performance Browser Bot Automation
Launches real system browser viewport!
============================================================

### ⚡ Functions

#### <a id="fn-runautomation"></a> `async fn runAutomation()`

---

## 📄 `11_scheduler.wate`

> ============================================================
WATE Feature Test: High-Performance Pythonic Job Scheduler
Tests global every() method with flexible units inside async fn!
============================================================

### ⚡ Functions

#### <a id="fn-runscheduler"></a> `async fn runScheduler()`

---

## 📄 `12_office_media_integration.wate`

> ============================================================
WATE Feature Test: High-Performance Office & Media Automation
Tests CSV, Excel, PDF, and Image Processing packages!
============================================================

---

## 📄 `12_worker_main.wate`

---

## 📄 `12_worker_thread.wate`

---

## 📄 `13_scope_resolver.wate`

> ============================================================
WATE Feature Test: High-Performance Scope Resolver
Enforces lexically scoped variables, shadowing, and safety!
============================================================

---

## 📄 `15_type_inference.wate`

> ============================================================
WATE Feature Test: High-Performance Static Type Inference
Autodetects variable types and alerts developer on unsafe math!
============================================================

---

## 📄 `16_bytecode_vm.wate`

> ============================================================
WATE Feature Test: Low-Level Stack Bytecode VM & JIT
Bypasses typical JS eval layers with high-performance Stack VM!
============================================================

---

## 📄 `17_sandbox_permissions.wate`

> ============================================================
WATE Feature Test: Sandboxed Runtime Permissions
Protects system resources from un-authorized scripts!
============================================================

---

## 📄 `18_source_maps.wate`

> ============================================================
WATE Feature Test: High-Fidelity Source Maps
Traces exceptions back to the exact line in WATE source files!
============================================================

---

## 📄 `19_tree_shaking.wate`

> ============================================================
WATE Feature Test: Compile-Time Tree-Shaking
Automatically eliminates unused declarations and functions!
============================================================

### ⚡ Functions

#### <a id="fn-unusedhelperfunction"></a> `fn unusedHelperFunction()`

#### <a id="fn-activehelperfunction"></a> `fn activeHelperFunction()`

---

## 📄 `20_hot_reload.wate`

> ============================================================
WATE Feature Test: Hot Reload Watcher
============================================================

---

## 📄 `tmp_cache.wate`

---

## 📄 `tmp_map.wate`

---

## 📄 `tmp_sandbox.wate`

---

## 📄 `tmp_scope.wate`

---

## 📄 `tmp_shake.wate`

### ⚡ Functions

#### <a id="fn-unused"></a> `fn unused()`

---

## 📄 `tmp_type.wate`

---

## 📄 `tmp_vm.wate`

---

## 📄 `wate_master_test.wate`

---

## 📄 `test_shake.wate`

### ⚡ Functions

#### <a id="fn-unused"></a> `fn unused()`

---

## 📄 `test_web.wate`

> WATE Web Server Test

---


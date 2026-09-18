# WATE Language — Quick Reference & Examples

> ⚡ WATE v10.0.0 | Built by WazemTech (Waseem Akram)

---

## 🚀 Hello World
```wate
out("Hello, World!")
print("Hello from WATE!")
```

---

## 📦 Variables
```wate
set name = "Waseem"
set age  = 25
const PI = 3.14159

out(f"Name: {name}, Age: {age}")
```

---

## 🔧 Functions
```wate
fn greet(name) {
    return f"Hello, {name}!"
}

out(greet("Waseem"))

# Anonymous function
set square = fn(x) { return x * x }
out(square(5))   # => 25
```

---

## 🔀 Control Flow
```wate
set x = 10

if x > 5 {
    out("x is greater than 5")
} else {
    out("x is 5 or less")
}
```

---

## 🔁 Loops
```wate
# For-in loop
set fruits = ["apple", "mango", "banana"]
for fruit in fruits {
    out(fruit)
}

# While loop
set i = 0
while i < 5 {
    out(i)
    i = i + 1
}
```

---

## 🏛️ Classes
```wate
class Animal {
    # Any method named 'init' or any other name works as constructor
    init(name, sound) {
        this.name = name
        this.sound = sound
    }

    speak() {
        return f"{this.name} says {this.sound}"
    }
}

set dog = Animal("Dog", "Woof!")
out(dog.speak())
```

> **Note:** WATE uses `init()` as the conventional constructor method name.
> Call `Animal(...)` to create an instance — WATE auto-calls `init` on construction.

---

## 📁 File I/O
```wate
# Requires: --allow-read --allow-write
file.write("hello.txt", "Hello from WATE!")
set content = file.read("hello.txt")
out(content)
```

---

## 🌐 HTTP Requests
```wate
# Requires: --allow-net
set res = http.get("https://api.github.com")
out(res)
```

---

## 🧮 Math
```wate
out(math.sqrt(144))     # => 12
out(math.pow(2, 10))    # => 1024
out(math.abs(-42))      # => 42
out(math.round(3.7))    # => 4
out(math.max(1, 2, 3))  # => 3
```

---

## 📝 String Operations
```wate
set msg = "Hello, World!"
out(str.upper(msg))        # HELLO, WORLD!
out(str.lower(msg))        # hello, world!
out(str.length(msg))       # 13
out(str.replace(msg, "World", "WATE"))  # Hello, WATE!
out(str.contains(msg, "World"))  # True
out(str.split(msg, ", "))  # ["Hello", "World!"]
```

---

## 🛡️ Try-Catch
```wate
try {
    set data = file.read("missing.txt")
} catch(e) {
    out(f"Error caught: {e}")
}
```

---

## 🔄 Imports & Packages
```wate
import "db"
import "bot"
import "ai"

set db = Database("mydata.json")
set users = db.collection("users")
users.insert({ name: "Waseem", role: "creator" })
```

---

## 🧵 Multi-Thread Workers
```wate
# main.wate
set worker = thread.create("worker.wate")
worker.onMessage(fn(msg) {
    out(f"Worker replied: {msg}")
})
worker.postMessage("start")

# worker.wate
thread.onMessage(fn(msg) {
    thread.postMessage(f"Got your message: {msg}")
})
```

---

## ⚡ CLI Commands
```bash
wate hello.wate                  # Run a script
wate run app.wate --allow-net    # Run with network access
wate lint                        # Scan & lint all .wate scripts
wate lint script.wate            # Lint a specific script
wate lint --rules                # Show all built-in linter rules
wate test                        # Run all tests in tests/ folder
wate test tests/01_vars.wate     # Run a specific test
wate --watch server.wate -A      # Hot reload mode
wate help                        # Show full help
wate version                     # Show version
```

---

## 📊 Built-in Modules Summary

| Module    | Purpose                        | Example                      |
|-----------|-------------------------------|------------------------------|
| `out`     | Print to console               | `out("Hello")`               |
| `file`    | File read/write                | `file.read("f.txt")`         |
| `sys`     | OS / shell commands            | `sys.exec("ls")`             |
| `http`    | HTTP client & pooling          | `http.get("url")`            |
| `math`    | Math operations                | `math.sqrt(16)`              |
| `str`     | String utilities               | `str.upper("hi")`            |
| `json`    | JSON parse/stringify           | `json.parse("{}")`           |
| `date`    | Date & time                    | `date.now()`                 |
| `color`   | Terminal colors                | `color.green("ok")`          |
| `os`      | OS information                 | `os.platform()`              |
| `thread`  | Multi-thread workers & atomics | `thread.create("w.wate")`    |
| `assert`  | Test assertions                | `assert.equal(1, 1, "ok")`   |
| `list`    | List/array utilities           | `list.sort([3,1,2])`         |
| `crypto`  | AES, RSA, bcrypt, MD5, SHA256  | `crypto.aes.encrypt(t, key)` |
| `regex`   | Regular expressions            | `regex.test("[a-z]+", "hi")` |
| `wpath`   | File path utilities            | `wpath.join("a", "b")`       |
| `timer`   | setTimeout / setInterval       | `timer.sleep(1000)`          |
| `every`   | Interval scheduler             | `every("5s", fn() {...})`    |
| `ws`      | Native WebSockets              | `ws.createServer(8080)`      |
| `jwt`     | JSON Web Token auth            | `jwt.sign({ sub: 1 }, key)`  |
| `orm`     | Fluent Database ORM            | `orm.define("User")`         |
| `env`     | .env parsing & schema check    | `env.schema({...}).validate()`|
| `args`    | CLI flags & args parser        | `args.parse(argv, spec)`     |
| `logger`  | Structured logging (JSON/Text) | `logger.info("ready")`       |
| `xml`     | XML Parser & Serializer        | `xml.parse("<data/>")`       |
| `yaml`    | YAML Configuration engine      | `yaml.parse("key: val")`     |
| `img`     | Image processing pipeline      | `img.Pipeline("p.png")`      |
| `pdf`     | Programmatic PDF reports       | `pdf.Document().save("r.pdf")`|
| `i18n`    | Multi-language localization    | `i18n.t("welcome", {user})`  |

---

## 🏢 Phase 4: Enterprise Ecosystem Guide & Examples

### 1. WebSockets Server & Client (`ws`)
```wate
set server = ws.createServer(9898)
server.broadcast("Hello to all connected clients!")

set client = ws.connect("ws://localhost:9898")
client.on("open", fn() {
    client.send("Ping from WATE client")
})
```

### 2. JWT Authentication (`jwt`)
```wate
set secret = "enterprise-secret-key"
set token = jwt.sign({ user: "Waseem", role: "admin" }, secret, { expiresIn: "2h" })
set user = jwt.verify(token, secret)
out(f"Authenticated user: {user.user} with role {user.role}")
```

### 3. Advanced Crypto (`crypto`)
```wate
# AES-256 Symmetric Encryption
set enc = crypto.aes.encrypt("Secret Document", "passkey")
set dec = crypto.aes.decrypt(enc, "passkey")

# RSA Asymmetric Signature
set keypair = crypto.rsa.generateKeyPair(1024)
set signature = crypto.rsa.sign("Transaction #101", keypair.privateKey)
set isValid = crypto.rsa.verify("Transaction #101", signature, keypair.publicKey)

# bcrypt Password Hashing
set hashed = crypto.bcrypt.hash("UserSecretPass", 8)
set isMatch = crypto.bcrypt.compare("UserSecretPass", hashed)
```

### 4. Fluent ORM & Query Builder (`orm`)
```wate
set User = orm.define("User", {}, { tableName: "users" })
User.create({ name: "Waseem", role: "Lead", salary: 120000 })

set topUsers = User.query()
    .where("role", "Lead")
    .orderBy("salary", "DESC")
    .limit(5)
    .execute()
```

### 5. Schema-Validated Environment Variables (`env`)
```wate
set raw = file.read(".env")
set schema = env.schema({
    PORT: { type: "number", default: 3000 },
    DB_URL: { type: "string", required: true },
    SSL: { type: "boolean", default: false }
})
set config = schema.validate(env.parse(raw))
```

### 6. Structured Logger (`logger`)
```wate
logger.setLevel("debug")
logger.setFormat("json") # or "pretty"
logger.info("Payment processed", { orderId: 4421, amount: 250.0 })

set log = logger.create({ tag: "AuthService" })
log.warn("Invalid attempt detected")
```

### 7. XML & YAML Configurations (`xml`, `yaml`)
```wate
# YAML Config
set conf = yaml.parse(file.read("config.yaml"))
out(conf.server.port)

# XML Parsing
set tree = xml.parse("<manifest version='1.0'><name>WATE</name></manifest>")
out(tree.attributes.version)
```

### 8. Vector PDF Generation (`pdf`)
```wate
set doc = pdf.Document({ title: "Annual Report" })
doc.text("Quarterly Executive Summary", 50, 750, { size: 16 })
doc.line(50, 740, 550, 740)
doc.table(["ID", "Name", "Score"], [["1", "Alpha", "98"], ["2", "Beta", "95"]])
doc.save("annual_report.pdf")
```

### 9. Multi-Language Localization (`i18n`)
```wate
i18n.load("ur", {
    welcome: "Khushamdeed, {user}!",
    cart: { zero: "Tokri khali hai", one: "1 cheez", other: "{count} cheezein" }
})
i18n.setLocale("ur")
out(i18n.t("welcome", { user: "Waseem" }))
out(i18n.t("cart", { count: 3 })) # => 3 cheezein
```

---

## 🛠️ Phase 5: Developer Tooling, Testing & Distribution

### 1. Code Formatter (`wate fmt`)
Go-style automatic source code formatter enforcing consistent indentation, operator spacing, and clean braces.
```bash
wate fmt main.wate             # Format file in-place
wate fmt ./src                 # Format entire directory recursively
wate fmt main.wate --check     # Check formatting without modifying files (CI/CD exit code 1 if unformatted)
```

### 2. High-Precision Benchmarking Suite (`wate bench`)
Micro-benchmark runner with warm-up cycles, high-precision timing via `hrtime.bigint()`, operations/second, and latency percentiles (min, avg, p95).
```bash
wate bench app.wate            # Run benchmarks on file
```
Programmatic benchmark definition in `.wate`:
```wate
set benchMod = sys.require("./wate-bench.js")
set suite = benchMod.BenchmarkSuite("Cryptography Benchmark")
suite.add("SHA-256 Hashing", fn() {
    crypto.sha256("test data")
}, { warmup: 50, iterations: 1000 })
suite.run()
```

### 3. Application & Package Bundler (`wate bundle`)
Recursively inlines all local file imports and `wate_packages` dependencies into a single, standalone distribution file with duplicate elimination.
```bash
wate bundle src/app.wate -o dist/bundle.wate       # Bundle app into single file
wate bundle src/app.wate -o dist/bundle.wate --minify # Bundle and compress whitespace
```

### 4. Code Coverage Reporter (`wate test --coverage`)
Statement and branch coverage tracking with execution hit counters and colored terminal reports.
```bash
wate test --coverage -A                       # Run full test suite with coverage report
wate test tests/01_variables.wate --coverage  # Track coverage on a specific test file
```

### 5. Native Binaries Compiler (`wate compile --exe`)
Compiles WATE applications into standalone native 64-bit Windows executables (`.exe`) without needing external dependencies.
```bash
wate compile app.wate --exe -o app.exe        # Produce standalone native .exe
./app.exe                                    # Run binary directly
```

### 6. WPM Security & Vulnerability Auditor (`wpm audit`)
Static security scanner detecting malicious patterns, unsandboxed `sys.exec` calls, hardcoded secrets, and remote code injections in installed packages.
```bash
wpm audit                                     # Scan wate_packages for vulnerabilities
```

### 7. WPM Cloud Package Publisher (`wpm publish`)
Publishes packages to the centralized WPM Cloud Registry with SHA-256 integrity checksum generation and `wate.json` validation.
```bash
wpm publish                                   # Publish current package to registry
```

### 8. Interactive CLI Debugger & DAP Server (`wate debug`, `wate --dap`)
Step-over (`n`), step-into (`s`), breakpoint management, and variable scope inspection in terminal or VS Code / Cursor visual debugger.
```bash
wate debug app.wate                           # Interactive CLI debugger
wate --dap                                    # Visual Debug Adapter Protocol daemon
```

### 9. Documentation Portal & Web Playground (`wate doc`, `wate playground`)
Markdown & HTML documentation generator with live server, and browser playground with cloud snippet sharing.
```bash
wate doc --serve                              # Serve official documentation portal
wate playground                               # Open interactive Web Playground
```



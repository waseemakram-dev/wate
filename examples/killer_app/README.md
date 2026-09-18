# ⚡ WATE Killer App: Nexus Cloud Microservice & Real-Time API

A production-grade REST API and real-time streaming microservice implemented 100% in **WATE native syntax**. This application demonstrates how WATE's native standard library modules (`http`, `ws`, `orm`, `jwt`, `crypto`, `env`, `logger`) integrate seamlessly to power modern backend architectures.

---

## 🌟 Key Architectural Features

1. **Native HTTP REST API**:
   - Zero external npm dependencies — powered directly by WATE's built-in `http` module.
   - Built-in CORS preflight negotiation and JSON request/response streaming.
   - Dynamic route dispatcher for authentication, projects, incident response, and metrics.

2. **Real-Time WebSockets Engine (`ws`)**:
   - Companion real-time WebSocket server on port `8086`.
   - Broadcasts real-time events (`user_registered`, `project_created`, `incident_reported`, `system_ping`) to all connected clients.

3. **Cryptographic Defense (`crypto`)**:
   - Passwords hashed using industry-standard **bcrypt** (`crypto.bcrypt.hash` with 8 salt rounds).
   - Sensitive internal configs protected with **AES-256-CBC** symmetric encryption.

4. **Stateless JWT Authentication (`jwt`)**:
   - Issues signed JSON Web Tokens (HMAC-SHA256) upon login.
   - Validates Bearer tokens on protected CRUD routes (`POST /api/projects`, `POST /api/incidents`).

5. **Fluent ORM & Active Record (`orm`)**:
   - Type-safe, declarative schemas for `User`, `Project`, and `Incident` models.
   - Fluent query builder with SQL generation: `.where()`, `.orderBy("stars", "DESC")`, `.limit()`, and `.execute()`.

6. **Environment Schema Validator (`env`)**:
   - Validates configuration keys, sets strict types, and applies sensible defaults.

7. **Structured Logger (`logger`)**:
   - Configurable logging levels (`info`, `warn`, `error`, `debug`) with caller tagging (`NexusCore`, `AuditSecurity`).

---

## 🚀 Getting Started

### 1. Launch the Server

Run the microservice directly using the WATE CLI:

```bash
# Start server with full permissions
wate run -A examples/killer_app/nexus_api.wate

# Or using node:
node wate.js -A examples/killer_app/nexus_api.wate
```

Output:
```
================================================================
🚀 Nexus Cloud API is online on http://localhost:8085
⚡ Real-Time WebSocket server on ws://localhost:8086
================================================================
```

### 2. Run Automated End-to-End Tests

Verify the entire authentication cycle, database queries, WebSocket events, and REST endpoints:

```bash
wate run -A examples/killer_app/test_client.wate
```

---

## 📡 REST API Documentation

### Public Endpoints

#### `GET /health`
Returns system health, active module telemetry, and entity counts.

```bash
curl http://localhost:8085/health
```
```json
{
  "status": "healthy",
  "engine": "WATE Enterprise Engine v10.0.0",
  "name": "NexusCloud",
  "port": 8085,
  "wsPort": 8086,
  "features": ["REST", "WebSockets", "ORM", "JWT", "AES-256", "bcrypt"],
  "stats": { "totalUsers": 1, "totalProjects": 2, "totalIncidents": 0 }
}
```

#### `POST /api/auth/register`
Registers a new user and hashes password with bcrypt.

```bash
curl -X POST http://localhost:8085/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"sarah_dev","password":"MySecurePassword2026","role":"developer"}'
```

#### `POST /api/auth/login`
Authenticates credentials and returns a signed JWT token.

```bash
curl -X POST http://localhost:8085/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"nexus_admin","password":"AdminSecure2026!"}'
```
```json
{
  "message": "Authentication successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": "8h",
  "user": { "id": 1, "username": "nexus_admin", "role": "admin" }
}
```

#### `GET /api/projects`
Lists all active projects ordered by stars.

```bash
curl http://localhost:8085/api/projects
```

---

### Protected Endpoints (Bearer JWT Required)

#### `POST /api/projects`
Creates a new project and triggers real-time WebSocket broadcast.

```bash
curl -X POST http://localhost:8085/api/projects \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <YOUR_JWT_TOKEN>" \
  -d '{"name":"Hydra CDN","description":"Distributed edge caching","stars":240}'
```

#### `POST /api/incidents`
Reports an operational incident and emits an alert.

```bash
curl -X POST http://localhost:8085/api/incidents \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <YOUR_JWT_TOKEN>" \
  -d '{"title":"API Gateway Latency Spike","severity":"high"}'
```

---

## ⚡ WebSocket Telemetry (`ws://localhost:8086`)

Connect any standard WebSocket client or WATE client:

```wate
set client = ws.connect("ws://localhost:8086")
client.on("open", fn() {
    client.send(json.stringify({ type: "subscribe", channel: "telemetry" }))
})
client.on("message", fn(msg) {
    out("Received Real-time Event: " + msg)
})
```

---

## 🏆 Compilation to Standalone Native Binary

You can compile this entire Killer App into a single standalone `.exe` native binary with zero external dependencies:

```bash
wate compile examples/killer_app/nexus_api.wate --exe -o dist/nexus_api.exe
```

# Gutt Architecture

## Overview

Gutt is structured in **five distinct layers**. Each layer has a single responsibility and only communicates downward — commands → core → storage → utils.

```
CLI (src/index.js)
    │
    ▼
Commands (src/commands/*.js)
    │  I/O only. No business logic.
    ▼
Core Managers (src/core/*.js)
    │  Business logic. Orchestration.
    ▼
Storage (src/storage/*.js)           Analytics (src/analytics/*.js)
    │  Filesystem persistence.            Derived insights from history.
    ▼
Utils (src/utils/*.js)
    Pure functions. No side effects.
```

---

## Layer Responsibilities

### Utils (`src/utils/`)
Pure functions with no side effects or I/O beyond what they're explicitly given.

| File | Responsibility |
|------|---------------|
| `hashUtils.js` | SHA-1 hashing, short hash display |
| `fileUtils.js` | fs/promises wrappers, directory listing |
| `diffUtils.js` | Wraps the `diff` package with clean abstractions |
| `ignoreUtils.js` | `.guttignore` parsing, pattern matching, sensitive file detection |

### Storage (`src/storage/`)
Each class manages one type of stored object.

| File | Stores |
|------|--------|
| `BlobStorage.js` | Raw file content, addressed by SHA-1 hash. Deduplicates automatically. |
| `CommitStorage.js` | Commit objects (message, files, parent, branch, timestamp). |
| `RefStorage.js` | Named references: branch heads, HEAD pointer. |

### Core (`src/core/`)
Business logic and orchestration.

| File | Responsibility |
|------|---------------|
| `Repository.js` | Central context. Instantiates storage layers. Resolves paths. |
| `IndexManager.js` | Staging area. Read/write/stage/unstage operations. |
| `BranchManager.js` | Branch lifecycle: create, list, delete, current. |
| `CheckoutManager.js` | Restore working tree from a commit or checkpoint. |
| `CommitManager.js` | Commit pipeline: validate → build → store → advance ref → clear index. |

### Analytics (`src/analytics/`)
Derived insights — all computed from commit history, no external tracking.

| File | Produces |
|------|---------|
| `CommitSuggestionEngine.js` | Suggested commit messages from filename/diff heuristics. |
| `InsightsEngine.js` | Repository statistics: active files, days, velocity. |
| `HotspotAnalyzer.js` | File churn scores weighted by frequency × recency. |

### Commands (`src/commands/`)
One file per CLI command. Each function signature: `async (args..., repo) → void`.
Commands do I/O (chalk output) and delegate all logic to core/analytics.

---

## Object Storage Model

```
.gutt/
├── objects/
│   ├── blobs/
│   │   └── ab/                ← first 2 chars of SHA-1
│   │       └── cdef123...     ← remaining 38 chars → raw file content
│   └── commits/
│       └── <full-sha1>        ← JSON commit object
├── refs/
│   └── heads/
│       ├── main               ← contains a commit hash
│       └── feature-x          ← contains a commit hash
├── HEAD                       ← "ref: refs/heads/main"
├── index                      ← JSON array of staged entries
└── checkpoints                ← JSON array of checkpoint records
```

### Why blob splitting by 2 chars?
Filesystems slow down with thousands of files in one directory.
Splitting by the first 2 hex chars (256 possible values) distributes blobs
across up to 256 subdirectories — same as Git's loose object model.

### Why content-addressed storage?
The hash IS the address. Identical file content stored twice produces the same
hash → stored once. This is how Gutt's snapshot deduplication works without
any explicit tracking.

---

## Commit Object Schema

```json
{
  "message":   "Updated auth middleware",
  "timeStamp": "2024-01-15T14:30:00.000Z",
  "files": [
    { "path": "src/auth.js", "hash": "abc123..." },
    { "path": "src/server.js", "hash": "def456..." }
  ],
  "parent": "previous-commit-hash-or-null",
  "branch": "main"
}
```

The commit hash is derived from this JSON. Any change to any field → different hash → immutable history.

---

## Key Design Decisions

### 1. Dependency Injection via Repository
Every command receives a `Repository` instance. Commands don't construct
storage objects. This makes unit testing straightforward — inject mock storage.

### 2. Command Layer is I/O Only
No `if/else` business logic in command files. Logic lives in core managers.
Commands translate CLI args → function calls → chalk output.

### 3. Deduplication is Structural, Not Explicit
Because blobs are content-addressed, deduplication happens automatically.
Gutt detects it by checking `stored: false` from `BlobStorage.store()`.
No separate "skip unchanged files" logic needed.

### 4. Analytics Are Stateless
`InsightsEngine`, `HotspotAnalyzer`, and `CommitSuggestionEngine` are
pure-function classes — they receive data, return results, touch no filesystem.
Completely testable without mocking.

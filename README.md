Gutt — Developer-Friendly Version Control System

> A Git-inspired Version Control System focused on visualization, repository analytics, workflow clarity, and engineering-grade internals.

---

Why Gutt?

Git is powerful — but its internals are difficult to understand for many developers.

Gutt was built to explore how a modern VCS actually works internally while improving:

- repository visualization  
- branch workflow clarity  
- repository analytics  
- integrity validation  
- developer UX  

Unlike toy VCS projects, Gutt focuses on:

- real snapshot restoration  
- deduplicated blob storage  
- branch-safe checkout  
- repository health diagnostics  
- realistic engineering analytics  

---

Core Features

📦 Repository Core

```bash
gutt init
gutt add <file>
gutt commit "message"

OUTPUT Example:
✔ Repository initialized
✔ File staged: app.js
✔ Commit created: a1b2c3d

Features:

* Snapshot-based commits
*SHA-1 content addressing
*Deduplicated storage
* Binary-safe handlin

🌿 Branching & Checkout
gutt branch feature-auth
gutt checkout feature-auth

Output:

Switched to branch 'feature-auth'
HEAD now at commit d4e5f6a

Features:

* Safe branch switching
* Detached HEAD support
* Exact workspace restoration

🧠 Commit System
gutt log --oneline

Output:

d4e5f6a auth system
a1b2c3d initial commit

📊 Repository Analytics

1)🔥 Hotspot Analysis
gutt hotspots

Output:

auth.js      🔥🔥🔥
storage.js   🔥🔥

2)📈 Timeline
gutt timeline

Shows:

* commit frequency
* activity streaks
* repository growth


3)📉 Churn
gutt churn

Output:

auth.js   78%
core.js   55%


4)🛠 Repository Integrity
gutt doctor

Output:

✗ HEAD file missing
✗ Branch "main" invalid
⚠ Corrupted commit detected

Checks:

* HEAD integrity
* branch validity
* blob consistency


5)💾 Stash System
gutt stash "half-finished feature"
gutt stash list
gutt stash apply


🚀 Remote Operations
gutt push ../remote-repo
gutt clone ./remote-repo cloned-repo


Installation:

git clone <your-repo-url>
cd gutt
npm install
npm link

Now available globally:

gutt init



Command Reference:

gutt init
gutt add <file>
gutt commit "msg"
gutt status
gutt log
gutt branch <name>
gutt checkout <name>
gutt restore <commit>
gutt doctor
gutt visualize

Internal Architecture:

Component	              Responsibility
BlobStorage	              File content storage
CommitStorage	           Commit objects
RefStorage	              Branch & HEAD refs
IndexManager	           Staging area
CheckoutManager	        Working tree sync


Design Philosophy:

Gutt prioritizes:

* engineering realism
* modular architecture
* repository correctness
* transparent internals

over:

* shortcuts
* fake analytics
* oversimplified VCS logic
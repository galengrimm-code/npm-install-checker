# npm-install-checker

A Claude Code PreToolUse hook that automatically checks npm packages against the registry before installation and flags suspicious ones.

Built in response to the [axios supply chain attack](https://socket.dev/blog/axios-npm-package-compromised) on March 31, 2026.

## What it does

Every time Claude Code runs `npm install`, `npm i`, or `npm add` with new packages, this hook:

1. Queries the npm registry for each package
2. Runs safety checks
3. **If all checks pass** - installs silently, you see nothing
4. **If any check fails** - shows a report card and asks you to approve or deny

### Safety Checks

| Check | Flags when... |
|---|---|
| **Exists** | Package not found on registry (typo?) |
| **Weekly downloads** | Less than 1,000 downloads/week |
| **Package age** | Published less than 30 days ago |
| **Last publish** | Not updated in over 2 years (abandoned?) |
| **Maintainers** | Zero maintainers listed |
| **Dependencies** | More than 30 direct dependencies |
| **Install scripts** | Has `preinstall`, `install`, or `postinstall` scripts |
| **Deprecated** | Marked as deprecated on npm |
| **License** | No license specified |
| **Vulnerabilities** | Has known security advisories |
| **Typosquat** | Name is within 2 edits of a popular package |

### Example output

```
[npm-checker] Package "reacct" flagged:
  X Weekly downloads: 24 (threshold: 1,000)
  * Package age: 2442 days
  X Last publish: 3.9 years ago (threshold: 2 years)
  * Maintainers: 1
  * Dependencies: 0
  * Install scripts: None
  * Deprecated: No
  X License: No license specified
  X Typosquat: Similar to popular package "react"
```

## Install

```bash
git clone https://github.com/galengrimm-code/npm-install-checker.git
cd npm-install-checker
node install.js
```

Restart Claude Code for the hook to take effect.

## Update

```bash
cd npm-install-checker
git pull
node install.js
```

Restart Claude Code for changes to take effect.

## Uninstall

```bash
cd npm-install-checker
node uninstall.js
```

## How it works

- Runs as a `PreToolUse` hook on all `Bash` tool calls
- Only activates on `npm install`/`npm i`/`npm add` with package names
- Ignores bare `npm install` (existing deps), `npm ci`, local paths, URLs
- Handles command chaining (`&&`, `||`, `;`) correctly
- Queries the npm registry in parallel for speed
- **Fails open** - if the registry is unreachable, the install proceeds normally
- No external dependencies - uses only Node.js built-in modules

## Requirements

- [Claude Code](https://claude.ai/code) installed
- Node.js (comes with Claude Code)

## Customizing thresholds

Edit the thresholds at the top of `~/.claude/hooks/npm-install-checker.js`:

```js
const MIN_WEEKLY_DOWNLOADS = 1000;
const MIN_AGE_DAYS = 30;
const MAX_STALE_DAYS = 730; // 2 years
const MIN_MAINTAINERS = 1;
const MAX_DEPENDENCIES = 30;
```

## License

MIT

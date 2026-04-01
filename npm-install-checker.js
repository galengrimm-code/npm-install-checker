#!/usr/bin/env node
// npm-install-checker: PreToolUse hook that checks npm packages before installation
// Reads stdin JSON from Claude Code, checks packages against npm registry,
// returns "ask" if any package is flagged, silent exit 0 if clean.

const https = require('https');

// --- THRESHOLDS ---
const MIN_WEEKLY_DOWNLOADS = 1000;
const MIN_AGE_DAYS = 30;
const MAX_STALE_DAYS = 730; // 2 years
const MIN_MAINTAINERS = 1;
const MAX_DEPENDENCIES = 30;

// --- POPULAR PACKAGES (for typosquat detection, >= 4 chars only) ---
const POPULAR_PACKAGES = [
  'react', 'react-dom', 'next', 'express', 'lodash', 'axios', 'webpack',
  'moment', 'commander', 'chalk', 'debug', 'uuid', 'dotenv', 'cors',
  'body-parser', 'mongoose', 'typescript', 'eslint', 'prettier', 'jest',
  'mocha', 'chai', 'sinon', 'puppeteer', 'playwright', 'cypress',
  'tailwindcss', 'postcss', 'autoprefixer', 'vite', 'esbuild', 'rollup',
  'babel', 'nodemon', 'concurrently', 'rimraf', 'glob', 'minimist',
  'yargs', 'inquirer', 'ora', 'nanoid', 'date-fns', 'luxon', 'dayjs',
  'zod', 'ajv', 'jsonwebtoken', 'bcrypt', 'passport', 'helmet',
  'socket.io', 'redis', 'mysql2', 'sequelize', 'prisma',
  'drizzle-orm', 'supabase', 'firebase', 'aws-sdk', 'sharp', 'multer',
  'formidable', 'nodemailer', 'handlebars', 'marked', 'highlight.js',
  'three', 'chart.js', 'mapbox-gl', 'leaflet',
].filter(name => name.length >= 4);

// --- STDIN READING ---
function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch { resolve(null); }
    });
    setTimeout(() => resolve(null), 2000);
  });
}

// --- COMMAND PARSING ---

const BOOLEAN_FLAGS = new Set([
  '--save', '--save-dev', '--save-optional', '--save-peer', '--save-exact',
  '--save-bundle', '--no-save', '--global', '--legacy-peer-deps',
  '--force', '--prefer-offline', '--prefer-online', '--ignore-scripts',
  '--no-optional', '--no-audit', '--no-fund', '--dry-run',
  '--package-lock-only', '--foreground-scripts', '--verbose',
  '-D', '-O', '-E', '-P', '-g', '-f',
]);

const VALUE_FLAGS = new Set([
  '--registry', '--tag', '--cache', '--prefix', '--workspace', '-w',
]);

function parsePackageNames(command) {
  const segment = command.split(/\s*(?:&&|\|\||[;|])\s*/)[0];

  const match = segment.match(/^npm\s+(install|i|add)\b(.*)$/);
  if (!match) return [];

  const argsStr = match[2].trim();
  if (!argsStr) return [];

  const tokens = argsStr.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  const packages = [];
  let skipNext = false;

  for (let idx = 0; idx < tokens.length; idx++) {
    if (skipNext) { skipNext = false; continue; }
    const token = tokens[idx];

    if (token.startsWith('-')) {
      if (VALUE_FLAGS.has(token)) skipNext = true;
      continue;
    }

    if (token.startsWith('.') || token.startsWith('/') || token.includes('://') || token.endsWith('.tgz')) {
      continue;
    }

    let pkg = token;
    if (pkg.startsWith('@')) {
      const slashIdx = pkg.indexOf('/');
      if (slashIdx !== -1) {
        const afterSlash = pkg.slice(slashIdx + 1);
        const atIdx = afterSlash.indexOf('@');
        if (atIdx !== -1) {
          pkg = pkg.slice(0, slashIdx + 1 + atIdx);
        }
      }
    } else {
      const atIdx = pkg.indexOf('@');
      if (atIdx > 0) pkg = pkg.slice(0, atIdx);
    }

    packages.push(pkg);
  }

  return packages;
}

// --- HTTP HELPERS ---
function encodePackageName(name) {
  if (name.startsWith('@')) return '@' + encodeURIComponent(name.slice(1));
  return encodeURIComponent(name);
}

function fetchJSON(url, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
      if (res.statusCode === 404) { resolve(null); return; }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(null); });
  });
}

// --- TYPOSQUAT DETECTION ---
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function checkTyposquat(pkgName) {
  const name = pkgName.startsWith('@') ? pkgName.split('/')[1] || '' : pkgName;
  if (name.length < 4) return null;

  for (const popular of POPULAR_PACKAGES) {
    if (name === popular) return null;
    const dist = levenshtein(name, popular);
    if (dist <= 2) return popular;
  }
  return null;
}

// --- PACKAGE CHECKING ---
async function checkPackage(pkgName) {
  const results = [];

  const encoded = encodePackageName(pkgName);
  const [meta, downloads, audit] = await Promise.all([
    fetchJSON(`https://registry.npmjs.org/${encoded}`),
    fetchJSON(`https://api.npmjs.org/downloads/point/last-week/${encoded}`),
    fetchJSON(`https://registry.npmjs.org/-/npm/v1/security/advisories?package=${encoded}&perPage=5`),
  ]);

  if (!meta) {
    results.push({ check: 'Exists', pass: false, detail: 'Package not found on npm registry' });
    const similar = checkTyposquat(pkgName);
    if (similar) {
      results.push({ check: 'Typosquat', pass: false, detail: `Similar to popular package "${similar}"` });
    }
    return results;
  }

  const weeklyDl = downloads?.downloads ?? 0;
  results.push(weeklyDl >= MIN_WEEKLY_DOWNLOADS
    ? { check: 'Weekly downloads', pass: true, detail: `${weeklyDl.toLocaleString()}` }
    : { check: 'Weekly downloads', pass: false, detail: `${weeklyDl.toLocaleString()} (threshold: ${MIN_WEEKLY_DOWNLOADS.toLocaleString()})` }
  );

  const created = meta.time?.created ? new Date(meta.time.created) : null;
  if (created) {
    const ageDays = Math.floor((Date.now() - created.getTime()) / 86400000);
    results.push(ageDays >= MIN_AGE_DAYS
      ? { check: 'Package age', pass: true, detail: `${ageDays} days` }
      : { check: 'Package age', pass: false, detail: `First published ${ageDays} days ago (threshold: ${MIN_AGE_DAYS} days)` }
    );
  }

  const modified = meta.time?.modified ? new Date(meta.time.modified) : null;
  if (modified) {
    const staleDays = Math.floor((Date.now() - modified.getTime()) / 86400000);
    results.push(staleDays <= MAX_STALE_DAYS
      ? { check: 'Last publish', pass: true, detail: `${staleDays} days ago` }
      : { check: 'Last publish', pass: false, detail: `${(staleDays / 365).toFixed(1)} years ago (threshold: 2 years)` }
    );
  }

  const maintainerCount = (meta.maintainers || []).length;
  results.push(maintainerCount >= MIN_MAINTAINERS
    ? { check: 'Maintainers', pass: true, detail: `${maintainerCount}` }
    : { check: 'Maintainers', pass: false, detail: `${maintainerCount} (threshold: ${MIN_MAINTAINERS})` }
  );

  const latestTag = meta['dist-tags']?.latest;
  const latestVersion = latestTag ? meta.versions?.[latestTag] : null;

  if (latestVersion) {
    const depCount = Object.keys(latestVersion.dependencies || {}).length;
    results.push(depCount <= MAX_DEPENDENCIES
      ? { check: 'Dependencies', pass: true, detail: `${depCount}` }
      : { check: 'Dependencies', pass: false, detail: `${depCount} direct deps (threshold: ${MAX_DEPENDENCIES})` }
    );
  }

  if (latestVersion) {
    const dangerousScripts = ['preinstall', 'install', 'postinstall']
      .filter(s => latestVersion.scripts?.[s]);
    results.push(dangerousScripts.length === 0
      ? { check: 'Install scripts', pass: true, detail: 'None' }
      : { check: 'Install scripts', pass: false, detail: `Has ${dangerousScripts.join(', ')} script(s)` }
    );
  }

  // Deprecated
  if (latestVersion?.deprecated) {
    results.push({ check: 'Deprecated', pass: false, detail: latestVersion.deprecated });
  } else {
    results.push({ check: 'Deprecated', pass: true, detail: 'No' });
  }

  // License
  const license = latestVersion?.license || meta.license;
  if (!license) {
    results.push({ check: 'License', pass: false, detail: 'No license specified' });
  } else {
    results.push({ check: 'License', pass: true, detail: typeof license === 'string' ? license : license.type || 'Unknown' });
  }

  // Known vulnerabilities (npm advisories)
  const advisories = audit?.objects || audit?.advisories;
  if (advisories) {
    const count = Array.isArray(advisories) ? advisories.length : Object.keys(advisories).length;
    if (count > 0) {
      const severities = Array.isArray(advisories)
        ? advisories.map(a => a.severity || a.advisory?.severity).filter(Boolean)
        : Object.values(advisories).map(a => a.severity).filter(Boolean);
      const high = severities.filter(s => s === 'critical' || s === 'high').length;
      const detail = high > 0
        ? `${count} advisory(ies), ${high} high/critical severity`
        : `${count} advisory(ies)`;
      results.push({ check: 'Vulnerabilities', pass: false, detail });
    } else {
      results.push({ check: 'Vulnerabilities', pass: true, detail: 'No known advisories' });
    }
  }

  // Typosquat
  const similar = checkTyposquat(pkgName);
  if (similar) {
    results.push({ check: 'Typosquat', pass: false, detail: `Similar to popular package "${similar}"` });
  }

  return results;
}

// --- MAIN ---
async function main() {
  const input = await readStdin();
  if (!input) process.exit(0);

  const toolName = input.tool_name;
  const command = input.tool_input?.command || '';

  if (toolName !== 'Bash') process.exit(0);

  const packages = parsePackageNames(command);
  if (packages.length === 0) process.exit(0);

  const results = await Promise.all(
    packages.map(async (pkg) => ({ name: pkg, checks: await checkPackage(pkg) }))
  );

  const flagged = results.filter(r => r.checks.some(c => !c.pass));
  if (flagged.length === 0) process.exit(0);

  const lines = [];
  for (const { name, checks } of flagged) {
    lines.push(`[npm-checker] Package "${name}" flagged:`);
    for (const c of checks) {
      const marker = c.pass ? '*' : 'X';
      lines.push(`  ${marker} ${c.check}: ${c.detail}`);
    }
    lines.push('');
  }

  const report = lines.join('\n').trim();

  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: report,
    },
  };

  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

main().catch(() => process.exit(0));

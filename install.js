#!/usr/bin/env node
// Installer for npm-install-checker Claude Code hook
// Copies the hook file and registers it in settings.json
// Run again after `git pull` to update the hook file

const fs = require('fs');
const path = require('path');
const os = require('os');

const homeDir = os.homedir();
const claudeDir = path.join(homeDir, '.claude');
const hooksDir = path.join(claudeDir, 'hooks');
const settingsPath = path.join(claudeDir, 'settings.json');

const hookFileName = 'npm-install-checker.js';
const hookSource = path.join(__dirname, hookFileName);
const hookDest = path.join(hooksDir, hookFileName);

// Ensure directories exist
if (!fs.existsSync(claudeDir)) {
  console.error('Error: ~/.claude directory not found. Is Claude Code installed?');
  process.exit(1);
}

if (!fs.existsSync(hooksDir)) {
  fs.mkdirSync(hooksDir, { recursive: true });
}

// Check if this is an update
const isUpdate = fs.existsSync(hookDest);

// Copy hook file
fs.copyFileSync(hookSource, hookDest);
if (isUpdate) {
  console.log(`Updated ${hookFileName} in ${hooksDir}`);
} else {
  console.log(`Installed ${hookFileName} to ${hooksDir}`);
}

// Build the command path with forward slashes for cross-platform compatibility
const hookCommand = `node "${hookDest.replace(/\\/g, '/')}"`;

const hookEntry = {
  matcher: 'Bash',
  hooks: [
    {
      type: 'command',
      command: hookCommand,
      timeout: 15,
    },
  ],
};

// Read or create settings.json
let settings = {};
if (fs.existsSync(settingsPath)) {
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch {
    console.error('Error: Could not parse settings.json. Please fix it manually.');
    process.exit(1);
  }
}

// Ensure hooks.PreToolUse array exists
if (!settings.hooks) settings.hooks = {};
if (!Array.isArray(settings.hooks.PreToolUse)) settings.hooks.PreToolUse = [];

// Check if already registered
const alreadyRegistered = settings.hooks.PreToolUse.some(entry =>
  entry.hooks?.some(h => h.command?.includes('npm-install-checker'))
);

if (alreadyRegistered) {
  if (!isUpdate) console.log('Hook already registered in settings.json. Skipping.');
} else {
  settings.hooks.PreToolUse.push(hookEntry);
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  console.log('Registered hook in settings.json');
}

if (isUpdate) {
  console.log('\nnpm-install-checker updated successfully!');
} else {
  console.log('\nnpm-install-checker installed successfully!');
}
console.log('Restart Claude Code for changes to take effect.');

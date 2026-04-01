#!/usr/bin/env node
// Uninstaller for npm-install-checker Claude Code hook

const fs = require('fs');
const path = require('path');
const os = require('os');

const homeDir = os.homedir();
const claudeDir = path.join(homeDir, '.claude');
const hooksDir = path.join(claudeDir, 'hooks');
const settingsPath = path.join(claudeDir, 'settings.json');
const hookDest = path.join(hooksDir, 'npm-install-checker.js');

// Remove hook file
if (fs.existsSync(hookDest)) {
  fs.unlinkSync(hookDest);
  console.log(`Removed ${hookDest}`);
} else {
  console.log('Hook file not found (already removed?)');
}

// Remove from settings.json
if (fs.existsSync(settingsPath)) {
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

    if (settings.hooks?.PreToolUse) {
      const before = settings.hooks.PreToolUse.length;
      settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter(entry =>
        !entry.hooks?.some(h => h.command?.includes('npm-install-checker'))
      );
      const after = settings.hooks.PreToolUse.length;

      if (before !== after) {
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
        console.log('Removed hook from settings.json');
      } else {
        console.log('Hook not found in settings.json (already removed?)');
      }
    }
  } catch {
    console.error('Error: Could not parse settings.json');
  }
}

console.log('\nnpm-install-checker uninstalled successfully.');

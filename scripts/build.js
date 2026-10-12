#!/usr/bin/env node
/*───────────────────────────────────

Theme Build

────────────────────────────────────

Compiles src/scss/index.scss and writes theme.css with the license
header (src/header.css) on top and the Style Settings definitions
(src/style-settings.yaml) at the end.

Usage:
    npm run build      build once
    npm run dev        rebuild on every change in src/ and copy
                       theme.css + manifest.json to OBSIDIAN_PATH

OBSIDIAN_PATH comes from the environment or from .env (see .env.example).

────────────────────────────────────*/

const fs = require('fs');
const path = require('path');
const sass = require('sass');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'theme.css');

function build() {
    const { css } = sass.compile(path.join(SRC, 'scss/index.scss'), { style: 'expanded' });
    const header = fs.readFileSync(path.join(SRC, 'header.css'), 'utf8').trim();
    const settings = fs.readFileSync(path.join(SRC, 'style-settings.yaml'), 'utf8').trim();
    fs.writeFileSync(OUT, `${header}\n\n${css}\n\n/* @settings\n\n${settings}\n\n*/\n`);
}

function vaultPath() {
    let value = process.env.OBSIDIAN_PATH;
    const envFile = path.join(ROOT, '.env');
    if (!value && fs.existsSync(envFile)) {
        const line = fs.readFileSync(envFile, 'utf8').split('\n').find(l => /^\s*OBSIDIAN_PATH\s*=/.test(l));
        if (line) value = line.replace(/^\s*OBSIDIAN_PATH\s*=\s*/, '').trim().replace(/^(['"])(.*)\1$/, '$2');
    }
    if (!value) return null;
    return value.startsWith('~') ? path.join(process.env.HOME || '', value.slice(1)) : path.resolve(value);
}

function copyToVault(dir) {
    fs.mkdirSync(dir, { recursive: true });
    for (const file of ['theme.css', 'manifest.json']) fs.copyFileSync(path.join(ROOT, file), path.join(dir, file));
}

function run(dir) {
    try {
        build();
        if (dir) copyToVault(dir);
        console.log(`${new Date().toLocaleTimeString()} built theme.css${dir ? ` → ${dir}` : ''}`);
    } catch (err) {
        console.error(err.message || err);
        if (!watching) process.exitCode = 1;
    }
}

const watching = process.argv.includes('--watch');
if (!watching) {
    run(null);
} else {
    const dir = vaultPath();
    if (!dir) console.warn('OBSIDIAN_PATH is not set, so theme.css is only built here');
    run(dir);
    let timer = null;
    fs.watch(SRC, { recursive: true }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => run(dir), 100);
    });
    console.log(`Watching ${path.relative(ROOT, SRC)}/ for changes...`);
}

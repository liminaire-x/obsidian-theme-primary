#!/usr/bin/env node
/*───────────────────────────────────

Selector Audit

────────────────────────────────────

Finds theme selectors and CSS variables that a newer Obsidian
version no longer has, by comparing two official Obsidian builds
(a baseline the theme is known to work with, and a target).

It downloads each app build from obsidianmd/obsidian-releases,
reads app.css / app.js from it, and checks every class, icon,
attribute value and CSS variable the compiled theme
(src/css/main.css) refers to.

Usage:
    npm run audit:selectors
    npm run audit:selectors -- --to 1.14.4 --from 1.6.7
    npm run audit:selectors -- --verbose --json report.json

Settings (baseline version, community plugins, accepted findings)
live in scripts/audit-selectors.config.json.
Downloads are cached in .cache/audit.

Exit code is 1 when "Removed in Obsidian" or "Missing from community
plugin" has findings that are not ignored, and 2 on errors.

────────────────────────────────────*/

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const asar = require('@electron/asar');
const postcss = require('postcss');
const selectorParser = require('postcss-selector-parser');

const ROOT = path.resolve(__dirname, '..');
const CACHE = path.join(ROOT, '.cache', 'audit');
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'audit-selectors.config.json'), 'utf8'));
const THEME_CSS = path.join(ROOT, 'src/css/main.css');
const STYLE_SETTINGS = path.join(ROOT, 'src/css/style-settings.css');

// Obsidian builds some class names from templates, e.g. "mod-{side}-split"
const TEMPLATE_VALUES = { side: ['left', 'right', 'primary', 'secondary'] };

function parseArgs(argv) {
    const args = { from: CONFIG.baseline, to: 'latest', verbose: false, json: null };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--from') args.from = argv[++i];
        else if (a === '--to') args.to = argv[++i];
        else if (a === '--json') args.json = argv[++i];
        else if (a === '--verbose' || a === '-v') args.verbose = true;
        else if (a === '--help' || a === '-h') {
            console.log('Usage: audit-selectors [--from <version>] [--to <version|latest>] [--verbose] [--json <file>]');
            process.exit(0);
        } else throw new Error(`Unknown argument: ${a}`);
    }
    return args;
}

/*  Downloads  */

async function download(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
    return Buffer.from(await res.arrayBuffer());
}

function walk(dir, exts, acc = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, exts, acc);
        else if (exts.some(x => p.endsWith(x))) acc.push(p);
    }
    return acc;
}

async function latestObsidianVersion() {
    const url = 'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/desktop-releases.json';
    return JSON.parse((await download(url)).toString('utf8')).latestVersion;
}

// Returns { css: [text], js: [text] } for an Obsidian app version
async function loadObsidian(version) {
    const dir = path.join(CACHE, 'obsidian', version);
    const done = path.join(dir, '.done');
    if (!fs.existsSync(done)) {
        console.error(`Downloading Obsidian ${version}...`);
        const url = `https://github.com/obsidianmd/obsidian-releases/releases/download/v${version}/obsidian-${version}.asar.gz`;
        const archive = path.join(CACHE, `obsidian-${version}.asar`);
        fs.mkdirSync(CACHE, { recursive: true });
        fs.writeFileSync(archive, zlib.gunzipSync(await download(url)));
        fs.rmSync(dir, { recursive: true, force: true });
        asar.extractAll(archive, dir);
        fs.rmSync(archive);
        // Keep only what the audit reads
        for (const f of walk(dir, [''])) {
            if (!f.endsWith('.css') && !f.endsWith('.js')) fs.rmSync(f);
        }
        fs.writeFileSync(done, '');
    }
    return {
        css: walk(dir, ['.css']).map(f => fs.readFileSync(f, 'utf8')),
        js: walk(dir, ['.js']).map(f => fs.readFileSync(f, 'utf8')),
    };
}

async function loadPlugin(plugin) {
    const base = plugin.tag === 'latest'
        ? `https://github.com/${plugin.repo}/releases/latest/download`
        : `https://github.com/${plugin.repo}/releases/download/${plugin.tag}`;
    const texts = [];
    for (const file of ['main.js', 'styles.css']) {
        try {
            texts.push((await download(`${base}/${file}`)).toString('utf8'));
        } catch (e) {
            if (file === 'main.js') throw e; // styles.css is optional
        }
    }
    return { ...plugin, text: texts.join('\n') };
}

/*  Indexing  */

// Source location of a node in the SCSS sources (needs a source map), e.g. src/scss/_x.scss:12
function origin(node) {
    const { input, start } = node.source || {};
    const o = input && start && input.origin(start.line, start.column);
    return o && o.file ? `${path.relative(ROOT, o.file)}:${o.line}` : null;
}

function scanCss(text, onSelector, parseOptions) {
    const out = { classes: new Set(), attrs: new Set(), varsDefined: new Set(), varsUsed: new Set(), varLocations: new Map() };
    const root = postcss.parse(text, parseOptions);
    root.walkRules(rule => {
        try {
            selectorParser(selectors => {
                selectors.each(sel => {
                    const found = { text: sel.toString().trim(), classes: [], attrs: [], rule };
                    sel.walk(node => {
                        if (node.type === 'class') {
                            out.classes.add(node.value);
                            found.classes.push(node.value);
                        } else if (node.type === 'attribute' && node.value) {
                            const key = `${node.attribute}=${node.value.replace(/^["']|["']$/g, '')}`;
                            out.attrs.add(key);
                            found.attrs.push(key);
                        }
                    });
                    if (onSelector) onSelector(found);
                });
            }).processSync(rule.selector);
        } catch (e) {
            // Selectors postcss-selector-parser can't read are skipped
        }
    });
    root.walkDecls(decl => {
        const names = decl.prop.startsWith('--') ? [decl.prop] : [];
        if (names.length) out.varsDefined.add(decl.prop);
        for (const m of decl.value.matchAll(/var\(\s*(--[\w-]+)/g)) { out.varsUsed.add(m[1]); names.push(m[1]); }
        if (parseOptions) for (const v of names) addTo(out.varLocations, v, decl);
    });
    return out;
}

function indexApp(app) {
    const css = { classes: new Set(), attrs: new Set(), vars: new Set() };
    for (const text of app.css) {
        const s = scanCss(text);
        s.classes.forEach(c => css.classes.add(c));
        s.attrs.forEach(a => css.attrs.add(a));
        s.varsDefined.forEach(v => css.vars.add(v));
        s.varsUsed.forEach(v => css.vars.add(v));
    }
    const js = app.js.join('\n');
    const tokens = new Set(js.match(/-{0,2}[A-Za-z_][\w-]*/g));
    for (const m of js.matchAll(/["'`]([\w-]*\{(\w+)\}[\w-]*)["'`]/g)) {
        for (const value of TEMPLATE_VALUES[m[2]] || []) tokens.add(m[1].replace(`{${m[2]}}`, value));
    }
    return { css, js, tokens };
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function hasClass(app, cls) {
    if (cls.startsWith('lucide-')) {
        // Icons are looked up by name in Obsidian's icon table, e.g. "check-circle-2":[[...
        const name = escapeRe(cls.slice('lucide-'.length));
        return app.tokens.has(cls) || new RegExp(`(^|[{,])"?${name}"?:\\s*[\\["']`).test(app.js);
    }
    return app.css.classes.has(cls) || app.tokens.has(cls);
}
const hasAttr = (app, attr) => app.css.attrs.has(attr) || app.js.includes(attr.slice(attr.indexOf('=') + 1));
const hasVar = (app, v) => app.css.vars.has(v) || app.tokens.has(v);

// Classes the theme adds itself through Style Settings (class-toggle ids and class-select values)
function themeOwnedClasses() {
    const owned = new Set();
    const lines = fs.readFileSync(STYLE_SETTINGS, 'utf8').split('\n');
    lines.forEach((line, i) => {
        const id = line.match(/^\s*-?\s*id:\s*(\S+)/);
        if (id && /type:\s*class-(toggle|select)/.test(lines[i + 1] || '')) owned.add(id[1]);
        const value = line.match(/^\s*-?\s*value:\s*(\S+)/);
        if (value) owned.add(value[1]);
    });
    return owned;
}

function pluginFor(plugins, cls) {
    return plugins.find(p => p.text.includes(cls)
        || (p.classPrefix && cls.startsWith(p.classPrefix)
            && new RegExp(`["'\`]${escapeRe(cls.slice(p.classPrefix.length))}["'\` ]`).test(p.text)));
}

const addTo = (map, key, value) => (map.get(key) || map.set(key, new Set()).get(key)).add(value);

/*  Audit  */

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.to === 'latest') args.to = await latestObsidianVersion();

    const [base, target] = (await Promise.all([loadObsidian(args.from), loadObsidian(args.to)])).map(indexApp);
    const plugins = await Promise.all(CONFIG.plugins.map(loadPlugin));
    const owned = themeOwnedClasses();
    const ignored = new Map(CONFIG.ignore.map(i => [i.name, i.reason]));

    const classUse = new Map(); // class -> selectors
    const attrUse = new Map();
    const nodesByName = new Map(); // class/attr -> rules, for SCSS locations
    const theme = scanCss(fs.readFileSync(THEME_CSS, 'utf8'), found => {
        found.classes.forEach(c => { addTo(classUse, c, found.text); addTo(nodesByName, c, found.rule); });
        found.attrs.forEach(a => { addTo(attrUse, a, found.text); addTo(nodesByName, a, found.rule); });
    }, { from: THEME_CSS, map: { prev: fs.readFileSync(`${THEME_CSS}.map`, 'utf8') } });
    theme.varLocations.forEach((nodes, v) => nodesByName.set(v, nodes));

    const report = { from: args.from, to: args.to, removed: [], pluginMissing: [], unstyled: [], unknown: [], ignored: [] };
    const push = (bucket, item) => {
        if (ignored.has(item.name)) report.ignored.push({ ...item, reason: ignored.get(item.name) });
        else report[bucket].push(item);
    };

    for (const [cls, sels] of [...classUse].sort()) {
        if (owned.has(cls)) continue;
        const item = { kind: cls.startsWith('lucide-') ? 'icon' : 'class', name: cls, selectors: [...sels] };
        if (hasClass(target, cls)) {
            if (base.css.classes.has(cls) && !target.css.classes.has(cls)) push('unstyled', item);
            continue;
        }
        if (pluginFor(plugins, cls)) continue;
        const pluginOwner = plugins.find(p => p.classPrefix && cls.startsWith(p.classPrefix));
        if (pluginOwner) push('pluginMissing', { ...item, plugin: pluginOwner.name });
        else push(hasClass(base, cls) ? 'removed' : 'unknown', item);
    }

    for (const [attr, sels] of [...attrUse].sort()) {
        if (hasAttr(base, attr) && !hasAttr(target, attr)) push('removed', { kind: 'attribute', name: attr, selectors: [...sels] });
    }

    for (const v of [...theme.varsDefined].sort()) {
        // An override the theme sets but Obsidian no longer reads (the theme's own variables are fine)
        if (!theme.varsUsed.has(v) && hasVar(base, v) && !hasVar(target, v)) push('removed', { kind: 'variable (set)', name: v });
    }
    for (const v of [...theme.varsUsed].sort()) {
        // A variable the theme reads but neither it nor Obsidian defines anymore
        if (!theme.varsDefined.has(v) && hasVar(base, v) && !hasVar(target, v)) push('removed', { kind: 'variable (used)', name: v });
    }

    for (const bucket of ['removed', 'pluginMissing', 'unstyled', 'unknown', 'ignored']) {
        for (const item of report[bucket]) {
            const locations = new Set([...(nodesByName.get(item.name) || [])].map(origin).filter(Boolean));
            item.locations = [...locations].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        }
    }

    print(report, plugins, args.verbose);
    if (args.json) fs.writeFileSync(args.json, JSON.stringify(report, null, 2));
    process.exitCode = report.removed.length + report.pluginMissing.length > 0 ? 1 : 0;
}

function print(report, plugins, verbose) {
    const section = (title, items, note, full = true) => {
        console.log(`\n■ ${title} (${items.length})`);
        if (note) console.log(`  ${note}`);
        if (!items.length) return;
        if (!full) { console.log('  (run with --verbose to list)'); return; }
        for (const item of items) {
            console.log(`  - ${item.kind}: ${item.name}${item.plugin ? ` [${item.plugin}]` : ''}`);
            if (item.reason) console.log(`      reason: ${item.reason}`);
            for (const loc of (item.locations || []).slice(0, 3)) console.log(`      ${loc}`);
            if (item.locations && item.locations.length > 3) console.log(`      ... ${item.locations.length - 3} more`);
            if (verbose) for (const s of (item.selectors || []).slice(0, 3)) console.log(`      selector: ${s}`);
        }
    };

    console.log(`Selector audit: Obsidian ${report.from} → ${report.to}`);
    console.log(`Plugins: ${plugins.map(p => `${p.name} (${p.tag})`).join(', ')}`);
    section('Removed in Obsidian', report.removed,
        `Present in ${report.from}, gone in ${report.to}: rules using these no longer apply.`);
    section('Missing from community plugin', report.pluginMissing,
        'Plugin-prefixed classes the current plugin release no longer has.');
    section('No longer styled by Obsidian', report.unstyled,
        'Still in the DOM, but Obsidian stopped styling them, so the theme may now be the only style.', verbose);
    section('Not found in either version', report.unknown,
        'Usually dynamic names, user content (callouts, task markers) or selectors that were already dead.', verbose);
    section('Ignored', report.ignored, 'Accepted in scripts/audit-selectors.config.json.', verbose);
}

main().catch(err => {
    console.error(err.message || err);
    process.exitCode = 2;
});

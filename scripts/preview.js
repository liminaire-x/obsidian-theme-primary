#!/usr/bin/env node
/*───────────────────────────────────

Theme Preview

────────────────────────────────────

Runs the real Obsidian app with this theme on a sample vault and saves
a screenshot, so changes can be checked without installing anything in
your own vault.

The first run downloads Obsidian (from obsidianmd/obsidian-releases)
and Electron, @electron/remote and playwright-core into .cache/preview.
On Linux without a display it re-runs itself under xvfb-run.

Usage:
    npm run preview -- [options]

Options:
    --out <file.png>      where to save (default .cache/preview/preview.png)
    --dark                dark mode
    --mobile              Obsidian's mobile emulation (tablet at the default size)
    --width <px>          window width (default 1300)
    --height <px>         window height (default 820)
    --open <path>         note to open (default Welcome.md)
    --snippet <file.css>  enable a CSS snippet, e.g. a font snippet (repeatable)
    --class <a,b>         extra body classes, e.g. ribbon-slideout,sb-style-floating
    --no-defaults         don't add the Style Settings classes that default to on
    --no-theme            use Obsidian's default theme, for comparison
    --hover <selector>    move the mouse over the first matching element
    --click <selector>    click the first matching element with the mouse
                          (--hover and --click run in order, before --eval)
    --eval <code>         JavaScript to run in Obsidian before the screenshot;
                          its result is printed
    --obsidian <version>  Obsidian version (default: latest release)

Style Settings classes that default to on (folder colors, icons, ...) are
added to <body> the way the plugin would, without installing it.

────────────────────────────────────*/

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync, spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CACHE = path.join(ROOT, '.cache', 'preview');
const TOOLS_DIR = path.join(CACHE, 'tools');
// Versions known to run Obsidian 1.14 this way
const TOOLS = { electron: '37.10.3', '@electron/remote': '2.1.3', 'playwright-core': '1.56.1' };
const THEME_NAME = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).name;

function parseArgs(argv) {
    const args = { out: path.join(CACHE, 'preview.png'), width: 1300, height: 820, open: 'Welcome.md',
        snippets: [], classes: [], defaults: true, theme: true, actions: [], dark: false, mobile: false, evaluate: null,
        obsidian: 'latest' };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const next = () => argv[++i];
        if (a === '--out') args.out = path.resolve(next());
        else if (a === '--dark') args.dark = true;
        else if (a === '--mobile') args.mobile = true;
        else if (a === '--width') args.width = Number(next());
        else if (a === '--height') args.height = Number(next());
        else if (a === '--open') args.open = next();
        else if (a === '--snippet') args.snippets.push(path.resolve(next()));
        else if (a === '--class') args.classes.push(...next().split(',').filter(Boolean));
        else if (a === '--no-defaults') args.defaults = false;
        else if (a === '--no-theme') args.theme = false;
        else if (a === '--hover' || a === '--click') args.actions.push([a.slice(2), next()]);
        else if (a === '--eval') args.evaluate = next();
        else if (a === '--obsidian') args.obsidian = next();
        else if (a === '--help' || a === '-h') {
            console.log(fs.readFileSync(__filename, 'utf8').match(/Usage:[\s\S]*?(?=\n\nStyle Settings)/)[0]);
            process.exit(0);
        } else throw new Error(`Unknown argument: ${a}`);
    }
    return args;
}

/*  Setup  */

async function download(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
    return Buffer.from(await res.arrayBuffer());
}

function ensureTools() {
    const ok = Object.entries(TOOLS).every(([name, version]) => {
        const pkg = path.join(TOOLS_DIR, 'node_modules', name, 'package.json');
        return fs.existsSync(pkg) && JSON.parse(fs.readFileSync(pkg, 'utf8')).version === version;
    });
    if (ok) return;
    console.error('Installing Electron and helpers into .cache/preview (first run only)...');
    fs.mkdirSync(TOOLS_DIR, { recursive: true });
    fs.writeFileSync(path.join(TOOLS_DIR, 'package.json'), '{ "private": true }\n');
    const specs = Object.entries(TOOLS).map(([name, version]) => `${name}@${version}`);
    execFileSync('npm', ['install', '--no-save', '--no-package-lock', '--no-audit', '--no-fund', ...specs],
        { cwd: TOOLS_DIR, stdio: 'inherit' });
}

async function ensureObsidian(version) {
    if (version === 'latest') {
        const url = 'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/desktop-releases.json';
        version = JSON.parse((await download(url)).toString('utf8')).latestVersion;
    }
    const dir = path.join(CACHE, `obsidian-${version}`);
    if (!fs.existsSync(path.join(dir, '.done'))) {
        console.error(`Downloading Obsidian ${version}...`);
        const asar = require('@electron/asar');
        const archive = path.join(CACHE, `obsidian-${version}.asar`);
        const url = `https://github.com/obsidianmd/obsidian-releases/releases/download/v${version}/obsidian-${version}.asar.gz`;
        fs.writeFileSync(archive, zlib.gunzipSync(await download(url)));
        fs.rmSync(dir, { recursive: true, force: true });
        asar.extractAll(archive, dir);
        fs.rmSync(archive);
        // The installer normally boots this bundle: it registers app:// and enables
        // @electron/remote before handing over to main.js
        fs.writeFileSync(path.join(dir, 'boot.js'), [
            "const { EventEmitter } = require('events');",
            "const { app, protocol } = require('electron');",
            "protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, bypassCSP: true } }]);",
            "const remoteMain = require('@electron/remote/main');",
            'remoteMain.initialize();',
            "app.on('web-contents-created', (_e, wc) => remoteMain.enable(wc));",
            "require('./main.js')(__dirname, new EventEmitter());",
            '',
        ].join('\n'));
        const pkgFile = path.join(dir, 'package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
        pkg.main = 'boot.js';
        delete pkg.dependencies;
        fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));
        fs.writeFileSync(path.join(dir, '.done'), '');
    }
    const modules = path.join(dir, 'node_modules');
    if (!fs.existsSync(modules)) fs.symlinkSync(path.join(TOOLS_DIR, 'node_modules'), modules, 'dir');
    return { dir, version };
}

const SAMPLE = {
    'Welcome.md': [
        '# Welcome', '',
        'The quick brown fox — “quotes”, 0123456789. Some **bold**, *italic* and `code`.', '',
        '한글 문장과 **굵은 한글**을 함께 확인합니다.', '',
        '- [ ] task', '- [x] done', '',
        '> [!note] Callout', '> With some text.', '',
        '```js', 'const answer = 42;', '```', '',
    ].join('\n'),
    'Highlights.md': [
        '# Highlights', '',
        'Plain ==highlight== and colored: ==🔴red==, ==🟠choose not to[^1]==, ==🟡yellow==,',
        '==🟢green==, ==🔵blue==, ==🟣purple==. **==Bold highlight==** and *==italic highlight==*.', '',
        '[^1]: A footnote.', '',
    ].join('\n'),
    'Projects/Alpha/Plan.md': '# Plan\n',
    'Projects/Archive/Old.md': '# Old\n',
    'Projects/Tasks.base': 'views:\n  - type: table\n    name: Table\n',
    'Journal/2026-01-01.md': '# Day\n',
    'Archive/Board.canvas': '{}\n',
};

// Classes Style Settings would add by default: class-toggles with default: true
// and the default option of each class-select
function defaultClasses() {
    const yaml = fs.readFileSync(path.join(ROOT, 'src/style-settings.yaml'), 'utf8');
    const classes = [];
    for (const block of yaml.split(/\n\s*- id:/).slice(1)) {
        const id = (block.match(/^\s*['"]?([^'"\s]+)/) || [])[1];
        const type = (block.match(/\n\s*type:\s*['"]?([\w-]+)/) || [])[1];
        const def = (block.match(/\n\s*default:\s*['"]?([^'"\n]+)/) || [])[1];
        if (type === 'class-toggle' && def === 'true') classes.push(id);
        if (type === 'class-select' && def) classes.push(def);
    }
    return classes;
}

function prepareVault(args) {
    const vault = path.join(CACHE, 'vault');
    for (const [file, text] of Object.entries(SAMPLE)) {
        fs.mkdirSync(path.dirname(path.join(vault, file)), { recursive: true });
        fs.writeFileSync(path.join(vault, file), text);
    }
    const config = path.join(vault, '.obsidian');
    // Start from a fresh layout every run (open tabs, reading/editing mode)
    fs.rmSync(path.join(config, 'workspace.json'), { force: true });
    const themeDir = path.join(config, 'themes', THEME_NAME);
    fs.mkdirSync(themeDir, { recursive: true });
    for (const file of ['theme.css', 'manifest.json']) fs.copyFileSync(path.join(ROOT, file), path.join(themeDir, file));

    const snippetDir = path.join(config, 'snippets');
    fs.rmSync(snippetDir, { recursive: true, force: true });
    fs.mkdirSync(snippetDir, { recursive: true });
    const enabled = args.snippets.map((file, i) => {
        const name = `${i}-${path.basename(file, '.css')}`;
        fs.copyFileSync(file, path.join(snippetDir, `${name}.css`));
        return name;
    });
    fs.writeFileSync(path.join(config, 'appearance.json'), JSON.stringify({
        cssTheme: args.theme ? THEME_NAME : '', theme: args.dark ? 'obsidian' : 'moonstone', enabledCssSnippets: enabled,
    }, null, 2));

    const userData = path.join(CACHE, 'userdata');
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(path.join(userData, 'obsidian.json'),
        JSON.stringify({ vaults: { preview0000000001: { path: vault, ts: Date.now(), open: true } } }));
    return userData;
}

/*  Run  */

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function workspacePage(browser) {
    for (let i = 0; i < 120; i++) {
        for (const ctx of browser.contexts()) for (const page of ctx.pages()) {
            const ready = await page.evaluate(() => !!(window.app && window.app.workspace && window.app.workspace.layoutReady))
                .catch(() => false);
            if (ready) return page;
        }
        await sleep(500);
    }
    throw new Error('Obsidian did not open the vault');
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    ensureTools();
    const { dir: appDir, version } = await ensureObsidian(args.obsidian);
    const userData = prepareVault(args);
    const { chromium } = require(path.join(TOOLS_DIR, 'node_modules/playwright-core'));

    const port = 9300 + Math.floor(Math.random() * 600);
    const electron = require(path.join(TOOLS_DIR, 'node_modules/electron'));
    const proc = spawn(electron, ['--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`,
        `--user-data-dir=${userData}`, appDir], { stdio: 'ignore' });
    let browser = null;
    try {
        for (let i = 0; i < 60 && !browser; i++) {
            await sleep(500);
            browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null);
        }
        if (!browser) throw new Error('Could not connect to Obsidian');
        let page = await workspacePage(browser);

        // Mobile emulation reloads the window and is remembered between runs
        if (await page.evaluate(() => !!window.app.isMobile) !== args.mobile) {
            await page.evaluate(on => window.app.emulateMobile(on), args.mobile).catch(() => {});
            await sleep(2000);
            page = await workspacePage(browser);
        }
        await page.setViewportSize({ width: args.width, height: args.height });

        const classes = [...(args.theme && args.defaults ? defaultClasses() : []), ...args.classes];
        await page.evaluate(async ({ classes, note }) => {
            document.body.classList.add(...classes);
            await window.app.workspace.openLinkText(note.replace(/\.md$/, ''), '', false, { state: { mode: 'source' } });
            document.querySelectorAll('.nav-folder.is-collapsed > .nav-folder-title').forEach(el => el.click());
            await document.fonts.ready;
        }, { classes, note: args.open });
        await sleep(1500);

        for (const [action, selector] of args.actions) {
            await page[action](selector, { timeout: 5000 });
            await sleep(700);
        }

        if (args.evaluate) {
            const result = await page.evaluate(args.evaluate);
            if (result !== undefined) console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
            await sleep(800);
        }
        fs.mkdirSync(path.dirname(args.out), { recursive: true });
        await page.screenshot({ path: args.out });
        console.log(`Obsidian ${version}: saved ${path.relative(process.cwd(), args.out)}`);
    } finally {
        if (browser) await browser.close().catch(() => {});
        proc.kill('SIGKILL');
    }
}

// Electron needs a display; use a virtual one when there is none
if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.PREVIEW_XVFB) {
    const xvfb = spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1920x1200x24', process.execPath, __filename, ...process.argv.slice(2)],
        { stdio: 'inherit', env: { ...process.env, PREVIEW_XVFB: '1' } });
    if (xvfb.error) {
        console.error('No display found and xvfb-run is not installed');
        process.exitCode = 2;
    } else {
        process.exitCode = xvfb.status;
    }
} else {
    main().catch(err => {
        console.error(err.message || err);
        process.exitCode = 1;
    });
}

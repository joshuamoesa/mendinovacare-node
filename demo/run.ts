import cfonts from 'cfonts';
import chalk from 'chalk';
import ora from 'ora';
import { select, confirm } from '@inquirer/prompts';
import open from 'open';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const args = process.argv.slice(2);
const isFast = args.includes('--fast');
const isReal = args.includes('--real');
const isHelp = args.includes('--help');

// ─── Retro phosphor green ──────────────────────────────────────────────────
const G = chalk.hex('#00FF41');
const W = 74; // section box width

if (isHelp) {
  console.log(`Usage: npm run demo [-- <flags>]

Flags:
  --help    Show this help message
  --fast    Skip all delays (useful for testing)
  --real    Run the actual Mendix SDK conversion (requires MENDIX_PAT)

Default (no flags): simulate a full conversion with realistic timing (~60s)
`);
  process.exit(0);
}

const sleep = (ms: number): Promise<void> =>
  isFast ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

// ─── TUI primitives ────────────────────────────────────────────────────────

/** ── Section Title (plain dashes, no corners) ─────── */
function sectionBar(title?: string): void {
  if (!title) {
    console.log(G('─'.repeat(W)));
    return;
  }
  const t = ` ${title} `;
  const left = Math.floor((W - t.length) / 2);
  const right = W - left - t.length;
  console.log(G('─'.repeat(left)) + G.bold(t) + G('─'.repeat(right)));
}

/** ┌── Title ──┐  top border with corners */
function boxTop(title: string): void {
  const inner = W - 2;
  const t = ` ${title} `;
  const left = Math.floor((inner - t.length) / 2);
  const right = inner - left - t.length;
  console.log(G('┌') + G('─'.repeat(left)) + G.bold(t) + G('─'.repeat(right)) + G('┐'));
}

/** └──────────┘  bottom border with corners */
function boxBottom(): void {
  console.log(G('└') + G('─'.repeat(W - 2)) + G('┘'));
}

/** │ content padded to W │ */
function boxLine(content: string): void {
  const inner = W - 4;
  const pad = Math.max(0, inner - stripAnsi(content).length);
  console.log(G('│') + ' ' + content + ' '.repeat(pad) + ' ' + G('│'));
}

/** Full bordered summary box with floating title */
function summaryBox(lines: string[]): void {
  const inner = W - 2;
  const titleText = ' Summary ';
  const tl = Math.floor((inner - titleText.length) / 2);
  const tr = inner - tl - titleText.length;
  console.log(G('┌') + G('─'.repeat(tl)) + G.bold(titleText) + G('─'.repeat(tr)) + G('┐'));
  lines.forEach((line) => {
    const pad = Math.max(0, inner - 2 - stripAnsi(line).length);
    console.log(G('│') + ' ' + line + ' '.repeat(pad) + ' ' + G('│'));
  });
  console.log(G('└') + G('─'.repeat(inner)) + G('┘'));
}

/** ✔ [n/t]|text padded   ████████████  |[✔]| */
function stageRow(num: number, total: number, text: string): string {
  const label = `[${num}/${total}]`;
  const TEXT_W = 28;
  const BAR_W  = 22;
  return (
    G(label) + chalk.dim('|') + G(text.padEnd(TEXT_W)) +
    '  ' + G('█'.repeat(BAR_W)) +
    chalk.dim('  |') + G('[✔]') + chalk.dim('|')
  );
}

// ─── Banner ────────────────────────────────────────────────────────────────

function printBanner(): void {
  const renderLines = (text: string, color: string): string[] => {
    const lines = cfonts.render(text, {
      font: 'block', colors: [color], background: 'transparent', space: false,
    }).string.trim().split('\n');
    // Shift the top row right so the ╗ corners don't visually break the edge.
    if (lines.length > 0) lines[0] = ' ' + lines[0];
    return lines;
  };

  const zipLines = (a: string[], b: string[]): string[] => {
    const maxW    = Math.max(...a.map((l) => stripAnsi(l).length));
    const rowCount = Math.max(a.length, b.length);
    while (a.length < rowCount) a.push('');
    while (b.length < rowCount) b.push('');
    return a.map((l, i) =>
      l + ' '.repeat(Math.max(0, maxW - stripAnsi(l).length)) + '  ' + b[i],
    );
  };

  const mendixLines   = renderLines('MENDIX',   '#0595DB');
  const exitToolLines = zipLines(renderLines('EXIT', '#00FF41'), renderLines('TOOL', '#00FF41'));

  console.log();
  [...mendixLines, ...exitToolLines].forEach((l) => process.stdout.write(l + '\n'));
  console.log();

  // Tagline bar
  console.log();
  const tagline = 'Claude Code  ·  Mendix Platform SDK  ·  Node.js';
  const tagInner = W - 2;
  const tagLeft  = Math.floor((tagInner - tagline.length) / 2);
  const tagRight = tagInner - tagLeft - tagline.length;
  console.log(chalk.dim('┌' + '┄'.repeat(W - 2) + '┐'));
  console.log(chalk.dim('┆') + ' '.repeat(tagLeft) + chalk.dim(tagline) + ' '.repeat(tagRight) + chalk.dim('┆'));
  console.log(chalk.dim('└' + '┄'.repeat(W - 2) + '┘'));
  console.log();
}

// ─── Simulate mode ─────────────────────────────────────────────────────────

async function runSimulate(): Promise<void> {
  printBanner();

  // Auth
  boxTop('Authentication');
  const authSpinner = ora({ text: G('Connecting to Mendix Platform...'), color: 'green' }).start();
  await sleep(2000);
  authSpinner.stop();
  boxLine('Authenticated as: ' + G.bold('joshua.moesa@mendix.com'));
  boxBottom();

  // Project selection
  const projectName = await select({
    message: 'Select a Mendix project to convert',
    choices: [
      { name: 'Mendinova Care - Demo',    value: 'Mendinova Care - Demo' },
      { name: 'HR Self Service Portal',   value: 'HR Self Service Portal' },
      { name: 'Customer Ticket Manager',  value: 'Customer Ticket Manager' },
    ],
  });
  console.log();

  // Configuration
  boxTop('Configuration');
  const cfgLeft  = `Starting conversion: ${G.bold(projectName)}`;
  const cfgRight = G.bold('>> Selected <<');
  const visibleLeft  = `Starting conversion: ${projectName}`;
  const visibleRight = '>> Selected <<';
  const cfgPad = Math.max(2, W - 4 - visibleLeft.length - visibleRight.length);
  boxLine(cfgLeft + ' '.repeat(cfgPad) + cfgRight);
  boxBottom();

  // Conversion stages
  sectionBar('Conversion Status');

  const stage = async (
    num: number, total: number,
    spinText: string, doneText: string,
    delay: number,
  ): Promise<void> => {
    const BAR_W  = 22;
    const TEXT_W = 28;
    const label  = `[${num}/${total}]`;
    const buildText = (filled: number): string =>
      G(label) + chalk.dim('|') + G(spinText.padEnd(TEXT_W)) +
      '  ' + G('█'.repeat(filled)) + chalk.dim('░'.repeat(BAR_W - filled));

    const s = ora({ text: buildText(0), color: 'green' }).start();

    if (isFast) {
      s.stopAndPersist({ symbol: G('✔'), text: stageRow(num, total, doneText) });
      return;
    }

    await new Promise<void>((resolve) => {
      let filled = 0;
      const intervalMs = delay / BAR_W;
      const timer = setInterval(() => {
        filled++;
        s.text = buildText(filled);
        if (filled >= BAR_W) {
          clearInterval(timer);
          resolve();
        }
      }, intervalMs);
    });

    s.stopAndPersist({ symbol: G('✔'), text: stageRow(num, total, doneText) });
  };

  await stage(1, 5, 'Creating temporary working copy...', 'Working copy ready',           15000);
  await stage(2, 5, 'Extracting domain model...',         '202 entities across 5 modules', 10000);
  await stage(3, 5, 'Extracting microflows...',           '87 microflows extracted',        8000);
  await stage(4, 5, 'Extracting 152 pages...',            '152 pages, 8 layouts',          15000);
  await stage(5, 5, 'Generating Node.js / Prisma / EJS...','320 files written to app/',    5000);

  // Summary
  console.log();
  summaryBox([
    'Conversion complete in 58s',
    '',
    `Pages generated  ${chalk.dim('|')} ${G.bold('152')}`,
    `Routes           ${chalk.dim('|')} ${G.bold('152')}`,
    `Entities         ${chalk.dim('|')} ${G.bold('202')}`,
    `Microflows       ${chalk.dim('|')} ${G.bold(' 87')}`,
    `Files written    ${chalk.dim('|')} ${G.bold('320')}`,
    `Conversion time  ${chalk.dim('|')} ${G.bold(' 58s')}`,
  ]);

  // Done
  console.log();
  sectionBar('* DONE *');
  console.log();

  // Browser prompt
  const shouldOpen = await confirm({
    message: 'Open the result in your browser?',
    default: true,
  });

  if (shouldOpen) {
    console.log();
    const openSpinner = ora({ text: G('Launching browser...'), color: 'green' }).start();
    await sleep(500);
    openSpinner.stopAndPersist({
      symbol: G('✔'),
      text: G('Launching browser → ') + G.bold.underline('http://localhost:3001'),
    });
    await open('http://localhost:3001');
  }

  console.log();
  console.log(chalk.dim('  This session will be closed. Have a nice day!'));
  console.log();
}

// ─── Real mode ─────────────────────────────────────────────────────────────

function spawnAsync(cmd: string, cmdArgs: string[], opts: { cwd?: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, { ...opts, stdio: 'pipe', shell: true });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`))));
    child.on('error', reject);
  });
}

async function runReal(): Promise<void> {
  printBanner();

  const appDir     = path.join(process.cwd(), 'app');
  const scriptPath = path.join(process.cwd(), 'scripts', 'generate.ts');
  const tsconfig   = path.join(process.cwd(), 'tsconfig.json');

  // Step 1 — SDK generation (live output)
  sectionBar('Mendix SDK Conversion');
  console.log(G('  Running real Mendix SDK conversion...'));
  console.log(chalk.dim('  Requires MENDIX_PAT to be set in your environment.'));
  console.log();

  await new Promise<void>((resolve, reject) => {
    const child = spawn('ts-node', ['--project', tsconfig, scriptPath], {
      stdio: 'inherit', shell: true,
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Generation failed (exit ${code})`))));
    child.on('error', reject);
  });

  // Post-generation steps
  console.log();
  sectionBar('Post-Generation Setup');

  const postStage = async (label: string, fn: () => Promise<void>): Promise<void> => {
    const s = ora({ text: G(label), color: 'green' }).start();
    await fn();
    s.stopAndPersist({ symbol: G('✔'), text: G(label) });
  };

  await postStage('Copying environment file...', async () => {
    fs.copyFileSync(path.join(appDir, '.env.example'), path.join(appDir, '.env'));
  });
  await postStage('Installing app dependencies...', () => spawnAsync('npm', ['install'], { cwd: appDir }));
  await postStage('Setting up database...', () => spawnAsync('npm', ['run', 'db:push'], { cwd: appDir }));

  const r5 = ora({ text: G('Starting app...'), color: 'green' }).start();
  const devProcess = spawn('npm', ['run', 'dev'], {
    cwd: appDir, stdio: 'ignore', shell: true, detached: true,
  });
  devProcess.unref();
  await sleep(3000);
  r5.stopAndPersist({
    symbol: G('✔'),
    text: G('App running on ') + G.bold.underline('http://localhost:3001'),
  });

  console.log();
  sectionBar('* DONE *');
  console.log();

  const shouldOpen = await confirm({
    message: 'Open the result in your browser?',
    default: true,
  });

  if (shouldOpen) {
    console.log();
    const openSpinner = ora({ text: G('Launching browser...'), color: 'green' }).start();
    await sleep(500);
    openSpinner.stopAndPersist({
      symbol: G('✔'),
      text: G('Launching browser → ') + G.bold.underline('http://localhost:3001'),
    });
    await open('http://localhost:3001');
  }

  console.log();
  console.log(chalk.dim('  This session will be closed. Have a nice day!'));
  console.log();
}

// ─── Entry point ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (isReal) {
    await runReal();
  } else {
    await runSimulate();
  }
}

main().catch((err: Error) => {
  console.error(chalk.red('\nError: ') + err.message);
  process.exit(1);
});

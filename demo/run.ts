import figlet from 'figlet';
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

function printBanner(): void {
  let siemensLines: string[];
  try {
    const siemensText = figlet.textSync('SIEMENS', { font: 'ANSI Shadow' });
    siemensLines = siemensText.split('\n');
    // Strip trailing blank lines figlet appends
    while (siemensLines.length > 0 && siemensLines[siemensLines.length - 1].trim() === '') {
      siemensLines.pop();
    }
  } catch {
    siemensLines = ['  SIEMENS'];
  }

  // Mendix logo — pure chalk, 5 rows
  const mendixLines: string[] = [
    chalk.hex('#0595DB')('▄▄▄▄▄▄▄▄▄▄▄▄'),
    chalk.bgHex('#0595DB')('              '),
    chalk.bgHex('#0595DB').white.bold('    mx      '),
    chalk.bgHex('#0595DB')('              '),
    chalk.hex('#0595DB')('▀▀▀▀▀▀▀▀▀▀▀▀'),
  ];

  // Pad both to the same number of lines
  const rowCount = Math.max(siemensLines.length, mendixLines.length);
  while (siemensLines.length < rowCount) siemensLines.push('');
  while (mendixLines.length < rowCount) mendixLines.push('');

  const maxSiemensWidth = Math.max(...siemensLines.map((l) => stripAnsi(l).length));

  console.log();
  for (let i = 0; i < rowCount; i++) {
    const s = siemensLines[i] ?? '';
    const m = mendixLines[i] ?? '';
    const pad = ' '.repeat(Math.max(0, maxSiemensWidth - stripAnsi(s).length));
    console.log(chalk.cyan(s) + pad + '   ' + m);
  }

  console.log();
  console.log(chalk.dim('      Claude Code  ·  Mendix Platform SDK  ·  Node.js'));
  console.log(chalk.dim('  ' + '─'.repeat(54)));
  console.log();
}

async function runSimulate(): Promise<void> {
  printBanner();

  // Auth
  const authSpinner = ora('Connecting to Mendix Platform...').start();
  await sleep(2000);
  authSpinner.succeed(chalk.green('Authenticated as ') + chalk.bold('joshua.moesa@mendix.com'));
  console.log();

  // Project selection
  const projectName = await select({
    message: 'Select a Mendix project to convert',
    choices: [
      { name: 'Mendinova Care - Demo', value: 'Mendinova Care - Demo' },
      { name: 'HR Self Service Portal', value: 'HR Self Service Portal' },
      { name: 'Customer Ticket Manager', value: 'Customer Ticket Manager' },
    ],
  });

  console.log();
  console.log('  Starting conversion: ' + chalk.bold(projectName));
  console.log('  ' + chalk.dim('─'.repeat(45)));
  console.log();

  // Stage 1 — Working copy (15s)
  const s1 = ora('[1/5] Creating temporary working copy...').start();
  await sleep(15000);
  s1.succeed(chalk.green('[1/5] Working copy ready'));

  // Stage 2 — Domain model (10s)
  const s2 = ora('[2/5] Extracting domain model...').start();
  await sleep(10000);
  s2.succeed(chalk.green('[2/5] 202 entities across 5 modules'));

  // Stage 3 — Microflows (8s)
  const s3 = ora('[3/5] Extracting microflows...').start();
  await sleep(8000);
  s3.succeed(chalk.green('[3/5] 87 microflows extracted'));

  // Stage 4 — Pages (15s)
  const s4 = ora('[4/5] Extracting 152 pages...').start();
  await sleep(15000);
  s4.succeed(chalk.green('[4/5] 152 pages, 8 layouts'));

  // Stage 5 — Generate (5s)
  const s5 = ora('[5/5] Generating Node.js / Prisma / EJS...').start();
  await sleep(5000);
  s5.succeed(chalk.green('[5/5] 320 files written to app/'));

  // Summary
  console.log();
  console.log('  ' + chalk.dim('─'.repeat(45)));
  console.log('  ' + chalk.green('✔') + ' Conversion complete in 58s');
  console.log();
  console.log('    Pages generated   ' + chalk.bold('152'));
  console.log('    Routes            ' + chalk.bold('152'));
  console.log('    Entities          ' + chalk.bold('202'));
  console.log('    Microflows        ' + chalk.bold(' 87'));
  console.log('    Files written     ' + chalk.bold('320'));
  console.log();
  console.log('  ' + chalk.dim('─'.repeat(45)));
  console.log();

  // Browser open
  const shouldOpen = await confirm({
    message: 'Open the result in your browser?',
    default: true,
  });

  if (shouldOpen) {
    console.log();
    const openSpinner = ora('Launching browser...').start();
    await sleep(500);
    openSpinner.succeed(
      chalk.green('Launching browser → ') + chalk.bold.underline('http://localhost:3001'),
    );
    await open('http://localhost:3001');
  }

  console.log();
  console.log(chalk.dim('  This session will be closed. Have a nice day!'));
  console.log();
}

function spawnAsync(cmd: string, args: string[], opts: { cwd?: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...opts, stdio: 'pipe', shell: true });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`))));
    child.on('error', reject);
  });
}

async function runReal(): Promise<void> {
  printBanner();

  const appDir = path.join(process.cwd(), 'app');
  const scriptPath = path.join(process.cwd(), 'scripts', 'generate.ts');
  const tsconfigPath = path.join(process.cwd(), 'tsconfig.json');

  // Step 1 — Generate (pipe SDK output directly so progress is visible)
  console.log(chalk.yellow('Running real Mendix SDK conversion...'));
  console.log(chalk.dim('  Requires MENDIX_PAT to be set in your environment.'));
  console.log();

  await new Promise<void>((resolve, reject) => {
    const child = spawn('ts-node', ['--project', tsconfigPath, scriptPath], {
      stdio: 'inherit',
      shell: true,
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Generation failed (exit ${code})`))));
    child.on('error', reject);
  });

  console.log();
  console.log('  ' + chalk.dim('─'.repeat(45)));
  console.log();

  // Step 2 — Copy .env
  const s2 = ora('Copying environment file...').start();
  fs.copyFileSync(path.join(appDir, '.env.example'), path.join(appDir, '.env'));
  s2.succeed(chalk.green('Environment file ready'));

  // Step 3 — npm install
  const s3 = ora('Installing app dependencies...').start();
  await spawnAsync('npm', ['install'], { cwd: appDir });
  s3.succeed(chalk.green('Dependencies installed'));

  // Step 4 — db:push
  const s4 = ora('Setting up database...').start();
  await spawnAsync('npm', ['run', 'db:push'], { cwd: appDir });
  s4.succeed(chalk.green('Database ready'));

  // Step 5 — Start dev server (detached so it outlives this script)
  const s5 = ora('Starting app...').start();
  const devProcess = spawn('npm', ['run', 'dev'], {
    cwd: appDir,
    stdio: 'ignore',
    shell: true,
    detached: true,
  });
  devProcess.unref();
  await sleep(3000);
  s5.succeed(chalk.green('App running on ') + chalk.bold.underline('http://localhost:3001'));

  console.log();

  // Browser open
  const shouldOpen = await confirm({
    message: 'Open the result in your browser?',
    default: true,
  });

  if (shouldOpen) {
    console.log();
    const openSpinner = ora('Launching browser...').start();
    await sleep(500);
    openSpinner.succeed(
      chalk.green('Launching browser → ') + chalk.bold.underline('http://localhost:3001'),
    );
    await open('http://localhost:3001');
  }

  console.log();
  console.log(chalk.dim('  This session will be closed. Have a nice day!'));
  console.log();
}

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

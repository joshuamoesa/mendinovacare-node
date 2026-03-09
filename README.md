# mendinovacare-node

[![standard-readme compliant](https://img.shields.io/badge/readme%20style-standard-brightgreen.svg?style=flat-square)](https://github.com/RichardLitt/standard-readme)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green?style=flat-square)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

Generate a runnable Node.js/Express/Prisma/EJS app from the Mendinova Care Mendix model — via a single CLI command.

## Table of Contents

- [Background](#background)
- [Install](#install)
- [Usage](#usage)
- [Scripts](#scripts)
- [Security](#security)
- [Related Efforts](#related-efforts)
- [Maintainers](#maintainers)
- [Contributing](#contributing)
- [License](#license)

## Background

Mendix is a low-code platform that stores application models — domain entities, microflows (business logic), and pages (UI) — in a proprietary format. Getting that logic out into a conventional codebase requires either manual rewriting or the [Mendix Platform SDK](https://docs.mendix.com/apidocs-mxsdk/mxsdk/).

This project automates that extraction specifically for the **Mendinova Care** patient portal. It connects to the Mendix Platform SDK, reads the live app model, and generates a working **Node.js + Express + EJS + Prisma** project into `app/`. The primary audience is Mendix presales consultants who need a live demo of the app running as a standard Node.js service.

The generated app uses **SQLite** so it requires no database server — `npm install && npm run db:push && npm run dev` is the entire setup.

## Install

**Prerequisites:**
- Node.js 20+
- A [Mendix Personal Access Token (PAT)](https://docs.mendix.com/community-tools/mendix-profile/user-settings/#pat) with scopes:
  - `mx:app:metadata:read`
  - `mx:modelrepository:repo:read`
- Your Mendix **User ID** (OpenID), found in Mendix Portal → Profile → Personal Data

```bash
git clone https://github.com/joshuamoesa/mendinovacare-node.git
cd mendinovacare-node
npm install
```

Copy the environment file and fill in your credentials:

```bash
cp .env.example .env
```

`.env` expects:

```
MENDIX_PAT=your_personal_access_token
MENDIX_USER_ID=your_user_id
```

## Usage

### Presales demo (recommended)

Runs a polished retro terminal UI demo — simulated by default, no credentials required:

```bash
npm run demo
```

The demo opens with a **MENDIX / EXIT TOOL** banner in large block letters (Mendix blue + phosphor green), followed by animated progress bars that fill left-to-right as each conversion stage runs, and a summary box with the final stats.

To run the real Mendix SDK conversion and automatically set up and launch the generated app:

```bash
npm run demo -- --real
```

This connects to the Mendix Platform SDK, generates all files into `app/`, installs dependencies, sets up the SQLite database, and starts the app at `http://localhost:3001`.

Available flags:

| Flag | Behaviour |
|------|-----------|
| *(none)* | Simulate a full conversion with realistic timing (~60s) |
| `--real` | Run the actual Mendix SDK conversion (requires `MENDIX_PAT`) |
| `--fast` | Skip all delays — useful for testing the demo script itself |
| `--help` | Print flag reference and exit |

### Generate only

To regenerate the code without the demo experience:

```bash
npm run generate          # writes all files to app/ (~60–120s)
```

Then start the generated app manually:

```bash
cp app/.env.example app/.env
cd app && npm install && npm run db:push && npm run dev
```

Open [http://localhost:3001](http://localhost:3001).

### Full generate + launch in one command

```bash
npm run generate:full
```

Equivalent to running `generate`, copying `.env`, installing dependencies, pushing the database schema, and starting the dev server — all in sequence.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run generate` | Connect to Mendix SDK and write all generated files to `app/` |
| `npm run generate:full` | Generate + copy `.env` + `npm install` + `db:push` + `npm run dev` |
| `npm run demo` | Polished presales demo (simulated by default) |
| `npm run demo -- --real` | Full real SDK run with automatic app setup and launch |

## Security

Credentials (`MENDIX_PAT` and `MENDIX_USER_ID`) are stored in the local `.env` file only and are used exclusively in direct HTTPS requests from `scripts/generate.ts` to Mendix APIs. They are never logged or sent to any third party.

The generated app writes only to the local `app/` directory. The `.env` written there contains `DATABASE_URL=file:./dev.db` (SQLite, local file) and never contains production credentials.

> The generated code is a demo-quality starting point. Review `app/src/routes/*.ts` for missing authentication and input validation before any production use.

## Related Efforts

- [mendix-to-node](https://github.com/joshuamoesa/mendix-to-node) — the browser-based version of this tool; supports any Mendix project via a web UI with voice commands, SSE streaming, and one-click launch
- [mendix-projects-viewer](https://github.com/joshuamoesa/mendix-projects-viewer) — Mendix project list viewer; shares the same API integration pattern
- [Mendix Platform SDK](https://docs.mendix.com/apidocs-mxsdk/mxsdk/) — official SDK used for model extraction

## Maintainers

[@joshuamoesa](https://github.com/joshuamoesa)

## Contributing

Issues and pull requests are welcome. For significant changes, open an issue first to discuss the approach.

All SDK objects are lazy proxies and require `.load()` before property access. Any contribution touching `scripts/generate.ts` must maintain this pattern or properties will silently return `undefined`.

## License

[MIT](LICENSE) © Joshua Moesa

# Problems and Solutions Log

This file tracks the problems encountered during development and their solutions, so they can be uploaded to GitHub later.

## Problem 1: `concurrently: command not found`
**Issue:**
When running the command:
```bash
concurrently -n DEV,BOT,REMIND,WHATSAPP -c blue,green,yellow,magenta "npm run dev" "npm run bot" "npm run reminder" "npm run whatsapp"
```
The terminal returned `sh: concurrently: command not found`.

**Cause:**
The `concurrently` CLI tool was not installed globally or locally, or it was invoked directly without `npx` which is required when the package isn't globally installed or run from an npm script.

**Solution:**
1. Install `concurrently` as a dev dependency:
   ```bash
   npm install --save-dev concurrently
   ```
2. Either use `npx concurrently ...` to run the command, or add a `dev:all` script in `package.json` to run all services together.

## Problem 2: ETELEGRAM 409 Conflict & Port Collision
**Issue:**
Telegram bot threw an error: `ETELEGRAM: 409 Conflict: terminated by other getUpdates request; make sure that only one bot instance is running` and WhatsApp bot exited with `code 1`.

**Cause:**
The user accidentally started duplicate instances of the bots (running `npm start` while `npm run start` was already backgrounded). Two Telegram bots tried to use the exact same API token, causing a conflict. Simultaneously, the WhatsApp bot crashed because port 3001 was already in use by the first instance.

**Solution:**
1. Stop all current bots by closing the duplicate terminals or terminating processes.
2. Find stuck processes (e.g., `lsof -i :3001` or `pgrep -f node`) and kill them.
3. Run `npm run start` exactly once.

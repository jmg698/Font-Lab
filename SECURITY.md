# Security Policy

Font Lab runs on a developer's machine: it reads and edits files in your project, self-hosts font
bundles, and runs a local MCP server that an AI agent drives. That makes a few classes of issue
worth reporting privately before they're public.

## Reporting a vulnerability

**Please don't open a public issue for a security problem.** Instead:

- Use GitHub's [private vulnerability reporting](https://github.com/jmg698/Font-Lab/security/advisories/new)
  (Security → Report a vulnerability), **or**
- Email **jmg698@gmail.com** with the details.

Include what you found, how to reproduce it, and the impact. We'll acknowledge within a few days,
keep you posted on the fix, and credit you when it ships (unless you'd rather stay anonymous).

## What's in scope

Things that would genuinely surprise a user, for example:

- Font Lab writing outside the target project, or following a path/symlink out of it.
- The apply/undo path corrupting or failing to back up a file it edits.
- The MCP server or pick endpoint accepting input from somewhere it shouldn't (the pick endpoint
  is loopback-only by default — a way to reach it off-host would qualify).
- A crafted project, font name, or `selection.json` causing code execution or an unintended write.

## What's not in scope

- The fact that Font Lab edits your source files — that's the whole point, and it's backup-first
  and reversible by design.
- Issues that require an already-compromised machine or a malicious local user.
- Bugs with no security impact — those are welcome as ordinary
  [issues](https://github.com/jmg698/Font-Lab/issues/new/choose).

## Supported versions

Font Lab ships from `main` and is published to npm continuously; fixes land in the next release.
Please test against the latest published version before reporting.

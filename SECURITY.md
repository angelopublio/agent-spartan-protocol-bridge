# Security Policy

## Supported versions

Agent Spartan Protocol Bridge is an experimental executable runtime, currently version 0.1.0. There is no stable release or long-term support commitment yet. Report issues against the current default branch and include the affected commit or version.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/angelopublio/agent-spartan-protocol-bridge/security/advisories/new). Do not include provider credentials, auth files, private prompts, private repository content, or live exploit data in a public issue.

If private reporting is not yet available, open a minimal public issue asking the maintainer for a secure contact channel. Do not disclose the vulnerability details in that issue.

Please include, when safe:

- the affected version or commit;
- the affected adapter or runtime component;
- a concise impact description;
- redacted reproduction steps;
- whether credentials, worktree writes, sandbox escape, or cross-run data are involved;
- any suggested mitigation.

The maintainer should acknowledge a private report, provide a triage status, and coordinate disclosure before publishing technical details.

## Sensitive data

Never submit real values for `CURSOR_API_KEY`, `OPENAI_API_KEY`, other API keys, tokens, cookies, auth files, Keychain records, or account identifiers. Replace them with obvious placeholders and remove private filesystem paths from diagnostics.

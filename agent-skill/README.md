# spbridge portable agent skill

This directory is the portable multi-host package for `spbridge`. Its only maintained skill source
is `skills/spbridge/`. It is not the Spartan Bridge runtime: install the repository's Node.js
runtime separately before invoking the skill.

Host integration is deliberately thin:

- Claude Code can link `skills/spbridge` into `~/.claude/skills/spbridge` and invoke `/spbridge`.
- Codex and Cursor can link it into `~/.agents/skills/spbridge`; Codex invokes `$spbridge`, while
  Cursor exposes the host's supported slash-command form.
- Codex may instead install this directory through its `.codex-plugin/plugin.json` wrapper.
- Future hosts may expose the same directory through their own discovery or plugin adapter. They
  must not copy the instructions or take policy, transition, permission, lock, or event authority
  away from the `spartan-bridge` runtime.

Run `scripts/manage-install.sh install all` from the repository checkout for direct host discovery.
See the repository [README](../README.md#install-on-another-notebook) for runtime, plugin, update,
migration, verification, and uninstall instructions.

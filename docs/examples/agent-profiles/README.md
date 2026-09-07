# Machine-local official-client profiles

These files are copied onto a Mac. They are not part of the Bridge runtime. Do
not commit `~/.agent-profiles` or copy `auth.json` between machines or aliases.
Do not modify Agent Spartan Protocol to compensate for profile isolation.

Install or refresh the wrappers:

```sh
docs/examples/agent-profiles/install-agent-profiles
```

That script copies `resolve-profile` and `wrap-official-client`, points
`claude`, `codex`, `cursor`, `cursor-agent`, and `agent` at the wrapper, and
leaves credential stores untouched. After `PATH` includes
`~/.agent-profiles/bin`, run `claude --version`, `codex --version`, and
`cursor-agent --help` once in each profiled repository so isolated Codex and
Cursor Agent CLI mirror protocol skills from `~/.agents/skills`.

Grok is not wrapped by that installer. When a profile relocates `HOME` (for
example Cursor Agent CLI under `~/.agent-profiles/<alias>/cursor-home`), a Grok
session started in that shell stores login under the relocated home. Make the
Bridge registry visible there and register the Grok launcher as described in
[Use Grok as an official client](../../AUTHENTICATION-AND-SECURITY.md#use-grok-as-an-official-client).
Do not wrap Grok as PATH name `agent`; that name belongs to Cursor Agent CLI.

The full checklist is in
[Isolate official clients on one Mac](../../AUTHENTICATION-AND-SECURITY.md#isolate-official-clients-on-one-mac)
and [User skills under isolation](../../AUTHENTICATION-AND-SECURITY.md#user-skills-under-isolation).

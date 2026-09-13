# Runtime promotion

Consumer repositories should run a packed, globally installed Bridge build. The
installed package contains `dist/` but not `src/`, so edits in this development
checkout neither make the consumer runtime stale nor change code beneath an
in-flight round. Every promoted build carries its package version, Git commit
when available, dirty state, and build time in `dist/build-info.json`.

## Promote a pinned runtime

Prerequisites are Node.js 20 or newer, npm, Git, and this repository checked out
at the exact revision to promote. The commands do not authenticate an official
client. Run the seven steps in order. Steps 1, 2, and 3 establish the tested
build; step 4 is a human decision; and steps 5, 6, and 7 promote and verify it.

Step 1 runs in the Bridge checkout root. Install exactly the dependencies from
the lockfile before building.

######## RUN ON TERMINAL ################
npm ci
######## END OF RUN ON TERMINAL ########

Step 2 also runs in the Bridge checkout root and requires step 1. Build the
runtime; `postbuild` writes its build stamp.

######## RUN ON TERMINAL ################
npm run build
######## END OF RUN ON TERMINAL ########

Step 3 runs in the Bridge checkout root and requires the completed build from
step 2. Run the repository tests separately from every promotion command.

######## RUN ON TERMINAL ################
npm test
######## END OF RUN ON TERMINAL ########

Step 4 is the promotion gate and is a human decision, not a command. On the
2026-09-13 `main` baseline, the only accepted failure is the pre-existing
`repo-hygiene` tilde failure tracked by task `0082`; any other failure stops the
promotion. Once task `0082` lands, the accepted baseline becomes zero failures.
Do not hide a new failure with `|| true` or make packing a consequence of the
test command.

Step 5 runs in the Bridge checkout root after the step 4 decision. Write the
tarball to a directory outside the repository so packing does not dirty the
worktree.

######## RUN ON TERMINAL ################
npm pack --pack-destination <a directory outside the repository>
######## END OF RUN ON TERMINAL ########

Step 6 is a machine-local human action and may run from any directory after step
5. Install the tarball that step 5 reported; do not install or publish from a
registry.

######## RUN ON TERMINAL ################
npm -g install <the tarball written by step 5>
######## END OF RUN ON TERMINAL ########

Step 7 may run wherever the operator wants to ask which build `PATH` resolves.
It requires the global install from step 6. Verify that the printed `commit`,
`dirty`, and `built_at` describe the build just packed. A `built_at` older than
step 2's build means the promotion did not land, whatever the install reported.

######## RUN ON TERMINAL ################
spartan-bridge --version
######## END OF RUN ON TERMINAL ########

The global installation replaces an existing `npm link` for the same package
with a real package directory. Reversal is also a machine-local human action.
First, from any directory, uninstall the packed runtime globally.

######## RUN ON TERMINAL ################
npm -g uninstall spartan-bridge
######## END OF RUN ON TERMINAL ########

Then, from the Bridge checkout root, restore the development link.

######## RUN ON TERMINAL ################
npm link
######## END OF RUN ON TERMINAL ########

## Select the development runtime in one shell

Runtime selection remains outside repository content. By default every shell,
including one opened in this checkout, resolves `spartan-bridge` to the pinned
global install. To exercise the current development build deliberately, create
an operator-owned directory outside every repository, for example
`/Users/example/.local/spartan-bridge-dev/bin`, and place an executable file
named `spartan-bridge` there with this content (replace the placeholder checkout
path with the actual checkout):

```sh
#!/bin/sh
exec node /Users/example/src/agent-spartan-protocol-bridge/dist/cli/main.js "$@"
```

Make that shim executable.

######## RUN ON TERMINAL ################
chmod +x /Users/example/.local/spartan-bridge-dev/bin/spartan-bridge
######## END OF RUN ON TERMINAL ########

After `npm run build` in the checkout, open a development shell whose `PATH`
prefers the shim directory.

######## RUN ON TERMINAL ################
PATH="/Users/example/.local/spartan-bridge-dev/bin:$PATH" /bin/zsh
######## END OF RUN ON TERMINAL ########

Only that shell and its children select the development runtime. Every other
shell continues to resolve the pinned install, and closing the development
shell reverses the selection without writing any repository file.

If a round in this checkout is started outside the development shell, it uses
the pinned build and nothing errors: the packed install intentionally has no
`src/`, so the stale-build check has no development source tree to compare.
Detect that mistake with `spartan-bridge --version`, the `runtime:` line from
`spartan-bridge doctor --repo <path>`, or the run status document's
`runtime_build`. Status documents name the build that created a run, while each
event's `emitting_build` names the build that appended that event line.

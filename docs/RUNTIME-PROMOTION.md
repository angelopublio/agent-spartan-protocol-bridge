# Runtime promotion

Consumer repositories should run a packed, globally installed Bridge build. The
installed package contains `dist/` but neither `src/` nor `docs/`, so edits in
this development checkout neither make the consumer runtime stale nor change
code beneath an in-flight round. Every promoted build carries its package
version, Git commit when available, dirty state, and build time in
`dist/build-info.json`.

## Promote a pinned runtime

Prerequisites are Node.js 20 or newer, npm, Git, and this repository checked out
at the exact revision to promote. The commands do not authenticate an official
client. Run the eight steps in order: seven commands and one decision. Steps 1,
2, and 3 establish the tested build; step 4 is a human decision; steps 5 and 6
pack and name the tarball; and steps 7 and 8 install and verify it.

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
tarball to a durable directory outside the repository, so packing does not dirty
the worktree and so previous promotions remain available for rollback.

######## RUN ON TERMINAL ################
npm pack --pack-destination <a durable directory outside the repository>
######## END OF RUN ON TERMINAL ########

`npm pack` names the file from the package version, which does not change
between promotions, so every pack writes the same name and would overwrite the
previous one. Step 6 renames it, in the same directory, using the `commit` and
`built_at` that `dist/build-info.json` already records for this build. Take
`commit` in full, lowercase hexadecimal, or the literal `nocommit` when the
stamp recorded `null`; take `built_at` as its RFC 3339 UTC value with every
non-digit removed and nothing truncated, so its fractional seconds are kept.
Append `-dirty` when the stamp recorded `dirty: true`. Nothing is truncated
because this step is an `mv`, which overwrites silently: a name that can collide
is an archive that can lose the build it was kept for. Two tarballs share a name
only when `commit`, `dirty` and `built_at` are all identical, and then the stamp
cannot tell those builds apart either. The result is unique per build and can
be checked against the tarball's own contents later.

######## RUN ON TERMINAL ################
mv <that directory>/spartan-bridge-<version>.tgz <that directory>/spartan-bridge-<version>-<commit>-<built_at digits>[-dirty].tgz
######## END OF RUN ON TERMINAL ########

Step 7 is a machine-local human action and may run from any directory after step
6. Install the tarball step 6 named; do not install or publish from a registry.

######## RUN ON TERMINAL ################
npm -g install <the tarball step 6 named>
######## END OF RUN ON TERMINAL ########

Step 8 may run wherever the operator wants to ask which build `PATH` resolves.
It requires the global install from step 7. Verify that the printed `commit`,
`dirty`, and `built_at` describe the build just packed. A `built_at` older than
step 2's build means the promotion did not land, whatever the install reported.

######## RUN ON TERMINAL ################
spartan-bridge --version
######## END OF RUN ON TERMINAL ########

## Roll back a promotion

There is no demotion: the global slot holds one package, and rolling back means
promoting something else. When a kept tarball from an earlier promotion is
available, reinstall it directly; this needs no rebuild and no test run.

######## RUN ON TERMINAL ################
npm -g install <the kept tarball for the target build>
######## END OF RUN ON TERMINAL ########

To find which build to go back to, read `runtime_build` in the `status.json` of
a run that behaved correctly: it names the `commit` and `built_at` of the build
that created that run, which are the two fields the kept tarballs are named by.
Confirm the rollback with `spartan-bridge --version`, the same way a promotion
is confirmed.

When no kept tarball covers the target build, check the checkout out at that
commit and run the eight promotion steps again.

## Reverse the promotion entirely

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

## Which runtime a round uses

Wherever `PATH` resolves `spartan-bridge`, every round — in every repository,
this checkout included — uses that pinned global install. Runtime selection
stays outside repository content: no file in a repository names the binary, and
nothing switches it automatically.

The one exception is pre-existing and bounded. When `PATH` resolves nothing, the
`/spbridge` skill falls back to the workspace's own `dist/cli/main.js`, which on
this checkout is an unpromoted development build. It displaces no pinned
runtime, because in that case there is none; its failure mode is a workspace
with no Bridge installed. After a promotion `PATH` resolves on this machine, so
the fallback is not reached.

To exercise a development build, promote it. That makes it the one runtime on
the machine until the next promotion, which is deliberate: the promotion is an
explicit act, and every run record and terminal opening line names the build it
ran, so a build promoted mid-development is visible rather than silent.

A round started against a build that is not the one intended does not error. The
packed install has no `src/`, so the stale-build check has no development source
tree to compare. Detect it with `spartan-bridge --version`, the `runtime:` line
from `spartan-bridge doctor --repo <path>`, the review's terminal opening line,
or the run status document's `runtime_build`. Status documents name the build
that created a run, while each event's `emitting_build` names the build that
appended that event line.

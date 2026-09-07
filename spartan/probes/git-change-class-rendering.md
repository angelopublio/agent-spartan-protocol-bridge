# Probe: how git renders every change class a working tree can hold

Produced by `spartan/tasks/0033-close-the-loop-the-implementer-still-leaves-open.md`, 2026-08-20,
to settle D1's agreement table over measured output instead of assumed output. Point-in-time: it is
true of the git build recorded below and is not maintained afterwards.

Measured with:

```text
git version 2.50.1 (Apple Git-155)
```

## The fixture

One repository carrying every combination of three facts about a path: whether `HEAD` holds it,
whether the index holds it, and whether the working tree holds it. Written to a throwaway directory
passed as `$1`; it touches nothing else.

```sh
#!/bin/sh
# One fixture carrying every combination of (in HEAD?) x (in working tree?) x (listed by the index?).
set -eu
D="$1"; rm -rf "$D"; mkdir -p "$D"; cd "$D"
git init -q .; git config user.email t@t.invalid; git config user.name t

# --- base commit ---
printf 'a\n' > modified.txt
printf '\000\001\002binary\n' > binary.bin
printf '#!/bin/sh\n' > mode.sh
printf 'x\n' > unchanged.txt
printf 'd\n' > deleted.txt
printf 'c\n' > uncached.txt
printf 'r\n' > git-rm.txt
for i in 1 2 3 4 5 6 7 8 9 10; do echo "line $i"; done > renamed-from.txt
git add -A
git commit -qm base

# --- working-tree and index states ---
printf 'a\nb\n' > modified.txt                 # in HEAD, worktree, content changed
printf '\000\001\003BINARY\n' > binary.bin     # in HEAD, worktree, binary change
chmod +x mode.sh                               # in HEAD, worktree, mode-only change
rm deleted.txt                                 # in HEAD, absent from worktree
printf 'new\n' > index-added.txt               # not in HEAD, index, worktree
git add index-added.txt
printf 'ghost\n' > staged-then-removed.txt     # not in HEAD, index, absent from worktree
git add staged-then-removed.txt
rm staged-then-removed.txt
printf 'u\n' > untracked.txt                   # not in HEAD, not in index, worktree
git rm -q --cached uncached.txt                # in HEAD, absent from index, worktree
git rm -q git-rm.txt                           # in HEAD, absent from index and from worktree
git mv renamed-from.txt renamed-to.txt         # rename

echo "=== git status --porcelain ==="
git status --porcelain
echo "=== git ls-files --cached ==="
git ls-files --cached
echo "=== git ls-files --others --exclude-standard ==="
git ls-files --others --exclude-standard
echo "=== git diff HEAD --name-status ==="
git diff HEAD --name-status
echo "=== git diff HEAD --name-status --no-renames ==="
git diff HEAD --name-status --no-renames
echo "=== git diff HEAD --no-renames ==="
git diff HEAD --no-renames
```

## What it printed

```text
=== git status --porcelain ===
 M binary.bin
 D deleted.txt
D  git-rm.txt
A  index-added.txt
 M mode.sh
 M modified.txt
R  renamed-from.txt -> renamed-to.txt
AD staged-then-removed.txt
D  uncached.txt
?? uncached.txt
?? untracked.txt
=== git ls-files --cached ===
binary.bin
deleted.txt
index-added.txt
mode.sh
modified.txt
renamed-to.txt
staged-then-removed.txt
unchanged.txt
=== git ls-files --others --exclude-standard ===
uncached.txt
untracked.txt
=== git diff HEAD --name-status ===
M	binary.bin
D	deleted.txt
D	git-rm.txt
A	index-added.txt
M	mode.sh
M	modified.txt
R100	renamed-from.txt	renamed-to.txt
D	uncached.txt
=== git diff HEAD --name-status --no-renames ===
M	binary.bin
D	deleted.txt
D	git-rm.txt
A	index-added.txt
M	mode.sh
M	modified.txt
D	renamed-from.txt
A	renamed-to.txt
D	uncached.txt
=== git diff HEAD --no-renames ===
diff --git a/binary.bin b/binary.bin
index 742c16a..b3351dc 100644
Binary files a/binary.bin and b/binary.bin differ
diff --git a/deleted.txt b/deleted.txt
deleted file mode 100644
index 4bcfe98..0000000
--- a/deleted.txt
+++ /dev/null
@@ -1 +0,0 @@
-d
diff --git a/git-rm.txt b/git-rm.txt
deleted file mode 100644
index 4286f42..0000000
--- a/git-rm.txt
+++ /dev/null
@@ -1 +0,0 @@
-r
diff --git a/index-added.txt b/index-added.txt
new file mode 100644
index 0000000..3e75765
--- /dev/null
+++ b/index-added.txt
@@ -0,0 +1 @@
+new
diff --git a/mode.sh b/mode.sh
old mode 100644
new mode 100755
diff --git a/modified.txt b/modified.txt
index 7898192..422c2b7 100644
--- a/modified.txt
+++ b/modified.txt
@@ -1 +1,2 @@
 a
+b
diff --git a/renamed-from.txt b/renamed-from.txt
deleted file mode 100644
index fa2da6e..0000000
--- a/renamed-from.txt
+++ /dev/null
@@ -1,10 +0,0 @@
-line 1
-line 2
-line 3
-line 4
-line 5
-line 6
-line 7
-line 8
-line 9
-line 10
diff --git a/renamed-to.txt b/renamed-to.txt
new file mode 100644
index 0000000..fa2da6e
--- /dev/null
+++ b/renamed-to.txt
@@ -0,0 +1,10 @@
+line 1
+line 2
+line 3
+line 4
+line 5
+line 6
+line 7
+line 8
+line 9
+line 10
diff --git a/uncached.txt b/uncached.txt
deleted file mode 100644
index f2ad6c7..0000000
--- a/uncached.txt
+++ /dev/null
@@ -1 +0,0 @@
-c
```

## What each row of D1's table rests on

- `staged-then-removed.txt` — in `HEAD` no, index yes, working tree no — is listed by
  `git ls-files --cached` and appears nowhere in `git diff HEAD`, in any form. A member with nothing
  for `diff.patch` to carry.
- `uncached.txt` — in `HEAD` yes, index no, working tree yes — is listed by
  `git ls-files --others --exclude-standard`, and `git diff HEAD` renders it as a full deletion while
  the file sits on disk. The one row where `worktree/` and `diff.patch` disagree by construction.
- `git-rm.txt` — in `HEAD` yes, index no, working tree no, an ordinary `git rm` — is listed by
  neither `git ls-files --cached` nor `git ls-files --others --exclude-standard`, so a predicate
  built from those two lists alone does not reach it at all, while `git diff HEAD` does carry its
  deletion as `D	git-rm.txt`.
- `binary.bin` and `mode.sh` carry a `diff --git` header and no `@@` hunk, which is why D1 says
  *represented* rather than "carries a hunk".
- `index-added.txt` is carried by `git diff HEAD` where `untracked.txt` is not, which is why those
  two are separate rows.
- `renamed-from.txt` / `renamed-to.txt` print as one `R100` line naming two paths under the default
  rendering and as a `D` line and an `A` line under `--no-renames`, which is why D1 states its rows
  per path.

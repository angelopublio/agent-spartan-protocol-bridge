import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

// This repository is published. The AGENTS.md rule "Repository content names no
// private identity" is the norm; these assertions verify four shapes of it and
// nothing more. Names — a person, an organisation, a product, a repository, an
// alias written as prose — are not scanned here and cannot be, because the list
// that would detect them is itself a manifest of what must never be published.
//
// Limits, stated rather than implied:
//
// Blobs are decoded as UTF-8, so a tracked file in another encoding is scanned
// as whatever that decoding yields. The home-path assertion knows two POSIX
// layouts. The alias assertion knows quoted serialisations only — neither an
// unquoted plain scalar nor the command-line form is detected. The first has no
// tracked target. The second appears in source inside string literals, where an
// escape sequence or an interpolation can transform the captured value after
// the fact; no character-class boundary distinguishes such syntax from an
// alias, so the alternatives were a loophole or a false positive on every
// literal, and neither is worth claiming coverage for.
//
// The home, tilde and alias patterns capture to a real delimiter — whitespace,
// a quote or a backtick — and judge afterwards, because a capture narrowed to an
// admissible alphabet stops at the first character outside it, which both misses
// a value shaped unexpectedly and truncates a longer token onto a pinned
// exception. The address pattern is the exception: it ends at the last label it
// can read, so it can stop mid-token, and what follows a match is inspected
// instead. That inspection is deliberately conservative — a continuation made
// only of periods is sentence punctuation, anything else is treated as a longer
// address and reported, even where a human would read it otherwise.
//
// A finding names a position in the tracked listing and a count, never a blob
// identifier, a tracked path, a filename or the matched value. A blob
// identifier is derived from content; a position is not. The test runner adds
// its own framing around a finding — this file's path, source lines, the
// assertion message — and that framing is public content.

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

const PLACEHOLDER_HOME_USERS = new Set(["example", "you", "real", "someone", "user", "x", "<user>"]);
const ALLOWED_ADDRESSES = new Set(["t@t.invalid"]);
const PUBLIC_CLIENT_CONTEXTS = new Set(["personal", "default"]);
// The single tilde exception is the negative fixture asserting that a tilde
// scope entry is refused. Compared against the whole captured token.
const TILDE_FIXTURE = "~/src/";

type Entry = { readonly index: number; readonly blob: string; readonly file: string; readonly text: string };

function git(args: readonly string[], input?: string): Buffer {
  const result = spawnSync("git", args, { cwd: REPO_ROOT, input, maxBuffer: 512 * 1024 * 1024 });
  assert.equal(result.status, 0, `git ${args[0]} must succeed`);
  return result.stdout;
}

/**
 * Read every tracked entry from the index and its bytes from the object
 * database. The working filesystem is never consulted, so a symlink is read as
 * the blob holding its target rather than followed out of the repository.
 */
function trackedEntries(): Entry[] {
  const rows = git(["ls-files", "-s", "-z"]).toString("utf8").split("\0").filter((row) => row.length > 0);
  const parsed = rows.map((row, index) => {
    // `<mode> <sha> <stage>\t<path>`; a path may itself contain a tab, so split
    // once on the first separator rather than on every one.
    const tab = row.indexOf("\t");
    const meta = row.slice(0, tab === -1 ? row.length : tab);
    return { index, blob: meta.split(" ")[1] ?? "", file: tab === -1 ? "" : row.slice(tab + 1) };
  });
  const out = git(["cat-file", "--batch"], `${parsed.map((entry) => entry.blob).join("\n")}\n`);

  const entries: Entry[] = [];
  let cursor = 0;
  for (const entry of parsed) {
    const newline = out.indexOf(0x0a, cursor);
    const size = Number.parseInt(out.subarray(cursor, newline).toString("utf8").split(" ")[2] ?? "0", 10);
    entries.push({ ...entry, text: out.subarray(newline + 1, newline + 1 + size).toString("utf8") });
    cursor = newline + 1 + size + 1;
  }
  return entries;
}

let cached: Entry[] | null = null;
function entries(): Entry[] {
  cached ??= trackedEntries();
  return cached;
}

/** Name where to look without naming what was found, or what holds it. */
function locate(entry: Entry): string {
  return `tracked entry ${entry.index} of ${entries().length}`;
}

/** Every assertion scans a tracked pathname and its blob alike: a name is content. */
function scan(matcher: (subject: string) => boolean): string[] {
  const offenders: string[] = [];
  for (const entry of entries()) {
    for (const subject of [entry.file, entry.text]) {
      if (matcher(subject)) {
        offenders.push(locate(entry));
      }
    }
  }
  return [...new Set(offenders)];
}

export function homePathOffends(subject: string): boolean {
  for (const match of subject.matchAll(/\/(?:Users|home)\/([^\s"'`]*)/g)) {
    // The first non-empty segment: a doubled separator must not present an empty
    // one and be read as the bare shape. The bare layout prefix with no segment
    // at all names no user; it is the shape under discussion, not a path.
    const segment = (match[1] ?? "").split("/").find((part) => part.length > 0);
    if (segment !== undefined && !PLACEHOLDER_HOME_USERS.has(segment)) {
      return true;
    }
  }
  return false;
}

export function tildePathOffends(subject: string): boolean {
  for (const match of subject.matchAll(/~\/[^\s"'`]*/g)) {
    const found = match[0];
    if (found === TILDE_FIXTURE) {
      continue;
    }
    const segments = found.slice(2).split("/");
    // A dotfile, but not a traversal — wherever in the token the traversal sits.
    if ((segments[0] ?? "").startsWith(".") && !segments.some((s) => s === "." || s === "..")) {
      continue;
    }
    return true;
  }
  return false;
}

export function addressOffends(subject: string): boolean {
  for (const match of subject.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
    const tail = subject.slice((match.index ?? 0) + match[0].length).match(/^[A-Za-z0-9._%+-]+/)?.[0] ?? "";
    // A continuation of periods alone is sentence punctuation. Anything else is
    // a longer address, and a prefix of one must never satisfy the exception.
    if (tail.replace(/\.+$/, "").length > 0) {
      return true;
    }
    if (!ALLOWED_ADDRESSES.has(match[0])) {
      return true;
    }
  }
  return false;
}

export function aliasOffends(subject: string): boolean {
  // The alias has no declared charset, so each pattern captures everything up to
  // its closing quote and the value is judged exactly. A prefix rule was
  // considered for the unquoted and command-line forms and rejected: no boundary
  // distinguishes syntax that later transforms the value.
  const quoted = [
    /"client_context"\s*:\s*"([^"]*)"/g,
    /\bclient_context:\s*"([^"]*)"/g,
    /\bclient_context:\s*'([^']*)'/g,
  ];
  for (const pattern of quoted) {
    for (const match of subject.matchAll(pattern)) {
      if (!PUBLIC_CLIENT_CONTEXTS.has(match[1] ?? "")) {
        return true;
      }
    }
  }
  return false;
}

test("an absolute home path names a placeholder user", () => {
  assert.deepEqual(scan(homePathOffends), [], "replace the real home path with a placeholder user");
});

test("a tilde path names a dotfile", () => {
  assert.deepEqual(
    scan(tildePathOffends),
    [],
    "a `~` path in this repository names a dotfile; a personal working directory does not",
  );
});

test("an e-mail address is the synthetic one", () => {
  assert.deepEqual(scan(addressOffends), [], "use t@t.invalid instead of a real address");
});

test("a client-context alias is one of the two public values", () => {
  const offenders = scan(aliasOffends);
  // This repository's own Agent hosts table, whose Client context column selects
  // the launcher these bindings actually use.
  const agents = entries().find((entry) => entry.file === "AGENTS.md");
  if (agents) {
    const table = /^## Agent hosts$[\s\S]*?(?=^## )/m.exec(agents.text)?.[0] ?? "";
    for (const row of table.split("\n")) {
      const cells = row.split("|").map((cell) => cell.trim());
      if (cells.length < 6 || cells[1] === "Binding" || cells[1]?.startsWith("---")) {
        continue;
      }
      if (!PUBLIC_CLIENT_CONTEXTS.has(cells[3] ?? "")) {
        offenders.push(locate(agents));
      }
    }
  }
  assert.deepEqual(
    [...new Set(offenders)],
    [],
    "a client-context alias in repository content is `personal` or `default`",
  );
});

// The cases every audit round required, retained as inputs rather than described
// in prose. Every value here is synthetic and names nothing real.
//
// A case that must be REPORTED is by definition a violation, and this file is
// scanned by the assertions it tests, so such a case cannot appear as a literal:
// it would make the file fail its own scan. Each offending case therefore writes
// one character of its marker as a Unicode escape. The run-time string is exact;
// only the source text differs, and this paragraph is why. Passing cases need no
// such treatment and are written plainly.
const SLASH = "\u002F";
const AT = "\u0040";

const HOME_CASES: readonly { readonly subject: string; readonly offends: boolean }[] = [
  { subject: "/Users/example/x", offends: false },
  { subject: "/Users/<user>/x", offends: false },
  { subject: "`/Users/`", offends: false },
  { subject: `/Users${SLASH}notaplaceholder`, offends: true },
  { subject: `/Users${SLASH}${SLASH}notaplaceholder`, offends: true },
  { subject: `/home${SLASH}${SLASH}${SLASH}notaplaceholder`, offends: true },
];

const TILDE_CASES: readonly { readonly subject: string; readonly offends: boolean }[] = [
  { subject: "~/.config/git/ignore", offends: false },
  { subject: TILDE_FIXTURE, offends: false },
  { subject: `~${SLASH}Documents/x`, offends: true },
  { subject: `~${SLASH}src/,x`, offends: true },
  { subject: `~${SLASH}src/)x`, offends: true },
  { subject: `~${SLASH}.config/../x`, offends: true },
];

const ADDRESS_CASES: readonly { readonly subject: string; readonly offends: boolean }[] = [
  { subject: "t@t.invalid", offends: false },
  { subject: "the address is t@t.invalid.", offends: false },
  { subject: "t@t.invalid..", offends: false },
  { subject: `t${AT}t.invalid-corp`, offends: true },
  { subject: `t${AT}t.invalid_x`, offends: true },
  { subject: `someone${AT}elsewhere.example`, offends: true },
];

const ALIAS_CASES: readonly { readonly subject: string; readonly offends: boolean }[] = [
  { subject: '"client_context": "personal"', offends: false },
  { subject: 'client_context: "default"', offends: false },
  { subject: "client_context: null", offends: false },
  { subject: `"client_context"${"\u003A"} "notpublic"`, offends: true },
  { subject: `"client_context"${"\u003A"} "with.dot"`, offends: true },
  { subject: `client_context${"\u003A"} 'notpublic'`, offends: true },
];

for (const [name, judge, cases] of [
  ["home path", homePathOffends, HOME_CASES],
  ["tilde path", tildePathOffends, TILDE_CASES],
  ["address", addressOffends, ADDRESS_CASES],
  ["alias", aliasOffends, ALIAS_CASES],
] as const) {
  test(`${name} judgement matches its retained cases`, () => {
    for (const item of cases) {
      assert.equal(judge(item.subject), item.offends, `case index ${cases.indexOf(item)}`);
    }
  });
}

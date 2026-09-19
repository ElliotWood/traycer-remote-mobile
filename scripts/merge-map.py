"""Measure the upstream merge conflict surface.

    python scripts/merge-map.py <ours> <upstream> [control-upstream]

Prints the conflict path set, the stage census, and -- when a control tip is
given -- whether the surface moved between the two upstream tips and which of
the control..upstream delta paths land inside it.

Exists because this measurement was re-run by hand three times (2026-09-19
09:59, 16:15, 2026-09-20 00:15) by sed-editing a dated copy of the previous
run's script.  Editing constants in a copy is how a stale tip gets carried
into a fresh-looking reading.  Pass the tips instead.

Self-check: python scripts/merge-map.py --selftest
"""
import collections
import subprocess
import sys
import tempfile


def git(*args):
    # No check=True: `merge-tree --write-tree` exits 1 *because* there are
    # conflicts, which is the case this whole script exists to measure.
    return subprocess.run(["git", *args], capture_output=True, text=True).stdout


def stage_lines(out):
    """Stage lines from `git merge-tree --write-tree` output.

    Line 0 is the written tree oid.  The stage block ends at the first BLANK
    line -- everything after it is informational messages, and counting those
    as paths overstates the conflict surface.
    """
    lines = []
    for line in out.splitlines()[1:]:
        if not line.strip():
            break
        lines.append(line)
    return lines


def census(lines):
    """path -> one of three-stage / add-add / base+ours, keyed on stage set."""
    stages = collections.defaultdict(set)
    for line in lines:
        stages[line.split("\t")[-1]].add(line.split("\t")[0].split()[-1])
    names = {
        frozenset("123"): "three-stage",
        frozenset("23"): "add-add",
        frozenset("12"): "base+ours",
    }
    return {p: names.get(frozenset(s), "/".join(sorted(s))) for p, s in stages.items()}


def area(path):
    return "/".join(path.split("/")[:2])


def ahead_behind(ours, upstream, at=()):
    """(ahead, behind) -- commits only ours has, then commits only upstream has.

    `git rev-list A..B` counts what is in B and not in A, so the range that
    answers "how far ahead is ours" is `upstream..ours` -- the one that reads
    backwards.  Printed the other way round, a fork 734 commits BEHIND upstream
    reads as 734 commits of its own work.  That is exactly how this printed
    from the script's first version until 2026-09-20, and the ledger published
    the swapped pair.  Nothing distinguishes the two numbers by inspection,
    which is why the self-check uses an asymmetric fixture.
    """
    return (
        len(git(*at, "rev-list", f"{upstream}..{ours}").split()),
        len(git(*at, "rev-list", f"{ours}..{upstream}").split()),
    )


def report(ours, upstream, control=None):
    lines = stage_lines(git("merge-tree", "--write-tree", ours, upstream))
    kinds = census(lines)
    print(f"ours {ours}  upstream {upstream}")
    print(f"  stage lines {len(lines)}   paths {len(kinds)}")
    print(f"  census {dict(collections.Counter(kinds.values()))}")
    for kind in ("add-add", "base+ours"):
        members = sorted(p for p, k in kinds.items() if k == kind)
        if members:
            by_area = collections.Counter(area(p) for p in members)
            print(f"  {kind}: {dict(by_area)}")
    print(f"  paths by area {dict(collections.Counter(area(p) for p in kinds))}")
    ahead, behind = ahead_behind(ours, upstream)
    print(f"  ours is {ahead} ahead of / {behind} behind upstream")
    if not control:
        return
    ctl = stage_lines(git("merge-tree", "--write-tree", ours, control))
    print(f"vs control upstream {control}")
    print(f"  stage lines identical: {lines == ctl}  ({len(lines)} vs {len(ctl)})")
    delta = set(git("diff", "--name-only", f"{control}..{upstream}").split())
    n = len(git("rev-list", f"{control}..{upstream}").split())
    contacts = sorted(delta & set(kinds))
    print(f"  {n} commits moved {len(delta)} paths; {len(contacts)} touch the surface")
    for p in contacts:
        print(f"    CONTACT {p} ({kinds[p]})")


def selftest():
    out = "\n".join(
        [
            "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
            "1\tblob\taaa\ta.ts",
            "2\tblob\tbbb\ta.ts",
            "3\tblob\tccc\ta.ts",
            "2\tblob\tddd\tb.ts",
            "3\tblob\teee\tb.ts",
            "1\tblob\tfff\tc.ts",
            "2\tblob\tggg\tc.ts",
            "",
            "Auto-merging d.ts",
            "CONFLICT (content): Merge conflict in d.ts",
        ]
    )
    lines = stage_lines(out)
    assert len(lines) == 7, lines
    kinds = census(lines)
    assert kinds == {
        "a.ts": "three-stage",
        "b.ts": "add-add",
        "c.ts": "base+ours",
    }, kinds
    assert area("clients/gui-app/src/lib/x.ts") == "clients/gui-app"
    assert area("bun.lock") == "bun.lock"
    selftest_ahead_behind()
    print("selftest ok")


def selftest_ahead_behind():
    """Orientation is which range you ask git for, so it cannot be checked on a
    canned string -- this builds a throwaway repo instead.  The fixture is
    DELIBERATELY asymmetric (2 ours, 1 upstream): with equal counts the swapped
    version passes, which is the whole reason the defect survived four
    readings.  `ignore_cleanup_errors` because git's loose objects are written
    read-only and Windows refuses to unlink those.
    """
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d:
        at = ("-C", d, "-c", "user.email=s@t", "-c", "user.name=s")
        git(*at, "init", "-q", "-b", "base")
        git(*at, "commit", "-q", "--allow-empty", "-m", "base")
        for branch, n in (("ours", 2), ("up", 1)):
            git(*at, "checkout", "-q", "-b", branch, "base")
            for i in range(n):
                git(*at, "commit", "-q", "--allow-empty", "-m", f"{branch}{i}")
        got = ahead_behind("ours", "up", at)
        assert got == (2, 1), got


if __name__ == "__main__":
    if sys.argv[1:2] == ["--selftest"]:
        selftest()
    elif len(sys.argv) in (3, 4):
        report(*sys.argv[1:])
    else:
        sys.exit(__doc__)

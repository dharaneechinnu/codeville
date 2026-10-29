from visualizer.parsers import (
    classify_command,
    parse_build_output,
    parse_command_output,
    parse_git_status,
    parse_lint_output,
    parse_test_output,
    parse_typecheck_output,
)


def test_classify_command_knows_the_common_commands():
    assert classify_command("npm test") == "test"
    assert classify_command("pnpm run test -- --watch=false") == "test"
    assert classify_command("npx vitest run") == "test"
    assert classify_command("python -m pytest -q") == "test"
    assert classify_command("node --test tests/a.test.js") == "test"
    assert classify_command("npm run lint") == "lint"
    assert classify_command("npx tsc --noEmit") == "typecheck"
    assert classify_command("npm run build") == "build"
    assert classify_command("ls -la") == "command"


def test_vitest_output_points_at_the_failing_line():
    out = "\n".join(
        [
            " ✓ src/cart.test.ts (3 tests) 12ms",
            " ❯ src/pay.test.ts (2 tests | 1 failed) 480ms",
            "   × pay > charges the card 11ms",
            "     → expected undefined to be 'ok'",
            " FAIL  src/pay.test.ts > pay > charges the card",
            "AssertionError: expected undefined to be 'ok'",
            " ❯ src/pay.test.ts:42:18",
        ]
    )
    r = parse_test_output(out, 1)
    assert r.failed == 1
    bad = next(s for s in r.steps if not s.ok)
    assert bad.name == "pay > charges the card"
    assert bad.problem["file"] == "src/pay.test.ts"
    assert bad.problem["line"] == 42
    assert "expected undefined" in " ".join(bad.problem["why"])
    assert "src/pay.test.ts" in bad.problem["next"]
    assert len([s for s in r.steps if s.ok]) == 1


def test_jest_output():
    out = "\n".join(
        [
            "PASS src/a.test.ts",
            "FAIL src/b.test.ts",
            "  ● b › does the thing",
            "    expect(received).toBe(expected)",
            "    at Object.<anonymous> (src/b.test.ts:12:5)",
        ]
    )
    r = parse_test_output(out, 1)
    assert (r.passed, r.failed) == (1, 1)
    assert r.problem["line"] == 12


def test_node_test_tap_output():
    out = "\n".join(
        [
            "TAP version 13",
            "ok 1 - adds numbers",
            "not ok 2 - charges card",
            "  ---",
            "  error: 'Stripe key is missing'",
            "  at: 'file:///C:/proj/src/pay.test.js:42:5'",
            "  ...",
            "# pass 1",
            "# fail 1",
        ]
    )
    r = parse_test_output(out, 1)
    assert (r.passed, r.failed) == (1, 1)
    assert "Stripe key is missing" in r.problem["why"][0]
    assert r.problem["line"] == 42


def test_pytest_output():
    out = "\n".join(
        [
            "tests/test_cart.py::test_total PASSED",
            "tests/test_pay.py::test_charge FAILED",
            "FAILED tests/test_pay.py::test_charge - AssertionError: key missing",
        ]
    )
    r = parse_test_output(out, 1)
    assert (r.passed, r.failed) == (1, 1)
    assert "key missing" in r.problem["why"][0]


def test_says_so_when_no_test_ran():
    r = parse_test_output("Error: Cannot find module vitest", 1)
    assert r.problem["what"] == "The tests did not run"


def test_all_passing_has_no_problem():
    r = parse_test_output("ok 1 - a\nok 2 - b", 0)
    assert r.failed == 0
    assert r.problem is None


def test_eslint_stylish_output():
    out = "\n".join(
        [
            "C:\\proj\\src\\CartPage.tsx",
            "  12:7  error  'coupon' is assigned a value but never used  @typescript-eslint/no-unused-vars",
            "  30:3  warning  Unexpected console statement  no-console",
            "",
            "✖ 2 problems (1 error, 1 warning)",
        ]
    )
    r = parse_lint_output(out, 1)
    assert r.failed == 1
    assert r.problem["what"] == "1 lint error"
    assert r.problem["file"] == "C:/proj/src/CartPage.tsx"
    assert r.problem["line"] == 12
    assert parse_lint_output("", 0).problem is None


def test_tsc_output_in_both_shapes():
    a = parse_typecheck_output("src/ProductList.tsx(30,5): error TS2322: Type 'string' is not assignable to type 'number'.", 2)
    assert a.problem["what"] == "1 type error"
    assert a.problem["line"] == 30
    b = parse_typecheck_output("src/a.ts:7:3 - error TS2304: Cannot find name 'x'.\nsrc/b.ts:9:1 - error TS2304: Cannot find name 'y'.", 2)
    assert b.problem["what"] == "2 type errors"
    assert b.problem["file"] == "src/a.ts"


def test_failed_build():
    r = parse_build_output("error during build:\nsrc/PayButton.tsx:3:8 Cannot find module './Coupon'", 1)
    assert r.problem["what"] == "The build failed"
    assert r.problem["file"] == "src/PayButton.tsx"
    assert r.problem["line"] == 3


def test_picks_the_parser_from_the_command():
    assert parse_command_output("npm run lint", "", 0).kind == "lint"
    assert parse_command_output("echo hi", "", 3).problem["what"] == "The command failed"


def test_git_status_counts():
    out = "\n".join(["## feature/checkout...origin/feature/checkout [ahead 2]", "M  a.ts", " M b.ts", "?? c.ts", "A  d.ts"])
    s = parse_git_status(out)
    assert s["branch"] == "feature/checkout"
    assert s["ahead"] == 2
    assert s["staged"] == 2
    assert s["changed"] == 2

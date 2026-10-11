const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync, mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const { formatter, pretty } = require("../dist/formatter");

const cli = join(__dirname, "../bin/mform.js");
const fixture = join(__dirname, "fixtures/spray.mu");
const spray = readFileSync(fixture, "utf8").trimEnd();
const unlayout = text => text.split("\n").map(line => line.trimStart()).join("");

test("nested dbref switch cases start lines, even after a missing function parenthesis", async () => {
  const fixture = readFileSync(join(__dirname, "fixtures/cmdtool.mu"), "utf8").trimEnd();
  for (const input of [fixture, fixture.replace("u(E.FAIL.CMD.1,%q<trim>]", "u(E.FAIL.CMD.1,%q<trim>)]")]) {
    const result = pretty(input);
    assert.match(result, /\n        #\-1,\{\n            @switch/);
    assert.match(result, /\n        #\-2,\{\n            @pemit/);
    assert.match(result, /\n        \{\n            @switch/);
    assert.match(result, /\[setq\(target,locate.*\]\n        \[%q<target>\]=\n/);
    assert.equal(unlayout(result), input);
    assert.equal((await formatter.format(result)).data, input);
  }
});

test("IndexCards switch uses the requested test and case layout", async () => {
  const input = readFileSync(join(__dirname, "fixtures/indexcards.mu"), "utf8").trimEnd();
  const expected = [
    "&T.CHECK_BLOCK IndexCards=@switch/now ",
    "    [setq(has_data,hasattr([v(indexcards_reference)],data_%0))]",
    "    [setq(data_id,switch(%q<has_data>,1,get([v(indexcards_reference)]/data_%0),))]",
    "    [setq(is_owner,switch(%q<has_data>,1,eq(owner(%q<data_id>),owner(%0)),0))]",
    "    [setq(answer,switch(%q<has_data>/%q<is_owner>,0/*,-1,1/0,-2,1))]%q<answer>=",
    "    1,{},",
    "    -1,{",
    "        &data_%0 [v(indexcards_reference)]=[setq(created,create(data_block_%0,10,t))]%q<created>;",
    "        @pemit [owner(%0)]=[u(u.create_data_0,%0,%1,%q<created>)]",
    "    },",
    "    -2,{",
    "        [setq(old_data,%q<data_id>)]&data_%0 [v(indexcards_reference)]=[setq(created,create(data_block_%0,10,t))]%q<created>;",
    "        @pemit [owner(%0)]=[u(u.create_data_1,%0,%1,%q<created>,%q<old_data>)]",
    "    }",
  ].join("\n");
  const result = pretty(input);
  assert.equal(result, expected);
  assert.equal(unlayout(result), input);
  assert.equal((await formatter.format(result)).data, input);
});

test("switch abbreviations, modifiers, and nested cases round-trip", async () => {
  for (const command of ["@sw", "@swi", "@swit", "@switc", "@switch", "@SWI/first", "@switch/now/all"]) {
    const input = `&TEST #1=$test:${command} [switch(v(x),a,b,c)]=1,{think one},-1,{think negative},2,{@swi x=a,{think nested},b,{think other}}, {think default}`;
    const result = pretty(input);
    assert.match(result, /\n    \[switch\(v\(x\),a,b,c\)\]=\n    1,\{/);
    assert.match(result, /\n    -1,\{/);
    assert.match(result, /@swi \n        x=\n        a,\{/);
    assert.equal(unlayout(result), input);
    assert.equal((await formatter.format(result)).data, input);
  }
});

test("unbraced switch results, escaped separators, and following commands", async () => {
  const input = String.raw`&TEST #1=$test:@swi x\=y=one\,two,think first,second,think second;think finished`;
  const result = pretty(input);
  assert.match(result, /x\\=y=\n    one\\,two,think first,\n    second,think second;/);
  assert.equal(unlayout(result), input);
  assert.equal((await formatter.format(result)).data, input);
  assert.equal(pretty("think @switch x=1,a,2,b"), "think @switch x=1,a,2,b");
  assert.equal(pretty("think [switch(x,1,a,2,b)]"), "think [switch(x,1,a,2,b)]");
});

test("SPRAY gets indented command bodies and round-trips exactly", async () => {
  const result = pretty(spray);
  assert.ok(result.split("\n").length > 10);
  assert.match(result, /^&SPRAY #130=\$\*spray \*:\n    @pemit/);
  assert.match(result, /0\/\*\/\*\/\*,\{\n        @pemit/);
  assert.match(result, /\*CLICK\*;\n    \}/);
  assert.match(result, /Sorry, this is not an automatic gun/);
  assert.equal(unlayout(result), spray);
  assert.equal((await formatter.format(result)).data, spray);
});

test("long functions wrap arguments without splitting nested short functions", async () => {
  const input = "think [switch(v(foo),first,[cat(hello,world)],second,other)]";
  const result = pretty(input, { width: 30, indent: 2 });
  assert.match(result, /first,\n/);
  assert.match(result, /\[cat\(hello,world\)\]/);
  assert.equal(unlayout(result), input);
  assert.equal((await formatter.format(result)).data, input);
});

test("semicolons inside expressions and escaped delimiters stay intact", async () => {
  for (const input of [
    "&TEST #1=$test:think [cat(a;b,c)];think done",
    String.raw`&TEST #1=$test:think a\;b%;;think \{literal\}%{x%}`,
    "think [setq(a,one)][setq(b,two)]",
  ]) {
    const result = pretty(input);
    assert.equal(unlayout(result), input);
    assert.equal((await formatter.format(result)).data, input);
  }
});

test("spaces in text and before structural breaks are retained", async () => {
  const input = "&TEST #1=$test: @switch x=a,{think hello world; think next },{think end}";
  const result = pretty(input);
  assert.equal(unlayout(result), input);
  assert.equal((await formatter.format(result)).data, input);
  assert.equal(unlayout(pretty("think multiple  spaces; think more")), "think multiple  spaces; think more");
});

test("layout does not promote text to directives, comments, or dash markers", async () => {
  for (const input of ["think a;#literal", "think a;-literal", "think a;@debug", "think a;@define foo {bar}"]) {
    assert.equal((await formatter.format(pretty(input))).data, (await formatter.format(input)).data);
  }
  for (const input of ["think a;//text", "think a;/*text*/"]) {
    assert.equal(pretty(input), input);
  }
});

test("multiple records stay separate and comments are left alone", async () => {
  const input = "@@ note {a;b}\n&ONE #1=$one:think a;think b\n&TWO #1=$two:think c";
  assert.equal((await formatter.format(pretty(input))).data, input);
  assert.equal(pretty("// note {a;b}"), "// note {a;b}");
  assert.equal(pretty(""), "");
});

test("invalid layout options report errors", () => {
  for (const indent of [0, -1, 1.5, 17, NaN]) assert.throws(() => pretty(spray, { indent }), /indent/);
  for (const width of [0, -1, 1.5, NaN]) assert.throws(() => pretty(spray, { width }), /width/);
});

test("CLI accepts a file or stdin, writes output, and reports failures", () => {
  const expected = pretty(spray + "\n");
  assert.equal(execFileSync(process.execPath, [cli, "pretty", fixture], { encoding: "utf8" }), expected);
  assert.equal(execFileSync(process.execPath, [cli, "pretty"], { input: spray + "\n", encoding: "utf8" }), expected);
  const directory = mkdtempSync(join(tmpdir(), "mush-pretty-"));
  try {
    const output = join(directory, "pretty.mu");
    execFileSync(process.execPath, [cli, "pretty", "-", "-o", output, "--indent", "2"], { input: spray });
    assert.equal(readFileSync(output, "utf8"), pretty(spray, { indent: 2 }));
    const missing = spawnSync(process.execPath, [cli, "pretty", join(directory, "missing.mu")], { encoding: "utf8" });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /mform pretty:/);
    const invalid = spawnSync(process.execPath, [cli, "pretty", "--indent", "0"], { input: spray, encoding: "utf8" });
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /indent/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

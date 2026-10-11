const assert = require("node:assert/strict");
const { test } = require("node:test");
const { mkdtemp, mkdir, writeFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { execFileSync } = require("node:child_process");
const { formatter } = require("../dist/formatter");

test("inline code can start with a comment without a leading newline", async () => {
  for (const newline of ["\n", "\r\n"]) {
    const input = `// hidden comment${newline}&command.cmd #123=$things:${newline}  @pemit %#=And Stuff.`;
    assert.equal(
      (await formatter.format(input)).data,
      "&command.cmd #123=$things:@pemit %#=And Stuff."
    );
    assert.equal(
      execFileSync(process.execPath, [join(__dirname, "../bin/mform.js"), "run", input], {
        encoding: "utf8",
      }).trim(),
      "&command.cmd #123=$things:@pemit %#=And Stuff."
    );
  }
});

test("comment-only input is empty", async () => {
  for (const input of ["// comment", "/* comment */"]) {
    assert.equal((await formatter.format(input)).data, "");
  }
});

test("file paths and nested includes still resolve and missing paths report errors", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mush-open-"));
  try {
    await mkdir(join(directory, "nested"));
    await writeFile(join(directory, "nested/child.mu"), "// comment\nthink Included");
    await writeFile(join(directory, "parent.mu"), "#include ./nested/child.mu\nthink Parent");
    assert.equal(
      (await formatter.format(join(directory, "parent.mu"))).data,
      "think Included\nthink Parent"
    );
    assert.equal(
      (await formatter.format("// comment\n#include ./parent.mu", directory)).data,
      "think Included\nthink Parent"
    );
    assert.match(
      (await formatter.format(join(directory, "missing.mu"))).data,
      /Error: File not found:/
    );
    assert.match(
      (await formatter.format("// comment\n#include ./missing.mu", directory)).data,
      /Error: File not found:/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

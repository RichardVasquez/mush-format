#!/usr/bin/env node

const { program } = require("commander");
const { readFileSync, writeFileSync } = require("fs");
const { pretty } = require("../dist/formatter");

program
  .description("Pretty-print compact MUSHcode from a file or stdin (use - for stdin).")
  .arguments("[path]")
  .option("-o, --output <file>", "Write the result to a file")
  .option("--indent <spaces>", "Spaces per indentation level", "4")
  .option("--width <characters>", "Expand expressions longer than this length", "100")
  .parse(process.argv);

try {
  const path = program.args[0];
  const input = readFileSync(!path || path === "-" ? 0 : path, "utf8");
  const result = pretty(input, { indent: Number(program.indent), width: Number(program.width) });
  if (program.output) writeFileSync(program.output, result);
  else process.stdout.write(result + (result.endsWith("\n") ? "" : "\n"));
} catch (error) {
  console.error(`mform pretty: ${error.message}`);
  process.exitCode = 1;
}

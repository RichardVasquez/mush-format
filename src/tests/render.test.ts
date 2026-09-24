/// <reference types="jest" />
import { createServer, Server } from "http";
import { AddressInfo } from "net";
import { formatter } from "../formatter";

let server: Server;
let serverUrl: string;

beforeAll((done) => {
  server = createServer((request, response) => {
    const files: { [path: string]: string } = {
      "/direct.mu": "&DIRECT me=direct",
      "/project/index.mu":
        "#include ./nested/one.mu\n#include ./sibling.mu",
      "/project/nested/one.mu":
        "&ONE me=one\n#include ../shared/two.mu",
      "/project/shared/two.mu": "&TWO me=two",
      "/project/sibling.mu": "&SIBLING me=sibling",
      "/cycle/a.mu": "#include ./b.mu",
      "/cycle/b.mu": "#include ./a.mu",
    };
    const body = files[request.url || ""];

    if (body === undefined) {
      response.statusCode = 404;
      response.end("not found");
      return;
    }

    response.end(body);
  });
  server.listen(0, "127.0.0.1", () => {
    const address = server.address() as AddressInfo;
    serverUrl = `http://127.0.0.1:${address.port}`;
    done();
  });
});

afterAll((done) => server.close(done));

const str = `
@debug
#debug {
  This is a test
}`.trim();

test("Register the @debug directive and statement", async () => {
  expect((await formatter.format(str)).data)?.toContain("This is a test");
});

test("Without the @debug directive, #debug block is removed", async () => {
  expect(
    await (
      await formatter.format("#debug{\nThis should be removed!\n}")
    ).data?.trim()
  ).toEqual("");
});

test("Headers and footers render in the file.", async () => {
  const { data } = await formatter.format(
    "#header foobar=baz\n#footer footer=footer\n"
  );
  expect(data).toContain("@@ foobar: baz");
  expect(data).toContain("@@ footer: footer");
});

test("#include pulls a remote file", async () => {
  const { data } = await formatter.format(`#include ${serverUrl}/direct.mu`);
  expect(data).toContain("&DIRECT me=direct");
});

test("remote files resolve nested, sibling, and parent-relative includes", async () => {
  const { data } = await formatter.format(
    `#include ${serverUrl}/project/index.mu`
  );
  expect(data).toContain("&ONE me=one");
  expect(data).toContain("&TWO me=two");
  expect(data).toContain("&SIBLING me=sibling");
});

test("remote includes report HTTP failures", async () => {
  const { data } = await formatter.format(`#include ${serverUrl}/missing.mu`);
  expect(data).toContain("HTTP 404");
});

test("remote includes report circular references", async () => {
  const { data } = await formatter.format(`#include ${serverUrl}/cycle/a.mu`);
  expect(data).toContain("Circular include detected");
});

test("@defines are replaced", async () => {
  expect(
    (
      await formatter.format(`
@define @test (.*) {
  This is a $1 
}

@test Foobar
    `)
    ).data!
  ).toEqual("This is a Foobar");
});

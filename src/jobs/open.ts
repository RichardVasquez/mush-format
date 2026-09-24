import { readFile } from "fs/promises";
import { existsSync } from "fs";
import _fetch from "isomorphic-fetch";
import { dirname, join, resolve } from "path";
import replace from "string-replace-async";
import validURL from "valid-url";

import { Context, Next } from "../formatter";

export default async (ctx: Context, next: Next) => {
  const read = async (
    requestedPath: string,
    parentSource?: string,
    activeSources = new Set<string>()
  ): Promise<string | undefined> => {
    let source: string | undefined;

    if (validURL.isUri(requestedPath)) {
      source = requestedPath;
    } else if (parentSource && validURL.isUri(parentSource)) {
      source = new URL(requestedPath, parentSource).toString();
    } else {
      const candidates = [
        parentSource ? join(dirname(parentSource), requestedPath) : undefined,
        ctx.path ? join(ctx.path, requestedPath) : undefined,
        requestedPath,
      ].filter((candidate): candidate is string => !!candidate);

      source = candidates.find((candidate) => existsSync(candidate));
      if (source) source = resolve(source);
    }

    if (!source) {
      if (
        parentSource ||
        requestedPath.startsWith("./") ||
        requestedPath.startsWith("/") ||
        requestedPath.startsWith("../")
      ) {
        throw new Error(`File not found: ${requestedPath}`);
      }

      return scan(requestedPath, undefined, activeSources);
    }

    if (activeSources.has(source)) {
      throw new Error(`Circular include detected: ${source}`);
    }

    activeSources.add(source);
    try {
      if (validURL.isUri(source)) {
        const response = await _fetch(source);
        if (!response.ok) {
          throw new Error(`Unable to fetch ${source}: HTTP ${response.status}`);
        }
        return await scan(await response.text(), source, activeSources);
      }

      return await scan(await readFile(source, "utf8"), source, activeSources);
    } finally {
      activeSources.delete(source);
    }
  };

  // Scan for includes and open the the file.
  async function scan(
    text: string,
    currentSource?: string,
    activeSources = new Set<string>()
  ) {
    // Open files
    let results = await replace(
      text,
      /#file\s+?(.*)/gi,
      async (...args: string[]) => {
        const res =
          (await read(
            args[1].trim(),
            currentSource,
            new Set(activeSources)
          )) || "";
        if (res) {
          return (
            "\n-\n" +
            res
              .trim()
              .split("\n")
              .map((line) => `@@ ${line}`)
              .join("\n") +
            "\n-\n"
          );
        }

        return "";
      }
    );

    return await replace(
      results,
      /#include\s+(.*)/g,
      async (...args: string[]) => {
        return (
          (await read(
            args[1].trim(),
            currentSource,
            new Set(activeSources)
          )) || ""
        );
      }
    );
  }

  ctx.scratch.current = "";
  ctx.scratch.current = await read(ctx.input);
  if (ctx.scratch.current) ctx.combined = ctx.scratch.current;
  ctx.scratch.data = ctx.scratch.current;
  next();
};

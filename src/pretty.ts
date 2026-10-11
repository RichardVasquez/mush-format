export interface PrettyOptions {
  /** Spaces per indentation level. */
  indent?: number;
  /** Expand bracketed expressions longer than this many characters. */
  width?: number;
}

interface Frame {
  close: string;
  expanded: boolean;
}

interface SwitchState {
  cases: boolean;
  commas: number;
}

/** Locate command-level switch separators, excluding nested function arguments. */
function switchBreaks(line: string): Set<number> {
  const breaks = new Set<number>();
  const frames: string[] = [];
  const states = new Map<number, SwitchState>();
  const closes: { [key: string]: string } = { "[": "]", "(": ")", "{": "}" };
  const attribute = /^&[^=]+=/.exec(line);
  const trigger = /^&[^=]+=[\$^]/.test(line);
  let commandStart = attribute && !trigger ? attribute[0].length : 0;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === "\\" || char === "%") {
      i++;
      continue;
    }
    const commandLevel = frames.every(close => close === "}");
    if (char === "@" && commandLevel && line.slice(commandStart, i).trim() === "") {
      const command = /^@sw(?:i(?:t(?:c(?:h)?)?)?)?(?:\/[a-z]+)*[ \t]+/i.exec(line.slice(i));
      if (command) {
        states.set(frames.length, { cases: false, commas: 0 });
        breaks.add(i + command[0].length);
        i += command[0].length - 1;
        continue;
      }
    }

    const state = commandLevel ? states.get(frames.length) : undefined;
    if (state && char === "=" && !state.cases) {
      state.cases = true;
      breaks.add(i + 1);
    } else if (state && char === "," && state.cases) {
      state.commas++;
      if (state.commas % 2 === 0) breaks.add(i + 1);
    }

    if (closes[char]) {
      frames.push(closes[char]);
      if (char === "{" && commandLevel) commandStart = i + 1;
    } else if (frames[frames.length - 1] === char) {
      states.delete(frames.length);
      frames.pop();
    } else if (commandLevel && char === ";") {
      states.delete(frames.length);
      commandStart = i + 1;
    } else if (!frames.length && trigger && char === ":" && commandStart === 0) {
      commandStart = i + 1;
    }
  }
  return breaks;
}

/** Add layout to compact MUSHcode without removing or rewriting characters. */
export function pretty(input: string, options: PrettyOptions = {}): string {
  const indent = options.indent === undefined ? 4 : options.indent;
  const width = options.width === undefined ? 100 : options.width;
  if (!Number.isInteger(indent) || indent < 1 || indent > 16) {
    throw new Error("indent must be an integer between 1 and 16");
  }
  if (!Number.isInteger(width) || width < 1) {
    throw new Error("width must be a positive integer");
  }

  return input.split(/\r?\n/).map(line => layout(line, indent, width)).join("\n");
}

function layout(line: string, indent: number, width: number): string {
  if (/^(?:@@|\/\/|\/\*)/.test(line)) return line;
  // Match delimiters first so only long expressions get expanded. Backslash
  // and percent escapes protect the following character from interpretation.
  const pairs = new Map<number, number>();
  const openings: { index: number; close: string }[] = [];
  const closes: { [key: string]: string } = { "[": "]", "(": ")", "{": "}" };
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === "\\" || char === "%") {
      i++;
    } else if (closes[char]) {
      openings.push({ index: i, close: closes[char] });
    } else if (openings.length && openings[openings.length - 1].close === char) {
      const opening = openings.pop()!;
      pairs.set(opening.index, i);
    }
  }

  const frames: Frame[] = [];
  const switchLines = switchBreaks(line);
  let output = "";
  let pending = false;
  const depth = () => frames.filter(frame => frame.expanded).length + 1;
  const trigger = /^&[^=]+=[\$^]/.test(line);
  let triggerEnded = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const top = frames[frames.length - 1];
    if (switchLines.has(i)) pending = true;
    let broke = false;
    const closing = top && top.close === char;
    if (closing) {
      frames.pop();
      if (top.expanded && line[i - 1] !== "[" && line[i - 1] !== "(" && line[i - 1] !== "{") {
        pending = true;
      }
    }

    // Preserve original spaces on the preceding line. The compressor strips
    // indentation, so moving those spaces onto the next line would lose them.
    // Never promote text to a formatter directive or comment. Negative cases
    // are safe: indented continuation lines are joined before dash processing.
    if (pending && !/[ \t]/.test(char)) {
      if (!/^(?:#|\/\/|\/\*|@define\b|@debug\b)/i.test(line.slice(i))) {
        output += "\n" + " ".repeat(depth() * indent);
        broke = true;
      }
      pending = false;
    }

    // Consecutive top-level expressions are easier to read on separate lines.
    if (char === "[" && !frames.length && line[i - 1] === "]" && !broke) {
      output += "\n" + " ".repeat(indent);
    }
    output += char;
    if (char === "\\" || char === "%") {
      if (i + 1 < line.length) output += line[++i];
      continue;
    }

    if (closes[char]) {
      const end = pairs.get(i);
      const commandBlock = char === "{" && frames.every(frame => frame.close === "}");
      const expanded = end !== undefined && end > i + 1 &&
        (commandBlock || end - i + 1 > width);
      frames.push({ close: closes[char], expanded });
      if (expanded) pending = true;
    } else if (char === ";" && frames.every(frame => frame.close === "}")) {
      pending = true;
    } else if (char === "," && top && top.expanded && top.close !== "}" && !closing) {
      pending = true;
    } else if (char === "," && line[i - 1] === "}" && frames.every(frame => frame.close === "}")) {
      pending = true;
    } else if (char === ":" && trigger && !triggerEnded && !frames.length) {
      triggerEnded = true;
      pending = true;
    }
  }
  return output;
}

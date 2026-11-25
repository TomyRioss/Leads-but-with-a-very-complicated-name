// Parses a JSON object that is still streaming in ("{\"a\":\"hel") into its best complete prefix ({ a: "hel" }).
// Used by /explorar to render each card while the model writes it. Returns undefined when nothing usable arrived yet.

/** Closes open strings and containers of a truncated JSON text. */
function close(text: string) {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const char of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
    } else if (char === "\"") inString = true;
    else if (char === "{") stack.push("}");
    else if (char === "[") stack.push("]");
    else if (char === "}" || char === "]") stack.pop();
  }
  return text + (inString ? "\"" : "") + stack.reverse().join("");
}

/** Structural "," "{" "[" positions outside strings: the places where a truncated text can be cut back to valid JSON. */
function cutPoints(text: string) {
  const points: number[] = [];
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
    } else if (char === "\"") inString = true;
    else if (char === ",") points.push(index);
    else if (char === "{" || char === "[") points.push(index + 1);
  }
  return points;
}

const tryParse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

// ponytail: cuts back one structural point at a time, re-closing each try; a few tries per call on a few KB of text.
export function parsePartialJson(input: string): Record<string, unknown> | undefined {
  const start = input.indexOf("{");
  if (start < 0) return undefined;
  const text = input.slice(start).replace(/\s*```\s*$/, "");
  const whole = tryParse(close(text));
  if (whole && typeof whole === "object" && !Array.isArray(whole)) return whole as Record<string, unknown>;
  const points = cutPoints(text);
  for (let index = points.length - 1; index >= 0; index--) {
    const parsed = tryParse(close(text.slice(0, points[index])));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  }
  return undefined;
}

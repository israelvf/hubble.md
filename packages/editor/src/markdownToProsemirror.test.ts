import { expect, test } from "vitest";
import { markdownToTiptapDoc } from "./markdownToProsemirror";

test("parses markdown table", () => {
  const result = markdownToTiptapDoc("| A | B |\n|---|---|\n| 1 | 2 |");
  console.log(JSON.stringify(result, null, 2));
});

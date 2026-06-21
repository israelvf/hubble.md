import { describe, expect, it } from "vitest";
import { applyPatchToMarkdown, parseMarkdownFile } from "./htmlAppFileApi";

describe("HTML app file API helpers", () => {
	it("reads markdown body and supported properties", () => {
		expect(
			parseMarkdownFile(
				"note.md",
				`---
title: Test
count: 2
nested:
  child: value
---
# Body`,
			),
		).toEqual({
			path: "note.md",
			body: "# Body",
			properties: { title: "Test", count: 2 },
		});
	});

	it("returns empty properties for invalid front matter", () => {
		expect(
			parseMarkdownFile(
				"note.md",
				`---
title: [broken
---
# Body`,
			).properties,
		).toEqual({});
	});

	it("patches properties and preserves omitted keys", () => {
		expect(
			applyPatchToMarkdown(
				`---
title: Test
status: draft
---
# Body`,
				{ properties: { status: "done", reviewed: true } },
			),
		).toBe(`---
title: "Test"
status: "done"
reviewed: true
---
# Body`);
	});

	it("keeps existing property order and appends new keys", () => {
		expect(
			applyPatchToMarkdown(
				`---
alpha: one
beta: two
gamma: three
---
# Body`,
				{ properties: { beta: "updated", delta: "new" } },
			),
		).toBe(`---
alpha: "one"
beta: "updated"
gamma: "three"
delta: "new"
---
# Body`);
	});

	it("deletes explicit null properties", () => {
		expect(
			applyPatchToMarkdown(
				`---
title: Test
status: draft
---
# Body`,
				{ properties: { status: null } },
			),
		).toBe(`---
title: "Test"
---
# Body`);
	});

	it("preserves raw front matter for body-only updates", () => {
		expect(
			applyPatchToMarkdown(
				`---
title: Test
nested:
  child: value
---
# Body`,
				{ body: "# Next" },
			),
		).toBe(`---
title: Test
nested:
  child: value
---
# Next`);
	});

	it("rejects property updates when front matter is invalid", () => {
		expect(() =>
			applyPatchToMarkdown(
				`---
title: [broken
---
# Body`,
				{ properties: { status: "done" } },
			),
		).toThrow("Cannot update properties");
	});
});

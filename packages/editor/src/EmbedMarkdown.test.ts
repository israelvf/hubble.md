import { describe, expect, it } from "vitest";
import { markdownToTiptapDoc } from "./markdownToProsemirror";
import { tiptapDocToMarkdown } from "./prosemirrorToMarkdown";

describe("embed markdown conversion", () => {
	it("parses an embed custom element into an embed node", () => {
		const doc = markdownToTiptapDoc(
			'# Roadmap\n\n<embed-kanban board="roadmap"></embed-kanban>',
		);

		expect(doc.content?.[1]).toEqual({
			type: "embed",
			attrs: {
				name: "kanban",
				tagName: "embed-kanban",
				props: {
					board: "roadmap",
				},
			},
		});
	});

	it("serializes an embed node back to custom element syntax", () => {
		const markdown = tiptapDocToMarkdown({
			type: "doc",
			content: [
				{
					type: "embed",
					attrs: {
						name: "kanban",
						tagName: "embed-kanban",
						props: {
							board: "roadmap",
						},
					},
				},
			],
		});

		expect(markdown).toBe('<embed-kanban board="roadmap"></embed-kanban>');
	});
});

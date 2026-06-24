// @vitest-environment happy-dom

import { listExtensions } from "@hubble.md/editor";
import { Editor, type JSONContent } from "@tiptap/core";
import { TaskItem } from "@tiptap/extension-list";
import { TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";

const editors: Editor[] = [];

afterEach(() => {
	for (const editor of editors) editor.destroy();
	editors.length = 0;
});

describe("task list splitting", () => {
	it("creates an unchecked task item after a checked task item", () => {
		const editor = createEditor(taskListDoc([{ checked: true, text: "done" }]));

		expect(editor.commands.keyboardShortcut("Enter")).toBe(true);

		expect(listItems(editor)).toMatchObject([
			taskItem({ checked: true, text: "done" }),
			taskItem({ checked: false }),
		]);
	});

	it("keeps unchecked task items unchecked when split", () => {
		const editor = createEditor(
			taskListDoc([{ checked: false, text: "todo" }]),
		);

		expect(editor.commands.keyboardShortcut("Enter")).toBe(true);

		expect(listItems(editor)).toMatchObject([
			taskItem({ checked: false, text: "todo" }),
			taskItem({ checked: false }),
		]);
	});

	it("creates unchecked nested task items", () => {
		const editor = createEditor(
			{
				type: "doc",
				content: [
					{
						type: "bulletList",
						content: [
							{
								type: "listItem",
								attrs: { checked: false },
								content: [
									{
										type: "paragraph",
										content: [{ type: "text", text: "parent" }],
									},
									{
										type: "bulletList",
										content: [taskItem({ checked: true, text: "nested" })],
									},
								],
							},
						],
					},
				],
			},
			"nested",
		);

		expect(editor.commands.keyboardShortcut("Enter")).toBe(true);

		const parentItem = listItems(editor)[0] as JSONContent;
		const nestedList = parentItem.content?.find(
			(node: JSONContent) => node.type === "bulletList",
		) as JSONContent | undefined;
		expect(parentItem.content?.[0]).toMatchObject({
			type: "paragraph",
			content: [{ type: "text", text: "parent" }],
		});
		expect(nestedList?.content).toMatchObject([
			taskItem({ checked: true, text: "nested" }),
			taskItem({ checked: false }),
		]);
	});

	it("keeps plain bullet list splitting unchanged", () => {
		const editor = createEditor(plainListDoc("bulletList", "plain"));

		expect(editor.commands.keyboardShortcut("Enter")).toBe(true);

		expect(listItems(editor)).toMatchObject([
			taskItem({ checked: null, text: "plain" }),
			taskItem({ checked: null }),
		]);
	});

	it("keeps ordered list splitting unchanged", () => {
		const editor = createEditor(plainListDoc("orderedList", "first"));

		expect(editor.commands.keyboardShortcut("Enter")).toBe(true);

		expect(listItems(editor, "orderedList")).toMatchObject([
			taskItem({ checked: null, text: "first" }),
			taskItem({ checked: null }),
		]);
	});
});

function createEditor(content: JSONContent, cursorText?: string) {
	const editor = new Editor({
		element: document.createElement("div"),
		extensions: [
			StarterKit.configure({
				listItem: false,
			}),
			...listExtensions,
			TaskItem.configure({ nested: true }),
		],
		content,
	});
	editors.push(editor);
	Object.defineProperty(editor, "isFocused", { value: true });
	placeCursorAfterText(editor, cursorText ?? firstText(content));
	return editor;
}

function listItems(
	editor: Editor,
	type: "bulletList" | "orderedList" = "bulletList",
) {
	const list = editor.getJSON().content?.find((node) => node.type === type);
	if (!list) throw new Error(`Expected ${type}`);
	return list.content ?? [];
}

function placeCursorAfterText(editor: Editor, text: string) {
	let position: number | null = null;
	editor.state.doc.descendants((node, pos) => {
		if (node.isText && node.text === text) {
			position = pos + node.nodeSize;
			return false;
		}
	});
	if (position === null) throw new Error(`Text not found: ${text}`);
	editor.view.dispatch(
		editor.state.tr.setSelection(
			TextSelection.create(editor.state.doc, position),
		),
	);
}

function firstText(content: JSONContent): string {
	if (typeof content.text === "string") return content.text;
	for (const child of content.content ?? []) {
		const text = firstText(child);
		if (text) return text;
	}
	return "";
}

function taskItem({
	checked,
	text,
}: {
	checked: boolean | null;
	text?: string;
}): JSONContent {
	const paragraph: JSONContent = {
		type: "paragraph",
	};
	if (text) {
		paragraph.content = [{ type: "text", text }];
	}
	return {
		type: "listItem",
		attrs: { checked },
		content: [paragraph],
	};
}

function taskListDoc(items: Array<{ checked: boolean; text: string }>) {
	return {
		type: "doc",
		content: [
			{
				type: "bulletList",
				content: items.map(taskItem),
			},
		],
	} satisfies JSONContent;
}

function plainListDoc(type: "bulletList" | "orderedList", text: string) {
	return {
		type: "doc",
		content: [
			{
				type,
				content: [taskItem({ checked: null, text })],
			},
		],
	} satisfies JSONContent;
}

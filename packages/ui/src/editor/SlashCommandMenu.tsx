import type { Editor } from "@tiptap/core";
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { Command } from "cmdk";
import {
	type ComponentType,
	type RefObject,
	useEffect,
	useRef,
	useState,
} from "react";
import MingcuteBorderHorizontalLine from "~icons/mingcute/border-horizontal-line";
import MingcuteHeading1Line from "~icons/mingcute/heading-1-line";
import MingcuteHeading2Line from "~icons/mingcute/heading-2-line";
import MingcuteHeading3Line from "~icons/mingcute/heading-3-line";
import MingcuteListCheck2Line from "~icons/mingcute/list-check-2-line";
import MingcuteListCheckLine from "~icons/mingcute/list-check-line";
import MingcuteListOrderedLine from "~icons/mingcute/list-ordered-line";
import MingcuteQuoteLeftLine from "~icons/mingcute/quote-left-line";
import MingcuteTextLine from "~icons/mingcute/text-line";
import { cn } from "../lib/utils";

type SlashCommandKind =
	| "paragraph"
	| "heading1"
	| "heading2"
	| "heading3"
	| "bulletList"
	| "orderedList"
	| "taskList"
	| "blockquote"
	| "divider";

type SlashCommand = {
	kind: SlashCommandKind;
	title: string;
	description: string;
	aliases: string[];
	icon: ComponentType<{ className?: string }>;
};

type SlashToken = {
	from: number;
	to: number;
	query: string;
};

type MenuPosition = {
	x: number;
	y: number;
};

const SLASH_COMMANDS: SlashCommand[] = [
	{
		kind: "paragraph",
		title: "Text",
		description: "Start a plain text block",
		aliases: ["paragraph", "plain"],
		icon: MingcuteTextLine,
	},
	{
		kind: "heading1",
		title: "Heading 1",
		description: "Large section heading",
		aliases: ["h1", "#", "title"],
		icon: MingcuteHeading1Line,
	},
	{
		kind: "heading2",
		title: "Heading 2",
		description: "Medium section heading",
		aliases: ["h2", "##", "subtitle"],
		icon: MingcuteHeading2Line,
	},
	{
		kind: "heading3",
		title: "Heading 3",
		description: "Small section heading",
		aliases: ["h3", "###"],
		icon: MingcuteHeading3Line,
	},
	{
		kind: "bulletList",
		title: "Bulleted list",
		description: "Create a simple list",
		aliases: ["bullet", "bullets", "ul", "list"],
		icon: MingcuteListCheckLine,
	},
	{
		kind: "orderedList",
		title: "Numbered list",
		description: "Create an ordered list",
		aliases: ["number", "numbered", "ol", "1."],
		icon: MingcuteListOrderedLine,
	},
	{
		kind: "taskList",
		title: "To-do list",
		description: "Create a task list",
		aliases: ["todo", "task", "check", "checkbox"],
		icon: MingcuteListCheck2Line,
	},
	{
		kind: "blockquote",
		title: "Quote",
		description: "Create a quote block",
		aliases: ["blockquote", ">"],
		icon: MingcuteQuoteLeftLine,
	},
	{
		kind: "divider",
		title: "Divider",
		description: "Separate sections",
		aliases: ["hr", "horizontal", "rule", "separator", "---"],
		icon: MingcuteBorderHorizontalLine,
	},
];

export function SlashCommandMenu({
	editor,
	viewportRef,
}: {
	editor: Editor | null;
	viewportRef: RefObject<HTMLDivElement | null>;
}) {
	const [token, setToken] = useState<SlashToken | null>(null);
	const [position, setPosition] = useState<MenuPosition | null>(null);
	const [selectedKind, setSelectedKind] =
		useState<SlashCommandKind>("paragraph");
	const suppressedFromRef = useRef<number | null>(null);
	const visibleCommands = SLASH_COMMANDS.filter((command) =>
		matchesCommand(command, token?.query ?? ""),
	);
	// Keep selection visible even when the current query filters out the
	// previously selected command.
	const activeKind = visibleCommands.some(
		(command) => command.kind === selectedKind,
	)
		? selectedKind
		: visibleCommands[0]?.kind;

	useEffect(() => {
		if (!editor) return;
		const viewport = viewportRef.current;

		// The query lives in ProseMirror text, not in the cmdk input. Recompute
		// the token and anchor whenever the editor may have moved.
		const update = () => {
			const nextToken = findSlashToken(editor);
			if (!nextToken) {
				suppressedFromRef.current = null;
				setToken(null);
				setPosition(null);
				return;
			}
			if (suppressedFromRef.current === nextToken.from) {
				setToken(null);
				setPosition(null);
				return;
			}
			const nextPosition = positionForToken(editor, nextToken, viewportRef);
			setToken(nextToken);
			setPosition(nextPosition);
		};

		update();
		editor.on("transaction", update);
		editor.on("selectionUpdate", update);
		editor.on("focus", update);
		editor.on("blur", update);
		viewport?.addEventListener("scroll", update, { passive: true });
		window.addEventListener("resize", update);

		return () => {
			editor.off("transaction", update);
			editor.off("selectionUpdate", update);
			editor.off("focus", update);
			editor.off("blur", update);
			viewport?.removeEventListener("scroll", update);
			window.removeEventListener("resize", update);
		};
	}, [editor, viewportRef]);

	useEffect(() => {
		if (!editor) return;

		// Keep focus in the editor so typing continues to update the document;
		// the menu only handles navigation and command selection keys.
		const handleKeyDown = (event: KeyboardEvent) => {
			if (!token) return;
			if (event.key === "Escape") {
				event.preventDefault();
				suppressedFromRef.current = token.from;
				setToken(null);
				setPosition(null);
				return;
			}
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				const currentIndex = visibleCommands.findIndex(
					(command) => command.kind === activeKind,
				);
				if (currentIndex === -1) return;
				const direction = event.key === "ArrowDown" ? 1 : -1;
				const nextIndex =
					(currentIndex + direction + visibleCommands.length) %
					visibleCommands.length;
				setSelectedKind(visibleCommands[nextIndex].kind);
				return;
			}
			if (event.key === "Enter" || event.key === "Tab") {
				const selectedCommand = visibleCommands.find(
					(command) => command.kind === activeKind,
				);
				if (!selectedCommand) return;
				event.preventDefault();
				applySlashCommand(editor, token, selectedCommand.kind);
				suppressedFromRef.current = null;
				setToken(null);
				setPosition(null);
			}
		};

		editor.view.dom.addEventListener("keydown", handleKeyDown, true);
		return () =>
			editor.view.dom.removeEventListener("keydown", handleKeyDown, true);
	}, [activeKind, editor, token, visibleCommands]);

	if (!editor || !token || !position || visibleCommands.length === 0) {
		return null;
	}

	return (
		<div
			className="absolute z-[4] w-[250px] overflow-hidden rounded-sm border border-border bg-popover text-popover-foreground shadow-panel"
			style={{
				insetInlineStart: `${position.x}px`,
				insetBlockStart: `${position.y}px`,
			}}
		>
			<Command
				label="Slash commands"
				value={activeKind}
				onValueChange={(value) => setSelectedKind(value as SlashCommandKind)}
				shouldFilter={false}
				loop
				onMouseDown={(event) => event.preventDefault()}
			>
				<Command.Input
					value={token.query}
					readOnly
					className="sr-only"
					aria-hidden="true"
					tabIndex={-1}
				/>
				<Command.List className="max-h-64 overflow-y-auto p-1">
					{visibleCommands.map((command) => {
						const Icon = command.icon;
						return (
							<Command.Item
								key={command.kind}
								value={command.kind}
								keywords={[
									command.title,
									command.description,
									...command.aliases,
								]}
								onSelect={() => {
									applySlashCommand(editor, token, command.kind);
									setToken(null);
									setPosition(null);
								}}
								className={cn(
									"flex min-w-0 cursor-default items-center gap-2 rounded-[calc(var(--radius)-2px)] px-2 py-1.5 text-start text-[11px] leading-[15px] outline-hidden",
									"data-[selected=true]:bg-muted data-[selected=true]:text-foreground",
								)}
							>
								<span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
									<Icon className="size-3.5" />
								</span>
								<span className="block min-w-0 flex-1 truncate text-foreground">
									{command.title}
								</span>
							</Command.Item>
						);
					})}
				</Command.List>
			</Command>
		</div>
	);
}

function findSlashToken(editor: Editor): SlashToken | null {
	if (!editor.isFocused || !editor.state.selection.empty) return null;
	const { $from } = editor.state.selection;
	const parent = $from.parent;
	if (!parent.isTextblock) return null;
	const textBefore = parent.textBetween(0, $from.parentOffset, "\n", "\0");
	// Slash commands start a phrase: beginning of the textblock or after
	// whitespace. This avoids triggering inside URLs and file paths.
	const match = /(^|\s)\/([^\s/]*)$/.exec(textBefore);
	if (!match) return null;
	const prefixLength = match[1].length;
	const query = match[2];
	const from = $from.start() + (match.index ?? 0) + prefixLength;
	return {
		from,
		to: $from.pos,
		query,
	};
}

function positionForToken(
	editor: Editor,
	token: SlashToken,
	viewportRef: RefObject<HTMLDivElement | null>,
): MenuPosition | null {
	const viewport = viewportRef.current;
	if (!viewport) return null;
	const coords = editor.view.coordsAtPos(token.from);
	const viewportRect = viewport.getBoundingClientRect();
	return {
		x: Math.max(8, coords.left - viewportRect.left + viewport.scrollLeft),
		y: coords.bottom - viewportRect.top + viewport.scrollTop + 6,
	};
}

function matchesCommand(command: SlashCommand, query: string) {
	if (query.trim() === "") return true;
	return (
		commandScore(command.kind, query, [
			command.title,
			command.description,
			...command.aliases,
		]) > 0
	);
}

function commandScore(value: string, search: string, keywords: string[]) {
	const normalizedSearch = normalize(search);
	if (!normalizedSearch) return 1;
	const haystacks = [value, ...keywords].map(normalize);
	let best = 0;
	for (const haystack of haystacks) {
		if (haystack === normalizedSearch) best = Math.max(best, 1);
		else if (haystack.startsWith(normalizedSearch)) best = Math.max(best, 0.9);
		else if (haystack.includes(normalizedSearch)) best = Math.max(best, 0.75);
		else if (isSubsequence(normalizedSearch, haystack)) {
			best = Math.max(best, 0.45);
		}
	}
	return best;
}

function normalize(value: string) {
	return value.toLowerCase().replace(/[\s_-]+/g, "");
}

function isSubsequence(needle: string, haystack: string) {
	let index = 0;
	for (const char of haystack) {
		if (char === needle[index]) index++;
		if (index === needle.length) return true;
	}
	return false;
}

function applySlashCommand(
	editor: Editor,
	token: SlashToken,
	kind: SlashCommandKind,
) {
	const { state, view } = editor;
	const { schema } = state;
	const $from = state.doc.resolve(token.from);
	if ($from.depth === 0) return;
	const topLevelDepth = Math.min(1, $from.depth);
	const blockStart = $from.before(topLevelDepth);
	const blockEnd = $from.after(topLevelDepth);
	const block = state.doc.nodeAt(blockStart);
	const canConvertInPlace =
		block?.type.name === "paragraph" &&
		block.content.size === token.to - token.from;
	const tr = state.tr.delete(token.from, token.to);

	// Empty paragraphs are converted in place. Otherwise, the slash token is
	// removed and the new empty block is inserted after the current top-level
	// block, matching Notion-style slash commands.
	if (canConvertInPlace) {
		const mappedBlockStart = tr.mapping.map(blockStart);
		const mappedBlockEnd = tr.mapping.map(blockEnd);
		if (kind === "divider") {
			const inserted = createInsertedBlock(schema, kind);
			if (!inserted) return;
			tr.replaceWith(mappedBlockStart, mappedBlockEnd, inserted.content);
			tr.setSelection(
				TextSelection.create(
					tr.doc,
					mappedBlockStart + inserted.selectionOffset,
				),
			);
			view.dispatch(tr.scrollIntoView());
			view.focus();
			return;
		}
		const node = createEmptyBlock(schema, kind);
		if (!node) return;
		tr.replaceWith(mappedBlockStart, mappedBlockEnd, node);
		const selectionPos = selectionPositionInsideNode(
			tr.doc.nodeAt(mappedBlockStart),
			mappedBlockStart,
		);
		tr.setSelection(TextSelection.create(tr.doc, selectionPos));
		view.dispatch(tr.scrollIntoView());
		view.focus();
		return;
	}

	const insertAt = tr.mapping.map(blockEnd);
	const inserted = createInsertedBlock(schema, kind);
	if (!inserted) return;
	tr.insert(insertAt, inserted.content);
	tr.setSelection(
		TextSelection.create(tr.doc, insertAt + inserted.selectionOffset),
	);
	view.dispatch(tr.scrollIntoView());
	view.focus();
}

function createInsertedBlock(
	schema: Editor["state"]["schema"],
	kind: SlashCommandKind,
): { content: Fragment; selectionOffset: number } | null {
	const node = createEmptyBlock(schema, kind);
	if (!node) return null;
	if (kind === "divider") {
		const paragraph = schema.nodes.paragraph.create();
		return {
			content: Fragment.fromArray([node, paragraph]),
			selectionOffset: node.nodeSize + 1,
		};
	}
	return {
		content: Fragment.from(node),
		selectionOffset: selectionOffsetInsideNode(node),
	};
}

function createEmptyBlock(
	schema: Editor["state"]["schema"],
	kind: SlashCommandKind,
): PMNode | null {
	const paragraph = schema.nodes.paragraph;
	const heading = schema.nodes.heading;
	const bulletList = schema.nodes.bulletList;
	const orderedList = schema.nodes.orderedList;
	const listItem = schema.nodes.listItem;
	const blockquote = schema.nodes.blockquote;
	const horizontalRule = schema.nodes.horizontalRule;

	switch (kind) {
		case "paragraph":
			return paragraph.create();
		case "heading1":
			return heading.create({ level: 1 });
		case "heading2":
			return heading.create({ level: 2 });
		case "heading3":
			return heading.create({ level: 3 });
		case "bulletList":
			return bulletList.create(null, listItem.create(null, paragraph.create()));
		case "orderedList":
			return orderedList.create(
				null,
				listItem.create(null, paragraph.create()),
			);
		case "taskList":
			return bulletList.create(
				null,
				listItem.create({ checked: false }, paragraph.create()),
			);
		case "blockquote":
			return blockquote.create(null, paragraph.create());
		case "divider":
			return horizontalRule.create();
	}
}

function selectionOffsetInsideNode(node: PMNode) {
	if (node.isTextblock) return 1;
	if (node.type.name === "blockquote") return 2;
	if (node.type.name === "bulletList" || node.type.name === "orderedList")
		return 3;
	return 0;
}

function selectionPositionInsideNode(node: PMNode | null, nodeStart: number) {
	if (!node) return nodeStart;
	return nodeStart + selectionOffsetInsideNode(node);
}

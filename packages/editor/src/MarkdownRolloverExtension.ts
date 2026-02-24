import { Extension } from "@tiptap/core";
import type { Mark, MarkType } from "@tiptap/pm/model";
import {
	type EditorState,
	Plugin,
	PluginKey,
	TextSelection,
	type Transaction,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

type CursorSide = "inside" | "outside";
type BoundaryType = "start" | "end";
type BoundaryMatch = { markType: MarkType; boundary: BoundaryType };
export type RolloverBoundaryState = {
	boundaryPos: number;
	markName: string;
	boundary: BoundaryType;
	side: CursorSide;
} | null;

const MARK_PRIORITY = ["code", "bold", "italic", "strike", "link"] as const;
const DELIMITER_BY_MARK: Record<
	string,
	{ start: string; end: string } | undefined
> = {
	code: { start: "`", end: "`" },
	bold: { start: "**", end: "**" },
	italic: { start: "*", end: "*" },
	strike: { start: "~~", end: "~~" },
	link: { start: "[", end: "]" },
};

export const MarkdownRolloverKey = new PluginKey<RolloverBoundaryState>(
	"markdownRollover",
);

export function getMarkdownRolloverBoundaryState(state: EditorState) {
	return MarkdownRolloverKey.getState(state) ?? null;
}

export const MarkdownRolloverExtension = Extension.create({
	name: "markdownRollover",

	addProseMirrorPlugins() {
		let isPointerDown = false;
		let frozenDecorations: DecorationSet | null = null;
		return [
			new Plugin<RolloverBoundaryState>({
				key: MarkdownRolloverKey,
				state: {
					init: (_config, state) => deriveBoundaryState(state, null),
					apply: (tr, prev, _oldState, newState) => {
						const meta = tr.getMeta(MarkdownRolloverKey) as
							| RolloverBoundaryState
							| undefined;
						if (meta !== undefined) return meta;

						const mappedPrev =
							prev && tr.docChanged
								? {
										...prev,
										boundaryPos: tr.mapping.map(prev.boundaryPos),
									}
								: prev;

						return deriveBoundaryState(newState, mappedPrev, {
							oldState: _oldState,
							transaction: tr,
						});
					},
				},
				props: {
					handleDOMEvents: {
						mousedown: (view, event) => {
							// Freeze currently visible delimiter decorations during
							// pointer-down so interim selection updates don't reflow them.
							isPointerDown = true;
							frozenDecorations = buildRolloverDecorations(view.state);
							const handled = maybeHandleDelimiterMouseDown(
								view,
								event as MouseEvent,
							);
							return handled;
						},
						mouseup: (view) => {
							if (!isPointerDown) return false;
							// Release frozen visuals at pointer-up and repaint against the
							// final selection state after the click/drag settles.
							isPointerDown = false;
							frozenDecorations = null;
							view.dispatch(view.state.tr);
							return false;
						},
					},
					handleKeyDown: (view, event) => {
						if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
							const next = getBoundaryTransition(view, event.key);
							if (!next) return false;

							const tr = view.state.tr.setSelection(
								TextSelection.create(view.state.doc, next.boundaryPos),
							);
							setStoredMarkIntent(tr, view.state, next.markType, next.side);
							tr.setMeta(MarkdownRolloverKey, {
								boundaryPos: next.boundaryPos,
								markName: next.markType.name,
								boundary: next.boundary,
								side: next.side,
							} satisfies NonNullable<RolloverBoundaryState>);
							view.dispatch(tr);
							event.preventDefault();
							return true;
						}

						if (event.key === "Backspace" || event.key === "Delete") {
							const handled = maybeHandleDeleteAtDelimiter(view);
							if (!handled) return false;
							event.preventDefault();
							return true;
						}

						return false;
					},
					decorations: (state) => {
						if (isPointerDown) return frozenDecorations;
						return buildRolloverDecorations(state);
					},
				},
			}),
		];
	},
});

function buildRolloverDecorations(state: EditorState): DecorationSet | null {
	const active = getActiveMarkContext(state);
	if (!active) return null;
	const delimiters = DELIMITER_BY_MARK[active.markType.name];
	if (!delimiters) return null;

	const startWidget = Decoration.widget(
		active.from,
		() =>
			createDelimiterWidget({
				delimiter: delimiters.start,
				markName: active.markType.name,
				boundary: "start",
				pos: active.from,
			}),
		{ side: -1 },
	);
	const endWidget = Decoration.widget(
		active.to,
		() =>
			createDelimiterWidget({
				delimiter: delimiters.end,
				markName: active.markType.name,
				boundary: "end",
				pos: active.to,
			}),
		{ side: 1 },
	);

	return DecorationSet.create(state.doc, [startWidget, endWidget]);
}
/**
 * Handles direct interaction with markdown delimiter widgets on pointer-down.
 *
 * We resolve inside/outside side intent on mousedown (not click/mouseup) so
 * boundary targeting is captured before subsequent selection churn.
 */
function maybeHandleDelimiterMouseDown(
	view: EditorView,
	event: MouseEvent,
): boolean {
	const target = event.target as HTMLElement | null;
	const delimiter = target?.closest(".pm-md-delimiter") as HTMLElement | null;
	if (!delimiter) return false;

	const markName = delimiter.dataset.mark;
	const boundary = delimiter.dataset.boundary as BoundaryType | undefined;
	const boundaryPos = Number(delimiter.dataset.pos);
	if (!markName || !boundary || Number.isNaN(boundaryPos)) return false;

	const markType = view.state.schema.marks[markName];
	if (!markType) return false;

	const rect = delimiter.getBoundingClientRect();
	const sideOfDelimiter: "left" | "right" =
		event.clientX < rect.left + rect.width / 2 ? "left" : "right";
	const side =
		boundary === "start"
			? sideOfDelimiter === "left"
				? "outside"
				: "inside"
			: sideOfDelimiter === "left"
				? "inside"
				: "outside";

	const tr = view.state.tr.setSelection(
		TextSelection.create(view.state.doc, boundaryPos),
	);
	setStoredMarkIntent(tr, view.state, markType, side);
	tr.setMeta(MarkdownRolloverKey, {
		boundaryPos,
		markName,
		boundary,
		side,
	} satisfies NonNullable<RolloverBoundaryState>);
	view.dispatch(tr);
	event.preventDefault();
	return true;
}

function createDelimiterWidget({
	delimiter,
	markName,
	boundary,
	pos,
}: {
	delimiter: string;
	markName: string;
	boundary: BoundaryType;
	pos: number;
}) {
	const span = document.createElement("span");
	span.className = `pm-md-delimiter pm-md-delimiter-${boundary}`;
	span.dataset.mark = markName;
	span.dataset.boundary = boundary;
	span.dataset.pos = String(pos);
	span.contentEditable = "false";
	span.textContent = delimiter;
	return span;
}

function getBoundaryTransition(
	view: EditorView,
	key: "ArrowLeft" | "ArrowRight",
): {
	boundaryPos: number;
	markType: MarkType;
	boundary: BoundaryType;
	side: CursorSide;
} | null {
	const { state } = view;
	const { selection } = state;
	if (!selection.empty) return null;

	const boundaryMatch = getBoundaryMatchAtPos(state, selection.from);
	if (!boundaryMatch) return null;

	const boundaryState = MarkdownRolloverKey.getState(state) ?? null;
	const currentSide = getCurrentCursorSide(
		state,
		boundaryMatch.markType,
		boundaryState,
	);

	const nextSide = getNextSideForArrow({
		boundary: boundaryMatch.boundary,
		currentSide,
		key,
	});
	if (!nextSide || nextSide === currentSide) return null;

	return {
		boundaryPos: selection.from,
		markType: boundaryMatch.markType,
		boundary: boundaryMatch.boundary,
		side: nextSide,
	};
}

function maybeHandleDeleteAtDelimiter(view: EditorView): boolean {
	const { state } = view;
	const { selection } = state;
	if (!selection.empty) return false;

	const boundaryMatch = getBoundaryMatchAtPos(state, selection.from);
	if (!boundaryMatch) return false;

	const boundaryState = MarkdownRolloverKey.getState(state) ?? null;
	const currentSide = getCurrentCursorSide(
		state,
		boundaryMatch.markType,
		boundaryState,
	);
	if (!isCursorRightOfDelimiter(boundaryMatch.boundary, currentSide))
		return false;

	const range = findMarkRangeAtPos(
		state,
		selection.from,
		boundaryMatch.markType,
	);
	if (!range) return false;

	const tr = state.tr.removeMark(range.from, range.to, boundaryMatch.markType);
	tr.removeStoredMark(boundaryMatch.markType);
	tr.setSelection(TextSelection.create(tr.doc, selection.from));
	view.dispatch(tr);
	return true;
}

function inferSideFromCursorMotion(
	oldState: EditorState,
	newState: EditorState,
	transaction: Transaction,
	boundaryMatch: BoundaryMatch,
): CursorSide | null {
	if (!transaction.selectionSet) return null;
	if (!oldState.selection.empty || !newState.selection.empty) return null;

	const oldPos = oldState.selection.from;
	const newPos = newState.selection.from;
	if (oldPos === newPos) return null;
	const rangeAtBoundaryPos = findMarkRangeAtPos(
		newState,
		newPos,
		boundaryMatch.markType,
	);
	if (!rangeAtBoundaryPos) return null;

	const movedLeft = oldPos > newPos;
	const movedRight = oldPos < newPos;

	if (
		boundaryMatch.boundary === "start" &&
		newPos === rangeAtBoundaryPos.from &&
		((movedLeft &&
			oldPos > rangeAtBoundaryPos.from &&
			oldPos <= rangeAtBoundaryPos.to) ||
			(movedRight && oldPos <= rangeAtBoundaryPos.from))
	) {
		return "inside";
	}

	if (
		boundaryMatch.boundary === "end" &&
		newPos === rangeAtBoundaryPos.to &&
		((movedRight &&
			oldPos < rangeAtBoundaryPos.to &&
			oldPos >= rangeAtBoundaryPos.from) ||
			(movedLeft && oldPos >= rangeAtBoundaryPos.to))
	) {
		return "inside";
	}

	return null;
}

function getNextSideForArrow({
	boundary,
	currentSide,
	key,
}: {
	boundary: BoundaryType;
	currentSide: CursorSide;
	key: "ArrowLeft" | "ArrowRight";
}): CursorSide | null {
	if (boundary === "start") {
		if (key === "ArrowLeft" && currentSide === "inside") return "outside";
		if (key === "ArrowRight" && currentSide === "outside") return "inside";
		return null;
	}

	if (key === "ArrowLeft" && currentSide === "outside") return "inside";
	if (key === "ArrowRight" && currentSide === "inside") return "outside";
	return null;
}

function isCursorRightOfDelimiter(boundary: BoundaryType, side: CursorSide) {
	return (
		(boundary === "start" && side === "inside") ||
		(boundary === "end" && side === "outside")
	);
}

function deriveBoundaryState(
	state: EditorState,
	prev: RolloverBoundaryState,
	context?: {
		oldState: EditorState;
		transaction: Transaction;
	},
): RolloverBoundaryState {
	const { selection } = state;
	if (!selection.empty) return null;

	const boundaryMatch = getBoundaryMatchAtPos(state, selection.from);
	if (!boundaryMatch) return null;

	if (
		prev &&
		prev.boundaryPos === selection.from &&
		prev.markName === boundaryMatch.markType.name &&
		prev.boundary === boundaryMatch.boundary
	) {
		return prev;
	}

	const inferredSide = context
		? inferSideFromCursorMotion(
				context.oldState,
				state,
				context.transaction,
				boundaryMatch,
			)
		: null;

	return {
		boundaryPos: selection.from,
		markName: boundaryMatch.markType.name,
		boundary: boundaryMatch.boundary,
		side:
			inferredSide ??
			(isMarkActiveForInsertion(state, boundaryMatch.markType)
				? "inside"
				: "outside"),
	};
}

function getActiveMarkContext(
	state: EditorState,
): { markType: MarkType; from: number; to: number } | null {
	const { selection } = state;
	if (!selection.empty) return null;

	const pos = selection.from;
	const markType = getPreferredMarkAtPos(state, pos);
	if (!markType) return null;

	const range = findMarkRangeAtPos(state, pos, markType);
	if (!range || range.from >= range.to) return null;
	return { markType, from: range.from, to: range.to };
}

function getPreferredMarkAtPos(
	state: EditorState,
	pos: number,
): MarkType | null {
	const markFromStored = findByPriority(
		state,
		state.storedMarks ?? state.selection.$from.marks(),
	);
	if (markFromStored) return markFromStored;

	const $pos = state.doc.resolve(pos);
	const before = findByPriority(state, $pos.nodeBefore?.marks ?? []);
	if (before) return before;

	return findByPriority(state, $pos.nodeAfter?.marks ?? []);
}

function getBoundaryMatchAtPos(
	state: EditorState,
	pos: number,
): BoundaryMatch | null {
	const $pos = state.doc.resolve(pos);
	const beforeMarks = $pos.nodeBefore?.marks ?? [];
	const afterMarks = $pos.nodeAfter?.marks ?? [];

	for (const markName of MARK_PRIORITY) {
		const markType = state.schema.marks[markName];
		if (!markType) continue;
		const hasBefore = !!markType.isInSet(beforeMarks);
		const hasAfter = !!markType.isInSet(afterMarks);
		if (!hasBefore && hasAfter) return { markType, boundary: "start" };
		if (hasBefore && !hasAfter) return { markType, boundary: "end" };
	}

	return null;
}

function getCurrentCursorSide(
	state: EditorState,
	markType: MarkType,
	boundaryState: RolloverBoundaryState,
): CursorSide {
	if (
		boundaryState &&
		boundaryState.boundaryPos === state.selection.from &&
		boundaryState.markName === markType.name
	) {
		return boundaryState.side;
	}
	return isMarkActiveForInsertion(state, markType) ? "inside" : "outside";
}

function setStoredMarkIntent(
	tr: Transaction,
	state: EditorState,
	markType: MarkType,
	side: CursorSide,
) {
	if (side === "inside") {
		const mark = markType.create();
		const activeMarks = tr.storedMarks ?? state.selection.$from.marks();
		if (!markType.isInSet(activeMarks ?? [])) {
			tr.addStoredMark(mark);
		}
		return;
	}

	tr.removeStoredMark(markType);
}

function isMarkActiveForInsertion(state: EditorState, markType: MarkType) {
	const marks = state.storedMarks ?? state.selection.$from.marks();
	return !!markType.isInSet(marks);
}

function findByPriority(
	state: EditorState,
	marks: readonly Mark[],
): MarkType | null {
	for (const markName of MARK_PRIORITY) {
		const markType = state.schema.marks[markName];
		if (markType?.isInSet(marks)) {
			return markType;
		}
	}
	return null;
}

function findMarkRangeAtPos(
	state: EditorState,
	pos: number,
	markType: MarkType,
): { from: number; to: number } | null {
	const $pos = state.doc.resolve(pos);
	const parent = $pos.parent;

	let index: number | null = null;
	if ($pos.nodeAfter && markType.isInSet($pos.nodeAfter.marks)) {
		index = $pos.index();
	} else if ($pos.nodeBefore && markType.isInSet($pos.nodeBefore.marks)) {
		index = $pos.index() - 1;
	}
	if (index === null || index < 0 || index >= parent.childCount) return null;

	let startIndex = index;
	let endIndex = index;

	let from = $pos.start();
	for (let i = 0; i < startIndex; i++) {
		from += parent.child(i).nodeSize;
	}
	let to = from + parent.child(index).nodeSize;

	while (
		startIndex > 0 &&
		!!markType.isInSet(parent.child(startIndex - 1).marks)
	) {
		startIndex -= 1;
		from -= parent.child(startIndex).nodeSize;
	}

	while (
		endIndex + 1 < parent.childCount &&
		!!markType.isInSet(parent.child(endIndex + 1).marks)
	) {
		endIndex += 1;
		to += parent.child(endIndex).nodeSize;
	}

	return { from, to };
}

export const __testing = {
	getNextSideForArrow,
	inferSideFromCursorMotion,
	isCursorRightOfDelimiter,
};

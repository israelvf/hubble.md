import { getActiveLinkRange } from "@hubble.md/editor";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Editor } from "@tiptap/core";
import { keymatch } from "keymatch";
import { type RefObject, useEffect, useRef, useState } from "react";

type LinkStatus = "idle" | "focused" | "hidden";

export function LinkPopover({
	editor,
	containerRef,
}: {
	editor: Editor | null;
	containerRef: RefObject<HTMLDivElement | null>;
}) {
	const [status, setStatus] = useState<LinkStatus>("idle");
	const [left, setLeft] = useState(0);
	const [top, setTop] = useState(0);
	const [hrefValue, setHrefValue] = useState("");
	const [activeLink, setActiveLink] = useState<{
		from: number;
		to: number;
		href: string;
	} | null>(null);
	const inputRef = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		if (!editor) return;
		const update = () => {
			const link = getActiveLinkRange(editor.state);
			setActiveLink(link);
			if (link) {
				setHrefValue(link.href);
			}
			const container = containerRef.current;
			if (!container || !link || status === "hidden") return;
			const coords = editor.view.coordsAtPos(editor.state.selection.from);
			const containerRect = container.getBoundingClientRect();
			const popoverWidth = 300;
			const inlinePadding = 8;
			const desiredLeft = coords.left - containerRect.left;
			const clampedLeft = Math.max(
				inlinePadding,
				Math.min(
					desiredLeft,
					containerRect.width - popoverWidth - inlinePadding,
				),
			);
			const desiredTop = coords.top - containerRect.top - 38;
			setLeft(clampedLeft);
			setTop(
				desiredTop < 0 ? coords.bottom - containerRect.top + 8 : desiredTop,
			);
		};

		update();
		editor.on("selectionUpdate", update);
		editor.on("transaction", update);
		editor.on("focus", update);
		editor.on("blur", update);
		window.addEventListener("resize", update);
		window.addEventListener("scroll", update, true);

		return () => {
			editor.off("selectionUpdate", update);
			editor.off("transaction", update);
			editor.off("focus", update);
			editor.off("blur", update);
			window.removeEventListener("resize", update);
			window.removeEventListener("scroll", update, true);
		};
	}, [editor, containerRef, status]);

	useEffect(() => {
		if (!activeLink) return;
		setStatus((prev) => (prev === "hidden" ? "hidden" : "idle"));
	}, [activeLink]);

	useEffect(() => {
		if (!editor || !activeLink || status === "hidden") return;
		const onKeyDown = (event: KeyboardEvent) => {
			const isInputFocused = document.activeElement === inputRef.current;
			const editorFocused = editor.isFocused;

			if (status !== "focused" && keymatch(event, "Tab")) {
				event.preventDefault();
				setStatus("focused");
				queueMicrotask(() => {
					inputRef.current?.focus();
					inputRef.current?.select();
				});
				return;
			}

			if (
				isInputFocused &&
				(keymatch(event, "Enter") || keymatch(event, "Escape"))
			) {
				event.preventDefault();
				editor.commands.focus(undefined, { scrollIntoView: false });
				return;
			}

			if (editorFocused && keymatch(event, "Escape")) {
				event.preventDefault();
				setStatus("hidden");
				return;
			}

			if (keymatch(event, "CmdOrCtrl+Enter")) {
				event.preventDefault();
				void visitLink(activeLink.href);
				return;
			}

			if (keymatch(event, "CmdOrCtrl+Shift+C")) {
				event.preventDefault();
				void navigator.clipboard.writeText(activeLink.href);
			}
		};

		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [editor, activeLink, status]);

	if (!editor || !activeLink || status === "hidden") return null;

	const handleInput = (href: string) => {
		setHrefValue(href);
		const linkType = editor.state.schema.marks.link;
		if (!linkType) return;
		const tr = editor.state.tr.removeMark(
			activeLink.from,
			activeLink.to,
			linkType,
		);
		tr.addMark(activeLink.from, activeLink.to, linkType.create({ href }));
		editor.view.dispatch(tr);
	};

	return (
		<div
			className="link-popover"
			style={{ insetInlineStart: `${left}px`, insetBlockStart: `${top}px` }}
		>
			<div className="link-popover-inner">
				<div className="link-input-container">
					{status === "idle" && <span className="link-tab-label">Tab</span>}
					<input
						ref={inputRef}
						type="text"
						value={hrefValue}
						onChange={(event) => handleInput(event.target.value)}
						onFocus={() => setStatus("focused")}
						onBlur={() => setStatus("idle")}
					/>
				</div>
				<button
					type="button"
					onClick={() => {
						void visitLink(activeLink.href);
					}}
				>
					↗
				</button>
			</div>
		</div>
	);
}

async function visitLink(href: string) {
	try {
		const parsed = new URL(href);
		const protocol = parsed.protocol.toLowerCase();
		if (protocol !== "http:" && protocol !== "https:") {
			// TODO: Replace console warnings with app toast notifications.
			console.warn(`[LinkPopover] blocked non-http(s) URL: ${href}`);
			return;
		}
		await openUrl(href);
	} catch {
		// TODO: Replace console warnings with app toast notifications.
		console.warn(`[LinkPopover] invalid URL: ${href}`);
	}
}

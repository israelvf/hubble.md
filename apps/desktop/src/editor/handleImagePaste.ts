import { invoke } from "@tauri-apps/api/core";
import type { Editor } from "@tiptap/core";
import { toast } from "sonner";

type PersistPastedImageResponse = {
	relativeMarkdownPath?: string;
	relative_markdown_path?: string;
};

async function persistAndInsertImage({
	editor,
	notePath,
	imageFile,
}: {
	editor: Editor;
	notePath: string;
	imageFile: File;
}) {

	try {
		const bytes = Array.from(new Uint8Array(await imageFile.arrayBuffer()));
		const result = await invoke<PersistPastedImageResponse>("persist_pasted_image", {
			notePath,
			bytes,
			mimeType: imageFile.type || null,
		});
		const relativeMarkdownPath =
			result.relativeMarkdownPath ?? result.relative_markdown_path ?? "";
		if (relativeMarkdownPath.trim().length === 0) {
			throw new Error("Image persisted but returned empty markdown path.");
		}
		const inserted = editor
			.chain()
			.focus()
			.setImage({ src: relativeMarkdownPath, alt: "" })
			.run();
		if (!inserted) {
			throw new Error("TipTap rejected image insertion at current selection.");
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		toast.error("Failed to paste image", { description: message });
	}
}

export function handleImagePaste({
	editor,
	notePath,
	event,
}: {
	editor: Editor | null;
	notePath: string;
	event: ClipboardEvent;
}): boolean {
	if (!editor) return false;
	const items = event.clipboardData?.items;
	if (!items) return false;
	const imageItem = Array.from(items).find((item) => item.type.startsWith("image/"));
	const imageFile = imageItem?.getAsFile();
	if (!imageFile) return false;
	event.preventDefault();
	void persistAndInsertImage({ editor, notePath, imageFile });
	return true;
}

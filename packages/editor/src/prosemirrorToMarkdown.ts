import type { JSONContent } from "@tiptap/core";

/**
 * Convert TipTap JSONContent (ProseMirror document) -> Markdown string
 * This is the reverse of remark-to-prosemirror.ts and runs synchronously.
 */
export function tiptapDocToMarkdown(doc: JSONContent): string {
	if (doc.type !== "doc" || !doc.content) {
		return "";
	}

	const blocks = doc.content.map(blockToMarkdown);
	return blocks.join("\n\n");
}

function blockToMarkdown(node: JSONContent): string {
	if (!node.type) return "";

	switch (node.type) {
		case "paragraph": {
			const content = inlineToMarkdown(node.content ?? []);
			// Empty paragraphs should produce a blank line
			return content || "";
		}

		case "heading": {
			const level = node.attrs?.level ?? 1;
			const content = inlineToMarkdown(node.content ?? []);
			const hashes = "#".repeat(Math.min(Math.max(level, 1), 6));
			return `${hashes} ${content}`;
		}

		case "blockquote": {
			const blockContent = (node.content ?? [])
				.map(blockToMarkdown)
				.filter(Boolean)
				.join("\n\n");
			// Add '> ' prefix to each line
			return blockContent
				.split("\n")
				.map((line) => `> ${line}`)
				.join("\n");
		}

		case "codeBlock": {
			const content = node.content?.[0]?.text ?? "";
			// Use triple backticks for code blocks
			return `\`\`\`\n${content}\n\`\`\``;
		}

		case "horizontalRule": {
			return "---";
		}

		case "orderedList": {
			const start = node.attrs?.start ?? 1;
			return (node.content ?? [])
				.map((item, index) => listItemToMarkdown(item, start + index))
				.filter(Boolean)
				.join("\n");
		}

		case "bulletList": {
			return (node.content ?? [])
				.map((item) => listItemToMarkdown(item))
				.filter(Boolean)
				.join("\n");
		}

		case "image": {
			const src = node.attrs?.src ?? "";
			const alt = node.attrs?.alt ?? "";

			return `![${alt}](${src})`;
		}

		default:
			return "";
	}
}

function getLinkHref(node: JSONContent | undefined): string | null {
	if (!node?.marks) return null;
	const linkMark = node.marks.find((mark) => mark.type === "link");
	if (!linkMark) return null;
	const href = (linkMark.attrs as { href?: unknown } | undefined)?.href;
	return typeof href === "string" ? href : null;
}

function removeLinkMark(node: JSONContent): JSONContent {
	if (!node.marks) return node;
	return {
		...node,
		marks: node.marks.filter((mark) => mark.type !== "link"),
	};
}

function listItemToMarkdown(item: JSONContent, number?: number): string {
	if (item.type !== "listItem") return "";

	const isBullet = number === undefined;
	const content = (item.content ?? [])
		.map((node, index) => {
			if (index === 0 && node.type === "paragraph") {
				// First paragraph content goes inline with the bullet/number or checkbox
				return inlineToMarkdown(node.content ?? []);
			}
			// Additional blocks are indented
			return blockToMarkdown(node)
				.split("\n")
				.map((line) => `  ${line}`)
				.join("\n");
		})
		.filter(Boolean)
		.join("\n");

	// If this is a bullet item and it has a checked attribute (true/false), render as a task item
	const hasCheckedAttr = item.attrs && "checked" in item.attrs;
	const checked = hasCheckedAttr ? item.attrs?.checked : null;

	if (isBullet && checked !== null && checked !== undefined) {
		const checkbox = checked ? "[x]" : "[ ]";
		return `- ${checkbox} ${content}`;
	}

	const prefix = isBullet ? "-" : `${number}.`;
	return `${prefix} ${content}`;
}

function inlineToMarkdown(nodes: JSONContent[]): string {
	let result = "";
	for (let i = 0; i < nodes.length; ) {
		const href = getLinkHref(nodes[i]);
		if (!href) {
			result += nodeToMarkdown(nodes[i]);
			i += 1;
			continue;
		}

		let j = i;
		const grouped: JSONContent[] = [];
		while (j < nodes.length && getLinkHref(nodes[j]) === href) {
			grouped.push(removeLinkMark(nodes[j]));
			j += 1;
		}
		result += `[${grouped.map(nodeToMarkdown).join("")}](${href})`;
		i = j;
	}
	return result;
}

function nodeToMarkdown(node: JSONContent): string {
	if (!node.type) return "";

	switch (node.type) {
		case "text": {
			let text = node.text ?? "";

			// Apply marks in the correct order for Markdown
			const marks = node.marks ?? [];

			for (const mark of marks) {
				switch (mark.type) {
					case "code":
						text = `\`${text}\``;
						break;
					case "bold":
						text = `**${text}**`;
						break;
					case "italic":
						text = `*${text}*`;
						break;
					case "strike":
						text = `~~${text}~~`;
						break;
					case "link":
						break;
				}
			}

			return text;
		}

		case "hardBreak": {
			return "  \n"; // Two spaces + newline creates a line break in Markdown
		}

		default:
			return "";
	}
}

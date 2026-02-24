import type { JSONContent } from "@tiptap/core";
import type { Element as HastElement, Root as HastRoot } from "hast";
import { fromHtml } from "hast-util-from-html";
import type { Content, Image, List, ListItem, Paragraph, Root } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { type Plugin, unified } from "unified";
import { visit } from "unist-util-visit";

// Convert Markdown (string) -> TipTap JSONContent (ProseMirror document)
export function markdownToTiptapDoc(markdown: string): JSONContent {
	const input = rawMarkdownAddEmptyMarkers(markdown);
	const processor = unified()
		.use(remarkParse)
		.use(remarkGfm)
		.use(remarkRemoveEmptyMarkers);
	const parsed = processor.parse(input);
	const tree = processor.runSync(parsed) as Root;
	return {
		type: "doc",
		content: normalizeBlockContent(tree.children).flatMap(blockToPM),
	} satisfies JSONContent;
}

function normalizeBlockContent(children: Content[]): Content[] {
	// mdast root.children are already block-level. Return as-is for now.
	return children;
}

function blockToPM(node: Content): JSONContent[] {
	switch (node.type) {
		case "paragraph": {
			const [maybeImage] = node.children;
			if (maybeImage?.type === "image") {
				return imageToPM(maybeImage);
			}

			return [
				{
					type: "paragraph",
					content: inlineToPM(node.children ?? []),
				},
			];
		}
		case "heading":
			return [
				{
					type: "heading",
					attrs: { level: node.depth ?? 1 },
					content: inlineToPM(node.children ?? []),
				},
			];
		case "blockquote":
			return [
				{
					type: "blockquote",
					content: (node.children ?? []).flatMap((n) =>
						blockToPM(n as Content),
					),
				},
			];
		case "code":
			return [
				{
					type: "codeBlock",
					// TipTap CodeBlock (not Lowlight) doesn’t have a language attr in StarterKit; keep plain.
					content: node.value ? [{ type: "text", text: node.value }] : [],
				},
			];
		case "thematicBreak":
			return [{ type: "horizontalRule" }];
		case "list": {
			const list = node as List;
			if (list.ordered) {
				// Ordered list: ignore any task checkbox semantics
				return [
					{
						type: "orderedList",
						attrs: { start: list.start ?? 1 },
						content: list.children.flatMap((li) =>
							listItemToPM(li as ListItem, /* allowChecked */ false),
						),
					},
				];
			}

			// Bullet list: allow listItem.checked to flow into attrs.checked
			return [
				{
					type: "bulletList",
					content: list.children.flatMap((li) =>
						listItemToPM(li as ListItem, /* allowChecked */ true),
					),
				},
			];
		}
		case "html": {
			// Parse HTML to extract img tags, fallback to text for everything else
			const raw = node.value ?? "";
			if (raw.trim() === "") return [];

			// Try to parse as HTML and extract img tags
			try {
				const hastTree = fromHtml(raw, { fragment: true });
				const images = extractImagesFromHast(hastTree);
				if (images.length > 0) {
					return images;
				}
			} catch {
				// If parsing fails, fall through to text fallback
			}

			// Fallback: keep raw HTML as a text paragraph to avoid data loss
			return [
				{
					type: "paragraph",
					content: [{ type: "text", text: raw }],
				},
			];
		}
		case "table":
		case "tableRow":
		case "tableCell":
		case "image": {
			return imageToPM(node as Image);
		}
		default: {
			// Unknown block: try to stringify inline if possible or drop.
			// For safety, don’t throw; produce nothing.
			return [];
		}
	}
}

function listItemToPM(li: ListItem, allowChecked: boolean): JSONContent[] {
	// mdast listItem children may be paragraphs and nested lists.
	const blocks = (li.children ?? []) as Content[];
	const first = blocks[0];
	const paragraphContent =
		first && first.type === "paragraph" ? inlineToPM(first.children ?? []) : [];
	const restBlocks = (
		first && first.type === "paragraph" ? blocks.slice(1) : blocks
	).flatMap(blockToPM);
	const content: JSONContent[] = [];
	content.push({ type: "paragraph", content: paragraphContent });
	content.push(...restBlocks);

	const checkedAttr = allowChecked && li.checked != null ? !!li.checked : null;
	return [
		{
			type: "listItem",
			attrs: { checked: checkedAttr },
			content,
		},
	];
}

function imageToPM(imageNode: Image): JSONContent[] {
	return [
		{
			type: "image",
			attrs: {
				src: imageNode.url || "",
				alt: imageNode.alt || "",
				title: imageNode.title || undefined,
			},
		},
	];
}

function inlineToPM(children: Content[]): JSONContent[] {
	const out: JSONContent[] = [];
	for (const child of children ?? []) {
		switch (child.type) {
			case "text":
				if (child.value && child.value.length > 0) {
					out.push({ type: "text", text: child.value });
				}
				break;
			case "strong":
				out.push(...applyMark(inlineToPM(child.children ?? []), "bold"));
				break;
			case "emphasis":
				out.push(...applyMark(inlineToPM(child.children ?? []), "italic"));
				break;
			case "delete":
				out.push(...applyMark(inlineToPM(child.children ?? []), "strike"));
				break;
			case "inlineCode":
				if (child.value) {
					out.push({
						type: "text",
						text: child.value,
						marks: [{ type: "code" }],
					});
				}
				break;
			case "break":
				out.push({ type: "hardBreak" });
				break;
			case "link":
				out.push(
					...applyMark(
						inlineToPM(child.children ?? []),
						"link",
						typeof child.url === "string" ? { href: child.url } : undefined,
					),
				);
				break;
			case "image":
				// Not supported; render alt text inline.
				if (child.alt) out.push({ type: "text", text: child.alt });
				break;
			case "html":
				if (child.value) out.push({ type: "text", text: child.value });
				break;
			default:
				// Unknown inline; ignore.
				break;
		}
	}
	return out;
}

function applyMark(
	nodes: JSONContent[],
	markType: "bold" | "italic" | "strike" | "link",
	attrs?: Record<string, unknown>,
): JSONContent[] {
	return nodes.map((n) => {
		if (n.type === "text") {
			const marks = [
				...(n.marks ?? []),
				attrs ? { type: markType, attrs } : { type: markType },
			];
			return { ...n, marks };
		}
		// For nested structures, descend if needed; most inline nodes here are text/hardBreak only.
		return n;
	});
}

const EMPTY_PARKER = "HUBBLE_INTERNAL_EMPTY_MARKER";

function rawMarkdownAddEmptyMarkers(rawMarkdown: string) {
	return (
		rawMarkdown
			// Handle empty paragraphs by double newlines
			.split("\n\n")
			.map((line) => {
				// Runs of empty lines are truncated into a single paragraph.
				// Add a marker to force each empty line to be a new paragraph.
				if (line.length === 0) {
					return EMPTY_PARKER;
				}
				return line;
			})
			.join("\n\n")
			// Handle empty checklist items by single newline
			.split("\n")
			.map((line) => {
				if (line.match(/^-\s\[(\s|x)\]\s*$/)) {
					return `${line} ${EMPTY_PARKER}`;
				}
				return line;
			})
			.join("\n")
	);
}

/**
 * Extract image nodes from a HAST tree (parsed HTML).
 */
function extractImagesFromHast(hastTree: HastRoot): JSONContent[] {
	const images: JSONContent[] = [];

	function visitHastNode(node: HastRoot | HastElement) {
		if (node.type === "element" && node.tagName === "img") {
			const attrs: {
				src?: string;
				alt?: string;
				title?: string;
				width?: number;
				height?: number;
			} = {};
			if (node.properties?.src) attrs.src = String(node.properties.src);
			if (node.properties?.alt) attrs.alt = String(node.properties.alt);
			if (node.properties?.title) attrs.title = String(node.properties.title);
			if (node.properties?.width)
				attrs.width = Number(node.properties.width) || undefined;
			if (node.properties?.height)
				attrs.height = Number(node.properties.height) || undefined;

			images.push({ type: "image", attrs });
		}

		if ("children" in node && node.children) {
			for (const child of node.children) {
				if (child.type === "element") {
					visitHastNode(child);
				}
			}
		}
	}

	visitHastNode(hastTree);
	return images;
}

const remarkRemoveEmptyMarkers: Plugin<[]> = () => {
	return (tree) => {
		visit(tree, "paragraph", (node: Paragraph) => {
			const paragraphText = node.children
				.filter((child) => child.type === "text")
				.map((child) => child.value)
				.join("");

			if (paragraphText.includes(EMPTY_PARKER)) {
				node.children = [];
			}
		});
	};
};

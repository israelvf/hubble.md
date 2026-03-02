import { convertFileSrc } from "@tauri-apps/api/core";
import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { useEffect, useState } from "react";

function dirname(filePath: string): string {
	const normalized = filePath.split("\\").join("/");
	const idx = normalized.lastIndexOf("/");
	if (idx <= 0) return normalized;
	return normalized.slice(0, idx);
}

function normalizePosixPath(path: string): string {
	const parts = path.split("/");
	const stack: string[] = [];
	for (const part of parts) {
		if (part === "" || part === ".") continue;
		if (part === "..") {
			stack.pop();
			continue;
		}
		stack.push(part);
	}
	return `/${stack.join("/")}`;
}

function joinToAbsolutePath(baseDir: string, relativePath: string): string {
	const rel = relativePath.split("\\").join("/");
	if (rel.startsWith("/")) return normalizePosixPath(rel);
	return normalizePosixPath(`${baseDir}/${rel}`);
}

function isResolvableLocalPath(src: string): boolean {
	return !/^(data:|https?:|file:|asset:)/i.test(src);
}

export function ImageNodeView({
	node,
	notePath,
	selected,
}: NodeViewProps & { notePath: string }) {
	const rawSrc = String(node.attrs.src ?? "");
	const [resolvedSrc, setResolvedSrc] = useState(rawSrc);

	useEffect(() => {
		if (rawSrc.trim().length === 0) {
			setResolvedSrc("");
			return;
		}
		if (!isResolvableLocalPath(rawSrc)) {
			setResolvedSrc(rawSrc);
			return;
		}
		const absolutePath = joinToAbsolutePath(dirname(notePath), rawSrc);
		setResolvedSrc(convertFileSrc(absolutePath));
	}, [rawSrc, notePath]);

	return (
		<NodeViewWrapper as="div" data-drag-handle>
			{resolvedSrc.length > 0 ? (
				<img
					src={resolvedSrc}
					alt={node.attrs.alt || ""}
					title={node.attrs.title || ""}
					className={selected ? "outline-2 outline-blue-400" : ""}
				/>
			) : null}
		</NodeViewWrapper>
	);
}

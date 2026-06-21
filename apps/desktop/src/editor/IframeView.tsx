import type { CSSProperties } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { desktopApi } from "../desktopApi";

type IframeRequest = {
	type?: unknown;
	id?: unknown;
	method?: unknown;
	params?: unknown;
	token?: unknown;
};

type IframeViewProps = {
	src: string;
	title: string;
	workspacePath: string | null;
	className: string;
	style?: CSSProperties;
	onError?: (message: string | null) => void;
	onHeightChange?: (height: number) => void;
};

export const MIN_IFRAME_HEIGHT = 80;
export const MAX_IFRAME_HEIGHT = 4000;
export const IFRAME_PADDING = 2;

export function IframeView({
	src,
	title,
	workspacePath,
	className,
	style,
	onError,
	onHeightChange,
}: IframeViewProps) {
	const iframeRef = useRef<HTMLIFrameElement | null>(null);
	const tokenRef = useRef(crypto.randomUUID());
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		onError?.(error);
	}, [error, onError]);

	useEffect(() => {
		// Inline embeds need resize messages because their content sets a dynamic
		// height in the Markdown document. Full-page HTML fills the panel and
		// scrolls inside the iframe, so there is no host height to update.
		if (!onHeightChange) return;
		const onMessage = (event: MessageEvent) => {
			const data = event.data as {
				type?: unknown;
				height?: unknown;
				token?: unknown;
			} | null;
			if (!isMessageForIframe(data, iframeRef.current)) return;
			if (!data || data.type !== "hubble:embed-height") return;
			const height = Number(data.height);
			if (!Number.isFinite(height)) return;
			const clamped = Math.max(
				MIN_IFRAME_HEIGHT,
				Math.min(MAX_IFRAME_HEIGHT, Math.ceil(height) + IFRAME_PADDING),
			);
			onHeightChange?.(clamped);
		};

		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, [onHeightChange]);

	useLayoutEffect(() => {
		const onMessage = (event: MessageEvent) => {
			const request = event.data as IframeRequest | null;
			if (!isMessageForIframe(request, iframeRef.current)) return;
			if (!request || request.type !== "hubble:request") return;
			void handleIframeRequest(request, workspacePath).then((response) => {
				if (!isWindowProxy(event.source)) return;
				event.source.postMessage(
					{ ...response, id: request.id, type: "hubble:response" },
					"*",
				);
			});
		};

		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, [workspacePath]);

	if (error) return null;

	return (
		<iframe
			ref={iframeRef}
			className={className}
			name={tokenRef.current}
			scrolling="auto"
			title={title}
			sandbox="allow-scripts"
			src={src}
			style={style}
			width="100%"
			onError={() => setError("Failed to load iframe.")}
			onLoad={() => setError(null)}
		/>
	);
}

export function toAssetUrl(path: string): string {
	const normalized = path.split("\\").join("/");
	const absolutePath = normalized.startsWith("/")
		? normalized
		: `/${normalized}`;
	const encodedPath = absolutePath
		.split("/")
		.map((part) => encodeURIComponent(part))
		.join("/");
	const pathWithEncodedRoot = encodedPath.startsWith("/")
		? `%2F${encodedPath.slice(1)}`
		: encodedPath;
	return `hubble-asset://local/${pathWithEncodedRoot}`;
}

async function handleIframeRequest(
	request: IframeRequest,
	workspacePath: string | null,
) {
	try {
		if (!workspacePath) {
			throw new Error("Open a workspace to query files.");
		}
		const params =
			request.params && typeof request.params === "object"
				? (request.params as Record<string, unknown>)
				: {};
		if (request.method === "files.list") {
			const glob = typeof params.glob === "string" ? params.glob : "**/*";
			return {
				ok: true,
				value: await desktopApi.listEmbedFiles(workspacePath, glob),
			};
		}
		if (request.method === "files.read") {
			const path = typeof params.path === "string" ? params.path : "";
			if (!isSafeWorkspacePath(path)) {
				throw new Error("File path must be workspace-relative.");
			}
			const absolutePath = await desktopApi.resolvePath(
				joinPath(workspacePath, path),
			);
			return {
				ok: true,
				value: await desktopApi.readFileText(absolutePath),
			};
		}
		throw new Error(`Unknown Hubble iframe method: ${String(request.method)}`);
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

function isWindowProxy(source: MessageEventSource | null): source is Window {
	return Boolean(source && "postMessage" in source);
}

function isMessageForIframe(
	data: { token?: unknown } | null,
	iframe: HTMLIFrameElement | null,
): boolean {
	return typeof data?.token === "string" && data.token === iframe?.name;
}

function isSafeWorkspacePath(path: string): boolean {
	if (
		!path ||
		path.startsWith("/") ||
		path.startsWith("\\") ||
		path.includes(":")
	) {
		return false;
	}
	return !path
		.split(/[\\/]+/)
		.some((part) => part === "" || part === "." || part === "..");
}

function joinPath(root: string, ...parts: string[]) {
	const normalizedRoot = root.replace(/[\\/]+$/, "");
	return [normalizedRoot, ...parts].join("/");
}

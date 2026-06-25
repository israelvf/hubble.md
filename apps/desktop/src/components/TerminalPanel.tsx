import { useStoreValue } from "@simplestack/store/react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import { desktopApi } from "../desktopApi";
import { cn } from "../lib/utils";
import { setTerminalOpen, toggleTerminal } from "../store/actions";
import { terminalOpenStore, workspacePathStore } from "../store/state";
import "@xterm/xterm/css/xterm.css";
import MingcuteAddLine from "~icons/mingcute/add-line";
import MingcuteCloseLine from "~icons/mingcute/close-line";

type Session = {
	id: string;
	title: string;
};

function cssColorToRgba(color: string): string {
	const canvas = document.createElement("canvas");
	canvas.width = 1;
	canvas.height = 1;
	const ctx = canvas.getContext("2d");
	if (!ctx) return color;
	ctx.fillStyle = color;
	ctx.fillRect(0, 0, 1, 1);
	const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
	return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
}

const LIGHT_THEME = {
	black: "#000000",
	red: "#cd3131",
	green: "#00bc00",
	yellow: "#949800",
	blue: "#0451a5",
	magenta: "#bc05bc",
	cyan: "#0598bc",
	white: "#555555",
	brightBlack: "#666666",
	brightRed: "#cd3131",
	brightGreen: "#14ce14",
	brightYellow: "#b5ba00",
	brightBlue: "#0451a5",
	brightMagenta: "#bc05bc",
	brightCyan: "#0598bc",
	brightWhite: "#a5a5a5",
};

const DARK_THEME = {
	black: "#000000",
	red: "#cd3131",
	green: "#0dbc79",
	yellow: "#e5e510",
	blue: "#2472c8",
	magenta: "#bc3fbc",
	cyan: "#11a8cd",
	white: "#e5e5e5",
	brightBlack: "#666666",
	brightRed: "#f14c4c",
	brightGreen: "#23d18b",
	brightYellow: "#f5f543",
	brightBlue: "#3b8eea",
	brightMagenta: "#d670d6",
	brightCyan: "#29b8db",
	brightWhite: "#e5e5e5",
};

export function TerminalPanel() {
	const isOpen = useStoreValue(terminalOpenStore);
	const workspacePath = useStoreValue(workspacePathStore);
	const [sessions, setSessions] = useState<Session[]>([]);
	const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
	const [height, setHeight] = useState(256);
	const isInitializingRef = useRef(false);
	const isDraggingRef = useRef(false);

	useEffect(() => {
		const handleMouseMove = (e: MouseEvent) => {
			if (!isDraggingRef.current) return;
			const newHeight = Math.max(
				100,
				Math.min(window.innerHeight - 100, window.innerHeight - e.clientY),
			);
			setHeight(newHeight);
		};
		const handleMouseUp = () => {
			if (isDraggingRef.current) {
				isDraggingRef.current = false;
				document.body.style.cursor = "";
			}
		};

		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("mouseup", handleMouseUp);
		return () => {
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("mouseup", handleMouseUp);
		};
	}, []);

	// Create a new session when the panel is opened and there are no sessions
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional
	useEffect(() => {
		if (
			isOpen &&
			sessions.length === 0 &&
			workspacePath &&
			!isInitializingRef.current
		) {
			isInitializingRef.current = true;
			void handleNewSession();
		}
	}, [isOpen, sessions.length, workspacePath]);

	const handleNewSession = async () => {
		if (!workspacePath) return;
		const sessionId = await desktopApi.terminalStart(workspacePath);
		setSessions((prev) => [...prev, { id: sessionId, title: `bash` }]);
		setActiveSessionId(sessionId);
	};

	const handleCloseSession = async (sessionId: string) => {
		await desktopApi.terminalStop(sessionId);
		setSessions((prev) => {
			const next = prev.filter((s) => s.id !== sessionId);
			if (activeSessionId === sessionId) {
				setActiveSessionId(next.length > 0 ? next[next.length - 1].id : null);
			}
			if (next.length === 0) {
				isInitializingRef.current = false;
				queueMicrotask(() => setTerminalOpen(false));
			}
			return next;
		});
	};

	return (
		<div
			style={{ height: isOpen ? height : undefined }}
			className={cn(
				"flex flex-col border-t border-border bg-background z-20 shadow-[0_-4px_16px_rgba(0,0,0,0.05)] relative",
				!isOpen && "hidden",
			)}
		>
			{/* Resizer Handle */}
			<div
				className="absolute -top-1 left-0 right-0 h-2 cursor-row-resize z-30 hover:bg-ring/30 transition-colors"
				onMouseDown={(e) => {
					e.preventDefault();
					isDraggingRef.current = true;
					document.body.style.cursor = "row-resize";
				}}
			/>
			{/* Terminal Tabs */}
			<div className="flex items-center h-9 px-2 border-b border-border bg-muted/30 select-none">
				<div className="flex-1 flex items-center gap-1 overflow-x-auto no-scrollbar">
					{sessions.map((session) => (
						<button
							type="button"
							key={session.id}
							className={cn(
								"group flex items-center gap-2 px-3 py-1 text-xs rounded-md cursor-pointer transition-colors max-w-32",
								activeSessionId === session.id
									? "bg-background text-foreground shadow-sm border border-border"
									: "text-muted-foreground hover:bg-muted",
							)}
							onClick={() => setActiveSessionId(session.id)}
						>
							<span className="truncate flex-1">{session.title}</span>
							<button
								type="button"
								className={cn(
									"p-0.5 rounded-sm hover:bg-muted-foreground/20 opacity-0 group-hover:opacity-100 transition-opacity",
									activeSessionId === session.id && "opacity-100",
								)}
								onClick={(e) => {
									e.stopPropagation();
									void handleCloseSession(session.id);
								}}
							>
								<MingcuteCloseLine className="w-3 h-3" />
							</button>
						</button>
					))}
					<button
						type="button"
						className="p-1 ml-1 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
						onClick={handleNewSession}
						title="New Terminal"
					>
						<MingcuteAddLine className="w-4 h-4" />
					</button>
				</div>
				<div className="flex items-center gap-2 pl-4">
					<button
						type="button"
						className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
						onClick={toggleTerminal}
						title="Close Terminal Panel"
					>
						<MingcuteCloseLine className="w-4 h-4" />
					</button>
				</div>
			</div>

			{/* Terminal Viewports */}
			<div className="flex-1 relative overflow-hidden bg-background p-2 pb-0">
				{sessions.map((session) => (
					<div
						key={session.id}
						className={cn(
							"absolute inset-2",
							activeSessionId === session.id
								? "z-10 opacity-100"
								: "z-0 opacity-0 pointer-events-none",
						)}
					>
						<TerminalInstance
							sessionId={session.id}
							isActive={activeSessionId === session.id}
						/>
					</div>
				))}
				{sessions.length === 0 && (
					<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
						No active terminal sessions.
					</div>
				)}
			</div>
		</div>
	);
}

function TerminalInstance({
	sessionId,
	isActive,
}: {
	sessionId: string;
	isActive: boolean;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const termRef = useRef<Terminal | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional
	useEffect(() => {
		if (!containerRef.current) return;

		const term = new Terminal({
			fontSize: 13,
			theme: { background: "transparent" },
			cursorBlink: true,
			allowTransparency: true,
		});

		const updateTheme = () => {
			const style = getComputedStyle(document.body);
			const rawForeground = style.color || "#ececec";
			const rawBackground = style.backgroundColor || "#ffffff";
			
			const foreground = cssColorToRgba(rawForeground);
			const background = cssColorToRgba(rawBackground);

			// Tailwind 4 outputs font-mono or default-mono-font-family
			let fontFamily = style.getPropertyValue("--font-mono").trim();
			if (!fontFamily) {
				fontFamily = style.getPropertyValue("--default-mono-font-family").trim();
			}
			if (!fontFamily) fontFamily = "monospace";

			const isDark = document.documentElement.classList.contains("dark");
			const palette = isDark ? DARK_THEME : LIGHT_THEME;

			term.options.fontFamily = fontFamily;
			term.options.theme = {
				...palette,
				background,
				foreground,
				cursor: foreground,
			};
		};

		updateTheme();

		const themeObserver = new MutationObserver(() => updateTheme());
		themeObserver.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["class"],
		});

		const fitAddon = new FitAddon();
		term.loadAddon(fitAddon);
		term.open(containerRef.current);

		termRef.current = term;
		fitAddonRef.current = fitAddon;

		term.onData((data) => {
			void desktopApi.terminalWrite(sessionId, data);
		});

		term.onResize(({ cols, rows }) => {
			void desktopApi.terminalResize(sessionId, cols, rows);
		});

		const unsubscribeData = desktopApi.onTerminalData(sessionId, (data) => {
			term.write(data);
		});

		let fitTimeout: ReturnType<typeof setTimeout>;
		const resizeObserver = new ResizeObserver(() => {
			if (isActive && containerRef.current?.offsetParent !== null) {
				clearTimeout(fitTimeout);
				fitTimeout = setTimeout(() => {
					try {
						fitAddon.fit();
					} catch {
						// Fit might throw if container is hidden/0px
					}
				}, 50);
			}
		});

		resizeObserver.observe(containerRef.current);

		// Initial fit
		// ResizeObserver will handle the initial fit


		return () => {
			clearTimeout(fitTimeout);
			unsubscribeData();
			resizeObserver.disconnect();
			themeObserver.disconnect();
			term.dispose();
		};
	}, [sessionId]); // Important: Do NOT include isActive here, we don't want to re-mount xterm

	useEffect(() => {
		if (
			isActive &&
			fitAddonRef.current &&
			containerRef.current?.offsetParent !== null
		) {
			try {
				fitAddonRef.current.fit();
				termRef.current?.focus();
			} catch {
				//
			}
		}
	}, [isActive]);

	return <div ref={containerRef} className="w-full h-full" />;
}

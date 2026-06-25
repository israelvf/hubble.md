import { spawn } from "node:child_process";
import os from "node:os";
import { ipcMain } from "electron";

export type TerminalSession = {
	id: string;
	write: (data: string) => void;
	resize: (cols: number, rows: number) => void;
	kill: () => void;
	isFallback: boolean;
};

const sessions: Record<string, TerminalSession> = {};
let nextSessionId = 0;

function getDefaultShell() {
	if (os.platform() === "win32") {
		return process.env.COMSPEC || "powershell.exe";
	}
	return process.env.SHELL || "/bin/sh";
}

function createPtySession(
	cwd: string,
	onData: (data: string) => void,
	onExit: () => void,
): TerminalSession | null {
	try {
		// Attempt to load node-pty. It's an optional dependency, so it might fail.
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const pty = require("node-pty");
		const shell = getDefaultShell();

		const ptyProcess = pty.spawn(shell, [], {
			name: "xterm-color",
			cols: 80,
			rows: 24,
			cwd: cwd,
			env: process.env,
		});

		ptyProcess.onData((data: string) => {
			onData(data);
		});

		ptyProcess.onExit(() => {
			onExit();
		});

		return {
			id: "", // Assigned later
			write: (data: string) => {
				ptyProcess.write(data);
			},
			resize: (cols: number, rows: number) => {
				try {
					ptyProcess.resize(cols, rows);
				} catch {
					// Ignore resize errors if process is dying
				}
			},
			kill: () => {
				ptyProcess.kill();
			},
			isFallback: false,
		};
	} catch (error) {
		console.warn(
			"Failed to load node-pty, falling back to child_process:",
			error,
		);
		return null;
	}
}

function createFallbackSession(
	cwd: string,
	onData: (data: string) => void,
	onExit: () => void,
): TerminalSession {
	const shell = getDefaultShell();
	// Spawn standard shell as a fallback.
	// Interactive CLI apps won't work perfectly, but basic scripts will.
	const cp = spawn(shell, {
		cwd,
		env: { ...process.env, TERM: "xterm-color" },
		stdio: ["pipe", "pipe", "pipe"],
		shell: true,
	});

	if (cp.stdout) {
		cp.stdout.on("data", (data: Buffer) => {
			onData(data.toString("utf8"));
		});
	}

	if (cp.stderr) {
		cp.stderr.on("data", (data: Buffer) => {
			onData(data.toString("utf8"));
		});
	}

	cp.on("exit", () => {
		onExit();
	});

	cp.on("error", (err) => {
		onData(`\r\n[Terminal Error]: ${err.message}\r\n`);
		onExit();
	});

	return {
		id: "",
		write: (data: string) => {
			if (cp.stdin?.writable) {
				cp.stdin.write(data);
			}
		},
		resize: (_cols: number, _rows: number) => {
			// No-op for standard child_process
		},
		kill: () => {
			cp.kill();
		},
		isFallback: true,
	};
}

export function setupTerminalIpc(
	sendToRenderer: (channel: string, ...args: unknown[]) => void,
) {
	ipcMain.handle(
		"desktop:terminal-start",
		(_event, { cwd }: { cwd: string }) => {
			const sessionId = `term-${++nextSessionId}`;

			const onData = (data: string) => {
				sendToRenderer(`desktop:terminal-data-${sessionId}`, data);
			};

			const onExit = () => {
				delete sessions[sessionId];
				sendToRenderer(`desktop:terminal-exit-${sessionId}`);
			};

			let session = createPtySession(cwd, onData, onExit);
			if (!session) {
				session = createFallbackSession(cwd, onData, onExit);
			}

			session.id = sessionId;
			sessions[sessionId] = session;

			if (session.isFallback) {
				onData(
					"\r\n\x1b[33m[Warning] Running in Fallback Mode (no PTY). Interactive apps (like vim) may not render correctly.\x1b[0m\r\n\n",
				);
				onData(`${cwd}> `); // Fake a prompt for fallback
			}

			return sessionId;
		},
	);

	ipcMain.handle(
		"desktop:terminal-write",
		(_event, { sessionId, data }: { sessionId: string; data: string }) => {
			const session = sessions[sessionId];
			if (session) {
				session.write(data);
			}
		},
	);

	ipcMain.handle(
		"desktop:terminal-resize",
		(
			_event,
			{
				sessionId,
				cols,
				rows,
			}: { sessionId: string; cols: number; rows: number },
		) => {
			const session = sessions[sessionId];
			if (session) {
				session.resize(cols, rows);
			}
		},
	);

	ipcMain.handle(
		"desktop:terminal-stop",
		(_event, { sessionId }: { sessionId: string }) => {
			const session = sessions[sessionId];
			if (session) {
				session.kill();
				delete sessions[sessionId];
			}
		},
	);
}

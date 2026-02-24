import { type StoreMiddleware, store } from "@simplestack/store";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

type ViewerStatus = "idle" | "loading" | "ready" | "error";

type ViewerState = {
	currentPath: string | null;
	lastOpenedPath: string | null;
	content: string;
	status: ViewerStatus;
	error: string | null;
};

const STORAGE_KEY = "hubble-desktop-viewer";
type PersistedViewerState = Pick<ViewerState, "lastOpenedPath">;

const persistentStateMiddleware: StoreMiddleware<ViewerState> = () => ({
	set: (next) => (setter) => {
		next((currentState) => {
			const nextState =
				typeof setter === "function" ? setter(currentState) : setter;
			const lastOpenedPath = nextState.currentPath ?? nextState.lastOpenedPath;
			const persistedState: PersistedViewerState = {
				lastOpenedPath,
			};
			localStorage.setItem(STORAGE_KEY, JSON.stringify(persistedState));
			return {
				...nextState,
				lastOpenedPath,
			};
		});
	},
});

function getInitialState(): ViewerState {
	const emptyState: ViewerState = {
		currentPath: null,
		lastOpenedPath: null,
		content: "",
		status: "idle",
		error: null,
	};

	const raw = localStorage.getItem(STORAGE_KEY);
	if (!raw) return emptyState;

	try {
		const parsed = JSON.parse(raw) as Partial<PersistedViewerState>;
		return {
			...emptyState,
			lastOpenedPath: parsed.lastOpenedPath ?? null,
		};
	} catch {
		return emptyState;
	}
}

export async function savePathContent(path: string, content: string) {
	viewerStore.set((current) => {
		if (current.currentPath !== path) return current;
		return {
			...current,
			content,
			status: "ready",
			error: null,
		};
	});

	try {
		await invoke("write_file_text", { path, content });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		toast.error("Failed to save file", { description: message });
		viewerStore.set((current) => {
			if (current.currentPath !== path) return current;
			return {
				...current,
				status: "error",
				error: message,
			};
		});
	}
}

export const viewerStore = store<ViewerState>(getInitialState(), {
	middleware: [persistentStateMiddleware],
});

export async function loadPath(path: string) {
	viewerStore.set((current) => ({
		...current,
		status: "loading",
		error: null,
	}));

	try {
		const content = await invoke<string>("read_file_text", { path });
		viewerStore.set((current) => ({
			...current,
			currentPath: path,
			content,
			status: "ready",
			error: null,
		}));
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		toast.error("Failed to open file", { description: message });
		viewerStore.set((current) => ({
			...current,
			currentPath: null,
			content: "",
			status: "error",
			error: message,
		}));
	}
}

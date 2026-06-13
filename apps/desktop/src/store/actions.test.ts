import { beforeEach, describe, expect, it, vi } from "vitest";

type MockDesktopApi = {
	readFileText: ReturnType<typeof vi.fn>;
	writeFileText: ReturnType<typeof vi.fn>;
	listDirectory: ReturnType<typeof vi.fn>;
};

function createDesktopApi(): MockDesktopApi {
	return {
		readFileText: vi.fn(async () => "before"),
		writeFileText: vi.fn(async () => {}),
		listDirectory: vi.fn(async () => []),
	};
}

/**
 * Actions capture window.desktopApi at import time, so each test stubs globals
 * before importing the store modules.
 */
async function loadStoreActions(api: MockDesktopApi) {
	vi.resetModules();
	vi.stubGlobal("localStorage", {
		getItem: vi.fn(() => null),
		setItem: vi.fn(),
	});
	vi.stubGlobal("window", {
		desktopApi: api,
		setTimeout,
		clearTimeout,
	});

	const actions = await import("./actions");
	const state = await import("./state");
	return { ...actions, ...state };
}

describe("desktop savePathContent", () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	it("preserves newer editor content when an older save finishes", async () => {
		const api = createDesktopApi();
		let finishWrite: () => void = () => {};
		// Keep the disk write pending so we can simulate more typing before the
		// older save resolves back into the store.
		api.writeFileText.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					finishWrite = resolve;
				}),
		);
		const { appStore, savePathContent, updateEditorContent, viewerStore } =
			await loadStoreActions(api);
		const path = "/workspace/note.md";

		appStore.set((current) => ({
			...current,
			document: {
				...current.document,
				currentPath: path,
				lastOpenedPath: path,
				content: "draft 1",
				diskContent: "before",
				externalChange: { kind: "none" },
				status: "ready",
				error: null,
			},
		}));

		const save = savePathContent(path, "draft 1");
		await Promise.resolve();
		expect(api.writeFileText).toHaveBeenCalledWith(path, "draft 1");

		updateEditorContent(path, "draft 2");
		finishWrite();
		await save;

		expect(viewerStore.get().content).toBe("draft 2");
		expect(viewerStore.get().diskContent).toBe("draft 1");
		expect(viewerStore.get().externalChange).toEqual({ kind: "none" });
	});

	it("uses latest editor content when classifying disk changes", async () => {
		const api = createDesktopApi();
		// The file now matches what the user just typed, even though the save
		// that is finishing still has the older text.
		api.readFileText.mockResolvedValue("draft 2");
		const { appStore, savePathContent, updateEditorContent, viewerStore } =
			await loadStoreActions(api);
		const path = "/workspace/note.md";

		appStore.set((current) => ({
			...current,
			document: {
				...current.document,
				currentPath: path,
				lastOpenedPath: path,
				content: "draft 1",
				diskContent: "before",
				externalChange: { kind: "none" },
				status: "ready",
				error: null,
			},
		}));
		updateEditorContent(path, "draft 2");

		await savePathContent(path, "draft 1");

		expect(api.writeFileText).not.toHaveBeenCalled();
		expect(viewerStore.get().content).toBe("draft 2");
		expect(viewerStore.get().diskContent).toBe("draft 2");
		expect(viewerStore.get().externalChange).toEqual({ kind: "none" });
	});
});

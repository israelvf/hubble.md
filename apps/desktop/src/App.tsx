import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { keymatch } from "keymatch";
import { useStoreValue } from "@simplestack/store/react";
import { loadPath, viewerStore } from "./store";
import "./App.css";

function App() {
  const state = useStoreValue(viewerStore);

  async function openFilePicker() {
    const selected = await open({
      multiple: false,
      directory: false,
      title: "Open Markdown file",
      filters: [
        { name: "Markdown", extensions: ["md", "markdown", "mdown"] },
        { name: "Text", extensions: ["txt", "text"] },
      ],
    });
    if (typeof selected === "string") {
      await loadPath(selected);
    }
  }

  useEffect(() => {
    const onKeyDown = async (event: KeyboardEvent) => {
      if (keymatch(event, "CmdOrCtrl+O")) {
        event.preventDefault();
        await openFilePicker();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    const setup = async () => {
      unlisten = await listen<{ path?: string }>("hubble://open-file", async (event) => {
        const path = event.payload?.path;
        if (path) {
          await loadPath(path);
        }
      });
    };
    void setup();
    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  useEffect(() => {
    let active = true;
    const init = async () => {
      const launchPath = await invoke<string | null>("get_launch_file_path");
      if (!active) return;

      if (typeof launchPath === "string" && launchPath.length > 0) {
        await loadPath(launchPath);
        return;
      }

      const lastPath = viewerStore.get().lastOpenedPath;
      if (lastPath) {
        await loadPath(lastPath);
      }
    };
    void init();
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="app">
      <header className="toolbar">
        <button className="button" type="button" onClick={() => void openFilePicker()}>
          Open (⌘O)
        </button>
        <span className="path">{state.currentPath ?? "No file selected"}</span>
      </header>
      <section className="content" aria-live="polite">
        {state.status === "loading" && <p>Loading…</p>}
        {state.status === "error" && <p>{state.error ?? "Failed to open file."}</p>}
        {state.status !== "loading" && state.status !== "error" && !state.currentPath && (
          <p>Open a markdown file to view raw text.</p>
        )}
        {state.status === "ready" && <pre className="rawText">{state.content}</pre>}
      </section>
    </main>
  );
}

export default App;

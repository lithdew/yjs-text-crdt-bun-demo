import * as Y from "yjs";

import { Store, useStore } from "@tanstack/react-store";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

const MAX_FRAME_LENGTH = 1 * 1024 * 1024;

const readFrame = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  bytes: Uint8Array<ArrayBuffer>
) => {
  while (bytes.byteLength < 8) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    bytes = new Uint8Array(bytes.byteLength + value.byteLength);
    bytes.set(value, bytes.byteLength - value.byteLength);
  }

  if (bytes.byteLength < 8) {
    throw new Error("Connection prematurely closed while reading frame length");
  }

  const frameLengthU64 = new DataView(bytes.buffer.slice(0, 8)).getBigUint64(
    0,
    true
  );
  if (frameLengthU64 > BigInt(MAX_FRAME_LENGTH)) {
    throw new Error("Frame length too large");
  }

  const frameLength = Number(frameLengthU64);
  bytes = new Uint8Array(bytes.buffer.slice(8));

  while (bytes.byteLength < frameLength) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    bytes = new Uint8Array(bytes.byteLength + value.byteLength);
    bytes.set(value, bytes.byteLength - value.byteLength);
  }

  if (bytes.byteLength < frameLength) {
    throw new Error("Connection prematurely closed while reading frame");
  }

  const frame = bytes.slice(0, frameLength);
  bytes = bytes.slice(frameLength);

  return { frame, rest: bytes };
};

class Note {
  doc = new Y.Doc();
  text = this.doc.getText("text");
  store = new Store({ isLoading: true, text: "" });
  prev = "";

  constructor() {
    this.doc.on("updateV2", (update, origin) => {
      const text = this.text.toJSON();

      this.prev = text;
      this.store.setState((state) => ({ ...state, text }));

      if (origin === "local") {
        void fetch("/note", {
          method: "POST",
          body: update,
        });
      }
    });
  }

  async stream(signal: AbortSignal) {
    while (true) {
      this.store.setState((state) => ({ ...state, isLoading: true }));

      try {
        const response = await fetch("/stream", {
          method: "POST",
          signal,
          body: Y.encodeStateVector(this.doc),
        });

        if (response.body === null) {
          throw new Error("No body");
        }

        const reader = response.body.getReader();

        let bytes = Uint8Array.of();
        let numUpdatesHandled = 0;

        while (true) {
          const { frame, rest } = await readFrame(reader, bytes);
          Y.applyUpdateV2(this.doc, frame, "remote");
          bytes = rest;

          numUpdatesHandled++;
          if (numUpdatesHandled === 1) {
            this.store.setState((state) => ({ ...state, isLoading: false }));
          }
        }
      } catch (err) {
        this.store.setState((state) => ({ ...state, isLoading: true }));

        if (
          signal.aborted ||
          (err instanceof Error && err.name === "AbortError")
        ) {
          break;
        }

        await new Promise<void>((resolve) => {
          const handle = setTimeout(() => {
            resolve();
          }, 1000);

          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(handle);
              resolve();
            },
            { once: true }
          );
        });

        console.warn("Note stream error", err);
      }
    }
  }

  handleTextChange(updated: string) {
    let start = 0;
    let oldEnd = this.prev.length;
    let newEnd = updated.length;

    // Find first differing character.
    while (
      start < Math.min(this.prev.length, updated.length) &&
      this.prev[start] === updated[start]
    ) {
      start++;
    }

    // Find last differing character.
    while (
      oldEnd > start &&
      newEnd > start &&
      this.prev[oldEnd - 1] === updated[newEnd - 1]
    ) {
      oldEnd--;
      newEnd--;
    }

    const numDeleted = oldEnd - start;
    const inserted = updated.slice(start, newEnd);

    this.doc.transact(() => {
      if (numDeleted > 0) {
        this.text.delete(start, numDeleted);
      }
      if (inserted.length > 0) {
        this.text.insert(start, inserted);
      }
    }, "local");

    this.prev = updated;
  }
}

function Textarea() {
  const [note] = useState(() => new Note());

  const text = useStore(note.store, (state) => state.text);
  const isLoading = useStore(note.store, (state) => state.isLoading);

  useEffect(() => {
    const controller = new AbortController();
    void note.stream(controller.signal);
    return () => controller.abort();
  }, []);

  return (
    <textarea
      placeholder="Enter some text..."
      className="border p-4 resize-none w-full disabled:opacity-50"
      value={text}
      disabled={isLoading}
      onChange={(e) => note.handleTextChange(e.target.value)}
      rows={5}
    />
  );
}

function App() {
  return (
    <div className="min-h-dvh grid place-items-center">
      <div className="max-w-md w-full">
        <div className="text-2xl font-semibold">Yjs Text CRDT Bun Demo</div>

        <div className="mt-2">
          <Textarea />
        </div>

        <div className="mt-2">
          <Textarea />
        </div>

        <div className="mt-2">
          <Textarea />
        </div>
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);

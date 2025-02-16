import * as Y from "yjs";

import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useRef, useState } from "react";

function Textarea() {
  const [doc] = useState(new Y.Doc());
  const [text] = useState(doc.getText("text"));

  const [value, setValue] = useState(text.toJSON());
  const prev = useRef(value);

  useEffect(() => {
    const controller = new AbortController();

    async function feed(signal: AbortSignal) {
      const response = await fetch("/stream", {
        method: "POST",
        signal,
        body: Y.encodeStateVector(doc),
      });

      if (response.body === null) {
        throw new Error("No body");
      }

      const reader = response.body.getReader();

      let bytes = Uint8Array.of();

      const readFrame = async () => {
        while (bytes.byteLength < 8) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          bytes = new Uint8Array(bytes.byteLength + value.byteLength);
          bytes.set(value, bytes.byteLength - value.byteLength);
        }

        if (bytes.byteLength < 8) {
          return null;
        }

        const frameLength = Number(
          new DataView(bytes.buffer.slice(0, 8)).getBigUint64(0, true)
        );
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
          return null;
        }

        const update = bytes.slice(0, frameLength);
        bytes = bytes.slice(frameLength);

        return update;
      };

      while (true) {
        const update = await readFrame();
        if (update === null) {
          break;
        }

        Y.applyUpdateV2(doc, update, "remote");
      }
    }

    void feed(controller.signal);

    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const handler = (update: Uint8Array, origin: any) => {
      prev.current = text.toJSON();
      setValue(text.toJSON());

      if (origin === "local") {
        void fetch("/note", {
          method: "POST",
          body: update,
        });
      }
    };

    doc.on("updateV2", handler);

    return () => {
      doc.off("updateV2", handler);
    };
  }, []);

  const onChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const updated = e.target.value;
    const old = prev.current;

    let start = 0;
    let oldEnd = old.length;
    let newEnd = updated.length;

    // Find first differing character
    while (
      start < Math.min(old.length, updated.length) &&
      old[start] === updated[start]
    ) {
      start++;
    }

    // Find last differing character
    while (
      oldEnd > start &&
      newEnd > start &&
      old[oldEnd - 1] === updated[newEnd - 1]
    ) {
      oldEnd--;
      newEnd--;
    }

    const numDeleted = oldEnd - start;
    const inserted = updated.slice(start, newEnd);

    doc.transact(() => {
      if (numDeleted > 0) {
        text.delete(start, numDeleted);
      }
      if (inserted.length > 0) {
        text.insert(start, inserted);
      }
    }, "local");

    prev.current = updated;
  }, []);

  return (
    <textarea
      placeholder="Enter some text..."
      className="border p-4 resize-none w-full"
      value={value}
      onChange={onChange}
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

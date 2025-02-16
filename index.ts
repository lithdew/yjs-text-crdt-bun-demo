import index from "./index.html";
import * as Y from "yjs";

let doc = Y.encodeStateAsUpdateV2(new Y.Doc());

interface Client {
  stateVector: Uint8Array;
  controller: ReadableStreamController<Uint8Array>;
}

const clients = new Set<Client>();

function encodeDoc(doc: Uint8Array) {
  const prefix = Buffer.alloc(8);
  prefix.writeBigUInt64LE(BigInt(doc.byteLength));
  return Buffer.concat([prefix, doc]);
}

function encodeDocUpdate(update: Uint8Array) {
  const prefix = Buffer.alloc(8);
  prefix.writeBigUInt64LE(BigInt(update.byteLength));
  return Buffer.concat([prefix, update]);
}

Bun.serve({
  idleTimeout: 0,
  development: true,
  port: 3000,
  static: {
    "/": index,
  },
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/stream" && req.method === "POST") {
      const stateVector = await req.bytes();

      const stream = new ReadableStream<Uint8Array>({
        type: "bytes",
        start(controller) {
          const client: Client = {
            stateVector,
            controller,
          };

          clients.add(client);
          console.log(`Client connected`);

          controller.enqueue(encodeDoc(Y.diffUpdateV2(doc, stateVector)));

          req.signal.addEventListener("abort", () => {
            console.log(`Client disconnected`);
            clients.delete(client);
            controller.close();
          });
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    if (url.pathname === "/note" && req.method === "POST") {
      const update = await req.bytes();

      function validateUpdate(update: Uint8Array) {
        // Validate that the update is valid.
        // 1. All contents of Item's are strings.
        // 2. Either the parent is null and the origin is not null or the parent is "text" and the origin is null.

        const decoded = Y.decodeUpdateV2(update);
        for (const struct of decoded.structs) {
          if (!(struct instanceof Y.Item)) {
            continue;
          }
          if (!(struct.content instanceof Y.ContentString)) {
            throw new Error("Invalid content");
          }
          if (struct.parent !== null) {
            if (struct.origin !== null) {
              throw new Error("Invalid origin");
            }
            if (typeof struct.parent !== "string") {
              throw new Error("Invalid parent");
            }
            if (struct.parent !== "text") {
              throw new Error("Invalid parent");
            }
          } else {
            if (struct.origin === null) {
              throw new Error("Invalid origin");
            }
          }
        }
      }

      try {
        validateUpdate(update);
      } catch (error) {
        if (error instanceof Error) {
          return Response.json({ ok: false, error: error.message });
        }
        return Response.json({ ok: false, error: "Unknown error" });
      }

      const merged = Y.mergeUpdatesV2([doc, update]);
      const decoded = Y.decodeUpdateV2(merged);

      // Validate that the resulting document after the update is valid.
      // I have not delved into Yjs deep enough to know if it is possible to validate that the resulting document
      // is valid without applying the updates, given that certain updates may be outdated/invalid.
      // Therefore, we will apply the updates and validate the resulting document.

      // We validate that:
      // 1. All contents of Item's are strings.
      // 2. Either the parent is null and the origin is not null or the parent is "text" and the origin is null.
      // 3. The total length of the document is less than or equal to 2000 characters.

      let totalInsertedCharacters = 0;
      let totalDeletedCharacters = 0;
      for (const struct of decoded.structs) {
        if (!(struct instanceof Y.Item)) {
          continue;
        }
        if (!(struct.content instanceof Y.ContentString)) {
          return Response.json({ ok: false, error: "Invalid content" });
        }
        if (struct.parent !== null) {
          if (struct.origin !== null) {
            throw new Error("Invalid origin");
          }
          if (typeof struct.parent !== "string") {
            throw new Error("Invalid parent");
          }
          if (struct.parent !== "text") {
            throw new Error("Invalid parent");
          }
        } else {
          if (struct.origin === null) {
            throw new Error("Invalid origin");
          }
        }
        totalInsertedCharacters += struct.content.getLength();
      }
      for (const entries of decoded.ds.clients.values()) {
        for (const entry of entries) {
          totalDeletedCharacters += entry.len;
        }
      }

      if (totalInsertedCharacters - totalDeletedCharacters > 2000) {
        return Response.json({ ok: false, error: "Too many changes" });
      }

      doc = merged;

      for (const client of clients) {
        client.controller.enqueue(
          encodeDocUpdate(Y.diffUpdateV2(doc, client.stateVector))
        );
      }

      return Response.json({ ok: true });
    }

    return new Response("Hello World");
  },
});

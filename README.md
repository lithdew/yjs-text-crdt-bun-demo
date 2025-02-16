# yjs-text-crdt-bun-demo

This demo demonstrates validating, streaming, merging, and applying [Yjs](https://github.com/yjs/yjs) updates using HTTP POST requests and Server-Sent Events (SSE).

This demo requires Bun v1.2.3 (canary as of 2025-02-17).

We ensure that:
1. There exists only one `Y.Text` item in a single `Y.Doc`.
2. All updates do not create or append any new items to the `Y.Doc`.
3. The total length of the `Y.Text` item is less than or equal to 2000 characters.

To run the demo:

```bash
bun install
bun run index.ts
```
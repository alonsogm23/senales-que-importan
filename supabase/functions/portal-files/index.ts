import { createClient } from "npm:@supabase/supabase-js@2.119.0";
const headers = {
  "Cache-Control": "no-store, private",
  "X-Content-Type-Options": "nosniff",
};
class Denied extends Error {
  constructor(public status: number) {
    super("Request unavailable");
  }
}
Deno.serve(async (req: Request) => {
  let draft: { id: string; storage_path: string } | undefined,
    rpc: ((op: string, b: unknown) => Promise<any>) | undefined,
    admin: any,
    requestId: string | undefined;
  try {
    if (req.method !== "POST") throw new Denied(405);
    if (Number(req.headers.get("content-length") || 0) > 3000000)
      throw new Denied(413);
    const auth = req.headers.get("Authorization") || "";
    if (!/^Bearer [A-Za-z0-9_.-]+$/.test(auth)) throw new Denied(401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const client = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    if ((await client.auth.getUser(auth.slice(7))).error) throw new Denied(401);
    rpc = async (op, b) => {
      const r = await client.rpc("portal_command", { op, b });
      if (r.error)
        throw new Denied(["42501", "P0002"].includes(r.error.code) ? 403 : 400);
      return r.data;
    };
    // Read bounded chunks instead of trusting Content-Length.
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (!req.body) throw new Denied(400);
    for await (const part of req.body) {
      total += part.length;
      if (total > 3000000) throw new Denied(413);
      chunks.push(part);
    }
    const all = new Uint8Array(total);
    let offset = 0;
    for (const part of chunks) {
      all.set(part, offset);
      offset += part.length;
    }
    const b = JSON.parse(new TextDecoder().decode(all));
    if (b.op === "upload") {
      if (
        typeof b.content !== "string" ||
        b.content.length > 2800000 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(b.content)
      )
        throw new Denied(400);
      const bytes = Uint8Array.from(atob(b.content), (c) => c.charCodeAt(0));
      const valid =
        b.mime === "application/pdf"
          ? new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-"
          : b.mime === "image/png"
            ? [137, 80, 78, 71, 13, 10, 26, 10].every((x, i) => bytes[i] === x)
            : b.mime === "image/jpeg" &&
              bytes[0] === 255 &&
              bytes[1] === 216 &&
              bytes[2] === 255;
      if (!valid || !bytes.length || bytes.length > 2097152)
        throw new Denied(400);
      requestId = b.id;
      draft = await rpc("document_prepare", { ...b, content: undefined });
      // The privileged key exists only in the Edge environment, solely for object transfer.
      admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
        auth: { persistSession: false },
      });
      const uploaded = await admin.storage
        .from("portal-documents")
        .upload(draft!.storage_path, bytes, {
          contentType: b.mime,
          cacheControl: "0",
          upsert: false,
        });
      if (uploaded.error) throw new Denied(503);
      const result = await rpc("document_finish", {
        id: b.id,
        document: draft!.id,
      });
      draft = undefined;
      return Response.json(result, { headers });
    }
    if (b.op === "download") {
      if (typeof b.token !== "string" || !/^[a-f0-9]{64}$/.test(b.token))
        throw new Denied(400);
      const d = await rpc("consume_ticket", { token: b.token });
      admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
        auth: { persistSession: false },
      });
      const downloaded = await admin.storage
        .from("portal-documents")
        .download(d.storage_path);
      if (downloaded.error) throw new Denied(503);
      return new Response(downloaded.data, {
        headers: {
          ...headers,
          "Content-Type": d.mime,
          "Content-Disposition": 'attachment; filename="documento"',
        },
      });
    }
    throw new Denied(400);
  } catch (e) {
    if (draft && admin && rpc) {
      try {
        await admin.storage
          .from("portal-documents")
          .remove([draft.storage_path]);
        await rpc("document_abort", { id: requestId, document: draft.id });
      } catch {
        /* retain pending metadata for operator reconciliation */
      }
    }
    return Response.json(
      { error: "Archivo no disponible o solicitud no autorizada." },
      { status: e instanceof Denied ? e.status : 400, headers },
    );
  }
});

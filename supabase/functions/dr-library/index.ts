import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.2.18";

const base = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const bucket = "dr-constitucional-biblioteca";
const globalIssuer = "https://oidc.vercel.com";
const teamIssuer = globalIssuer + "/wisegt";
const teamKeys = createRemoteJWKSet(new URL(teamIssuer + "/.well-known/jwks"));
const globalKeys = createRemoteJWKSet(new URL(globalIssuer + "/.well-known/jwks"));
const claims = {
  audience: "https://vercel.com/wisegt",
  subject: "owner:wisegt:project:constitucional-ia-gt:environment:production",
  algorithms: ["RS256"],
  requiredClaims: ["exp", "iat"],
};

async function authorized(request: Request) {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return false;
  const token = authorization.slice(7);
  for (const [issuer, keys] of [[teamIssuer, teamKeys], [globalIssuer, globalKeys]] as const) {
    try {
      const { payload } = await jwtVerify(token, keys, { ...claims, issuer });
      return payload.owner_id === "team_GYZJZTikCh3E0BdS4p5psprD"
        && payload.project_id === "prj_pONqMPL9Y9XGuke63MBCPG5qOEGA"
        && payload.environment === "production";
    } catch {
      // Either documented issuer mode can be active for this Vercel project.
    }
  }
  return false;
}

async function service(path: string, body?: object) {
  const response = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: "Bearer " + serviceKey,
      apikey: serviceKey,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`Supabase request failed (${response.status})`);
  return response.json();
}

Deno.serve(async request => {
  if (request.method !== "POST" || !(await authorized(request))) {
    return Response.json({ error: "Acceso denegado." }, { status: 401 });
  }
  try {
    const { operation, payload } = await request.json();
    const rpc = (name: string, data: object) => service("/rest/v1/rpc/dr_library_gateway", {
      operation: name, payload: data,
    });
    if (operation === "sign") {
      const name = payload.name;
      if (typeof name !== "string" || !/^[^/\\]{1,200}\.(pdf|docx|txt|md)$/i.test(name)) {
        return Response.json({ error: "Selecciona un archivo compatible." }, { status: 400 });
      }
      const id = crypto.randomUUID();
      const path = id + "." + name.slice(name.lastIndexOf(".") + 1).toLowerCase();
      const signed = await service("/storage/v1/object/upload/sign/" + bucket + "/" + path, {});
      await rpc("create", { id, name, path });
      return Response.json({ id, uploadUrl: base + "/storage/v1" + signed.url });
    }
    if (operation === "read") {
      const document = await rpc("get", payload);
      if (!document) return Response.json(null, { status: 404 });
      const signed = await service("/storage/v1/object/sign/" + bucket + "/" + document.object_path, {
        expiresIn: 120,
      });
      return Response.json({ ...document, downloadUrl: base + "/storage/v1" + signed.signedURL });
    }
    if (!["list", "begin", "complete", "fail", "search", "validity"].includes(operation)) {
      return Response.json({ error: "Operación inválida." }, { status: 400 });
    }
    return Response.json(await rpc(operation, payload));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Error en biblioteca");
    return Response.json({ error: "No se pudo completar la operación en Supabase." }, { status: 502 });
  }
});

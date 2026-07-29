// Smoke test: the generated Connect client talks to backend-rs end-to-end.
// Run backend-rs on :3010, then: SMOKE_JWT=<token> bun run scripts/smoke-connect.ts
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { HealthService } from "../src/lib/gen/health_pb";

const base = "http://localhost:3010";
const jwt = process.env.SMOKE_JWT ?? "";

const client = createClient(HealthService, createConnectTransport({ baseUrl: base }));

const check = await client.check({});
console.log("Check.status        =", check.status);

const a = await client.dbCheck({});
const b = await client.dbCheck({});
console.log("DbCheck ts differ   =", a.ts !== b.ts, `(${a.ts} -> ${b.ts})`);

try {
  await client.whoAmI({});
  console.log("WhoAmI(no token)    = UNEXPECTED ok");
} catch (e) {
  console.log(
    "WhoAmI(no token)    =",
    e instanceof ConnectError ? Code[e.code] : String(e),
  );
}

const authed = createClient(
  HealthService,
  createConnectTransport({
    baseUrl: base,
    interceptors: [
      (next) => async (req) => {
        if (jwt) req.header.set("Authorization", `Bearer ${jwt}`);
        return next(req);
      },
    ],
  }),
);
const me = await authed.whoAmI({});
console.log("WhoAmI(token).userId =", me.userId);

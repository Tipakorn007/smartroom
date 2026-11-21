import { expect, test } from "bun:test";
import { neon } from "@neondatabase/serverless";
import { offerNextWaitlist } from "../src/server/waitlist.ts";

const enabled = process.env.SMARTROOM_TEST_POSTGRES === "true";

test.skipIf(!enabled)("waitlist offer accepts millisecond timestamps in PostgreSQL", async () => {
  const url = process.env.DATABASE_URL;
  const expectedBranch = process.env.SMARTROOM_TEST_NEON_BRANCH_ID;
  if (!url || !expectedBranch || expectedBranch === "br-summer-lake-bez3c4t2") {
    throw new Error("Provide DATABASE_URL and a non-production SMARTROOM_TEST_NEON_BRANCH_ID");
  }
  const sql = neon(url);
  const branch = await sql.query("SELECT current_setting('neon.branch_id', true) AS id");
  if (branch[0]?.id !== expectedBranch) {
    throw new Error("DATABASE_URL does not point to the requested Neon test branch");
  }

  const rooms = await sql.query("SELECT id FROM rooms WHERE id = $1", [-1]);
  expect(rooms).toHaveLength(0);
  await expect(offerNextWaitlist(-1, Date.now())).resolves.toBeUndefined();
}, 60_000);

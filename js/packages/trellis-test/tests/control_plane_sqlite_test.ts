import { assertEquals } from "@std/assert";
import { TrellisControlPlaneSqlite } from "../src/control_plane_sqlite.ts";

Deno.test("TrellisControlPlaneSqlite queries and mutates a runtime database", async () => {
  const dbPath = await Deno.makeTempFile({ suffix: ".sqlite" });
  const sqlite = new TrellisControlPlaneSqlite(dbPath);

  try {
    await sqlite.execute(
      "create table sessions (session_key text primary key, value text)",
    );
    const inserted = await sqlite.execute(
      "insert into sessions (session_key, value) values (?, ?)",
      ["session-1", "before"],
    );
    assertEquals(inserted.rowsAffected, 1);

    const rows = await sqlite.query(
      "select session_key, value from sessions where session_key = ?",
      ["session-1"],
    );
    assertEquals(rows, [{ session_key: "session-1", value: "before" }]);

    const snapshot = await sqlite.takeSession("session-1");
    assertEquals(await sqlite.query("select * from sessions"), []);
    assertEquals((await snapshot?.restore())?.rowsAffected, 1);
    assertEquals(await sqlite.query("select * from sessions"), [{
      session_key: "session-1",
      value: "before",
    }]);

    const deleted = await sqlite.execute(
      "delete from sessions where session_key = ?",
      ["session-1"],
    );
    assertEquals(deleted.rowsAffected, 1);
    assertEquals(await sqlite.query("select * from sessions"), []);
  } finally {
    await Deno.remove(dbPath).catch(() => undefined);
  }
});

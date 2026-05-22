/**
 * Firestore security rules tests.
 * Requires the Firebase Emulator to be running on port 8080.
 *
 * Run via: firebase emulators:exec --only firestore --project demo-eyawriter \
 *           "node --test tests/rules.test.mjs"
 *
 * Or standalone (with emulator already running):
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 node --test tests/rules.test.mjs
 */
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from "@firebase/firestore";

const PROJECT_ID = "demo-eyawriter";
const RULES = readFileSync("firestore.rules", "utf8");

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: RULES,
      host: "localhost",
      port: 8080,
    },
  });
});

after(async () => {
  await testEnv?.cleanup();
});

// ── helper: seed data bypassing rules ──────────────────────────────────────

async function seed(path, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), data);
  });
}

// ── 1. Unauthenticated access ──────────────────────────────────────────────

await test("unauthed cannot read any user data", async () => {
  await seed("users/alice/projects/p1", { title: "My Script" });
  const unauthed = testEnv.unauthenticatedContext();
  await assertFails(getDoc(doc(unauthed.firestore(), "users/alice/projects/p1")));
});

await test("unauthed cannot read sharedProjects", async () => {
  await seed("sharedProjects/sp1", { ownerId: "alice", collaborators: {} });
  const unauthed = testEnv.unauthenticatedContext();
  await assertFails(getDoc(doc(unauthed.firestore(), "sharedProjects/sp1")));
});

await test("unauthed cannot read invitations", async () => {
  await seed("invitations/inv1", { fromUid: "alice", toEmail: "bob@test.com", status: "pending" });
  const unauthed = testEnv.unauthenticatedContext();
  await assertFails(getDoc(doc(unauthed.firestore(), "invitations/inv1")));
});

// ── 2. User data isolation ────────────────────────────────────────────────

await test("user can read their own data", async () => {
  await seed("users/alice/projects/p1", { title: "My Script" });
  const alice = testEnv.authenticatedContext("alice");
  await assertSucceeds(getDoc(doc(alice.firestore(), "users/alice/projects/p1")));
});

await test("user cannot read another user's data", async () => {
  await seed("users/alice/projects/p1", { title: "Secret Script" });
  const bob = testEnv.authenticatedContext("bob");
  await assertFails(getDoc(doc(bob.firestore(), "users/alice/projects/p1")));
});

await test("user can write their own data", async () => {
  const alice = testEnv.authenticatedContext("alice");
  await assertSucceeds(
    setDoc(doc(alice.firestore(), "users/alice/projects/p2"), { title: "New Script" })
  );
});

await test("user cannot write another user's data", async () => {
  const bob = testEnv.authenticatedContext("bob");
  await assertFails(
    setDoc(doc(bob.firestore(), "users/alice/projects/p2"), { title: "Hack" })
  );
});

// ── 3. sharedProjects — read access ───────────────────────────────────────

await test("owner can read sharedProject", async () => {
  await seed("sharedProjects/sp2", { ownerId: "alice", collaborators: {} });
  const alice = testEnv.authenticatedContext("alice");
  await assertSucceeds(getDoc(doc(alice.firestore(), "sharedProjects/sp2")));
});

await test("collaborator can read sharedProject", async () => {
  await seed("sharedProjects/sp2", {
    ownerId: "alice",
    collaborators: { bob: { role: "editor" } },
  });
  const bob = testEnv.authenticatedContext("bob");
  await assertSucceeds(getDoc(doc(bob.firestore(), "sharedProjects/sp2")));
});

await test("non-member cannot read sharedProject", async () => {
  await seed("sharedProjects/sp2", { ownerId: "alice", collaborators: {} });
  const carol = testEnv.authenticatedContext("carol");
  await assertFails(getDoc(doc(carol.firestore(), "sharedProjects/sp2")));
});

await test("any authed user can read non-existent sharedProject doc", async () => {
  const carol = testEnv.authenticatedContext("carol");
  // resource == null path — should succeed (used for existence checks)
  await assertSucceeds(getDoc(doc(carol.firestore(), "sharedProjects/does-not-exist-xyz")));
});

// ── 4. sharedProjects — create ────────────────────────────────────────────

await test("owner can create sharedProject when ownerId matches uid", async () => {
  const alice = testEnv.authenticatedContext("alice");
  await assertSucceeds(
    setDoc(doc(alice.firestore(), "sharedProjects/sp-new"), {
      ownerId: "alice",
      collaborators: {},
    })
  );
});

await test("cannot create sharedProject with mismatched ownerId", async () => {
  const bob = testEnv.authenticatedContext("bob");
  await assertFails(
    setDoc(doc(bob.firestore(), "sharedProjects/sp-impersonate"), {
      ownerId: "alice",
      collaborators: {},
    })
  );
});

// ── 5. sharedProjects — owner update ────────────────────────────────────

await test("owner can update any field", async () => {
  await seed("sharedProjects/sp3", { ownerId: "alice", collaborators: {}, title: "Old" });
  const alice = testEnv.authenticatedContext("alice");
  await assertSucceeds(
    updateDoc(doc(alice.firestore(), "sharedProjects/sp3"), { title: "New" })
  );
});

// ── 6. sharedProjects — collaborator update ───────────────────────────────

await test("editor collaborator can update content fields", async () => {
  await seed("sharedProjects/sp4", {
    ownerId: "alice",
    collaborators: { bob: { role: "editor" } },
    title: "Old Title",
  });
  const bob = testEnv.authenticatedContext("bob");
  await assertSucceeds(
    updateDoc(doc(bob.firestore(), "sharedProjects/sp4"), { title: "New Title" })
  );
});

await test("editor collaborator cannot change ownerId", async () => {
  await seed("sharedProjects/sp5", {
    ownerId: "alice",
    collaborators: { bob: { role: "editor" } },
  });
  const bob = testEnv.authenticatedContext("bob");
  await assertFails(
    updateDoc(doc(bob.firestore(), "sharedProjects/sp5"), { ownerId: "bob" })
  );
});

await test("viewer collaborator cannot update content", async () => {
  await seed("sharedProjects/sp6", {
    ownerId: "alice",
    collaborators: { carol: { role: "viewer" } },
    title: "Read Only",
  });
  const carol = testEnv.authenticatedContext("carol");
  await assertFails(
    updateDoc(doc(carol.firestore(), "sharedProjects/sp6"), { title: "Changed" })
  );
});

// ── 7. sharedProjects — delete ────────────────────────────────────────────

await test("owner can delete sharedProject", async () => {
  await seed("sharedProjects/sp-del", { ownerId: "alice", collaborators: {} });
  const alice = testEnv.authenticatedContext("alice");
  await assertSucceeds(deleteDoc(doc(alice.firestore(), "sharedProjects/sp-del")));
});

await test("non-owner cannot delete sharedProject", async () => {
  await seed("sharedProjects/sp-nodelete", { ownerId: "alice", collaborators: { bob: { role: "editor" } } });
  const bob = testEnv.authenticatedContext("bob");
  await assertFails(deleteDoc(doc(bob.firestore(), "sharedProjects/sp-nodelete")));
});

// ── 8. Invitations ────────────────────────────────────────────────────────

await test("sender can read their own invitation", async () => {
  await seed("invitations/inv2", { fromUid: "alice", toEmail: "bob@test.com", status: "pending" });
  const alice = testEnv.authenticatedContext("alice");
  await assertSucceeds(getDoc(doc(alice.firestore(), "invitations/inv2")));
});

await test("recipient can read invitation sent to their email", async () => {
  await seed("invitations/inv3", { fromUid: "alice", toEmail: "bob@test.com", status: "pending" });
  const bob = testEnv.authenticatedContext("bob", { email: "bob@test.com" });
  await assertSucceeds(getDoc(doc(bob.firestore(), "invitations/inv3")));
});

await test("stranger cannot read an invitation", async () => {
  await seed("invitations/inv4", { fromUid: "alice", toEmail: "bob@test.com", status: "pending" });
  const carol = testEnv.authenticatedContext("carol", { email: "carol@test.com" });
  await assertFails(getDoc(doc(carol.firestore(), "invitations/inv4")));
});

await test("sender can create invitation with their own fromUid", async () => {
  const alice = testEnv.authenticatedContext("alice");
  await assertSucceeds(
    setDoc(doc(alice.firestore(), "invitations/inv-create"), {
      fromUid: "alice",
      toEmail: "dave@test.com",
      status: "pending",
    })
  );
});

await test("cannot create invitation with mismatched fromUid", async () => {
  const bob = testEnv.authenticatedContext("bob");
  await assertFails(
    setDoc(doc(bob.firestore(), "invitations/inv-spoof"), {
      fromUid: "alice",
      toEmail: "eve@test.com",
      status: "pending",
    })
  );
});

// ── 9. Deny-all for unknown collections ──────────────────────────────────

await test("unknown root collection is denied for reads", async () => {
  const alice = testEnv.authenticatedContext("alice");
  await assertFails(getDoc(doc(alice.firestore(), "unknownCollection/someDoc")));
});

await test("unknown root collection is denied for writes", async () => {
  const alice = testEnv.authenticatedContext("alice");
  await assertFails(
    setDoc(doc(alice.firestore(), "unknownCollection/someDoc"), { data: "hack" })
  );
});

// ── 10. Presence subcollection ────────────────────────────────────────────

await test("member can write their own presence heartbeat", async () => {
  await seed("sharedProjects/sp-presence", { ownerId: "alice", collaborators: { bob: { role: "editor" } } });
  const bob = testEnv.authenticatedContext("bob");
  await assertSucceeds(
    setDoc(doc(bob.firestore(), "sharedProjects/sp-presence/presence/bob"), {
      uid: "bob", name: "Bob", seenAt: new Date().toISOString()
    })
  );
});

await test("member cannot write another member's presence record", async () => {
  await seed("sharedProjects/sp-presence", { ownerId: "alice", collaborators: { bob: { role: "editor" } } });
  const bob = testEnv.authenticatedContext("bob");
  await assertFails(
    setDoc(doc(bob.firestore(), "sharedProjects/sp-presence/presence/alice"), {
      uid: "alice", name: "Alice", seenAt: new Date().toISOString()
    })
  );
});

await test("non-member cannot write to presence subcollection", async () => {
  await seed("sharedProjects/sp-presence2", { ownerId: "alice", collaborators: {} });
  const outsider = testEnv.authenticatedContext("outsider");
  await assertFails(
    setDoc(doc(outsider.firestore(), "sharedProjects/sp-presence2/presence/outsider"), {
      uid: "outsider", name: "Outsider", seenAt: new Date().toISOString()
    })
  );
});

await test("member can read presence subcollection", async () => {
  await seed("sharedProjects/sp-presence", { ownerId: "alice", collaborators: { bob: { role: "editor" } } });
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "sharedProjects/sp-presence/presence/alice"), {
      uid: "alice", name: "Alice", seenAt: new Date().toISOString()
    });
  });
  const bob = testEnv.authenticatedContext("bob");
  await assertSucceeds(
    getDoc(doc(bob.firestore(), "sharedProjects/sp-presence/presence/alice"))
  );
});

// ── 11. Billing / aiUsage — client write denied ───────────────────────────

await test("client cannot write to billing/data (server-only)", async () => {
  const alice = testEnv.authenticatedContext("alice");
  await assertFails(
    setDoc(doc(alice.firestore(), "users/alice/billing/data"), { plan: "pro" })
  );
});

await test("client cannot write to aiUsage (server-only)", async () => {
  const alice = testEnv.authenticatedContext("alice");
  await assertFails(
    setDoc(doc(alice.firestore(), "users/alice/aiUsage/2024-01"), { requestCount: 1 })
  );
});

await test("user can read their own billing data", async () => {
  await seed("users/alice/billing/data", { plan: "pro", status: "active" });
  const alice = testEnv.authenticatedContext("alice");
  await assertSucceeds(getDoc(doc(alice.firestore(), "users/alice/billing/data")));
});

// ── 12. Quota — plan field write restriction ──────────────────────────────

await test("user can write quota count and resetAt without plan field", async () => {
  const alice = testEnv.authenticatedContext("alice");
  await assertSucceeds(
    setDoc(doc(alice.firestore(), "users/alice/quota/current"), {
      count: 5, resetAt: new Date().toISOString()
    }, { merge: true })
  );
});

await test("user cannot write plan field to quota/current (privilege escalation block)", async () => {
  const alice = testEnv.authenticatedContext("alice");
  await assertFails(
    setDoc(doc(alice.firestore(), "users/alice/quota/current"), {
      count: 0, plan: "pro"
    }, { merge: true })
  );
});

// ── 13. webhookEvents — fully denied to clients ───────────────────────────

await test("client cannot read webhookEvents", async () => {
  await seed("webhookEvents/evt_123", { handled: true });
  const alice = testEnv.authenticatedContext("alice");
  await assertFails(getDoc(doc(alice.firestore(), "webhookEvents/evt_123")));
});

await test("client cannot write webhookEvents", async () => {
  const alice = testEnv.authenticatedContext("alice");
  await assertFails(
    setDoc(doc(alice.firestore(), "webhookEvents/evt_fake"), { handled: true })
  );
});

// ── 14. Comments on sharedProjects ────────────────────────────────────────

await test("editor can create a comment stamped with their uid", async () => {
  await seed("sharedProjects/sp-comments", { ownerId: "alice", collaborators: { bob: { role: "editor" } } });
  const bob = testEnv.authenticatedContext("bob");
  await assertSucceeds(
    setDoc(doc(bob.firestore(), "sharedProjects/sp-comments/comments/c1"), {
      uid: "bob", text: "Great scene!", resolved: false, createdAt: new Date().toISOString()
    })
  );
});

await test("member cannot create a comment stamped with another uid", async () => {
  await seed("sharedProjects/sp-comments", { ownerId: "alice", collaborators: { bob: { role: "editor" } } });
  const bob = testEnv.authenticatedContext("bob");
  await assertFails(
    setDoc(doc(bob.firestore(), "sharedProjects/sp-comments/comments/c-spoof"), {
      uid: "alice", text: "I am Alice!", resolved: false, createdAt: new Date().toISOString()
    })
  );
});

await test("non-member cannot read comments", async () => {
  await seed("sharedProjects/sp-comments", { ownerId: "alice", collaborators: {} });
  await seed("sharedProjects/sp-comments/comments/c2", { uid: "alice", text: "Private note" });
  const outsider = testEnv.authenticatedContext("outsider");
  await assertFails(getDoc(doc(outsider.firestore(), "sharedProjects/sp-comments/comments/c2")));
});

// ── 15. adminSignups — own record creation ───────────────────────────────

await test("user can create their own adminSignups record", async () => {
  const alice = testEnv.authenticatedContext("alice");
  await assertSucceeds(
    setDoc(doc(alice.firestore(), "adminSignups/alice"), { email: "alice@test.com" })
  );
});

await test("user cannot create another user's adminSignups record", async () => {
  const bob = testEnv.authenticatedContext("bob");
  await assertFails(
    setDoc(doc(bob.firestore(), "adminSignups/alice"), { email: "alice@test.com" })
  );
});

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { OperationCoordinator } = require("../src/operations");

test("operation coordinator serializes work and supports cancellation", async () => {
  const coordinator = new OperationCoordinator();
  let release;
  const running = coordinator.run("backup", signal => new Promise(resolve => {
    release = () => resolve(signal.aborted);
  }));
  assert.deepEqual(coordinator.status(), { busy:true, type:"backup" });
  await assert.rejects(coordinator.run("restore", async () => {}), /backup is already running/);
  assert.equal(coordinator.cancel(), true);
  release();
  assert.equal(await running, true);
  assert.deepEqual(coordinator.status(), { busy:false });
});

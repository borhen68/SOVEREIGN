// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import { CommandQueue } from "../src/services/command-queue.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("command queue serializes work inside the same lane", async () => {
  const queue = new CommandQueue({
    maxConcurrent: 4,
    defaultLaneConcurrency: 1
  });

  let laneRunning = 0;
  let laneMax = 0;
  const run = async (ms) => {
    laneRunning += 1;
    laneMax = Math.max(laneMax, laneRunning);
    await sleep(ms);
    laneRunning -= 1;
  };

  const jobA = queue.enqueue({ lane: "mission:1", label: "first" }, () => run(30));
  const jobB = queue.enqueue({ lane: "mission:1", label: "second" }, () => run(10));
  await Promise.all([jobA, jobB]);

  assert.equal(laneMax, 1);
});

test("command queue runs different lanes in parallel up to global limit", async () => {
  const queue = new CommandQueue({
    maxConcurrent: 2,
    defaultLaneConcurrency: 1
  });

  let globalRunning = 0;
  let globalMax = 0;
  const run = async (ms) => {
    globalRunning += 1;
    globalMax = Math.max(globalMax, globalRunning);
    await sleep(ms);
    globalRunning -= 1;
  };

  const first = queue.enqueue({ lane: "mission:1", label: "A" }, () => run(40));
  const second = queue.enqueue({ lane: "mission:2", label: "B" }, () => run(40));
  await Promise.all([first, second]);

  assert.equal(globalMax, 2);
  const stats = queue.getStats();
  assert.equal(stats.maxConcurrent, 2);
});

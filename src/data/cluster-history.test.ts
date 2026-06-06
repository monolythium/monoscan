/**
 * Pure-function coverage for the cluster operator/registry surfaces added in
 * the June 5 feature round (CJ-1 membership history + cluster-name fan-out).
 *
 * These exercise the decoders/normalizers without a live chain or a React
 * render env: `decodeClusterHistoryLogs` over synthetic `eth_getLogs`
 * fixtures, and `normalizeClusterNameMapIds` dedup.
 */

import { describe, expect, it } from "vitest";
import {
  clusterHistoryTopic,
  decodeClusterHistoryLogs,
  normalizeClusterNameMapIds,
  type ClusterHistoryRow,
  type EthLogRow,
} from "./hooks";

// ---- log fixture helpers -------------------------------------------------

/** 32-byte zero-padded hex word from a non-negative integer. */
function word(value: number | bigint): string {
  return BigInt(value).toString(16).padStart(64, "0");
}

/** A `bytes32` topic carrying a left-padded operator id (32 raw bytes). */
function operatorTopic(seed: string): string {
  return `0x${seed.padStart(64, "0")}`;
}

/** Build a synthetic registry log for one cluster-history event kind. */
function log(
  kind: Parameters<typeof clusterHistoryTopic>[0],
  opts: {
    topics?: string[];
    dataWords?: string[];
    blockNumber?: number;
    logIndex?: number;
  } = {},
): EthLogRow {
  const block = opts.blockNumber ?? 100;
  return {
    address: "0x0000000000000000000000000000000000001005",
    topics: [clusterHistoryTopic(kind), ...(opts.topics ?? [])],
    data: `0x${(opts.dataWords ?? []).join("")}`,
    blockHash: `0x${"bb".repeat(32)}`,
    blockNumber: `0x${block.toString(16)}`,
    transactionHash: `0x${"cc".repeat(32)}`,
    transactionIndex: "0x0",
    logIndex: `0x${(opts.logIndex ?? 0).toString(16)}`,
  };
}

/**
 * Encode a `ClusterFormed(uint32,uint64,address,bytes)` data body:
 * word0 carries the anchor address in its low 20 bytes, word2 carries the
 * roster byte-length, and the roster follows as packed 48-byte member refs.
 */
function clusterFormedData(anchorLow20: string, roster48ByteRefs: string[]): string {
  const head0 = anchorLow20.padStart(64, "0"); // anchor read from bytes 12..32
  const head1 = "0".repeat(64);
  const rosterHex = roster48ByteRefs.join("");
  const rosterLen = rosterHex.length / 2;
  const head2 = word(rosterLen);
  return `0x${head0}${head1}${head2}${rosterHex}`;
}

/** 48-byte member ref: 32-byte op hash + 16-byte zero pad (the live width). */
function memberRef(opHash32: string): string {
  return opHash32.padStart(64, "0") + "0".repeat(32);
}

const NO_TIMESTAMPS = new Map<number, number | null>();

function byKind(rows: ClusterHistoryRow[], kind: string): ClusterHistoryRow[] {
  return rows.filter((r) => r.kind === kind);
}

describe("decodeClusterHistoryLogs (CJ-1 event parsing)", () => {
  it("decodes ClusterFormed into a formed row plus one joined row per founding operator", () => {
    const logs = [
      log("clusterFormed", {
        topics: [`0x${word(3)}`, `0x${word(42)}`],
        dataWords: [],
        // data is built separately because it is variable-length
      }),
    ];
    logs[0].data = clusterFormedData("00".repeat(8) + "ab".repeat(12), [
      memberRef("11".repeat(32)),
      memberRef("22".repeat(32)),
    ]);

    const rows = decodeClusterHistoryLogs(3, logs, NO_TIMESTAMPS);

    const formed = byKind(rows, "formed");
    expect(formed).toHaveLength(1);
    expect(formed[0].status).toBe("applied");
    expect(formed[0].effectiveEpoch).toBe("42");
    expect(formed[0].detail).toContain("2 founding operators");

    const joined = byKind(rows, "joined");
    expect(joined).toHaveLength(2);
    expect(joined.map((r) => r.operatorId)).toEqual([
      `0x${"11".repeat(32)}`,
      `0x${"22".repeat(32)}`,
    ]);
    expect(joined.every((r) => r.status === "applied")).toBe(true);
  });

  it("ignores ClusterFormed events for other clusters", () => {
    const logs = [
      log("clusterFormed", { topics: [`0x${word(7)}`, `0x${word(1)}`] }),
    ];
    logs[0].data = clusterFormedData("00".repeat(8) + "cd".repeat(12), [
      memberRef("33".repeat(32)),
    ]);

    expect(decodeClusterHistoryLogs(3, logs, NO_TIMESTAMPS)).toHaveLength(0);
  });

  it("decodes ClusterJoinRequested as a pending join_requested row", () => {
    const rows = decodeClusterHistoryLogs(
      5,
      [
        log("clusterJoinRequested", {
          topics: [`0x${word(5)}`, operatorTopic("aa".repeat(8))],
          dataWords: [word(0), word(120)],
        }),
      ],
      NO_TIMESTAMPS,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("join_requested");
    expect(rows[0].status).toBe("pending");
    expect(rows[0].effectiveEpoch).toBe("120");
  });

  it("decodes ClusterJoinVoted with the running vote tally", () => {
    const rows = decodeClusterHistoryLogs(
      5,
      [
        log("clusterJoinVoted", {
          topics: [
            `0x${word(5)}`,
            operatorTopic("aa".repeat(8)),
            operatorTopic("bb".repeat(8)),
          ],
          dataWords: [word(4), word(7)],
        }),
      ],
      NO_TIMESTAMPS,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("join_voted");
    expect(rows[0].status).toBe("pending");
    expect(rows[0].detail).toBe("4/7 votes collected");
  });

  it("decodes ClusterJoinAdmitted as a queued row carrying seal-roster readiness", () => {
    const rows = decodeClusterHistoryLogs(
      5,
      [
        log("clusterJoinAdmitted", {
          topics: [`0x${word(5)}`, operatorTopic("aa".repeat(8))],
          dataWords: [word(130), word(1)],
        }),
      ],
      NO_TIMESTAMPS,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("join_admitted");
    expect(rows[0].status).toBe("queued");
    expect(rows[0].effectiveEpoch).toBe("130");
    expect(rows[0].detail).toContain("seal roster pending");
  });

  it("maps a ClusterJoinCancelled status code of 4 to an expired row", () => {
    const cancelled = decodeClusterHistoryLogs(
      5,
      [
        log("clusterJoinCancelled", {
          topics: [`0x${word(5)}`, operatorTopic("aa".repeat(8))],
          dataWords: [word(2)],
        }),
      ],
      NO_TIMESTAMPS,
    );
    expect(cancelled[0].kind).toBe("join_cancelled");
    expect(cancelled[0].status).toBe("cancelled");
    expect(cancelled[0].label).toBe("Join cancelled");

    const expired = decodeClusterHistoryLogs(
      5,
      [
        log("clusterJoinCancelled", {
          topics: [`0x${word(5)}`, operatorTopic("aa".repeat(8))],
          dataWords: [word(4)],
        }),
      ],
      NO_TIMESTAMPS,
    );
    expect(expired[0].status).toBe("expired");
    expect(expired[0].label).toBe("Join expired");
  });

  it("decodes PendingChangeQueued (cluster 0 only) into a kinded pending row", () => {
    const rows = decodeClusterHistoryLogs(
      0,
      [
        log("pendingChangeQueued", {
          topics: [`0x${word(2)}`, `0x${word(140)}`],
          dataWords: [operatorTopic("aa".repeat(8)).slice(2), word(99)],
        }),
      ],
      NO_TIMESTAMPS,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("pending_remove");
    expect(rows[0].status).toBe("queued");
    expect(rows[0].inferred).toBe(true);
    expect(rows[0].effectiveEpoch).toBe("140");
  });

  it("derives joined/left rows by pairing admissions and removals with a roster transition", () => {
    const rows = decodeClusterHistoryLogs(
      0,
      [
        log("clusterJoinAdmitted", {
          topics: [`0x${word(0)}`, operatorTopic("aa".repeat(8))],
          dataWords: [word(150), word(0)],
          logIndex: 0,
        }),
        log("pendingChangeQueued", {
          topics: [`0x${word(2)}`, `0x${word(150)}`],
          dataWords: [operatorTopic("bb".repeat(8)).slice(2), word(1)],
          logIndex: 1,
        }),
        log("validatorSetTransition", {
          topics: [`0x${word(150)}`],
          dataWords: [word(7), word(7), word(1), word(1), word(0)],
          logIndex: 2,
        }),
      ],
      NO_TIMESTAMPS,
    );

    const joined = byKind(rows, "joined");
    expect(joined).toHaveLength(1);
    expect(joined[0].status).toBe("derived");
    expect(joined[0].operatorId).toBe(`0x${"aa".repeat(8).padStart(64, "0")}`);

    const left = byKind(rows, "left");
    expect(left).toHaveLength(1);
    expect(left[0].status).toBe("derived");
    expect(left[0].operatorId).toBe(`0x${"bb".repeat(8).padStart(64, "0")}`);

    expect(byKind(rows, "transition")).toHaveLength(1);
  });

  it("drops cluster-scoped events that do not match the requested cluster id", () => {
    const rows = decodeClusterHistoryLogs(
      5,
      [
        log("clusterJoinRequested", {
          topics: [`0x${word(9)}`, operatorTopic("aa".repeat(8))],
          dataWords: [word(0), word(1)],
        }),
      ],
      NO_TIMESTAMPS,
    );
    expect(rows).toHaveLength(0);
  });
});

describe("normalizeClusterNameMapIds", () => {
  it("dedups, truncates, and drops null/negative/non-finite cluster ids", () => {
    expect(normalizeClusterNameMapIds([0, 1, 1, 2, 2, 2])).toEqual([0, 1, 2]);
    expect(normalizeClusterNameMapIds([3, 3.9, 3.1])).toEqual([3]);
    expect(
      normalizeClusterNameMapIds([null, undefined, -1, Number.NaN, 4]),
    ).toEqual([4]);
    expect(normalizeClusterNameMapIds([])).toEqual([]);
  });

  it("preserves first-seen order of the deduped ids", () => {
    expect(normalizeClusterNameMapIds([5, 2, 5, 9, 2])).toEqual([5, 2, 9]);
  });
});

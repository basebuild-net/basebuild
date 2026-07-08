import { useMemo } from "react";
import type { GitCommit } from "../../lib/git";

/** Lane assignment for a single commit row. */
type GraphRow = {
  commit: GitCommit;
  lane: number;
  /** Connectors from this commit's lane to each parent's lane. */
  connectors: { fromLane: number; toLane: number; isMerge: boolean }[];
};

const LANE_COLORS = [
  "#5b8def", // blue
  "#e85d75", // pink/red
  "#4ec9b0", // teal
  "#dcdcaa", // yellow
  "#ce9178", // orange
  "#c586c0", // purple
  "#9cdcfe", // light blue
  "#f4a261", // amber
];

const LANE_W = 22;
const DOT_R = 4;
const ROW_H = 42;

/**
 * Assign commits to lanes and compute connector lines.
 * Walks newest-first. For each commit, if its hash is already in a lane (a
 * parent of a prior commit), reuse that lane. Otherwise assign a new lane.
 * For each parent: if the parent is not yet in a lane, assign it one (reusing
 * the commit's lane for single-parent, new lane for merges).
 */
function computeLanes(commits: GitCommit[]): GraphRow[] {
  const laneHashes: string[] = [];
  const rows: GraphRow[] = [];

  for (const commit of commits) {
    let lane = laneHashes.indexOf(commit.hash);
    if (lane === -1) {
      lane = laneHashes.length;
      laneHashes.push(commit.hash);
    }

    const connectors: { fromLane: number; toLane: number; isMerge: boolean }[] = [];

    for (let i = 0; i < commit.parents.length; i++) {
      const parent = commit.parents[i];
      let parentLane = laneHashes.indexOf(parent);
      if (parentLane === -1) {
        if (commit.parents.length === 1) {
          parentLane = lane;
          laneHashes[lane] = parent;
        } else {
          parentLane = laneHashes.length;
          laneHashes.push(parent);
        }
      }
      connectors.push({
        fromLane: lane,
        toLane: parentLane,
        isMerge: commit.parents.length > 1,
      });
    }

    // Free this lane if no parent reused it
    if (laneHashes[lane] === commit.hash) {
      const reused = connectors.some((c) => c.toLane === lane);
      if (!reused) laneHashes[lane] = "";
    }

    rows.push({ commit, lane, connectors });
  }

  return rows;
}

export function CommitGraph({ commits }: { commits: GitCommit[] }) {
  const rows = useMemo(() => computeLanes(commits), [commits]);
  const maxLane = useMemo(() => {
    let max = 0;
    for (const row of rows) {
      if (row.lane > max) max = row.lane;
      for (const c of row.connectors) {
        if (c.toLane > max) max = c.toLane;
      }
    }
    return max;
  }, [rows]);

  const graphWidth = (maxLane + 1) * LANE_W + 8;

  return (
    <div className="commit-graph">
      <div className="commit-graph-rows">
        {rows.map((row, i) => (
          <div className="commit-graph-row" key={row.commit.hash}>
            <svg
              className="commit-graph-svg"
              width={graphWidth}
              height={ROW_H}
            >
              {/* Curved connectors to parents */}
              {row.connectors.map((conn, j) => {
                const fromX = conn.fromLane * LANE_W + LANE_W / 2 + 4;
                const toX = conn.toLane * LANE_W + LANE_W / 2 + 4;
                const color = LANE_COLORS[conn.toLane % LANE_COLORS.length];
                const midY = ROW_H / 2 + ROW_H / 2;
                // Bezier curve from this commit dot down to the next row's dot
                const path = `M ${fromX} ${ROW_H / 2} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${ROW_H / 2 + ROW_H}`;
                return (
                  <path
                    key={j}
                    d={path}
                    fill="none"
                    stroke={color}
                    strokeWidth={conn.isMerge ? 2 : 1.5}
                    strokeLinecap="round"
                  />
                );
              })}
              {/* Commit dot */}
              <circle
                cx={row.lane * LANE_W + LANE_W / 2 + 4}
                cy={ROW_H / 2}
                r={DOT_R}
                fill={LANE_COLORS[row.lane % LANE_COLORS.length]}
                stroke="var(--bb-bg)"
                strokeWidth={1.5}
              />
              {/* Ring for commits with refs (branch heads, tags) */}
              {row.commit.refs.length > 0 && (
                <circle
                  cx={row.lane * LANE_W + LANE_W / 2 + 4}
                  cy={ROW_H / 2}
                  r={DOT_R + 3}
                  fill="none"
                  stroke={LANE_COLORS[row.lane % LANE_COLORS.length]}
                  strokeWidth={1.5}
                />
              )}
            </svg>
            <div className="commit-graph-info">
              <div className="commit-graph-msg">{row.commit.message}</div>
              <div className="commit-graph-meta">
                {row.commit.refs.map((ref) => (
                  <span
                    key={ref}
                    className={`commit-ref${ref.includes("HEAD") ? " is-head" : ""}${ref.startsWith("tag:") ? " is-tag" : ""}`}
                  >
                    {ref.replace(/^tag:\s*/, "").replace(/^refs\/(heads|remotes|tags)\//, "")}
                  </span>
                ))}
                <span className="commit-hash">{row.commit.shortHash}</span>
                <span className="commit-author">{row.commit.author}</span>
                <span className="commit-date">{row.commit.date}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

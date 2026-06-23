import {
  getEngagement,
  listActivity,
  listEvidence,
  listFindings,
  listTargets,
} from "@promptkiddie/core";
import { notFound } from "next/navigation";
import { Inbox } from "./inbox";

export const dynamic = "force-dynamic";

const PHASES = ["scoping", "recon", "enum", "exploit", "postexploit", "report"] as const;

function PhaseIndicator({ currentPhase }: { currentPhase: string | null }) {
  const activeIdx = currentPhase ? PHASES.indexOf(currentPhase as typeof PHASES[number]) : -1;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.8rem" }}>
      {PHASES.map((p, i) => {
        const done = i < activeIdx;
        const active = i === activeIdx;
        return (
          <div key={p} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span
              style={{
                display: "inline-block",
                padding: "2px 8px",
                borderRadius: "var(--radius)",
                background: active ? "var(--accent-dim)" : done ? "var(--bg-hover)" : "transparent",
                border: `1px solid ${active ? "var(--accent)" : done ? "var(--border)" : "var(--border)"}`,
                color: active ? "var(--accent)" : done ? "var(--text-dim)" : "var(--text-dim)",
                fontWeight: active ? 600 : 400,
                opacity: !done && !active ? 0.4 : 1,
              }}
            >
              {p}
            </span>
            {i < PHASES.length - 1 && (
              <span style={{ color: "var(--border)" }}>&rarr;</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function severityClass(s: string) {
  const map: Record<string, string> = {
    critical: "badge-critical",
    high: "badge-high",
    medium: "badge-medium",
    low: "badge-low",
    info: "badge-info",
  };
  return `badge ${map[s] ?? "badge-status"}`;
}

export default async function EngagementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const engagement = await getEngagement(id);
  if (!engagement) notFound();

  const [targets, findings, activity, evidence] = await Promise.all([
    listTargets(id),
    listFindings(id),
    listActivity(id),
    listEvidence(id),
  ]);

  const currentPhase = activity.length > 0 ? activity[0].phase : null;

  return (
    <div className="container stack">
      <div>
        <div className="row">
          <h1>{engagement.name}</h1>
          <span className="badge badge-status">{engagement.type}</span>
          <span className="badge badge-status">{engagement.status}</span>
        </div>
        <div className="mt-1">
          <PhaseIndicator currentPhase={currentPhase} />
        </div>
        {engagement.scope && (
          <p className="dim mt-1">{engagement.scope}</p>
        )}
      </div>

      <div className="grid-2">
        {/* Targets */}
        <div className="card">
          <h3>
            Targets{" "}
            <span className="dim">({targets.length})</span>
          </h3>
          {targets.length === 0 ? (
            <p className="dim mt-1">None</p>
          ) : (
            <table className="mt-1">
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>Identifier</th>
                  <th>Scope</th>
                </tr>
              </thead>
              <tbody>
                {targets.map((t) => (
                  <tr key={t.id}>
                    <td>{t.kind}</td>
                    <td>
                      <code>{t.identifier}</code>
                    </td>
                    <td>{t.inScope ? "in" : "out"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Findings */}
        <div className="card">
          <h3>
            Findings{" "}
            <span className="dim">({findings.length})</span>
          </h3>
          {findings.length === 0 ? (
            <p className="dim mt-1">None</p>
          ) : (
            <table className="mt-1">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Severity</th>
                  <th>Status</th>
                  <th>CVSS</th>
                </tr>
              </thead>
              <tbody>
                {findings.map((f) => (
                  <tr key={f.id}>
                    <td>{f.title}</td>
                    <td>
                      <span className={severityClass(f.severity)}>
                        {f.severity}
                      </span>
                    </td>
                    <td>
                      <span className="badge badge-status">{f.status}</span>
                    </td>
                    <td className="dim">{f.cvss ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Activity Timeline */}
      <div className="card">
        <h3>
          Activity{" "}
          <span className="dim">({activity.length})</span>
        </h3>
        {activity.length === 0 ? (
          <p className="dim mt-1">No activity recorded</p>
        ) : (
          <table className="mt-1">
            <thead>
              <tr>
                <th>Phase</th>
                <th>Action</th>
                <th>Actor</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {activity.map((a) => (
                <tr key={a.id}>
                  <td>
                    <span className="badge badge-status">{a.phase}</span>
                  </td>
                  <td>{a.action}</td>
                  <td className="dim">{a.actor}</td>
                  <td className="dim">
                    {new Date(a.createdAt!).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Evidence */}
      <div className="card">
        <h3>
          Evidence{" "}
          <span className="dim">({evidence.length})</span>
        </h3>
        {evidence.length === 0 ? (
          <p className="dim mt-1">No evidence captured</p>
        ) : (
          <table className="mt-1">
            <thead>
              <tr>
                <th>Type</th>
                <th>Path</th>
                <th>SHA256</th>
                <th>Captured</th>
              </tr>
            </thead>
            <tbody>
              {evidence.map((e) => (
                <tr key={e.id}>
                  <td>
                    <span className="badge badge-status">{e.type}</span>
                  </td>
                  <td>
                    <code>{e.path}</code>
                  </td>
                  <td className="dim">
                    {e.sha256 ? e.sha256.slice(0, 12) + "..." : "-"}
                  </td>
                  <td className="dim">
                    {new Date(e.capturedAt!).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Inbox */}
      <Inbox engagementId={id} />
    </div>
  );
}

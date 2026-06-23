import { listEngagements } from "@promptkiddie/core";
import Link from "next/link";
import { createEngagementAction } from "./actions";

export const dynamic = "force-dynamic";

const inputStyle = {
  padding: "8px 12px",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  color: "var(--text)",
  fontFamily: "var(--mono)",
  fontSize: "0.9rem",
} as const;

export default async function Home() {
  const engagements = await listEngagements();

  return (
    <div className="container stack">
      <div className="row">
        <h1>Engagements</h1>
      </div>

      <div className="card">
        <h3>New engagement</h3>
        <form
          action={createEngagementAction}
          style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}
        >
          <input
            name="name"
            type="text"
            placeholder="Name..."
            required
            autoComplete="off"
            style={{ ...inputStyle, flex: 1 }}
          />
          <select name="type" required style={inputStyle}>
            <option value="ctf">CTF</option>
            <option value="whitebox">Whitebox</option>
            <option value="blackbox">Blackbox</option>
            <option value="bugbounty">Bug Bounty</option>
          </select>
          <button
            type="submit"
            style={{
              padding: "8px 16px",
              background: "var(--accent-dim)",
              color: "var(--accent)",
              border: "1px solid var(--accent)",
              borderRadius: "var(--radius)",
              cursor: "pointer",
              fontFamily: "var(--mono)",
              fontSize: "0.9rem",
            }}
          >
            Create
          </button>
        </form>
      </div>

      {engagements.length === 0 ? (
        <p className="dim">No engagements yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {engagements.map((e) => (
              <tr key={e.id}>
                <td>
                  <Link href={`/engagements/${e.id}`}>{e.name}</Link>
                </td>
                <td>
                  <span className="badge badge-status">{e.type}</span>
                </td>
                <td>
                  <span className="badge badge-status">{e.status}</span>
                </td>
                <td className="dim">
                  {new Date(e.createdAt!).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

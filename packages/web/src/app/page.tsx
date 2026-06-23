import { listEngagements } from "@promptkiddie/core";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function Home() {
  const engagements = await listEngagements();

  return (
    <div className="container">
      <div className="row mb-1">
        <h1>Engagements</h1>
      </div>

      {engagements.length === 0 ? (
        <p className="dim mt-2">
          No engagements yet. Create one with{" "}
          <code>pk engagement new --name "..." --type ctf</code>
        </p>
      ) : (
        <table className="mt-1">
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

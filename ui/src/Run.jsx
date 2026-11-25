import React, { useEffect, useRef, useState } from "react";
import { Button, Card, Empty, ErrorText, Heading, Status } from "./common.jsx";
import { activeStates, completedStates, formatDate, runLabels } from "./model.mjs";

function eventText(event) {
  const payload = event.payload;
  if (event.kind === "delta") return payload.text;
  if (event.kind === "tool_call") return payload.tool;
  if (event.kind === "progress") return [payload.phase, `${payload.scanned ?? 0} scanned`,
    payload.hashed !== undefined && `${payload.hashed} hashed`].filter(Boolean).join(" · ");
  if (payload.error) return payload.error;
  if (payload.result) return payload.result;
  if (payload.skipped) return "Skipped because the brain was unavailable";
  if (payload.model) return payload.model;
  if (payload.approvalId) return `Approval #${payload.approvalId}`;
  if (payload.position) return `Queue position ${payload.position}`;
  return "";
}

export function RunView({ id, api, data, refresh }) {
  const [run, setRun] = useState(null);
  const [events, setEvents] = useState([]);
  const [frozen, setFrozen] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const recent = useRef(0);
  const agent = run && data.agents.find((entry) => entry.id === run.agent_id);
  const brain = run && data.brains.find((entry) => entry.id === run.brain_id);

  useEffect(() => {
    let live = true;
    const source = new EventSource(`/api/runs/${id}/stream`);
    const update = () => api(`/runs/${id}`).then((snapshot) => {
      if (live) setRun(snapshot);
    }).catch((err) => { if (live) setError(err.message); });
    const receive = (message) => {
      try {
        const event = JSON.parse(message.data);
        if (!live || recent.current >= event.id) return;
        recent.current = event.id;
        setEvents((previous) => [...previous, event].slice(-350));
        if (event.kind !== "delta" && event.kind !== "progress") void update();
        if (completedStates.has(event.kind)) source.close();
      } catch {}
    };
    source.addEventListener("run", receive);
    source.onerror = () => { if (live) void update(); };
    void update();
    const timer = setInterval(() => { setClock(Date.now()); }, 1000);
    return () => { live = false; source.close(); clearInterval(timer); };
  }, [api, id]);

  async function update(path, body) {
    setBusy(true);
    setError("");
    try {
      await api(path, { method: "POST", body });
      setRun(await api(`/runs/${id}`));
      await refresh();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  if (!run) return <><Heading title="Run" back={{ href: "#agents", label: "Agents" }} />
    <ErrorText message={error} />{!error && <p role="status">Loading run…</p>}</>;
  const steps = agent?.config.energy?.maxSteps ?? 12;
  const limit = agent?.config.energy?.maxSeconds ?? 300;
  const maxTokens = agent?.config.energy?.maxTokens ?? 16000;
  const elapsed = run.started_at ? Math.max(0, Math.floor(((run.ended_at ? Date.parse(run.ended_at) : clock)
    - Date.parse(run.started_at)) / 1000)) : 0;
  const tokens = (run.tokens?.prompt ?? 0) + (run.tokens?.output ?? 0);
  const shown = frozen ?? events;

  return <>
    <Heading title={agent?.name ?? `Run #${run.id}`} back={{ href: "#agents", label: "Agents" }}
      description={[`Run #${run.id}`, run.started_at && `Started ${formatDate(run.started_at)}`, brain?.name].filter(Boolean).join(" · ")}
      action={<><Status state={run.state} />
        <Button onClick={() => setFrozen(frozen ? null : events)}>{frozen ? "Resume log" : "Pause log"}</Button>
        {activeStates.has(run.state) && <Button variant="danger" disabled={busy}
          onClick={() => update(`/runs/${id}/kill`)}>Kill run</Button>}</>} />
    <ErrorText message={error || run.error} />
    <div className="run-grid">
      <Card className="panel log-panel">
        <div className="card-top"><h2>Live log</h2>{frozen && <Status state="idle">Paused</Status>}</div>
        {shown.length ? <ol className="log-list" aria-label="Run events">
          {shown.map((event) => <li key={event.id}>
            <time dateTime={event.ts}>{new Date(event.ts).toLocaleTimeString()}</time>
            <strong>{runLabels[event.kind] ?? event.kind.replaceAll("_", " ")}</strong>
            <span>{eventText(event)}</span>
          </li>)}
        </ol> : <Empty title="Waiting for events">The run log will appear here.</Empty>}
      </Card>
      <div className="stack">
        <Card className="panel energy">
          <h2>Energy</h2>
          <Meter title="Steps" value={run.step} max={steps} />
          <Meter title="Elapsed time" value={elapsed} max={limit} unit="s" />
          <Meter title="Tokens" value={tokens} max={maxTokens} />
          {run.queuePosition && <p className="muted">Queue position {run.queuePosition}</p>}
        </Card>
        {run.approvals.map((approval) => <Approval key={approval.id} approval={approval} run={run} busy={busy} update={update} />)}
      </div>
    </div>
  </>;
}

function Meter({ title, value, max, unit = "" }) {
  return <label className="meter"><span>{title}<b>{value}{unit} / {max}{unit}</b></span>
    <progress max={max} value={Math.min(value, max)} /></label>;
}

function Approval({ approval, run, busy, update }) {
  const { proposal } = approval;
  const path = `/runs/${run.id}/approvals/${approval.id}`;
  const pending = run.state === "awaiting_approval" && ["pending", "approved"].includes(approval.status) && !approval.restored
    && approval.id === run.approvals.at(-1).id;
  const fileMove = proposal.kind === "quarantine";
  return <Card className="panel approval">
    <div className="card-top"><h2>{pending ? "Waiting for your approval" : "Approval"}</h2>
      <Status state={pending ? "awaiting_approval" : "idle"}>{approval.restored ? "Restored" : approval.status}</Status></div>
    {fileMove ? <><p>Move <strong>{proposal.path}</strong> to quarantine.</p>
      {proposal.keep && <p className="muted">Keep {proposal.keep.path}</p>}</> :
      <><p>Update <strong>{proposal.name}.md</strong>{proposal.source === "web" && " from web reference data"}.</p>
        <pre className="proposal-text">{proposal.content}</pre></>}
    {pending && <div className="actions">
      <Button variant="primary" disabled={busy} onClick={() => update(path, { decision: "approved" })}>
        {approval.status === "approved" ? "Retry approved action" : "Approve"}
      </Button>
      {approval.status === "pending" && <Button disabled={busy} onClick={() => update(path, { decision: "rejected" })}>Reject</Button>}
    </div>}
    {!pending && fileMove && approval.status === "approved" && !approval.restored &&
      <Button disabled={busy} onClick={() => update(path + "/restore")}>Restore original file</Button>}
  </Card>;
}

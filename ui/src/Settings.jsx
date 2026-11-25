import React, { useCallback, useEffect, useState } from "react";
import { Button, Card, Empty, ErrorText, Field, Heading, Status } from "./common.jsx";
import { formatDate } from "./model.mjs";

export function Brains({ api, data, refresh, user }) {
  const [edit, setEdit] = useState(null);
  const [found, setFound] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const admin = user.role === "admin";
  async function action(job) {
    setBusy(true);
    setError("");
    try { await job(); } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <>
    <Heading title="Brains" description="Manage the local Ollama endpoints and their fallback priority."
      action={admin && <><Button disabled={busy} onClick={() => action(async () => {
        setFound(await api("/brains/discover", { method: "POST" }));
      })}>Scan LAN</Button><Button variant="primary" onClick={() => setEdit({ enabled: true, priority: 10 })}>＋ Add brain</Button></>} />
    <ErrorText message={error} />
    {edit && <Card className="panel narrow settings-panel"><form className="stack" key={edit.id ?? edit.url ?? "new"} onSubmit={(event) => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      void action(async () => {
        await api(edit.id ? `/brains/${edit.id}` : "/brains", { method: edit.id ? "PUT" : "POST",
          body: { name: values.get("name"), url: values.get("url"), priority: Number(values.get("priority")), enabled: values.has("enabled") } });
        setEdit(null);
        await refresh();
      });
    }}>
      <h2>{edit.id ? "Edit brain" : "Add brain"}</h2>
      <Field label="Name"><input name="name" required maxLength={80} defaultValue={edit.name ?? ""} /></Field>
      <div className="form-grid">
        <Field label="Ollama URL"><input name="url" type="url" required defaultValue={edit.url ?? ""} placeholder="http://192.168.1.40:11434" /></Field>
        <Field label="Priority" hint="Lower numbers come first."><input name="priority" type="number" min="0" step="1" required defaultValue={edit.priority} /></Field>
      </div>
      <label className="checkbox"><input name="enabled" type="checkbox" defaultChecked={edit.enabled} /> Enabled</label>
      <div className="actions end"><Button onClick={() => setEdit(null)}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={busy}>Save brain</Button></div>
    </form></Card>}
    {found && <Card className="panel settings-panel">
      <div className="card-top"><h2>Discovered endpoints</h2><Button onClick={() => setFound(null)}>Close</Button></div>
      {found.length ? found.map((brain) => <div className="list-row" key={brain.url}><div><strong>{brain.url}</strong>
        <p>Ollama {brain.version}</p></div><Button onClick={() => setEdit({ ...brain, enabled: true, priority: 10 })}>Review and add</Button></div>) :
        <p className="muted">No Ollama endpoints responded.</p>}
    </Card>}
    <Card className="list-card">{data.brains.length ? data.brains.map((brain) => <div className="list-row" key={brain.id}>
      <div><strong>{brain.name}</strong><p>{brain.url && brain.url + " · "}Priority {brain.priority}
        {brain.lastSeen && " · Last seen " + formatDate(brain.lastSeen)}</p>
        {brain.models.length > 0 && <p>{brain.models.join(", ")}</p>}</div>
      <div className="actions"><Status state={brain.online ? "online" : "idle"}>{brain.enabled ? brain.online ? "Online" : "Unavailable" : "Disabled"}</Status>
        {admin && <Button onClick={() => setEdit(brain)}>Edit</Button>}</div>
    </div>) : <Empty title="No brains configured">{admin ? "Add the address of a local Ollama server to run an agent." : "Ask a Lab Agents administrator to add a local Ollama endpoint."}</Empty>}</Card>
  </>;
}

const fileNames = ["soul", "avatar", "energy", "memory", "learning", "history", "mind"];

export function AgentFiles({ agent, api }) {
  const root = `/agents/${agent.id}/files/`;
  const [name, setName] = useState("soul");
  const [file, setFile] = useState(null);
  const [content, setContent] = useState("");
  const [versions, setVersions] = useState([]);
  const [restore, setRestore] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const current = await api(root + name);
    const recent = current.editable ? await api(root + name + "/versions") : [];
    return [current, recent];
  }, [api, root, name]);
  function show(current, recent) { setFile(current); setContent(current.content); setVersions(recent); setRestore(""); }

  useEffect(() => {
    let active = true;
    setFile(null); setError(""); setSaved("");
    load().then(([current, recent]) => { if (active) show(current, recent); })
      .catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [load]);

  async function action(mode) {
    setBusy(true); setError(""); setSaved("");
    try {
      if (mode === "save") await api(root + name, { method: "PUT", body: { content, revision: file.revision } });
      if (mode === "revert") await api(root + name + "/revert", { method: "POST", body: { version: restore, revision: file.revision } });
      show(...await load());
      if (mode !== "reload") setSaved(mode === "save" ? "Saved" : "Previous version restored");
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <>
    <Heading title={agent.name + " files"} back={{ href: `#agents/${agent.id}/edit`, label: agent.name }} />
    <ErrorText message={error} />
    <div className="files-grid">
      <Card className="file-menu"><nav aria-label="Agent files">{fileNames.map((entry) => <button key={entry} type="button"
        aria-current={entry === name ? "page" : undefined} disabled={busy} onClick={() => {
          if (file?.editable && content !== file.content && !window.confirm("Discard unsaved changes?")) return;
          setName(entry);
        }}>{entry}.md</button>)}</nav></Card>
      <Card className="panel">
        <div className="card-top"><h2>{name}.md</h2><span className="muted" role="status">{saved}</span></div>
        {file && <div className="stack">
          {file.editable ? <>
            {name === "energy" && <p className="muted">Use one setting per line, for example <code>maxSteps: 12</code>.</p>}
            <Field label="Markdown"><textarea className="markdown" rows="15" value={content} onChange={(e) => setContent(e.target.value)} /></Field>
            <div className="actions end"><Button disabled={busy} onClick={() => action("reload")}>Reload</Button>
              <Button variant="primary" disabled={busy || content === file.content} onClick={() => action("save")}>Save file</Button></div>
            {versions.length > 0 && <div className="version-controls">
              <Field label="Previous versions"><select value={restore} onChange={(e) => setRestore(e.target.value)}>
                <option value="">Choose a version</option>{versions.map((version) => <option value={version.revision} key={version.revision}>
                  {formatDate(version.savedAt)} · {version.revision.slice(0, 8)}</option>)}</select></Field>
              <Button disabled={busy || !restore} onClick={() => action("revert")}>Restore version</Button></div>}
          </> : <pre className="read-file">{content || "No entries yet."}</pre>}
        </div>}
      </Card>
    </div>
  </>;
}

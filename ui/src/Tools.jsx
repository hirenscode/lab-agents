import React, { useState } from "react";
import { Button, Card, Empty, ErrorText, Field, Heading, Status } from "./common.jsx";
import { typeInfo } from "./model.mjs";

function typeLabel(id) {
  return typeInfo[id] ?? [id, "System", ""];
}

export function ToolLibrary({ api, data, refresh, selection = [], onUse, onBack, edit }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [setup, setSetup] = useState(edit ? { type: data.types.find(({ id }) => id === edit.type), tool: edit } : null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const types = data.types.filter(({ id }) => {
    const [name, group, description] = typeLabel(id);
    return (category === "All" || group === category) && (name + " " + description).toLowerCase().includes(query.toLowerCase());
  });
  const saved = data.tools.filter((tool) => {
    const [name, group] = typeLabel(tool.type);
    return (category === "All" || group === category) && (tool.name + " " + name).toLowerCase().includes(query.toLowerCase());
  });
  async function save(type, name, scope, tool) {
    setBusy(true);
    setError("");
    try {
      const savedTool = await api(tool ? `/tools/${tool.id}` : "/tools", {
        method: tool ? "PUT" : "POST", body: { type: type.id, permission: type.permission, name, scope },
      });
      await refresh();
      setSetup(null);
      onUse?.(savedTool);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function start(type) {
    if (Object.keys(type.scopeSchema.properties).length) setSetup({ type });
    else await save(type, typeLabel(type.id)[0], {});
  }
  return <section>
    <Heading title={setup ? (setup.tool ? "Edit tool limits" : "Set up tool") : "Tools library"}
      description={setup ? typeLabel(setup.type.id)[2] : "Choose a tool type or reuse a saved setup."}
      action={onBack && <Button onClick={onBack}>Back to agent</Button>} />
    <ErrorText message={error} />
    {setup ? <ToolSetup key={setup.tool?.id ?? setup.type.id} {...setup} mounts={data.mounts} busy={busy}
      onSubmit={(name, scope) => save(setup.type, name, scope, setup.tool)} onCancel={() => { setError(""); setSetup(null); }} /> : <>
      <div className="toolbar">
        <label className="search"><span className="visually-hidden">Search tools</span>
          <span aria-hidden="true">⌕</span><input type="search" placeholder="Search tools" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
        <div className="segmented" aria-label="Tool category">
          {["All", "Files", "Web", "System"].map((group) => <button key={group} type="button" aria-pressed={category === group}
            onClick={() => setCategory(group)}>{group}</button>)}
        </div>
      </div>
      <h2 className="section-label">Tool types</h2>
      {types.length ? <div className="tool-grid">{types.map((type) => {
        const [label, group, description] = typeLabel(type.id);
        const config = Object.keys(type.scopeSchema.properties).length > 0;
        const attached = !config && data.tools.some((tool) => tool.type === type.id && selection.includes(tool.id));
        return <Card key={type.id} className="tool-card">
          <div className="card-top"><span className="tool-icon" aria-hidden="true">{group === "Files" ? "▤" : group === "Web" ? "◎" : "◈"}</span>
            <Status state={type.permission === "propose" ? "awaiting_approval" : "idle"}>
              {type.permission === "propose" ? "Needs approval" : "Read only"}
            </Status></div>
          <h3>{label}</h3><p>{description}</p>
          <div className="tool-footer"><small>{type.id === "weather" ? "Open-Meteo only" : config ? group === "Web" ? "Allowed hostnames" : "Allowed folder" : "Static"}</small>
            <Button disabled={busy || attached} onClick={() => start(type)}>{attached ? "Added" : config ? "Set up" : onUse ? "Add to agent" : "Save setup"}</Button></div>
        </Card>;
      })}</div> : <Card><Empty title="No matching tool types">Try a different search or category.</Empty></Card>}
      <h2 className="section-label">Saved tool setups</h2>
      {!saved.length ? <Card><Empty title="No saved setups here">Configured tool instances appear here.</Empty></Card> :
        <Card className="list-card">{saved.map((tool) => {
          const attached = selection.includes(tool.id);
          return <div className="list-row" key={tool.id}><div><strong>{tool.name}</strong>
            <p>{tool.description || typeLabel(tool.type)[0]}</p></div>
            <div className="actions">
              <Button onClick={() => setSetup({ type: data.types.find(({ id }) => id === tool.type), tool })}>Edit limits</Button>
              {onUse && <Button disabled={attached} variant="primary" onClick={() => onUse(tool)}>{attached ? "Added" : "Add to agent"}</Button>}
            </div></div>;
        })}</Card>}
    </>}
  </section>;
}

function ToolSetup({ type, tool, mounts, busy, onSubmit, onCancel }) {
  const [name, setName] = useState(tool?.name ?? typeLabel(type.id)[0]);
  const [scope, setScope] = useState(tool?.scope ?? {});
  const properties = type.scopeSchema.properties;
  const choices = mounts.filter((mount) => type.permission !== "propose" || mount.mode === "write");
  const { allowedDomains: _domains, ...initialScope } = scope;
  function submit(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const updated = { ...initialScope };
    if (properties.mountId) {
      updated.mountId = data.get("mountId");
      updated.folder = data.get("folder");
    }
    if (properties.allowedDomains) updated.allowedDomains = data.get("domains").split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
    onSubmit(name, updated);
  }
  return <Card className="panel narrow">
    <form className="stack" onSubmit={submit}>
      <Field label="Setup name"><input value={name} required maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
      {properties.mountId && <>
        <div className="form-grid">
          <Field label="Share"><select name="mountId" required defaultValue={scope.mountId ?? ""} onChange={(e) => setScope({ ...scope, mountId: e.target.value })}>
            <option value="">Select a mounted share</option>
            {choices.map(({ id, mode }) => <option key={id} value={id}>{id} · {mode}</option>)}</select></Field>
          <Field label="Folder within share" hint="Leave blank to use the share root."><input name="folder" defaultValue={scope.folder ?? ""} placeholder="family/photos" /></Field>
        </div>
        {!choices.length && <p className="notice">A suitable mounted share is required. Configure tool mounts in Docker before using this tool.</p>}
      </>}
      {properties.allowedDomains && <Field label="Allowed hostnames" hint="Enter one exact hostname per line.">
        <textarea name="domains" rows="4" required defaultValue={scope.allowedDomains?.join("\n")} placeholder="example.com" />
      </Field>}
      <div className="actions end"><Button onClick={onCancel}>Cancel</Button><Button type="submit" variant="primary" disabled={busy}>Save setup</Button></div>
    </form>
  </Card>;
}

import React, { useEffect, useState } from "react";
import { Button, Card, Empty, ErrorText, Field, Heading, Status } from "./common.jsx";
import { activeStates, latestRun, localZone, makeTrigger, triggerLabel, zones } from "./model.mjs";
import { ToolLibrary } from "./Tools.jsx";

export function Agents({ api, data, refresh, go, act }) {
  const [preset, setPreset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const writable = data.mounts.filter(({ mode }) => mode === "write");
  async function createPreset(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const agent = await api("/presets/duplicate-finder", { method: "POST", body: {
        scope: { mountId: form.get("mountId"), folder: form.get("folder") },
      } });
      await refresh();
      go(`agents/${agent.id}/edit`);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <>
    <Heading title="Agents" description="Create, run, and stop agents that work on your NAS."
      action={<><Button onClick={() => setPreset(!preset)}>Duplicate Finder</Button>
        <Button variant="primary" onClick={() => go("agents/new")}><span aria-hidden="true">＋</span> New agent</Button></>} />
    {preset && <Card className="panel preset"><form className="stack" onSubmit={createPreset}>
      <h2>Set up Duplicate Finder</h2><p>The preset scans a share and asks you to approve each quarantine move.</p>
      <ErrorText message={error} />
      <div className="form-grid">
        <Field label="Writable share"><select name="mountId" required><option value="">Select a share</option>
          {writable.map(({ id }) => <option key={id}>{id}</option>)}</select></Field>
        <Field label="Folder within share"><input name="folder" placeholder="Share root" /></Field>
      </div>
      {!writable.length && <p className="notice">Configure a writable tool mount to use Duplicate Finder.</p>}
      <div className="actions"><Button onClick={() => setPreset(false)}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={busy || !writable.length}>Create preset</Button></div>
    </form></Card>}
    <Card className="agents-card">
      {!data.agents.length ? <Empty title="No agents yet" action={<Button variant="primary" onClick={() => go("agents/new")}>Create your first agent</Button>}>
        Choose a brain, add tools, and decide when it should run.
      </Empty> : <table className="agents-table"><thead><tr>
        <th scope="col">Agent</th><th scope="col">Status</th><th scope="col">Trigger</th><th scope="col">Tools</th><th scope="col">Actions</th>
      </tr></thead><tbody>{data.agents.map((agent) => {
        const run = latestRun(data.runs, agent.id);
        const active = activeStates.has(run?.state);
        const trigger = data.triggers[agent.id]?.find(({ enabled }) => enabled) ?? data.triggers[agent.id]?.[0];
        const state = active ? run.state : trigger?.enabled && trigger.kind !== "manual" ? "scheduled" : "idle";
        return <tr key={agent.id}>
          <td data-label="Agent"><a className="agent-name" href={`#agents/${agent.id}/edit`}>{agent.name}</a>
            {agent.config.description && <p className="cell-caption">{agent.config.description}</p>}</td>
          <td data-label="Status"><Status state={state} />
            {!!run?.queuePosition && <small className="cell-caption">Queue position {run.queuePosition}</small>}</td>
          <td data-label="Trigger">{triggerLabel(trigger)}</td>
          <td data-label="Tools" className="muted">{agent.tools.map(({ name }) => name).join(", ") || "None"}</td>
          <td data-label="Actions"><div className="row-actions">
            {run && <a href={`#runs/${run.id}`}>Run log</a>}
            {active ? <Button variant="danger" onClick={() => act(async () => {
              await api(`/runs/${run.id}/kill`, { method: "POST" }); await refresh();
            })}>Kill</Button> : <Button onClick={() => act(async () => {
              const created = await api(`/agents/${agent.id}/runs`, { method: "POST" }); await refresh(); go(`runs/${created.id}`);
            })}>{state === "scheduled" ? "Spawn now" : "Spawn"}</Button>}
          </div></td>
        </tr>;
      })}</tbody></table>}
    </Card>
  </>;
}

const triggerFields = new Set(["trigger", "once", "minutes", "time", "timeZone", "days", "mountId", "folder", "catchUp"]);

const energyFields = [
  ["maxSteps", "Max steps", 12, 1, 50],
  ["maxSeconds", "Time limit (seconds)", 300, 1, 3600],
  ["maxTokens", "Token budget", 16000, 64, 128000],
  ["contextTokens", "Context size", 8192, 512, 8192],
];

function dateInput(value) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function AgentEditor({ agent, data, api, refresh, go }) {
  const trigger = agent && data.triggers[agent.id]?.[0];
  const [form, setForm] = useState(() => ({
    name: agent?.name ?? "", description: agent?.config.description ?? "", task: agent?.config.task ?? "",
    brainId: agent?.brain_pref ?? "", model: agent?.config.model ?? "", ifUnavailable: agent?.config.ifUnavailable ?? "fallback",
    energy: Object.fromEntries(energyFields.map(([key, , fallback]) => [key, agent?.config.energy?.[key] ?? fallback])),
    toolIds: agent?.tools.map(({ id }) => id) ?? [],
    trigger: trigger?.kind ?? "manual", once: dateInput(trigger?.spec.at), minutes: trigger?.spec.minutes ?? 30,
    time: trigger?.spec.time ?? "02:00", timeZone: trigger?.spec.timeZone ?? localZone,
    days: trigger?.spec.days ?? [0, 1, 2, 3, 4, 5, 6], mountId: trigger?.spec.mountId ?? "",
    folder: trigger?.spec.folder ?? "", catchUp: trigger?.spec.catchUp ?? "run_once",
    soul: "", avatar: "",
  }));
  const [toolPanel, setToolPanel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedId, setSavedId] = useState(agent?.id);
  const [savedTrigger, setSavedTrigger] = useState(trigger?.id);
  const [triggerDirty, setTriggerDirty] = useState(false);
  const set = (key, value) => {
    if (triggerFields.has(key)) setTriggerDirty(true);
    setForm((previous) => ({ ...previous, [key]: value }));
  };
  const currentBrain = data.brains.find(({ id }) => String(id) === String(form.brainId));
  const matching = form.toolIds.map((id) => data.tools.find((tool) => tool.id === id)).filter(Boolean);

  async function save(event) {
    event.preventDefault();
    const spawn = event.nativeEvent.submitter?.value === "spawn";
    setBusy(true);
    setError("");
    try {
      const definition = makeTrigger(form.trigger, form);
      const body = { name: form.name, description: form.description, task: form.task,
        brainId: form.brainId ? Number(form.brainId) : null, model: form.model, ifUnavailable: form.ifUnavailable,
        toolIds: form.toolIds, energy: Object.fromEntries(Object.entries(form.energy).map(([key, val]) => [key, Number(val)])) };
      const saved = await api(savedId ? `/agents/${savedId}` : "/agents", { method: savedId ? "PUT" : "POST", body });
      setSavedId(saved.id);
      if (!savedTrigger || triggerDirty) {
        const savedSchedule = await api(`/agents/${saved.id}/triggers${savedTrigger ? "/" + savedTrigger : ""}`, {
          method: savedTrigger ? "PUT" : "POST", body: definition,
        });
        setSavedTrigger(savedSchedule.id);
        setTriggerDirty(false);
      }
      for (const file of ["soul", "avatar"]) {
        if (!form[file].trim()) continue;
        const path = `/agents/${saved.id}/files/${file}`;
        const old = await api(path);
        await api(path, { method: "PUT", body: { content: form[file], revision: old.revision } });
      }
      if (spawn) {
        const run = await api(`/agents/${saved.id}/runs`, { method: "POST" });
        await refresh();
        go(`runs/${run.id}`);
      } else {
        await refresh();
        go("agents");
      }
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  function useTool(tool) {
    if (!form.toolIds.includes(tool.id)) set("toolIds", [...form.toolIds, tool.id]);
    setToolPanel(null);
  }
  async function archive() {
    if (!window.confirm(`Archive ${agent.name}?`)) return;
    setBusy(true);
    try { await api(`/agents/${agent.id}`, { method: "DELETE" }); await refresh(); go("agents"); }
    catch (error) { setError(error.message); } finally { setBusy(false); }
  }
  if (toolPanel) return <ToolLibrary api={api} data={data} refresh={refresh} selection={form.toolIds}
    edit={toolPanel === true ? null : toolPanel} onUse={useTool} onBack={() => setToolPanel(null)} />;

  return <section className="editor">
    <Heading title={agent ? "Edit " + agent.name : "New agent"} back={{ href: "#agents", label: "Agents" }}
      description="Choose a brain, decide when it should run, and add the tools it needs."
      action={agent && <><Button onClick={() => go(`agents/${agent.id}/files`)}>Agent files</Button>
        <Button onClick={() => go(`agents/${agent.id}/history`)}>Run history</Button></>} />
    <ErrorText message={error} />
    <form className="editor-stack" onSubmit={save}>
      <Card className="panel">
        <h2>Basics</h2>
        <div className="form-grid">
          <Field label="Name"><input required maxLength={80} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. HomeHunter" /></Field>
          <Field label="Brain"><select value={form.brainId} onChange={(e) => {
            setForm({ ...form, brainId: e.target.value, model: "" });
          }}><option value="">Automatic by priority</option>{data.brains.map((brain) => <option key={brain.id} value={brain.id}>{brain.name}</option>)}</select></Field>
          <Field label="Description"><input value={form.description} maxLength={300} onChange={(e) => set("description", e.target.value)} /></Field>
          <Field label="Preferred model"><input value={form.model} maxLength={120} list="brain-models" placeholder="Automatic"
            onChange={(e) => set("model", e.target.value)} /><datalist id="brain-models">
              {(currentBrain?.models ?? data.brains.flatMap(({ models }) => models)).filter((model, index, all) => all.indexOf(model) === index)
                .map((model) => <option key={model} value={model} />)}</datalist></Field>
        </div>
        <Field label="What should it do?"><textarea required maxLength={4000} rows="3" value={form.task}
          onChange={(e) => set("task", e.target.value)} placeholder="Describe the task the agent should perform." /></Field>
      </Card>
      <Card className="panel">
        <h2>When should it run?</h2>
        <fieldset className="trigger-options"><legend className="visually-hidden">Trigger type</legend>
          {[["once", "Once"], ["schedule", "On a schedule"], ["interval", "Every N minutes"],
            ["file_appears", "When a file appears"], ["manual", "Only when I click"]].map(([value, label]) =>
            <label key={value}><input type="radio" name="trigger" value={value} checked={form.trigger === value}
              onChange={() => set("trigger", value)} />{label}</label>)}
        </fieldset>
        <div className="form-grid">
          {form.trigger === "once" && <Field label="Run at"><input required type="datetime-local" value={form.once} onChange={(e) => set("once", e.target.value)} /></Field>}
          {form.trigger === "interval" && <Field label="Interval (minutes)"><input required type="number" min="1" max="10080" value={form.minutes} onChange={(e) => set("minutes", e.target.value)} /></Field>}
          {form.trigger === "schedule" && <>
            <Field label="Local time"><input required type="time" value={form.time} onChange={(e) => set("time", e.target.value)} /></Field>
            <Field label="Time zone"><input required list="time-zones" value={form.timeZone} onChange={(e) => set("timeZone", e.target.value)} />
              <datalist id="time-zones">{["UTC", ...zones.filter((zone) => zone !== "UTC")].map((zone) => <option key={zone}>{zone}</option>)}</datalist></Field>
            <fieldset className="day-options"><legend>Days</legend>
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label, index) => <label key={label}>
                <input type="checkbox" checked={form.days.includes(index)} onChange={(event) =>
                  set("days", event.target.checked ? [...form.days, index] : form.days.filter((day) => day !== index))} />{label}</label>)}
            </fieldset>
          </>}
          {form.trigger === "file_appears" && <>
            <Field label="Watch share"><select required value={form.mountId} onChange={(e) => set("mountId", e.target.value)}>
              <option value="">Select share</option>{data.mounts.map(({ id }) => <option key={id}>{id}</option>)}</select></Field>
            <Field label="Folder within share"><input placeholder="Share root" value={form.folder} onChange={(e) => set("folder", e.target.value)} /></Field>
          </>}
          <Field label="If the brain is asleep"><select value={form.ifUnavailable} onChange={(e) => set("ifUnavailable", e.target.value)}>
            <option value="wait">Wait until it returns</option><option value="fallback">Use another brain</option><option value="skip">Skip this run</option>
          </select></Field>
          {form.trigger !== "manual" && <Field label="Missed occurrences"><select value={form.catchUp} onChange={(e) => set("catchUp", e.target.value)}>
            <option value="run_once">Run once on return</option><option value="skip">Skip missed runs</option></select></Field>}
        </div>
      </Card>
      <Card className="panel">
        <h2>Personality and Energy</h2>
        {!agent && <div className="form-grid">
          {["soul", "avatar"].map((key) => <Field key={key} label={key === "soul" ? "Soul (optional)" : "Avatar and tone (optional)"}>
            <textarea rows="2" value={form[key]} onChange={(e) => set(key, e.target.value)} /></Field>)}
        </div>}
        <div className="form-grid energy-fields">{energyFields.map(([key, label, , minimum, max]) => <Field key={key} label={label}>
          <input type="number" required min={minimum} max={max} value={form.energy[key]} onChange={(e) => {
            set("energy", { ...form.energy, [key]: e.target.value });
          }} /></Field>)}</div>
        <p className="muted">File moves require your approval.</p>
      </Card>
      <Card className="panel">
        <div className="card-top"><h2>Tools for this agent</h2>
          <Button variant="primary" onClick={() => setToolPanel(true)} disabled={form.toolIds.length >= 8}>＋ Add tool</Button></div>
        {matching.length ? <div className="agent-tools">{matching.map((tool) => <div className="list-row" key={tool.id}>
          <div><strong>{tool.name}</strong><p>{tool.description}</p></div><div className="actions">
            <Button onClick={() => setToolPanel(tool)}>Edit limits</Button>
            <Button onClick={() => set("toolIds", form.toolIds.filter((id) => id !== tool.id))}>Remove</Button>
          </div></div>)}</div> : <p className="muted">This agent has no tools yet.</p>}
      </Card>
      <div className="actions end editor-footer">
        {agent && <Button variant="danger" className="push-start" disabled={busy} onClick={archive}>Archive</Button>}
        <Button onClick={() => go("agents")}>Cancel</Button>
        <Button type="submit" disabled={busy}>{agent ? "Save changes" : "Create agent"}</Button>
        <Button type="submit" value="spawn" variant="primary" disabled={busy}>{agent ? "Save and spawn" : "Create and spawn"}</Button>
      </div>
    </form>
  </section>;
}

export function AgentHistory({ agent, runs }) {
  return <>
    <Heading title={agent.name + " run history"} back={{ href: "#agents/" + agent.id + "/edit", label: agent.name }} />
    <Card className="list-card">
      {runs.length ? runs.map((run) => <div className="list-row" key={run.id}>
        <div><a href={`#runs/${run.id}`}><strong>Run #{run.id}</strong></a><p>{run.task}</p></div><Status state={run.state} />
      </div>) : <Empty title="No runs yet">Spawn the agent to see its run history.</Empty>}
    </Card>
  </>;
}

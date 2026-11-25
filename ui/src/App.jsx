import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { createApi } from "./api.mjs";
import { AgentEditor, AgentHistory, Agents } from "./Agents.jsx";
import { Button, Card, ErrorText, Field, Heading, Status } from "./common.jsx";
import { ConfigProvider } from "./hexagon/utils/ConfigProvider.jsx";
import { RunView } from "./Run.jsx";
import { AgentFiles, Brains } from "./Settings.jsx";
import { ToolLibrary } from "./Tools.jsx";
import "./styles.css";

const anonymous = createApi();
const route = () => window.location.hash.replace(/^#\/?/, "") || "agents";
const navigate = (path) => { window.location.hash = path; };
const initialTheme = () => {
  const saved = localStorage.getItem("lab-agents-theme");
  return saved === "light" || saved === "dark" ? saved : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

function Logo() {
  return <a className="brand" href="#agents"><span className="brand-mark" aria-hidden="true"><span /></span>Agent Console</a>;
}

function ThemeButton({ theme, switchTheme }) {
  return <Button variant="plain" onClick={switchTheme} aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}>
    <span aria-hidden="true" className="theme-icon">{theme === "light" ? "☾" : "☀"}</span></Button>;
}

function Login({ onLogin, theme, switchTheme }) {
  const [provider, setProvider] = useState("dsm");
  const [otp, setOtp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function signIn(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      const code = form.get("otp");
      const session = await anonymous("/login", { method: "POST", body: {
        username: form.get("username"), password: form.get("password"), provider, ...(code && { otp: code }),
      } });
      onLogin(session);
    } catch (err) {
      if (["otp_required", "otp_wrong", "otp_enforced"].includes(err.code)) setOtp(true);
      setError(err.message);
    } finally { setBusy(false); }
  }
  return <>
    <header className="top-bar"><div className="top-inner"><Logo /><ThemeButton theme={theme} switchTheme={switchTheme} /></div></header>
    <main className="signin-wrap">
      <Card className="signin">
        <div className="login-mark" aria-hidden="true"><span className="brand-mark"><span /></span></div>
        <h1>Sign in to Lab Agents</h1><p>Use your NAS account to manage your agents.</p>
        <ErrorText message={error} />
        <form className="stack" onSubmit={signIn}>
          <Field label="Sign-in method"><select value={provider} onChange={(e) => { setProvider(e.target.value); setOtp(false); setError(""); }}>
            <option value="dsm">Synology DSM</option><option value="local">Local administrator</option></select></Field>
          <Field label="Username"><input name="username" autoComplete="username" required maxLength={128} /></Field>
          <Field label="Password"><input name="password" type="password" autoComplete="current-password" required /></Field>
          {provider === "dsm" && <><label className="checkbox"><input type="checkbox" checked={otp} onChange={(e) => setOtp(e.target.checked)} />
            Use a verification code</label>{otp && <Field label="Verification code">
              <input name="otp" autoComplete="one-time-code" inputMode="numeric" required /></Field>}</>}
          <Button type="submit" variant="primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
        </form>
      </Card>
    </main>
  </>;
}

function Console({ session, onLogout, theme, switchTheme }) {
  const [path, setPath] = useState(route);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const api = useMemo(() => createApi(session.csrfToken), [session.csrfToken]);
  const refresh = useCallback(async () => {
    const [agents, tools, brains, runs, types, mounts] = await Promise.all(
      ["/agents", "/tools", "/brains", "/runs", "/tool-types", "/mounts"].map((path) => api(path)));
    const triggers = Object.fromEntries(await Promise.all(agents.map(async ({ id }) => [id, await api(`/agents/${id}/triggers`)])));
    setData({ agents, tools, brains, runs, types, mounts, triggers });
  }, [api]);
  const report = useCallback((err) => {
    if (err.status === 401) onLogout();
    else setError(err.message);
  }, [onLogout]);

  useEffect(() => {
    const change = () => setPath(route());
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    void refresh().catch(report);
    const timer = setInterval(() => { if (!document.hidden) void refresh().catch(report); }, 6000);
    return () => clearInterval(timer);
  }, [refresh, report]);
  useEffect(() => {
    window.scrollTo(0, 0);
    document.querySelector("main h1")?.focus({ preventScroll: true });
  }, [path, Boolean(data)]);

  async function act(operation) {
    setError("");
    try { await operation(); } catch (err) { report(err); }
  }
  const [section, selection, subview] = path.split("/");
  const available = data?.brains.filter((brain) => brain.enabled && brain.online) ?? [];
  const primary = available[0];
  const mainMenu = section === "runs" ? "agents" : section;
  let view;
  if (data) {
    const common = { api, data, refresh, go: navigate, act };
    const agent = data.agents.find(({ id }) => String(id) === selection);
    if (section === "tools") view = <ToolLibrary {...common} />;
    else if (section === "brains") view = <Brains {...common} user={session.user} />;
    else if (section === "runs" && /^\d+$/.test(selection ?? "")) view = <RunView key={selection} id={selection} {...common} />;
    else if (section === "agents" && selection === "new") view = <AgentEditor key="new" {...common} />;
    else if (section === "agents" && agent && subview === "edit") view = <AgentEditor key={agent.id} agent={agent} {...common} />;
    else if (section === "agents" && agent && subview === "files") view = <AgentFiles key={agent.id} agent={agent} api={api} />;
    else if (section === "agents" && agent && subview === "history") view = <AgentHistory agent={agent} runs={data.runs.filter(({ agent_id }) => agent_id === agent.id)} />;
    else if (section === "agents" && !selection) view = <Agents {...common} />;
    else view = <Heading title="Page unavailable" back={{ href: "#agents", label: "Agents" }} />;
  }
  return <>
    <a className="skip" href="#main" onClick={(event) => { event.preventDefault(); document.getElementById("main").focus(); }}>Skip to content</a>
    <header className="top-bar"><div className="top-inner">
      <Logo />
      <nav className="main-nav" aria-label="Main navigation">
        {[["agents", "Agents"], ["tools", "Tools"], ["brains", "Brains"]].map(([key, label]) =>
          <a key={key} href={"#" + key} aria-current={mainMenu === key ? "page" : undefined}>{label}</a>)}
      </nav>
      <div className="top-right">
        <Status state={primary ? "online" : "idle"}>{primary ? `Brain online · ${primary.name}` : "Brain unavailable"}</Status>
        <span className="username" title={session.user.username}>{session.user.username}</span>
        <ThemeButton theme={theme} switchTheme={switchTheme} />
        <Button variant="plain" onClick={() => act(async () => { await api("/logout", { method: "POST" }); onLogout(); })}>Sign out</Button>
      </div>
    </div></header>
    <main className="shell" id="main" tabIndex="-1">
      <ErrorText message={error} />{view ?? (!error && <p role="status">Loading console…</p>)}
    </main>
  </>;
}

function App() {
  const [theme, setTheme] = useState(initialTheme);
  const [session, setSession] = useState(undefined);
  const [error, setError] = useState("");
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("lab-agents-theme", theme);
  }, [theme]);
  useEffect(() => {
    const stop = new AbortController();
    anonymous("/session", { signal: stop.signal }).then(setSession).catch((err) => {
      if (!stop.signal.aborted) {
        if (err.status !== 401) setError(err.message);
        setSession(null);
      }
    });
    return () => stop.abort();
  }, []);
  const logout = useCallback(() => setSession(null), []);
  const switchTheme = () => setTheme((theme) => theme === "dark" ? "light" : "dark");
  return <ConfigProvider theme={theme}>
    {error && <ErrorText message={error} />}
    {session === undefined ? <main className="shell"><p role="status">Loading Lab Agents…</p></main> : session ?
      <Console session={session} onLogout={logout} theme={theme} switchTheme={switchTheme} /> :
      <Login onLogin={setSession} theme={theme} switchTheme={switchTheme} />}
  </ConfigProvider>;
}

createRoot(document.getElementById("root")).render(<App />);

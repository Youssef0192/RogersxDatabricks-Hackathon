import { useState } from "react";
import { post } from "../api";

/** Genie answers use light markdown: render **bold** and keep line breaks; everything else is plain text. */
function Md({ text }: { text: string }) {
  return <div style={{ whiteSpace: "pre-wrap" }}>{text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <b key={i}>{part.slice(2, -2)}</b> : <span key={i}>{part}</span>)}</div>;
}
const cell = (v: any) => (v !== null && v !== "" && !Number.isNaN(Number(v)) && String(v).includes(".") ? Number(v).toLocaleString("en-CA", { maximumFractionDigits: 3 }) : v);

const SAMPLES = [
  "Which hub surges most often?",
  "Which routes need buses at UBC on exam-week evenings?",
  "What should dispatch do at Waterfront on June 24, 2026?",
  "How much crowding did Hub Pulse avoid on surge days?",
  "How accurate is the surge forecast compared with the baseline?",
  "Is this data real? What are its limits?",
];

export default function GenieView() {
  const [q, setQ] = useState("");
  const [conv, setConv] = useState<string | null>(null);
  const [log, setLog] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  const ask = async (question: string) => {
    if (!question.trim() || busy) return;
    setBusy(true); setQ("");
    setLog((l) => [...l, { q: question }]);
    try {
      const r = await post("/api/genie", { question, conversation_id: conv });
      setConv(r.conversation_id);
      setLog((l) => [...l.slice(0, -1), { q: question, a: r }]);
    } catch (e: any) {
      setLog((l) => [...l.slice(0, -1), { q: question, a: { error: String(e.message) } }]);
    } finally { setBusy(false); }
  };

  return (
    <div className="page">
      <div className="chat">
        <div className="note" style={{ marginBottom: 12 }}>
          Ask the data in plain English. Answers come from the Hub Pulse Genie space (16 curated tables and metric views) and run as <b>you</b>, with your own
          Unity Catalog permissions. Each answer shows the SQL Genie wrote so it can be checked.
        </div>
        {!log.length && <div className="row" style={{ marginBottom: 12 }}>{SAMPLES.map((s) => <button key={s} className="chip" onClick={() => ask(s)}>{s}</button>)}</div>}
        {log.map((m, i) => (
          <div key={i}>
            <div className="msg q">{m.q}</div>
            <div className="msg">
              {!m.a && <span className="muted">Genie is thinking… (usually 10–40 seconds)</span>}
              {m.a?.error && !m.a?.text && <span className="err">{m.a.error}</span>}
              {m.a?.text && <Md text={m.a.text} />}
              {m.a?.columns?.length > 0 && (
                <div style={{ overflowX: "auto", marginTop: 8 }}>
                  <table className="t"><thead><tr>{m.a.columns.map((c: string) => <th key={c}>{c}</th>)}</tr></thead>
                    <tbody>{m.a.rows.slice(0, 20).map((r: any[], j: number) => <tr key={j}>{r.map((v, k) => <td key={k}>{cell(v)}</td>)}</tr>)}</tbody></table>
                </div>
              )}
              {m.a?.sql && <details style={{ marginTop: 8 }}><summary className="muted small">SQL Genie ran</summary><pre className="sql">{m.a.sql}</pre></details>}
            </div>
          </div>
        ))}
        <form className="row" onSubmit={(e) => { e.preventDefault(); ask(q); }} style={{ marginTop: 8 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Which routes serving UBC are over 85% full in the PM peak?"
            style={{ flex: 1, padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", font: "inherit" }} />
          <button className="btn primary" disabled={busy}>Ask</button>
          {conv && <button type="button" className="btn" onClick={() => { setConv(null); setLog([]); }}>New conversation</button>}
        </form>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import type {
  ChurchSuiteImportReport,
  ChurchSuitePlanPreview,
  ChurchSuitePlanSummary,
} from "@sm/shared";
import { api, ApiError } from "../api";
import { IsoDateInput } from "../components/IsoDateInput";
import { compactDate } from "../service-date";

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function defaultRange(): { from: string; to: string } {
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - 30);
  const to = new Date(today);
  to.setDate(to.getDate() + 120);
  return { from: isoDate(from), to: isoDate(to) };
}

function planName(plan: ChurchSuitePlanSummary): string {
  return `${compactDate(plan.date)} · ${plan.time?.slice(0, 5) ?? "no time"} · ${plan.name}`;
}

export default function ChurchsuitePage({
  notify,
  onOpenSetlists,
}: {
  notify: (text: string, kind?: "info" | "error") => void;
  onOpenSetlists: () => void;
}) {
  const range = defaultRange();
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [status, setStatus] = useState("published");
  const [plans, setPlans] = useState<ChurchSuitePlanSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<number | null>(null);
  const [preview, setPreview] = useState<ChurchSuitePlanPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [importName, setImportName] = useState("");
  const [importDate, setImportDate] = useState(isoDate(new Date()));
  const [importTime, setImportTime] = useState("");
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<ChurchSuiteImportReport | null>(null);

  async function loadPlans() {
    setLoading(true);
    setReport(null);
    try {
      const result = await api.churchsuitePlans({ from, to, status });
      const next = [...(result.plans.data ?? [])].sort((a, b) =>
        `${a.date}T${a.time ?? ""}`.localeCompare(`${b.date}T${b.time ?? ""}`),
      );
      setPlans(next);
      if (!next.some((plan) => plan.id === selectedPlan)) setSelectedPlan(null);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not load ChurchSuite plans", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPlans();
  }, []);

  async function openPlan(plan: ChurchSuitePlanSummary) {
    setSelectedPlan(plan.id);
    setPreview(null);
    setPreviewLoading(true);
    setReport(null);
    try {
      const result = await api.churchsuitePlanPreview(plan.id);
      setPreview(result.preview);
      setImportName(`${compactDate(result.preview.plan.date)}-${result.preview.plan.name}`.slice(0, 200));
      setImportDate(result.preview.plan.date);
      setImportTime(result.preview.plan.time?.slice(0, 5) ?? "");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not load ChurchSuite plan", "error");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function createSetlist() {
    if (!preview) return;
    setImporting(true);
    setReport(null);
    try {
      const result = await api.importChurchsuitePlan(preview.plan.id, {
        name: importName.trim() || undefined,
        serviceDate: importDate,
        serviceTime: importTime || null,
      });
      setReport(result.report);
      notify(`Created set list “${result.report.setlistName}”`);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not create set list", "error");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="churchsuite-page">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>ChurchSuite planning</h2>
            <p className="muted">
              Pull published plans, review their service items and create a draft set list. This never
              changes the live session.
            </p>
          </div>
          <button className="button" onClick={loadPlans} disabled={loading}>
            {loading ? "Loading…" : "Reload plans"}
          </button>
        </div>
        <div className="churchsuite-filters">
          <label>
            From
            <IsoDateInput value={from} onChange={setFrom} />
          </label>
          <label>
            To
            <IsoDateInput value={to} onChange={setTo} />
          </label>
          <label>
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="published">Published</option>
              <option value="draft">Draft</option>
            </select>
          </label>
          <button className="button primary" onClick={loadPlans} disabled={loading}>
            Apply
          </button>
        </div>
      </section>

      <div className="churchsuite-grid">
        <aside className="panel churchsuite-plans">
          <div className="panel-heading">
            <h3>Plans</h3>
            <span className="muted">{plans.length}</span>
          </div>
          {plans.map((plan) => (
            <button
              key={plan.id}
              className={`churchsuite-plan ${plan.id === selectedPlan ? "current" : ""}`}
              onClick={() => openPlan(plan)}
            >
              <strong>{plan.name}</strong>
              <span>
                {compactDate(plan.date)} · {plan.time?.slice(0, 5) ?? "no time"} · {plan.status}
              </span>
            </button>
          ))}
          {!loading && !plans.length && (
            <p className="muted">No plans in this date range. Try widening the dates or changing status.</p>
          )}
        </aside>

        <section className="panel churchsuite-preview">
          {previewLoading && <p className="muted">Loading plan…</p>}
          {!previewLoading && !preview && (
            <div className="empty-state">
              <p className="muted">Choose a plan to review its items and create a set list.</p>
            </div>
          )}
          {preview && (
            <>
              <div className="panel-heading">
                <div>
                  <h2>{preview.plan.name}</h2>
                  <p className="muted">
                    {compactDate(preview.plan.date)} · {preview.plan.time?.slice(0, 5) ?? "no time"} ·{" "}
                    {preview.songCount} songs · {preview.matchedCount} matched ·{" "}
                    {preview.placeholderCount} text placeholders
                  </p>
                </div>
              </div>

              <div className="cs-item-list">
                {preview.items.map((item) => (
                  <div key={item.id} className={`cs-item ${item.action}`}>
                    <span className="cs-order">{item.order}</span>
                    <div className="cs-item-main">
                      <strong>{item.name || item.typeName || "(unnamed item)"}</strong>
                      <span className="muted">
                        {item.typeName}
                        {item.key ? ` · key ${item.key}` : ""}
                        {item.author ? ` · ${item.author}` : ""}
                      </span>
                      {item.notes && <span className="cs-notes">{item.notes}</span>}
                    </div>
                    <span className={`cs-action ${item.action}`}>
                      {item.action === "song"
                        ? `Song: ${item.matchedSong?.title ?? ""}`
                        : item.action === "placeholder"
                          ? item.isSong
                            ? "No local match"
                            : "Text placeholder"
                          : "Skipped"}
                    </span>
                  </div>
                ))}
              </div>

              <div className="cs-import-form">
                <label>
                  Set-list name
                  <input value={importName} onChange={(event) => setImportName(event.target.value)} />
                </label>
                <label>
                  Service date
                  <IsoDateInput value={importDate} onChange={setImportDate} />
                </label>
                <label>
                  Service time
                  <input
                    type="time"
                    value={importTime}
                    onChange={(event) => setImportTime(event.target.value)}
                  />
                </label>
                <button className="button primary" onClick={createSetlist} disabled={importing}>
                  {importing ? "Creating…" : "Create draft set list"}
                </button>
              </div>
              <p className="hint">
                Matched songs link to the local song library. Unmatched songs and named non-song items
                become editable text placeholders. The draft is not sent live automatically.
              </p>

              {report && (
                <div className="cs-report">
                  <strong>Created “{report.setlistName}”</strong>
                  <span>
                    {report.itemCount} items · {report.songsMatched} songs matched ·{" "}
                    {report.placeholders} placeholders · {report.skipped} skipped
                  </span>
                  <button className="button ghost small" onClick={onOpenSetlists}>
                    Open set lists
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

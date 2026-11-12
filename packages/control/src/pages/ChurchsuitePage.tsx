import { useEffect, useState } from "react";
import type {
  ChurchSuiteImportReport,
  ChurchSuitePlanPreview,
  ChurchSuitePlanSummary,
  SiteScraperProviderSummary,
} from "@sm/shared";
import { api, ApiError } from "../api";
import { EyeIcon } from "../components/Icons";
import { IsoDateInput } from "../components/IsoDateInput";
import { SiteSongLookupDialog } from "../components/SiteSongLookupDialog";
import { SongLyricsDialog } from "../components/SongLyricsDialog";
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
  const [songSelections, setSongSelections] = useState<Record<number, string>>({});
  const [lyricsPreview, setLyricsPreview] = useState<{
    title: string;
    author: string | null;
    copyright: string | null;
    ccli: string | null;
    lyrics: string;
  } | null>(null);
  const [lyricsLoadingId, setLyricsLoadingId] = useState<string | null>(null);
  const [siteProvider, setSiteProvider] = useState<SiteScraperProviderSummary | null>(null);
  const [lookupQuery, setLookupQuery] = useState<string | null>(null);

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

  useEffect(() => {
    api
      .siteScrapingProviders()
      .then((result) => {
        setSiteProvider(result.providers.find((provider) => provider.activeSource) ?? null);
      })
      .catch(() => setSiteProvider(null));
  }, []);

  useEffect(() => {
    if (!lyricsPreview) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLyricsPreview(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [lyricsPreview]);

  async function previewLyrics(candidate: { id: string; title: string }) {
    setLyricsLoadingId(candidate.id);
    try {
      const result = await api.song(candidate.id);
      setLyricsPreview({
        title: result.song.title,
        author: result.song.author,
        copyright: result.song.copyright,
        ccli: result.song.ccli,
        lyrics: result.song.lyrics,
      });
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not load song lyrics", "error");
    } finally {
      setLyricsLoadingId(null);
    }
  }

  async function openPlan(plan: ChurchSuitePlanSummary) {
    setSelectedPlan(plan.id);
    setPreview(null);
    setPreviewLoading(true);
    setReport(null);
    try {
      const result = await api.churchsuitePlanPreview(plan.id);
      setPreview(result.preview);
      setSongSelections(
        Object.fromEntries(
          result.preview.items
            .filter((item) => item.matchedSong)
            .map((item) => [item.id, item.matchedSong!.id]),
        ),
      );
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
        songSelections: Object.fromEntries(
          Object.entries(songSelections).map(([itemId, songId]) => [itemId, songId]),
        ),
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
          <button
            className="button"
            onClick={loadPlans}
            disabled={loading}
            title="Fetch ChurchSuite plans using the selected date range and status"
          >
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
          <button
            className="button primary"
            onClick={loadPlans}
            disabled={loading}
            title="Apply the selected date range and plan status"
          >
            Apply
          </button>
        </div>
      </section>

      <div className="churchsuite-grid">
        <aside className="panel churchsuite-plans" data-key-list>
          <div className="panel-heading">
            <h3>Plans</h3>
            <span className="muted">{plans.length}</span>
          </div>
          {plans.map((plan) => (
            <button
              key={plan.id}
              data-key-list-item
              className={`churchsuite-plan ${plan.id === selectedPlan ? "current" : ""}`}
              onClick={() => openPlan(plan)}
              title={`Review ChurchSuite plan “${plan.name}”`}
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
                    {preview.placeholderCount} text placeholders · {preview.emptyCount} empty
                  </p>
                </div>
              </div>

              <div className="cs-item-list">
                {preview.items.map((item) => {
                  const selected =
                    item.matchCandidates.find(
                      (candidate) =>
                        candidate.id === (songSelections[item.id] ?? item.matchedSong?.id),
                    ) ?? item.matchCandidates[0];
                  const canLookup = item.isSong && item.action !== "song" && Boolean(siteProvider);
                  return (
                    <div
                      key={item.id}
                      className={`cs-item-wrap ${
                        item.action === "song" && item.matchCandidates.length > 1
                          ? "has-matches"
                          : ""
                      }`}
                    >
                      <div className={`cs-item ${item.action}`}>
                        <span className="cs-order">{item.order}</span>
                        <div className="cs-item-main">
                          <strong>{item.name || item.typeName || "(unnamed item)"}</strong>
                          <span className="muted">
                            {item.typeName}
                            {item.key ? ` · key ${item.key}` : ""}
                            {item.author ? ` · ${item.author}` : ""}
                          </span>
                          {item.notes && <span className="cs-notes">{item.notes}</span>}
                          {item.matchCandidates.length > 1 && (
                            <span className="cs-match-count">
                              {item.matchCandidates.length} possible local matches
                            </span>
                          )}
                          {canLookup && (
                            <button
                              type="button"
                              className="button ghost small cs-site-lookup"
                              onClick={() =>
                                setLookupQuery(item.name || item.typeName || "worship song")
                              }
                              title="Search SongSelect for this song and download its files"
                            >
                              Lookup song in SongSelect
                            </button>
                          )}
                        </div>
                        <span className={`cs-action ${item.action}`}>
                          {item.action === "song"
                            ? `Song: ${selected?.title ?? item.matchedSong?.title ?? ""}`
                            : item.action === "empty"
                              ? "Empty item"
                              : item.action === "placeholder"
                                ? item.isSong
                                  ? "No local match"
                                  : "Text placeholder"
                                : "Skipped"}
                        </span>
                      </div>
                      {item.action === "song" && item.matchCandidates.length > 1 && (
                        <div className="cs-match-wrap">
                          <table className="cs-match-table">
                            <thead>
                              <tr>
                                <th>Use</th>
                                <th>Title</th>
                                <th>Author</th>
                                <th>CCLI</th>
                                <th>Key</th>
                                <th>Alternative titles / first lines</th>
                                <th>Lyrics</th>
                              </tr>
                            </thead>
                            <tbody>
                              {item.matchCandidates.map((candidate) => (
                                <tr
                                  key={candidate.id}
                                  className={
                                    candidate.id === (selected?.id ?? "") ? "selected" : ""
                                  }
                                >
                                  <td>
                                    <input
                                      type="radio"
                                      name={`cs-song-${item.id}`}
                                      checked={candidate.id === (selected?.id ?? "")}
                                      onChange={() =>
                                        setSongSelections((current) => ({
                                          ...current,
                                          [item.id]: candidate.id,
                                        }))
                                      }
                                      title={`Use “${candidate.title}” for this item`}
                                    />
                                  </td>
                                  <td>
                                    <strong>{candidate.title}</strong>
                                    <span className="cs-match-reasons">
                                      {candidate.reasons.join(" · ")}
                                    </span>
                                  </td>
                                  <td>{candidate.author || "—"}</td>
                                  <td>{candidate.ccli || "—"}</td>
                                  <td>{candidate.key || "—"}</td>
                                  <td>
                                    <span className="cs-match-meta">
                                      {candidate.alternateTitles || "No alternate titles"}
                                    </span>
                                    <span className="cs-match-lyrics">{candidate.firstLines}</span>
                                  </td>
                                  <td className="cs-preview-cell">
                                    <button
                                      type="button"
                                      className="button ghost small cs-eye-button"
                                      onClick={() => previewLyrics(candidate)}
                                      disabled={lyricsLoadingId === candidate.id}
                                      title={`Preview all lyrics for “${candidate.title}”`}
                                      aria-label={`Preview lyrics for ${candidate.title}`}
                                    >
                                      {lyricsLoadingId === candidate.id ? "…" : <EyeIcon />}
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
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
                <button
                  className="button primary"
                  onClick={createSetlist}
                  disabled={importing}
                  title="Create a draft set list from this plan without changing the live session"
                >
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
                    {report.placeholders} placeholders · {report.emptyItems} empty ·{" "}
                    {report.skipped} skipped
                  </span>
                  <button
                    className="button ghost small"
                    onClick={onOpenSetlists}
                    title="Open Set lists to review and edit the new draft"
                  >
                    Open set lists
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <SongLyricsDialog song={lyricsPreview} onClose={() => setLyricsPreview(null)} />
      {lookupQuery !== null && siteProvider && (
        <SiteSongLookupDialog
          provider={siteProvider}
          initialQuery={lookupQuery}
          notify={notify}
          onClose={() => setLookupQuery(null)}
        />
      )}
    </div>
  );
}

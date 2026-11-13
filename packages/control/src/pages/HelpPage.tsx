import { useEffect, useState } from "react";
import {
  SHORTCUT_CHANGE_EVENT,
  SHORTCUT_LABELS,
  loadKeyboardShortcuts,
  type KeyboardShortcuts,
} from "../keyboard";

const QUICK_LINKS = [
  { id: "quick-start", label: "Quick start" },
  { id: "live", label: "Live control" },
  { id: "setlists", label: "Set lists" },
  { id: "items", label: "Songs, text & images" },
  { id: "outputs", label: "Outputs / OBS" },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "troubleshooting", label: "Troubleshooting" },
];

const KEY_LABELS: Record<string, string> = {
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Space: "Space",
  Escape: "Esc",
};

function formatShortcut(value: string): string {
  if (!value) return "Not set";
  return value
    .split("+")
    .map((part) => KEY_LABELS[part] ?? part)
    .join(" + ");
}

export default function HelpPage({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [shortcuts, setShortcuts] = useState<KeyboardShortcuts>(loadKeyboardShortcuts);

  useEffect(() => {
    const refresh = () => setShortcuts(loadKeyboardShortcuts());
    window.addEventListener(SHORTCUT_CHANGE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(SHORTCUT_CHANGE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return (
    <div className="help-page">
      <section className="panel help-hero">
        <div>
          <span className="badge">Operator guide</span>
          <h2>Help &amp; quick reference</h2>
          <p className="muted">
            Plan a service, take it live and keep the lower-third, full-screen, stage and chord
            outputs in sync. Hover any button for a reminder of what it does.
          </p>
        </div>
        <nav className="help-links" aria-label="Help sections">
          {QUICK_LINKS.map((link) => (
            <a
              key={link.id}
              className="button ghost small"
              href={`#${link.id}`}
              title={`Jump to ${link.label.toLowerCase()}`}
            >
              {link.label}
            </a>
          ))}
        </nav>
      </section>

      <section id="quick-start" className="panel help-section">
        <div className="panel-heading">
          <div>
            <h2>Service-day quick start</h2>
            <p className="muted">The normal flow from planning to the first live lyric.</p>
          </div>
        </div>
        <ol className="help-steps">
          <li>
            <strong>Build the set list.</strong> Open <em>Set lists</em>, create or select the
            service, then add songs, images and text in the order you need them.
          </li>
          <li>
            <strong>Check the outputs.</strong> Load the display URLs in OBS or a browser and confirm
            the token is accepted. The output shows a blank screen until the session starts.
          </li>
          <li>
            <strong>Start the session.</strong> Open <em>Live control</em>, choose the set list and
            <em> Live</em> or <em>Rehearsal</em>, then press <strong>Start session</strong>.
          </li>
          <li>
            <strong>Show the first page.</strong> In <em>Transport</em>, press <strong>Next</strong>,
            or click a page in the <em>Pages</em> panel. <strong>Blank</strong> hides everything
            instantly.
          </li>
          <li>
            <strong>End cleanly.</strong> Use <strong>End session</strong> in the top bar when the
            service is finished.
          </li>
        </ol>
      </section>

      <section id="live" className="panel help-section">
        <div className="panel-heading">
          <div>
            <h2>Live control</h2>
            <p className="muted">Everything that changes the current output.</p>
          </div>
        </div>
        <div className="help-grid">
          <article className="help-card">
            <h3>Transport</h3>
            <ul className="help-list">
              <li>
                <strong>Previous / Next</strong> moves by page and crosses into the previous or next
                item at the end of an item, depending on the live-navigation setting.
              </li>
              <li>
                <strong>Blank / Show</strong> hides or reveals the output without ending the session.
              </li>
              <li>
                <strong>Transpose</strong> changes the current song by semitones.
              </li>
              <li>
                <strong>Lines / page</strong> temporarily changes automatic page splitting.
              </li>
            </ul>
          </article>
          <article className="help-card">
            <h3>Items and pages</h3>
            <ul className="help-list">
              <li>
                Click an <strong>item</strong> to preview its page list in the Pages panel without
                sending it live.
              </li>
              <li>
                Press the item&apos;s <strong>+</strong> button to append its pages to the current
                live queue.
              </li>
              <li>
                Click a <strong>page</strong> to show it immediately.
              </li>
              <li>
                A queued revision is shown in the banner and waits until the current item finishes
                before applying.
              </li>
            </ul>
          </article>
          <article className="help-card">
            <h3>Quick text and footer</h3>
            <ul className="help-list">
              <li>
                <strong>Quick text</strong> displays immediately without being saved to the set list.
                Ctrl/⌘ + Enter sends it.
              </li>
              <li>
                <strong>Footer</strong> adds optional text beneath the current item; press Enter or
                <strong> Set</strong> to broadcast it.
              </li>
            </ul>
          </article>
          <article className="help-card">
            <h3>Display config</h3>
            <ul className="help-list">
              <li>
                Font, text colour, text size and smart page splitting apply to the lower-third,
                centered two-thirds and full-screen outputs.
              </li>
              <li>
                Server smart wrap can be enabled for Songs, Text and Bible independently. It only
                splits lines at or above the configured minimum word count (default 15); shorter
                lines wrap naturally in the browser.
              </li>
              <li>
                Lower-third text is shown in a dark 80%-opaque rounded panel, anchored to the bottom
                with the configured border padding. The panel stays constant between page changes
                and fades only when the output is blank or idle. Images use the same bottom padding.
              </li>
              <li>
                Stage and chord outputs keep their fixed readable style.
              </li>
              <li>
                Press <strong>Save display config</strong> to broadcast the settings to every output.
              </li>
            </ul>
          </article>
        </div>
      </section>

      <section id="setlists" className="panel help-section">
        <div className="panel-heading">
          <div>
            <h2>Set lists and publishing</h2>
            <p className="muted">
              Editing a set list never changes a live session until you publish and apply it.
            </p>
          </div>
        </div>
        <div className="help-table-wrap">
          <table className="help-table">
            <thead>
              <tr>
                <th>Action</th>
                <th>What happens</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <strong>Publish</strong>
                </td>
                <td>
                  Saves a numbered revision. The current live output and the live snapshot stay
                  unchanged.
                </td>
              </tr>
              <tr>
                <td>
                  <strong>Send to live session</strong>
                </td>
                <td>
                  Replaces the live snapshot immediately with this draft. Use with care during a
                  service.
                </td>
              </tr>
              <tr>
                <td>
                  <strong>Add to live</strong>
                </td>
                <td>
                  Publishes the draft and applies it automatically after the current live item
                  finishes. This is the safe option during a service.
                </td>
              </tr>
              <tr>
                <td>
                  <strong>Start live</strong>
                </td>
                <td>
                  Starts a new live or rehearsal session when this set list is not already live.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="help-grid help-grid-spaced">
          <article className="help-card">
            <h3>Building the list</h3>
            <ul className="help-list">
              <li>Add songs from the searchable library, upload or select images, or author text.</li>
              <li>Reorder with the arrow buttons or drag the handle.</li>
              <li>
                Click an item to edit its title, content, key, transpose, verse order and notes.
              </li>
              <li>
                <strong>Save local</strong> keeps song edits inside this set list.
                <strong> Save to song library</strong> updates the shared song for future services.
              </li>
              <li>
                Song items have an <strong>ALT</strong> button for locally stored versions with similar
                titles. Compare metadata and lyric differences before switching versions.
              </li>
            </ul>
          </article>
          <article className="help-card">
            <h3>Share, import and recover</h3>
            <ul className="help-list">
              <li>
                <strong>Export JSON</strong> is a lightweight reference; <strong>Export bundle</strong>
                includes songs and attached assets.
              </li>
              <li>Importing file data always creates a new draft and never changes a live service.</li>
              <li>
                Published revisions remain available in the set-list details panel for reference.
              </li>
            </ul>
          </article>
        </div>
      </section>

      <section id="items" className="panel help-section">
        <div className="panel-heading">
          <div>
            <h2>Songs, text &amp; images</h2>
            <p className="muted">Content-specific tips and syntax.</p>
          </div>
        </div>
        <div className="help-grid">
          <article className="help-card">
            <h3>Songs</h3>
            <ul className="help-list">
              <li>
                Put chords in square brackets directly before the syllable:
                <code>a[C]mazing</code>.
              </li>
              <li>
                <code>[Verse 1]</code> on its own line becomes a section label. Blank lines separate
                sections.
              </li>
              <li>
                Optional Markdown styling supports <code>**bold**</code>, <code>*italic*</code>,
                <code> ~~strike~~</code> and <code>==highlight==</code> on the lower-third and
                centered two-thirds outputs.
              </li>
              <li>
                Named verse orders are saved with the song and can be selected per set-list item.
              </li>
              <li>
                Attach scores, tabs, ChordPro files or lyric sheets for the read-only musicians view.
              </li>
              <li>
                Use <strong>Select</strong> above the library list to select multiple songs, choose
                all shown results, and delete them together.
              </li>
            </ul>
          </article>
          <article className="help-card">
            <h3>Text items</h3>
            <ul className="help-list">
              <li>
                Choose Markdown, plain text, HTML or reStructuredText, plus left or centre alignment.
              </li>
              <li>
                Use <strong>Insert page marker</strong> for an inline break or <strong>+ Add page box</strong>
                for separate pages.
              </li>
              <li>Bible passages and quick text use the same page-splitting rules.</li>
            </ul>
          </article>
          <article className="help-card">
            <h3>Image display modes</h3>
            <ul className="help-list">
              <li>
                <strong>Scale to screen</strong> fits the whole image at its correct aspect ratio
                (default).
              </li>
              <li>
                <strong>1:1</strong> keeps native pixels; <strong>Crop</strong> fills and crops;
                <strong> Stretch</strong> fills and can distort.
              </li>
              <li>
                On the lower-third output images always keep their aspect ratio, sit at the bottom
                and never show a filename or title. Their maximum height and padding are set in
                <strong> Live control → Display config</strong>; defaults are 30% of the viewport and
                48px.
              </li>
              <li>
                The <strong>LIVE</strong> button on an image card shows it immediately on every
                output without adding it to the set list or changing the live queue.
              </li>
              <li>
                A folder can be converted into a <strong>multiple images</strong> item. Autoplay is
                off by default; when enabled it advances every configured delay (default 6 seconds)
                using <strong>Single</strong>, <strong>Loop</strong> or <strong>Bounce</strong>{" "}
                playback. Bounce runs forwards through every page, then backwards, and repeats.
                Without autoplay, advance the images manually.
              </li>
            </ul>
          </article>
          <article className="help-card">
            <h3>Backgrounds</h3>
            <ul className="help-list">
              <li>
                Open <strong>Menu → Backgrounds</strong> to manage image, animated image, CSS and SVG
                backgrounds and the global background colour theme.
              </li>
              <li>
                Set lists choose a default background; text and song items can override it. Tarp
                pages can choose a background for each view.
              </li>
              <li>Backgrounds are applied to full-screen, two-thirds, stage and chords outputs.</li>
            </ul>
          </article>
          <article className="help-card">
            <h3>Transition stingers</h3>
            <ul className="help-list">
              <li>
                Manage transparent SVG and image stingers from <strong>Menu → Stingers</strong>.
              </li>
              <li>
                Set a default on the set list, override it on an item, or add page-level overrides
                using the 1-based page numbers shown on stage.
              </li>
              <li>
                Stingers play on full-screen and two-thirds outputs as the old page is covered and
                the new page is revealed.
              </li>
            </ul>
          </article>
          <article className="help-card">
            <h3>Bible and ChurchSuite</h3>
            <ul className="help-list">
              <li>
                Choose a translation, book, chapter and verse range. <strong>Include reference</strong>
                adds the citation to the text. The default translation is selected under{" "}
                <strong>Settings → Bible</strong>.
              </li>
              <li>
                <strong>Layout</strong> chooses <strong>Paragraph</strong> or{" "}
                <strong>Line per verse</strong> for the passage text and the set-list item.
              </li>
              <li>
                <strong>Add to current setlist</strong> saves the passage; <strong>Add to live
                session</strong> displays it now without saving.
              </li>
              <li>
                ChurchSuite plans can be reviewed and turned into a draft set list. Matched songs
                link to the library. When several local songs match, compare their metadata and
                lyrics and choose the right version before importing. Unmatched named items become
                editable text placeholders. Plan object
                types listed under <strong>Settings → ChurchSuite empty items</strong> become empty
                items with no pages, keeping their text in the notes.
              </li>
            </ul>
          </article>
          <article className="help-card">
            <h3>SongSelect drop folder</h3>
            <ul className="help-list">
              <li>
                Point the CCLI SongSelect downloader output folder at the path shown under{" "}
                <strong>Settings → SongSelect drop folder</strong>.
              </li>
              <li>
                New <code>.txt</code> downloads are imported automatically; the panel shows recent
                imports, updates, skips and errors.
              </li>
              <li>
                Re-downloading the same filename updates its song. Matching titles or CCLI numbers are
                skipped unless you use <strong>Force rescan</strong>.
              </li>
            </ul>
          </article>
        </div>
      </section>

      <section id="outputs" className="panel help-section">
        <div className="panel-heading">
          <div>
            <h2>Display outputs and OBS</h2>
            <p className="muted">
              Add each output as a browser source at 1920×1080. Every URL needs the output token.
              Use <strong>Menu → External links</strong> to open any display view in a new tab.
            </p>
          </div>
        </div>
        <div className="help-table-wrap">
          <table className="help-table">
            <thead>
              <tr>
                <th>Output</th>
                <th>URL path</th>
                <th>Typical use</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Lower-third / main</td>
                <td>
                  <code>/display/lowerthird?token=…</code>
                </td>
                <td>Transparent lyric overlay; images use the configurable bottom area.</td>
              </tr>
              <tr>
                <td>Full screen</td>
                <td>
                  <code>/display/full?token=…</code>
                </td>
                <td>Full-frame lyrics or images for the main projector.</td>
              </tr>
              <tr>
                <td>Centered two-thirds</td>
                <td>
                  <code>/display/two-thirds?token=…</code>
                </td>
                <td>Centered lyric block with space above and below.</td>
              </tr>
              <tr>
                <td>Stage</td>
                <td>
                  <code>/display/stage?token=…</code>
                </td>
                <td>Current and following pages for the stage monitor.</td>
              </tr>
              <tr>
                <td>Chords</td>
                <td>
                  <code>/display/chords?token=…</code>
                </td>
                <td>Current and following pages with chord symbols for musicians.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="hint">
          These are the seeded defaults. Create, remove or customise outputs in{" "}
          <strong>Menu → Outputs</strong>; each output uses <code>/display/&lt;id&gt;</code> and can
          define its own fade, background, layout, panel, text and page visibility. Legacy aliases
          such as <code>/display/twothirds</code>, <code>/display/main</code> and
          <code> /display/fullscreen</code> are attached to the default outputs. Displays receive a
          full snapshot on reconnect, so refreshing OBS does not lose the current screen. Add a
          clock overlay to any output in <strong>Menu → Outputs</strong>; choose analogue (no
          numbers), digital 24-hour or digital 12-hour, and the overlay remains visible while
          content is blank or changing. Ask your administrator for the production token; never
          publish it publicly.
        </p>
        <p className="hint">
          A separate read-only server, normally on port <code>8081</code>, serves the complete
          <code> /display/*</code> tree with no login or API. A forward proxy can expose only that
          path and port to a wider audience. Image files are served from
          <code> /display/images/file</code>, fonts from <code>/display/fonts</code> and display
          assets from <code>/display/assets</code>.
        </p>
      </section>

      <section id="shortcuts" className="panel help-section">
        <div className="panel-heading">
          <div>
            <h2>Keyboard shortcuts</h2>
            <p className="muted">
              Shortcuts work from the control window, except while typing in an input, textarea or
              select.
            </p>
          </div>
          <button
            className="button ghost"
            onClick={onOpenSettings}
            title="Open Settings to change keyboard shortcuts"
          >
            Change shortcuts
          </button>
        </div>
        <div className="help-shortcuts">
          {SHORTCUT_LABELS.map(({ action, label, hint }) => (
            <div key={action} className="help-shortcut">
              <div>
                <strong>{label}</strong>
                <span className="muted">{hint}</span>
              </div>
              <kbd>{formatShortcut(shortcuts[action])}</kbd>
            </div>
          ))}
        </div>
        <p className="hint">
          Page navigation can stop at the end of an item or continue into the previous/next item.
          Change that behaviour in <em>Settings → Live navigation</em>.
        </p>
      </section>

      <section id="troubleshooting" className="panel help-section">
        <div className="panel-heading">
          <div>
            <h2>Troubleshooting</h2>
            <p className="muted">The quickest checks for the most common service-day issues.</p>
          </div>
        </div>
        <div className="help-details-list">
          <details className="help-details">
            <summary>An output is black, transparent or not updating</summary>
            <ul className="help-list">
              <li>Confirm a live session is running and that the output has not been blanked.</li>
              <li>Show a page in Transport; new sessions start blank by design.</li>
              <li>
                Check the URL token matches <code>SM_OUTPUT_TOKEN</code> on the server.
              </li>
              <li>Refresh the browser source once; it reconnects and receives the current snapshot.</li>
            </ul>
          </details>
          <details className="help-details">
            <summary>My set-list changes are not on the live screen</summary>
            <ul className="help-list">
              <li>
                A live session uses a snapshot. Publish the set list, then choose <strong>Send to
                live session</strong> or <strong>Add to live</strong>.
              </li>
              <li>Check that the live session is using the same set list shown in the editor.</li>
            </ul>
          </details>
          <details className="help-details">
            <summary>An image is cropped, stretched or the wrong size</summary>
            <ul className="help-list">
              <li>Edit the image item and choose the intended image display mode.</li>
              <li>
                On the lower-third output, images are limited to the configured maximum height and
                padding under <strong>Live control → Display config</strong>. Use the full-screen
                output for a larger image.
              </li>
            </ul>
          </details>
          <details className="help-details">
            <summary>Git export fails with a permission error</summary>
            <ul className="help-list">
              <li>
                The remote token or SSH key needs write access to that repository, not just read
                access.
              </li>
              <li>
                Songs can succeed while set lists fail if they use different repositories and
                credentials.
              </li>
            </ul>
          </details>
          <details className="help-details">
            <summary>A ChurchSuite song did not match</summary>
            <ul className="help-list">
              <li>Matching uses CCLI and song title against the local library.</li>
              <li>
                Unmatched songs and named service items become text placeholders so nothing is lost;
                convert them to songs or edit the draft afterwards.
              </li>
            </ul>
          </details>
        </div>
      </section>
    </div>
  );
}

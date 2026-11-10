import { useState } from "react";

export function QuickText({ onSend }: { onSend: (text: string) => void }) {
  const [text, setText] = useState("");

  function send() {
    const value = text.trim();
    if (!value) return;
    onSend(value);
    setText("");
  }

  return (
    <div className="quick-text">
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Type text to display immediately. Blank lines create new pages."
        rows={4}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            send();
          }
        }}
      />
      <div className="quick-text-actions">
        <span className="hint">Ctrl/⌘ + Enter to display</span>
        <button className="button primary" onClick={send} disabled={!text.trim()}>
          Display now
        </button>
      </div>
    </div>
  );
}

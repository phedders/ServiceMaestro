import { useEffect, useState } from "react";
import type { MqttPublicControl } from "@sm/shared";
import { useAdapters } from "../adapters";
import { api, ApiError } from "../api";

export function MqttControls({
  placement,
  notify,
  onPublished,
}: {
  placement: "live" | "menu";
  notify: (text: string, kind?: "info" | "error") => void;
  onPublished?: () => void;
}) {
  const { mqttEnabled } = useAdapters();
  const [controls, setControls] = useState<MqttPublicControl[]>([]);
  const [selections, setSelections] = useState<Record<string, number>>({});
  const [publishing, setPublishing] = useState<string | null>(null);

  useEffect(() => {
    if (!mqttEnabled) {
      setControls([]);
      return;
    }
    api
      .mqttControls()
      .then((result) => setControls(result.controls))
      .catch(() => setControls([]));
  }, [mqttEnabled]);

  if (!mqttEnabled) return null;
  const visible = controls.filter((control) => control.placement === placement);
  if (!visible.length) return null;

  async function publish(control: MqttPublicControl) {
    setPublishing(control.id);
    try {
      const optionIndex = control.type === "select" ? selections[control.id] ?? 0 : undefined;
      await api.publishMqttControl(control.id, optionIndex);
      notify(`Sent ${control.label}`);
      onPublished?.();
    } catch (error) {
      notify(
        error instanceof ApiError ? error.message : `Could not send ${control.label}`,
        "error",
      );
    } finally {
      setPublishing(null);
    }
  }

  const body = (
    <div className={`mqtt-controls ${placement}`}>
      {visible.map((control) => (
        <div className="mqtt-control" key={control.id}>
          {control.type === "select" ? (
            <>
              <select
                value={String(selections[control.id] ?? 0)}
                onChange={(event) =>
                  setSelections((current) => ({
                    ...current,
                    [control.id]: Number(event.target.value),
                  }))
                }
                title={`Choose an argument for ${control.label}`}
              >
                {control.options.map((option, index) => (
                  <option key={`${control.id}-${index}`} value={index}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="button ghost small"
                onClick={() => void publish(control)}
                disabled={publishing === control.id}
                title={`Send ${control.label} to MQTT`}
              >
                {publishing === control.id ? "Sending…" : control.label}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="button ghost small"
              onClick={() => void publish(control)}
              disabled={publishing === control.id}
              title={`Send ${control.label} to MQTT`}
            >
              {publishing === control.id ? "Sending…" : control.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );

  if (placement === "menu") {
    return (
      <>
        <div className="nav-dropdown-separator" />
        <div className="nav-dropdown-label">MQTT controls</div>
        {body}
      </>
    );
  }
  return (
    <section className="panel wide-panel">
      <div className="panel-heading">
        <h2>External controls</h2>
        <span className="muted">Send commands to connected systems</span>
      </div>
      {body}
    </section>
  );
}

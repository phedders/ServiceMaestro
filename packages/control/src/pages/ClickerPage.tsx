import { useEffect, useState } from "react";
import {
  CLICKER_ACTIONS,
  type ClickerAction,
  type ClickerConfig,
  type ClickerConfigInput,
  type LiveState,
} from "@sm/shared";
import { api, ApiError } from "../api";
import { SaveButton } from "../components/SaveButton";
import { changeList } from "../form-changes";
import {
  clickerActionLabel,
  clickerButtonFromEvent,
  defaultClickerConfig,
  runClickerAction,
} from "../clicker";
import { isTypingTarget } from "../keyboard";
import { compactDateTime } from "../service-date";

interface HidDeviceLike {
  productName?: string;
  open(): Promise<void>;
  close(): Promise<void>;
}

interface HidNavigator extends Navigator {
  hid?: {
    requestDevice(options: {
      filters: Array<{ vendorId: number; productId: number }>;
    }): Promise<HidDeviceLike[]>;
  };
}

interface LastPress {
  id: string;
  label: string;
  action: ClickerAction | null;
}

function hex(value: number): string {
  return `0x${value.toString(16).padStart(4, "0")}`;
}

export default function ClickerPage({
  live,
  onCommand,
  canWriteLive,
  notify,
}: {
  live: LiveState;
  onCommand: (payload: Record<string, unknown>) => void;
  canWriteLive: boolean;
  notify: (text: string, kind?: "info" | "error") => void;
}) {
  const [config, setConfig] = useState<ClickerConfigInput>(defaultClickerConfig);
  const [savedConfig, setSavedConfig] =
    useState<ClickerConfigInput>(defaultClickerConfig);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [captureMessage, setCaptureMessage] = useState("");
  const [testing, setTesting] = useState(false);
  const [lastPress, setLastPress] = useState<LastPress | null>(null);
  const [hidSupported, setHidSupported] = useState(false);
  const [hidStatus, setHidStatus] = useState("");

  useEffect(() => {
    setHidSupported(Boolean((navigator as HidNavigator).hid));
    api
      .clicker()
      .then((result) => {
        if (!result.config) return;
        const { updatedAt: savedAt, ...input } = result.config;
        setConfig(input);
        setSavedConfig(input);
        setUpdatedAt(savedAt);
      })
      .catch((error) =>
        notify(error instanceof ApiError ? error.message : "Could not load clicker settings", "error"),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!capturing) return;
    const handler = (event: KeyboardEvent) => {
      const button = clickerButtonFromEvent(event);
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      const alreadyMapped = config.buttons.some((entry) => entry.id === button.id);
      setConfig((current) => ({
        ...current,
        buttons: alreadyMapped
          ? current.buttons.map((entry) =>
              entry.id === button.id ? { ...entry, label: button.label } : entry,
            )
          : [...current.buttons, button],
      }));
      setCaptureMessage(
        alreadyMapped
          ? `Updated the ${button.label} button.`
          : `Added the ${button.label} button. Choose a live action below.`,
      );
      setCapturing(false);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [capturing, config.buttons]);

  useEffect(() => {
    if (!testing || capturing || !canWriteLive) return;
    const handler = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || event.repeat) return;
      const button = clickerButtonFromEvent(event);
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      const mapping = config.buttons.find((entry) => entry.id === button.id);
      setLastPress({
        id: button.id,
        label: mapping?.label ?? button.label,
        action: mapping?.action ?? null,
      });
      if (mapping) runClickerAction(mapping.action, live, onCommand);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [testing, capturing, canWriteLive, config.buttons, live, onCommand]);

  async function save() {
    setSaving(true);
    try {
      const result = await api.saveClicker(config);
      const { updatedAt: savedAt, ...input } = result.config;
      setConfig(input);
      setSavedConfig(input);
      setUpdatedAt(savedAt);
      notify("Clicker configuration saved");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not save clicker settings", "error");
    } finally {
      setSaving(false);
    }
  }

  function setButtonAction(id: string, action: ClickerAction) {
    setConfig((current) => ({
      ...current,
      buttons: current.buttons.map((button) =>
        button.id === id ? { ...button, action } : button,
      ),
    }));
  }

  function removeButton(id: string) {
    setConfig((current) => ({
      ...current,
      buttons: current.buttons.filter((button) => button.id !== id),
    }));
  }

  function useR400Defaults() {
    setConfig(defaultClickerConfig());
    setCaptureMessage("Loaded the standard R400 button layout.");
  }

  async function tryHidAccess() {
    const hid = (navigator as HidNavigator).hid;
    if (!hid) {
      setHidStatus("WebHID is not available in this browser. Use keyboard capture below.");
      return;
    }
    setHidStatus("Opening the browser HID chooser…");
    try {
      const devices = await hid.requestDevice({
        filters: [{ vendorId: config.vendorId, productId: config.productId }],
      });
      if (!devices.length) {
        setHidStatus("No HID device was selected. Use keyboard capture below.");
        return;
      }
      const device = devices[0];
      await device.open();
      setHidStatus(
        `Browser HID access opened “${device.productName || "the selected device"}”. Most presentation remotes still send keyboard events; map them below.`,
      );
      await device.close();
    } catch (error) {
      setHidStatus(
        `Browser HID access was refused or blocked: ${
          error instanceof Error ? error.message : String(error)
        }. USB remotes that identify as keyboards, including the Logitech R400, must use keyboard capture.`,
      );
    }
  }

  if (loading) return <div className="panel">Loading clicker settings…</div>;

  const clickerChanges = changeList([
    { label: "Clicker name", before: savedConfig.name, after: config.name },
    { label: "Vendor ID", before: savedConfig.vendorId, after: config.vendorId },
    { label: "Product ID", before: savedConfig.productId, after: config.productId },
    { label: "Button mappings", before: savedConfig.buttons, after: config.buttons },
  ]);

  return (
    <div className="clicker-page">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>USB clicker</h2>
            <p className="muted">
              Map a presentation remote, such as the Logitech R400, to live-control actions. The
              configuration is saved to your user account.
            </p>
          </div>
          <SaveButton
            label="Save clicker"
            savingLabel="Saving…"
            onClick={() => void save()}
            changes={clickerChanges}
            saving={saving}
            title="Save this clicker configuration to your user account"
          />
        </div>
        <div className="clicker-device-grid">
          <label>
            Clicker name
            <input
              value={config.name}
              onChange={(event) => setConfig({ ...config, name: event.target.value })}
              placeholder="Logitech R400"
              maxLength={80}
            />
          </label>
          <div className="clicker-usb-id">
            <span className="field-label">USB device</span>
            <code>
              {hex(config.vendorId)}:{hex(config.productId).slice(2)}
            </code>
          </div>
          {updatedAt && <span className="muted">Saved {compactDateTime(updatedAt)}</span>}
        </div>
        <p className="hint">
          Most USB presentation clickers identify themselves as keyboards. Browsers block direct HID
          access to those devices, so Service Maestro listens for the keys the clicker sends. Press
          the remote while the Clicker page is focused; live control integration will later let the
          same mapping keep working when you leave this page.
        </p>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Button mappings</h2>
            <p className="muted">
              Capture each remote button, then choose the live action it should trigger.
            </p>
          </div>
          <div className="button-row">
            <button
              className="button ghost"
              onClick={useR400Defaults}
              title="Replace the mappings with the standard PageUp, PageDown and period buttons"
            >
              Use R400 defaults
            </button>
            <button
              className={`button ${capturing ? "primary" : "ghost"}`}
              onClick={() => {
                setTesting(false);
                setCaptureMessage("");
                setCapturing((current) => !current);
              }}
              title="Listen for the next button press from the clicker"
            >
              {capturing ? "Press a clicker button…" : "Capture button"}
            </button>
          </div>
        </div>
        {capturing && (
          <div className="clicker-capture">
            <strong>Listening for a clicker button…</strong>
            <span className="muted">
              Point the remote at this device and press the button you want to map.
            </span>
            <button
              className="button ghost small"
              onClick={() => setCapturing(false)}
              title="Stop listening for a clicker button"
            >
              Cancel
            </button>
          </div>
        )}
        {captureMessage && <p className="hint">{captureMessage}</p>}
        {config.buttons.length ? (
          <div className="page-id-table-wrap">
            <table className="page-id-table clicker-table">
              <thead>
                <tr>
                  <th>Clicker button</th>
                  <th>Live action</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {config.buttons.map((button) => (
                  <tr key={button.id}>
                    <td>
                      <strong>{button.label}</strong>
                      <span className="clicker-key">{button.id}</span>
                    </td>
                    <td>
                      <select
                        value={button.action}
                        onChange={(event) =>
                          setButtonAction(button.id, event.target.value as ClickerAction)
                        }
                        title={`Live action for the ${button.label} button`}
                      >
                        {CLICKER_ACTIONS.map((action) => (
                          <option key={action.id} value={action.id}>
                            {action.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <button
                        className="button ghost small danger-text"
                        onClick={() => removeButton(button.id)}
                        title={`Remove the ${button.label} mapping`}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No buttons mapped yet. Use Capture button or the R400 defaults.</p>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Test mapping</h2>
            <p className="muted">
              Temporarily listen on this page to verify the remote and actions before enabling a
              clicker from live control.
            </p>
          </div>
          <span className={`badge ${testing ? "live" : "idle"}`}>
            {testing ? "Listening" : "Off"}
          </span>
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={testing}
            disabled={!canWriteLive}
            onChange={(event) => {
              setCapturing(false);
              setTesting(event.target.checked);
            }}
          />
          Enable clicker on this page for testing
        </label>
        {!canWriteLive && (
          <p className="hint">
            You have read-only live access, so clicker actions cannot be sent from this account.
          </p>
        )}
        <p className="hint">
          Last button:{" "}
          {lastPress
            ? `${lastPress.label}${
                lastPress.action ? ` → ${clickerActionLabel(lastPress.action)}` : " (not mapped)"
              }`
            : "none yet"}
        </p>
        <p className="hint">
          Live session: {live.status === "idle" ? "not started" : `${live.setlistName} · ${live.status}`}
        </p>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Browser HID access</h2>
            <p className="muted">
              Optional WebHID check for non-keyboard devices. Keyboard-style clickers use the
              capture workflow above.
            </p>
          </div>
          <button
            className="button ghost"
            onClick={() => void tryHidAccess()}
            disabled={!hidSupported}
            title={
              hidSupported
                ? "Ask the browser for access to the configured USB HID device"
                : "This browser does not expose the WebHID API"
            }
          >
            Try browser HID access
          </button>
        </div>
        <p className="hint">
          WebHID availability: {hidSupported ? "available in this browser" : "not available"}. The
          Logitech R400 is normally protected as a keyboard device, so keyboard capture is the
          reliable route.
        </p>
        {hidStatus && <p className="hint">{hidStatus}</p>}
      </section>
    </div>
  );
}

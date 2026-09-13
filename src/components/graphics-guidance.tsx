import type { ReactNode } from "react";

export type GraphicsGuidancePlatform =
  "desktop-chrome" | "mobile" | "desktop-other";

const mobileUserAgent = /Android|webOS|iPhone|iPad|iPod|Mobile/i;
const chromeUserAgent = /Chrome\//i;
const chromeAlternative = /CriOS|Edg|OPR/i;

export function graphicsGuidancePlatform(
  userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent,
): GraphicsGuidancePlatform {
  if (mobileUserAgent.test(userAgent)) return "mobile";
  if (chromeUserAgent.test(userAgent) && !chromeAlternative.test(userAgent))
    return "desktop-chrome";
  return "desktop-other";
}

export function graphicsGuidanceSteps(
  platform: GraphicsGuidancePlatform,
): readonly string[] {
  if (platform === "desktop-chrome")
    return [
      "In Chrome, open Settings → System.",
      "Find “Use graphics acceleration when available”, then choose Relaunch.",
    ];
  if (platform === "mobile")
    return [
      "Update or reopen your browser, then try again.",
      "Desktop graphics acceleration controls are not available on mobile. If it still fails, try a browser or device with WebGL2 support.",
    ];
  return [
    "Update or reopen your browser, then try again.",
    "If your desktop browser offers a graphics acceleration setting, check it in that browser’s settings.",
  ];
}

export interface GraphicsGuidanceProps {
  readonly onRetry: () => void;
  readonly detail?: string;
  readonly retrying?: boolean;
  readonly standalone?: boolean;
  readonly advisory?: boolean;
  readonly onDismiss?: () => void;
  readonly onDownload?: () => void | Promise<void>;
  readonly children?: ReactNode;
}

/**
 * A renderer failure is observable; the browser does not expose why WebGL2
 * initialization failed. Keep the diagnosis explicit and give the user one
 * bounded retry without changing browser settings from the page.
 */
export function GraphicsGuidance({
  onRetry,
  detail,
  retrying = false,
  standalone = false,
  advisory = false,
  onDismiss,
  onDownload,
  children,
}: GraphicsGuidanceProps) {
  const platform = graphicsGuidancePlatform();
  const steps = graphicsGuidanceSteps(platform);
  if (advisory)
    return (
      <section
        className="graphics-guidance is-advisory"
        aria-label="Graphics options"
      >
        <details>
          <summary>Using compatibility graphics · Options</summary>
          <p>
            Your world is playable. For smoother graphics, you can check your
            browser settings.
          </p>
          <ol>
            {steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <button type="button" onClick={onRetry} disabled={retrying}>
            {retrying ? "Checking…" : "Check again"}
          </button>
        </details>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss graphics advice"
          >
            ×
          </button>
        )}
      </section>
    );
  return (
    <section
      className="graphics-guidance"
      aria-labelledby="graphics-guidance-title"
    >
      <h2 id="graphics-guidance-title">Graphics are unavailable</h2>
      <p>
        Neither WebGL2 nor the software canvas renderer could initialize in this
        browser.
      </p>
      {detail && <p className="graphics-guidance-detail">{detail}</p>}
      <ol>
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {onDownload && platform === "desktop-chrome" && (
        <p className="graphics-guidance-warning">
          Before relaunching, download a copy of this world.
          <button type="button" onClick={() => void onDownload()}>
            Download a copy
          </button>
        </p>
      )}
      {standalone && (
        <p>This exported world stays loaded while you use Check again.</p>
      )}
      {children}
      <button
        className="graphics-guidance-retry"
        type="button"
        onClick={onRetry}
        disabled={retrying}
      >
        {retrying ? "Checking…" : "Check again"}
      </button>
    </section>
  );
}

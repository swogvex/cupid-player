import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { useSmoothProgress } from "../lib/useSmoothProgress";
import { initImportEvents, useImportStore } from "../state/importStore";
import { Marquee } from "./Marquee";
import { PixelButton } from "./PixelButton";
import { PixelInput } from "./PixelInput";
import { Sprite } from "./Sprite";

export function ImportBox() {
  const { t } = useTranslation();
  const [link, setLink] = useState("");
  const phase = useImportStore((s) => s.phase);
  const fraction = useImportStore((s) => s.fraction);
  const finished = useImportStore((s) => s.finished);
  const total = useImportStore((s) => s.total);
  const needsReview = useImportStore((s) => s.needsReview);
  const failed = useImportStore((s) => s.failed);
  const cancelled = useImportStore((s) => s.cancelled);
  const cancelling = useImportStore((s) => s.cancelling);
  const truncated = useImportStore((s) => s.truncated);
  const alreadyImported = useImportStore((s) => s.alreadyImported);
  const errorCode = useImportStore((s) => s.errorCode);
  const runId = useImportStore((s) => s.runId);
  const barRef = useRef<HTMLDivElement>(null);

  // Listens to the import events while the box is mounted (it lives in the sidebar).
  useEffect(() => initImportEvents(), []);

  const running = phase === "running";
  const busy = phase === "starting" || running;

  // The real progress arrives in bursts; the bar glides toward it and creeps
  // slowly while waiting, so it never looks stuck.
  const animate = busy || phase === "done";
  const headroom = phase === "done" ? 0 : Math.min(0.05, 0.5 / Math.max(total, 1));
  useSmoothProgress(barRef, fraction, animate, headroom, runId);

  const submit = async () => {
    const ok = await useImportStore.getState().start(link);
    if (ok) setLink("");
  };
  const onAction = () => {
    if (running) useImportStore.getState().cancel();
    else void submit();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !busy && link.trim() !== "") void submit();
  };

  let status: string;
  if (phase === "starting") {
    status = t("import.reading");
  } else if (running) {
    status = cancelling ? t("import.cancelling") : t("import.progress", { done: finished, total });
  } else if (phase === "error") {
    status = t(`errors.${errorCode ?? "unknown"}`, { defaultValue: t("errors.unknown") });
  } else if (phase === "done") {
    if (cancelled) status = t("import.cancelled");
    else if (needsReview > 0 && failed > 0) status = t("import.problems", { count: needsReview + failed });
    else if (failed > 0) status = t("import.failed", { count: failed });
    else if (needsReview > 0) status = t("import.needsReview", { count: needsReview });
    else if (truncated) status = t("import.truncated");
    else if (alreadyImported) status = t("import.alreadyDone");
    else status = t("import.done");
  } else {
    status = t("import.idle");
  }
  // The status line scrolls when it does not fit; the tooltip carries the longer explanation.
  const hint =
    phase === "done" && truncated && !cancelled ? `${status}. ${t("import.truncatedHint")}` : status;

  return (
    <div className="import">
      <div className="import__field">
        <Sprite name="icon-link" className="import__field-icon" />
        <PixelInput
          // The placeholder is drawn by the marquee below (an input cannot scroll it).
          placeholder=""
          aria-label={t("import.placeholder")}
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
        />
        {link === "" && (
          <div className="import__ph" aria-hidden="true">
            <Marquee text={t("import.placeholder")} always />
          </div>
        )}
      </div>
      <PixelButton
        className="import__btn"
        onClick={onAction}
        disabled={phase === "starting" || cancelling || (!running && link.trim() === "")}
      >
        {running ? (
          <span>{t("import.cancel")}</span>
        ) : (
          <>
            <Sprite name="icon-download" />
            <span>{t("import.button")}</span>
          </>
        )}
      </PixelButton>
      <div
        ref={barRef}
        className="px-progress import__bar"
        style={{ "--p": 0 } as CSSProperties}
        role="progressbar"
        aria-label={t("import.button")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fraction * 100)}
      >
        <div className="px-progress__track" />
        {fraction > 0 && <div className="px-progress__fill" />}
        {phase !== "idle" && (
          <div className="px-progress__star">
            <Sprite name="knob-download" />
          </div>
        )}
      </div>
      <div className="import__status" aria-live="polite">
        <Marquee text={status} title={hint} always />
      </div>
    </div>
  );
}
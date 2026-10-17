import { useEffect, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { PixelButton } from "./PixelButton";
import { PixelInput } from "./PixelInput";
import { Sprite } from "./Sprite";

type Phase = "idle" | "running" | "done";

const TOTAL = 8; // mock: replaced by real progress in H7

export function ImportBox() {
  const { t } = useTranslation();
  const [link, setLink] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [done, setDone] = useState(0);

  useEffect(() => {
    if (phase !== "running") return;
    const id = window.setTimeout(() => {
      if (done + 1 >= TOTAL) {
        setDone(TOTAL);
        setPhase("done");
      } else {
        setDone(done + 1);
      }
    }, 350);
    return () => window.clearTimeout(id);
  }, [phase, done]);

  const start = () => {
    setDone(0);
    setPhase("running");
  };

  const status =
    phase === "running"
      ? t("import.progress", { done, total: TOTAL })
      : phase === "done"
        ? t("import.done")
        : t("import.idle");

  return (
    <div className="import">
      <PixelInput
        placeholder={t("import.placeholder")}
        aria-label={t("import.placeholder")}
        value={link}
        onChange={(e) => setLink(e.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
      <PixelButton onClick={start} disabled={phase === "running" || link.trim() === ""}>
        {t("import.button")}
      </PixelButton>
      <div
        className="px-progress import__bar"
        style={{ "--p": done / TOTAL } as CSSProperties}
        role="progressbar"
        aria-label={t("import.button")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round((done / TOTAL) * 100)}
      >
        <div className="px-progress__track" />
        {done > 0 && <div className="px-progress__fill" />}
        {phase !== "idle" && (
          <div className="px-progress__star">
            <Sprite name="knob-download" w={9} h={8} />
          </div>
        )}
      </div>
      <div className="import__status ellipsis" aria-live="polite">
        {status}
      </div>
    </div>
  );
}
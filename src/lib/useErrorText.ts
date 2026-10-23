import { useTranslation } from "react-i18next";

const CODE = /^[a-z_]+(\.[a-z_]+)+$/;

/** Turns a stable error code from Rust ("library.io") into a translated message. */
export function useErrorText(): (e: unknown) => string {
  const { t } = useTranslation();
  return (e) => {
    const raw = typeof e === "string" ? e : e instanceof Error ? e.message : "";
    return CODE.test(raw)
      ? t(`errors.${raw}`, { defaultValue: t("errors.unknown") })
      : t("errors.unknown");
  };
}
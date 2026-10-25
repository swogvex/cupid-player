import i18next from "i18next";
import { setTrayLabels } from "../ipc/commands";
import { onTrayNext, onTrayPlayPause } from "../ipc/trayEvents";
import { usePlayerStore } from "../state/playerStore";

function pushLabels(): void {
  void setTrayLabels({
    show: i18next.t("tray.show"),
    playPause: i18next.t("tray.playPause"),
    next: i18next.t("tray.next"),
    quit: i18next.t("tray.quit"),
  }).catch(() => undefined);
}

/** Connects the tray menu to the player and keeps its labels in the current language. */
export function startTrayBridge(): () => void {
  let disposed = false;
  const unlisten: Array<() => void> = [];

  void Promise.all([
    onTrayPlayPause(() => usePlayerStore.getState().togglePlay()),
    onTrayNext(() => usePlayerStore.getState().next()),
  ]).then((fns) => {
    if (disposed) fns.forEach((f) => f());
    else unlisten.push(...fns);
  });

  pushLabels();
  i18next.on("languageChanged", pushLabels);

  return () => {
    disposed = true;
    i18next.off("languageChanged", pushLabels);
    unlisten.forEach((f) => f());
  };
}
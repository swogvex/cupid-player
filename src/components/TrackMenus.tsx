import { useEffect } from "react";
import { usePlaylistMenuStore } from "../state/playlistMenuStore";
import { useTrackMenuStore } from "../state/trackMenuStore";
import { DeleteTrackDialog } from "./DeleteTrackDialog";
import { EditTrackDialog } from "./EditTrackDialog";
import { Overlay } from "./Overlay";
import { PlaylistOverlays } from "./PlaylistOverlays";
import { TrackContextMenu } from "./TrackContextMenu";

/** Mount once per view that lists tracks or playlists. */
export function TrackMenus() {
  const notice = useTrackMenuStore((s) => s.notice);

  // Leaving the view closes whatever was open.
  useEffect(
    () => () => {
      useTrackMenuStore.getState().reset();
      usePlaylistMenuStore.getState().reset();
    },
    [],
  );

  return (
    <>
      <TrackContextMenu />
      <EditTrackDialog />
      <DeleteTrackDialog />
      <PlaylistOverlays />
      {notice && (
        <Overlay>
          <div className="toast" role="status">
            {notice}
          </div>
        </Overlay>
      )}
    </>
  );
}
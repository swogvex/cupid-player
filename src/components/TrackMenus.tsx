import { useEffect } from "react";
import { useTrackMenuStore } from "../state/trackMenuStore";
import { DeleteTrackDialog } from "./DeleteTrackDialog";
import { EditTrackDialog } from "./EditTrackDialog";
import { Overlay } from "./Overlay";
import { TrackContextMenu } from "./TrackContextMenu";

/** Mount once per view that lists tracks. */
export function TrackMenus() {
  const notice = useTrackMenuStore((s) => s.notice);

  // Leaving the view closes whatever was open.
  useEffect(() => () => useTrackMenuStore.getState().reset(), []);

  return (
    <>
      <TrackContextMenu />
      <EditTrackDialog />
      <DeleteTrackDialog />
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
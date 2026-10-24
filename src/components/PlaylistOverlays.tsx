import { AddToPlaylistDialog } from "./AddToPlaylistDialog";
import { DeletePlaylistDialog } from "./DeletePlaylistDialog";
import { PlaylistContextMenu } from "./PlaylistContextMenu";
import { PlaylistNameDialog } from "./PlaylistNameDialog";
import { TrackPickerDialog } from "./TrackPickerDialog";

/** All the playlist menus and dialogs; rendered by TrackMenus. */
export function PlaylistOverlays() {
  return (
    <>
      <PlaylistContextMenu />
      <PlaylistNameDialog />
      <DeletePlaylistDialog />
      <TrackPickerDialog />
      <AddToPlaylistDialog />
    </>
  );
}
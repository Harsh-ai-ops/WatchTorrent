import { useState } from 'react';
import Landing from './components/Landing.tsx';
import Room from './components/Room.tsx';

// A shared invite link looks like https://host/?room=ABC123 — read it so a
// friend who clicks it lands straight on the join screen with the code filled.
function roomFromUrl(): string {
  try {
    return new URLSearchParams(window.location.search).get('room')?.trim().toUpperCase() || '';
  } catch {
    return '';
  }
}

export default function App() {
  const [roomState, setRoomState] = useState<{
    roomId: string;
    userName: string;
  } | null>(null);

  if (roomState) {
    return (
      <Room
        roomId={roomState.roomId}
        userName={roomState.userName}
        onLeave={() => {
          window.history.replaceState(null, '', window.location.pathname);
          setRoomState(null);
        }}
      />
    );
  }

  return (
    <Landing
      initialRoom={roomFromUrl()}
      onEnter={(roomId, userName) => {
        // Put the room in the URL so the host can just copy the address bar /
        // hit "Invite" to share a one-click join link.
        window.history.replaceState(null, '', `?room=${roomId}`);
        setRoomState({ roomId, userName });
      }}
    />
  );
}

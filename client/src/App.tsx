import { useState } from 'react';
import Landing from './components/Landing.tsx';
import Room from './components/Room.tsx';

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
        onLeave={() => setRoomState(null)}
      />
    );
  }

  return <Landing onEnter={(roomId, userName) => setRoomState({ roomId, userName })} />;
}

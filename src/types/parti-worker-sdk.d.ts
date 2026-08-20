declare module '@parti/worker-sdk' {
  export type RoomPlayer = { id: string; name: string; role: 'host' | 'player' | 'spectator' };
  export type RoomContext<S> = {
    state: S;
    players: RoomPlayer[];
    host?: RoomPlayer | null;
    random(): number;
    send(playerId: string, event: string, payload: unknown): void;
    broadcast(event: string, payload: unknown): void;
    kick(playerId: string, reason?: string): void;
  };
  export function defineRoom<S>(room: {
    meta: { name: string; minPlayers: number; maxPlayers: number };
    initialState(): S;
    onJoin?(ctx: RoomContext<S>, player: RoomPlayer): void;
    onReconnect?(ctx: RoomContext<S>, player: RoomPlayer): void;
    onLeave?(ctx: RoomContext<S>, player: RoomPlayer): void;
    onReady?(ctx: RoomContext<S>, player: RoomPlayer): void;
    actions: Record<string, (ctx: RoomContext<S>, args: { player: RoomPlayer; payload?: any }) => void>;
  }): unknown;
}

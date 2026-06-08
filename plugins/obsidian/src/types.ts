import type { WebSocket, WebSocketServer } from "ws";

export interface ObsidianState {
  server?: WebSocketServer;
  connections: Map<string, WebSocket>;
  token?: string;
}

export interface ObsidianMessage {
  type: "message" | "vault-info";
  id?: string;
  text: string;
  context?: {
    filePath: string;
    fileName: string;
    content: string;
  } | null;
  vaultFiles?: string[]; // file paths in vault (for vault-info type)
  vaultName?: string;
}

export interface ColaAction {
  type: "openFile" | "createFile" | "searchFile";
  path?: string;
  content?: string;
  query?: string;
}

export interface ObsidianReply {
  type: "reply";
  id?: string;
  text: string;
  actions?: ColaAction[];
}

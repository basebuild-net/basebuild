type UnlistenFn = () => void;

export enum UserAttentionType {
  Critical = 1,
  Informational = 2,
}

type MockWindow = {
  onResized: () => Promise<UnlistenFn>;
  isMaximized: () => Promise<boolean>;
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
  requestUserAttention: (requestType: UserAttentionType | null) => Promise<void>;
};

const mockWindow: MockWindow = {
  onResized: async () => () => {},
  isMaximized: async () => false,
  minimize: async () => undefined,
  toggleMaximize: async () => undefined,
  close: async () => undefined,
  requestUserAttention: async () => undefined,
};

export function getCurrentWindow(): MockWindow {
  return mockWindow;
}

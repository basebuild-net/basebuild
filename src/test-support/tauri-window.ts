type UnlistenFn = () => void;

type MockWindow = {
  onResized: () => Promise<UnlistenFn>;
  isMaximized: () => Promise<boolean>;
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
};

const mockWindow: MockWindow = {
  onResized: async () => () => {},
  isMaximized: async () => false,
  minimize: async () => undefined,
  toggleMaximize: async () => undefined,
  close: async () => undefined,
};

export function getCurrentWindow(): MockWindow {
  return mockWindow;
}

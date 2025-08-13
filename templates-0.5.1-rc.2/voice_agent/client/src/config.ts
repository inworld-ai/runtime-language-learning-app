const PORT = import.meta.env.VITE_APP_PORT || 4000;

export const config = {
  LOAD_URL:
    import.meta.env.VITE_APP_LOAD_URL || `http://localhost:${PORT}/load`,
  UNLOAD_URL:
    import.meta.env.VITE_APP_UNLOAD_URL || `http://localhost:${PORT}/unload`,
  SESSION_URL:
    import.meta.env.VITE_APP_SESSION_URL || `ws://localhost:${PORT}/session`,
};

export const validateEnv = (vars: string[]) => {
  const missing = vars.filter(v => !import.meta.env[v]);
  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    // Depending on criticality, could throw an error or set a UI-blocking state
    return false;
  }
  return true;
};

export function isFortiManagerPermissionError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  return /no permission for the resource/i.test(error.message) || /\(-11\)/.test(error.message);
}

export function formatReadOnlyApiUserHelp() {
  return (
    "FortiManager allows read proxy (GET) but blocked write proxy (POST). " +
    "The api user effectively has read-only JSON API access. " +
    "In GUI: System Settings → Administrators → api → JSON API Access = Read-Write. " +
    "In CLI: set rpc-permit read-write under config system admin user. Regenerate the API key after saving."
  );
}

export type PoePortRow = {
  switchId: string;
  portName: string;
  portKey: string;
  macAddress?: string;
  ipAddress?: string;
  oui?: string;
  ouiApproved: boolean;
};

export type PoeResetResult = {
  method: string;
  command?: string;
};

export type PoeLearnedDevice = {
  interfaceName: string;
  ipAddress: string;
  macAddress: string;
  deviceName?: string;
  oui: string;
  ouiApproved: boolean;
  switchPort?: string;
};

export type PoeLearnedDeviceDiagnostic = {
  path: string;
  records: number;
  devices: number;
  error?: string;
  note?: string;
};

export type PoeWorkspaceState = {
  error?: string;
  message?: string;
  ports?: PoePortRow[];
  learnedDevices?: PoeLearnedDevice[];
  learnedDiagnostics?: PoeLearnedDeviceDiagnostic[];
  allowedOuis?: string[];
  connectionLabel?: string;
  firewallName?: string;
};

export type PoeResetActionState = {
  error?: string;
  message?: string;
  method?: string;
  command?: string;
  portKey?: string;
} | undefined;

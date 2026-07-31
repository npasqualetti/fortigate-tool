export type FortiManagerSettings = {
  host: string;
  apiKey: string;
  verifyTls: boolean;
  adom: string;
};

export type FortiManagerDiscoveredDevice = {
  name: string;
  serialNumber: string | null;
  ipAddress: string | null;
  hostname: string | null;
  model: string | null;
  osVersion: string | null;
  connectionStatus: string | null;
  osType: string | null;
  adom: string | null;
};

export type FortiManagerJsonRpcResponse<T = unknown> = {
  id?: number | string;
  result?: T;
  error?: {
    code?: number;
    message?: string;
  };
};

export type FortiManagerRpcResultBlock = {
  status?: { code?: number; message?: string };
  data?: unknown;
};

export type AdSettings = {
  adUrl: string;
  adBaseDn: string;
  adDomain: string;
  adUsernameAttribute: string;
  adGroupAttribute: string;
  adVerifyTls: boolean;
};

export type AdSettingsDetection = {
  settings: Partial<AdSettings>;
  source: string[];
  hostname: string;
};

export function dnsDomainToBaseDn(dnsDomain: string) {
  return dnsDomain
    .split(".")
    .filter(Boolean)
    .map((part) => `DC=${part}`)
    .join(",");
}

export function parseAdSettingsForm(formData: FormData): AdSettings {
  const verifyField = formData.get("adVerifyTls");
  return {
    adUrl: String(formData.get("adUrl") || "").trim(),
    adBaseDn: String(formData.get("adBaseDn") || "").trim(),
    adDomain: String(formData.get("adDomain") || "").trim().toUpperCase(),
    adUsernameAttribute: String(formData.get("adUsernameAttribute") || "sAMAccountName").trim() || "sAMAccountName",
    adGroupAttribute: String(formData.get("adGroupAttribute") || "memberOf").trim() || "memberOf",
    adVerifyTls: verifyField === "on" || verifyField === "true" || verifyField === "1"
  };
}

export function validateAdSettings(settings: AdSettings) {
  if (!settings.adUrl) {
    return "LDAP URL is required.";
  }
  if (!settings.adBaseDn) {
    return "Base DN is required.";
  }
  if (!settings.adDomain) {
    return "AD domain short name is required.";
  }
  if (!/^ldap(s)?:\/\//i.test(settings.adUrl)) {
    return "LDAP URL must start with ldap:// or ldaps://.";
  }
  return null;
}

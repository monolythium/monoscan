import {
  buildNativeAgentCreateEscrowForwarderInput,
  buildNativeAgentModuleCallEnvelope,
  buildNativeAgentRecordReputationForwarderInput,
  buildNativeAgentSetSpendingPolicyForwarderInput,
  encodeNativeAgentAcceptEscrowCall,
  encodeNativeAgentApproveEscrowCall,
  encodeNativeAgentCancelEscrowCall,
  encodeNativeAgentCloseAvailabilityCall,
  encodeNativeAgentCounterEscrowCall,
  encodeNativeAgentDeactivateServiceCall,
  encodeNativeAgentDisputeEscrowCall,
  encodeNativeAgentGrantConsentCall,
  encodeNativeAgentIssueAttestationCall,
  encodeNativeAgentListServiceCall,
  encodeNativeAgentModuleForwarderInput,
  encodeNativeAgentOpenAvailabilityCall,
  encodeNativeAgentRecordPolicySpendCall,
  encodeNativeAgentRegisterArbiterCall,
  encodeNativeAgentRegisterIssuerCall,
  encodeNativeAgentResolveEscrowCall,
  encodeNativeAgentRevokeAttestationCall,
  encodeNativeAgentRevokeConsentCall,
  encodeNativeAgentSetAvailabilityCall,
  encodeNativeAgentStartEscrowCall,
  encodeNativeAgentSubmitEscrowCall,
  type CapabilitiesResponse,
  type EncodeNativeAgentAvailabilitySlotArgs,
  type EncodeNativeAgentCounterEscrowArgs,
  type EncodeNativeAgentCreateEscrowArgs,
  type EncodeNativeAgentDeactivateServiceArgs,
  type EncodeNativeAgentEscrowActorArgs,
  type EncodeNativeAgentGrantConsentArgs,
  type EncodeNativeAgentIssueAttestationArgs,
  type EncodeNativeAgentListServiceArgs,
  type EncodeNativeAgentRecordReputationArgs,
  type EncodeNativeAgentRecordPolicySpendArgs,
  type EncodeNativeAgentRegisterArbiterArgs,
  type EncodeNativeAgentRegisterIssuerArgs,
  type EncodeNativeAgentResolveEscrowArgs,
  type EncodeNativeAgentRevokeAttestationArgs,
  type EncodeNativeAgentRevokeConsentArgs,
  type EncodeNativeAgentSetAvailabilityArgs,
  type EncodeNativeAgentSetSpendingPolicyArgs,
  type NativeAgentStateResponse,
} from "@monolythium/core-sdk";
import { getNativeAgentForwarderAddress } from "./sdk/client";

const NATIVE_AGENT_FORWARDER_MAX_CYCLES = "22000";
const NATIVE_AGENT_MRV_EXECUTION_UNIT_LIMIT_HEX = "0x200000";
const U64_MAX = (1n << 64n) - 1n;

export interface NativeAgentWalletRequest {
  method: "monolythium_submitMrvNativeCall";
  params: [{
    contractAddress: string;
    input: string;
    executionUnitLimitHex: string;
    valueWeiHex: "0x0";
  }];
}

export interface NativeAgentForwarderRequestOptions {
  forwarderContractAddress: string | null | undefined;
  capabilities?: CapabilitiesResponse | null;
  maxCycles?: string | number | bigint;
  executionUnitLimitHex?: string;
}

export type NativeAgentSetSpendingPolicyWalletRequestArgs =
  EncodeNativeAgentSetSpendingPolicyArgs & NativeAgentForwarderRequestOptions;
export type NativeAgentCreateEscrowWalletRequestArgs =
  EncodeNativeAgentCreateEscrowArgs & NativeAgentForwarderRequestOptions;
export type NativeAgentRecordReputationWalletRequestArgs =
  EncodeNativeAgentRecordReputationArgs & NativeAgentForwarderRequestOptions;
export type NativeAgentRegisterIssuerWalletRequestArgs =
  EncodeNativeAgentRegisterIssuerArgs & NativeAgentForwarderRequestOptions;
export type NativeAgentIssueAttestationWalletRequestArgs =
  EncodeNativeAgentIssueAttestationArgs & NativeAgentForwarderRequestOptions;
export type NativeAgentRevokeAttestationWalletRequestArgs =
  EncodeNativeAgentRevokeAttestationArgs & NativeAgentForwarderRequestOptions;
export type NativeAgentGrantConsentWalletRequestArgs =
  EncodeNativeAgentGrantConsentArgs & NativeAgentForwarderRequestOptions;
export type NativeAgentRevokeConsentWalletRequestArgs =
  EncodeNativeAgentRevokeConsentArgs & NativeAgentForwarderRequestOptions;
export type NativeAgentListServiceWalletRequestArgs =
  EncodeNativeAgentListServiceArgs & NativeAgentForwarderRequestOptions;
export type NativeAgentDeactivateServiceWalletRequestArgs =
  EncodeNativeAgentDeactivateServiceArgs & NativeAgentForwarderRequestOptions;
export type NativeAgentSetAvailabilityWalletRequestArgs =
  EncodeNativeAgentSetAvailabilityArgs & NativeAgentForwarderRequestOptions;
export type NativeAgentAvailabilitySlotWalletRequestArgs =
  EncodeNativeAgentAvailabilitySlotArgs & NativeAgentForwarderRequestOptions;
export type NativeAgentRegisterArbiterWalletRequestArgs =
  EncodeNativeAgentRegisterArbiterArgs & NativeAgentForwarderRequestOptions;
export type NativeAgentRecordPolicySpendWalletRequestArgs =
  EncodeNativeAgentRecordPolicySpendArgs & NativeAgentForwarderRequestOptions;
export type NativeAgentCounterEscrowWalletRequestArgs =
  EncodeNativeAgentCounterEscrowArgs & NativeAgentForwarderRequestOptions;
export type NativeAgentEscrowActorWalletRequestArgs =
  EncodeNativeAgentEscrowActorArgs & NativeAgentForwarderRequestOptions;
export type NativeAgentResolveEscrowWalletRequestArgs =
  EncodeNativeAgentResolveEscrowArgs & NativeAgentForwarderRequestOptions;

export type NativeAgentActionKind =
  | "registerIssuer"
  | "issueAttestation"
  | "revokeAttestation"
  | "grantConsent"
  | "revokeConsent"
  | "listService"
  | "deactivateService"
  | "setAvailability"
  | "openAvailability"
  | "closeAvailability"
  | "registerArbiter"
  | "setSpendingPolicy"
  | "recordPolicySpend"
  | "createEscrow"
  | "counterEscrow"
  | "acceptEscrow"
  | "startEscrow"
  | "submitEscrow"
  | "approveEscrow"
  | "disputeEscrow"
  | "cancelEscrow"
  | "resolveEscrow"
  | "recordReputation";

export type NativeAgentActionFieldKind =
  | "address"
  | "hash32"
  | "amount"
  | "number"
  | "boolean"
  | "select";

export interface NativeAgentActionField {
  key: string;
  label: string;
  kind: NativeAgentActionFieldKind;
  defaultValue?: string;
  options?: Array<{ value: string; label: string }>;
}

export interface NativeAgentActionDefinition {
  kind: NativeAgentActionKind;
  group: string;
  label: string;
  fields: NativeAgentActionField[];
}

const ADDRESS_FIELD = "address" as const;
const HASH_FIELD = "hash32" as const;
const NUMBER_FIELD = "number" as const;
const AMOUNT_FIELD = "amount" as const;

export const NATIVE_AGENT_ACTIONS: NativeAgentActionDefinition[] = [
  {
    kind: "registerIssuer",
    group: "Issuer",
    label: "Register issuer",
    fields: [
      { key: "issuer", label: "Issuer", kind: ADDRESS_FIELD },
      { key: "nonce", label: "Nonce", kind: NUMBER_FIELD, defaultValue: "0" },
      { key: "metadataHash", label: "Metadata hash", kind: HASH_FIELD },
    ],
  },
  {
    kind: "issueAttestation",
    group: "Attestation",
    label: "Issue attestation",
    fields: [
      { key: "issuerId", label: "Issuer id", kind: HASH_FIELD },
      { key: "issuer", label: "Issuer", kind: ADDRESS_FIELD },
      { key: "subject", label: "Subject", kind: ADDRESS_FIELD },
      { key: "nonce", label: "Nonce", kind: NUMBER_FIELD, defaultValue: "0" },
      { key: "schemaHash", label: "Schema hash", kind: HASH_FIELD },
      { key: "payloadHash", label: "Payload hash", kind: HASH_FIELD },
    ],
  },
  {
    kind: "revokeAttestation",
    group: "Attestation",
    label: "Revoke attestation",
    fields: [
      { key: "attestationId", label: "Attestation id", kind: HASH_FIELD },
      { key: "issuer", label: "Issuer", kind: ADDRESS_FIELD },
    ],
  },
  {
    kind: "grantConsent",
    group: "Consent",
    label: "Grant consent",
    fields: [
      { key: "subject", label: "Subject", kind: ADDRESS_FIELD },
      { key: "grantee", label: "Grantee", kind: ADDRESS_FIELD },
      { key: "nonce", label: "Nonce", kind: NUMBER_FIELD, defaultValue: "0" },
      { key: "scopeHash", label: "Scope hash", kind: HASH_FIELD },
      { key: "expiresAt", label: "Expires at", kind: NUMBER_FIELD, defaultValue: "0" },
    ],
  },
  {
    kind: "revokeConsent",
    group: "Consent",
    label: "Revoke consent",
    fields: [
      { key: "consentId", label: "Consent id", kind: HASH_FIELD },
      { key: "subject", label: "Subject", kind: ADDRESS_FIELD },
    ],
  },
  {
    kind: "listService",
    group: "Discovery",
    label: "List service",
    fields: [
      { key: "provider", label: "Provider", kind: ADDRESS_FIELD },
      { key: "nonce", label: "Nonce", kind: NUMBER_FIELD, defaultValue: "0" },
      { key: "categoryHash", label: "Category hash", kind: HASH_FIELD },
      { key: "metadataHash", label: "Metadata hash", kind: HASH_FIELD },
    ],
  },
  {
    kind: "deactivateService",
    group: "Discovery",
    label: "Deactivate service",
    fields: [
      { key: "serviceId", label: "Service id", kind: HASH_FIELD },
      { key: "provider", label: "Provider", kind: ADDRESS_FIELD },
    ],
  },
  {
    kind: "setAvailability",
    group: "Availability",
    label: "Set availability",
    fields: [
      { key: "provider", label: "Provider", kind: ADDRESS_FIELD },
      { key: "maxConcurrent", label: "Max concurrent", kind: NUMBER_FIELD, defaultValue: "1" },
      { key: "paused", label: "Paused", kind: "boolean", defaultValue: "false" },
    ],
  },
  {
    kind: "openAvailability",
    group: "Availability",
    label: "Open availability",
    fields: [
      { key: "provider", label: "Provider", kind: ADDRESS_FIELD },
      { key: "consumer", label: "Consumer", kind: ADDRESS_FIELD },
    ],
  },
  {
    kind: "closeAvailability",
    group: "Availability",
    label: "Close availability",
    fields: [
      { key: "provider", label: "Provider", kind: ADDRESS_FIELD },
      { key: "consumer", label: "Consumer", kind: ADDRESS_FIELD },
    ],
  },
  {
    kind: "registerArbiter",
    group: "Arbiter",
    label: "Register arbiter",
    fields: [
      { key: "arbiter", label: "Arbiter", kind: ADDRESS_FIELD },
      { key: "nonce", label: "Nonce", kind: NUMBER_FIELD, defaultValue: "0" },
      { key: "tier", label: "Tier", kind: NUMBER_FIELD, defaultValue: "1" },
      { key: "metadataHash", label: "Metadata hash", kind: HASH_FIELD },
    ],
  },
  {
    kind: "setSpendingPolicy",
    group: "Policy",
    label: "Set spending policy",
    fields: [
      { key: "owner", label: "Owner", kind: ADDRESS_FIELD },
      { key: "controller", label: "Controller", kind: ADDRESS_FIELD },
      { key: "nonce", label: "Nonce", kind: NUMBER_FIELD, defaultValue: "0" },
      { key: "assetId", label: "Asset id", kind: HASH_FIELD },
      { key: "perActionLimit", label: "Per-action limit", kind: AMOUNT_FIELD, defaultValue: "0" },
      { key: "windowLimit", label: "Window limit", kind: AMOUNT_FIELD, defaultValue: "0" },
      { key: "windowSecs", label: "Window seconds", kind: NUMBER_FIELD, defaultValue: "3600" },
    ],
  },
  {
    kind: "recordPolicySpend",
    group: "Policy",
    label: "Record policy spend",
    fields: [
      { key: "policyId", label: "Policy id", kind: HASH_FIELD },
      { key: "controller", label: "Controller", kind: ADDRESS_FIELD },
      { key: "window", label: "Window", kind: NUMBER_FIELD, defaultValue: "0" },
      { key: "amount", label: "Amount", kind: AMOUNT_FIELD, defaultValue: "0" },
    ],
  },
  {
    kind: "createEscrow",
    group: "Escrow",
    label: "Create escrow",
    fields: [
      { key: "buyer", label: "Buyer", kind: ADDRESS_FIELD },
      { key: "provider", label: "Provider", kind: ADDRESS_FIELD },
      { key: "arbiter", label: "Arbiter", kind: ADDRESS_FIELD },
      { key: "nonce", label: "Nonce", kind: NUMBER_FIELD, defaultValue: "0" },
      { key: "assetId", label: "Asset id", kind: HASH_FIELD },
      { key: "amount", label: "Amount", kind: AMOUNT_FIELD, defaultValue: "0" },
      { key: "termsHash", label: "Terms hash", kind: HASH_FIELD },
    ],
  },
  {
    kind: "counterEscrow",
    group: "Escrow",
    label: "Counter escrow",
    fields: [
      { key: "escrowId", label: "Escrow id", kind: HASH_FIELD },
      { key: "actor", label: "Actor", kind: ADDRESS_FIELD },
      { key: "termsHash", label: "Terms hash", kind: HASH_FIELD },
    ],
  },
  {
    kind: "acceptEscrow",
    group: "Escrow",
    label: "Accept escrow",
    fields: [
      { key: "escrowId", label: "Escrow id", kind: HASH_FIELD },
      { key: "actor", label: "Actor", kind: ADDRESS_FIELD },
    ],
  },
  {
    kind: "startEscrow",
    group: "Escrow",
    label: "Start escrow",
    fields: [
      { key: "escrowId", label: "Escrow id", kind: HASH_FIELD },
      { key: "actor", label: "Provider", kind: ADDRESS_FIELD },
    ],
  },
  {
    kind: "submitEscrow",
    group: "Escrow",
    label: "Submit escrow",
    fields: [
      { key: "escrowId", label: "Escrow id", kind: HASH_FIELD },
      { key: "actor", label: "Provider", kind: ADDRESS_FIELD },
      { key: "payloadHash", label: "Payload hash", kind: HASH_FIELD },
    ],
  },
  {
    kind: "approveEscrow",
    group: "Escrow",
    label: "Approve escrow",
    fields: [
      { key: "escrowId", label: "Escrow id", kind: HASH_FIELD },
      { key: "actor", label: "Buyer", kind: ADDRESS_FIELD },
    ],
  },
  {
    kind: "disputeEscrow",
    group: "Escrow",
    label: "Dispute escrow",
    fields: [
      { key: "escrowId", label: "Escrow id", kind: HASH_FIELD },
      { key: "actor", label: "Actor", kind: ADDRESS_FIELD },
    ],
  },
  {
    kind: "cancelEscrow",
    group: "Escrow",
    label: "Cancel escrow",
    fields: [
      { key: "escrowId", label: "Escrow id", kind: HASH_FIELD },
      { key: "actor", label: "Actor", kind: ADDRESS_FIELD },
    ],
  },
  {
    kind: "resolveEscrow",
    group: "Escrow",
    label: "Resolve escrow",
    fields: [
      { key: "escrowId", label: "Escrow id", kind: HASH_FIELD },
      { key: "actor", label: "Arbiter", kind: ADDRESS_FIELD },
      {
        key: "resolution",
        label: "Resolution",
        kind: "select",
        defaultValue: "release-provider",
        options: [
          { value: "release-provider", label: "Release provider" },
          { value: "refund-buyer", label: "Refund buyer" },
        ],
      },
    ],
  },
  {
    kind: "recordReputation",
    group: "Reputation",
    label: "Record reputation",
    fields: [
      { key: "reviewer", label: "Reviewer", kind: ADDRESS_FIELD },
      { key: "subject", label: "Subject", kind: ADDRESS_FIELD },
      { key: "categoryId", label: "Category", kind: NUMBER_FIELD, defaultValue: "0" },
      { key: "speed", label: "Speed", kind: NUMBER_FIELD, defaultValue: "5" },
      { key: "quality", label: "Quality", kind: NUMBER_FIELD, defaultValue: "5" },
      { key: "communication", label: "Communication", kind: NUMBER_FIELD, defaultValue: "5" },
      { key: "accuracy", label: "Accuracy", kind: NUMBER_FIELD, defaultValue: "5" },
      { key: "payloadHash", label: "Payload hash", kind: HASH_FIELD },
    ],
  },
];

function resolveNativeAgentForwarderAddress(
  capabilities: CapabilitiesResponse | null | undefined,
  requestBytes: number,
  fallbackAddress: string | null | undefined,
): string {
  const resolved = getNativeAgentForwarderAddress(capabilities, requestBytes);
  if (resolved) return resolved;
  if ((capabilities?.nativeModuleForwarders?.agent ?? []).length > 0) {
    throw new Error(`MRV native agent forwarder for ${requestBytes} request bytes is not configured.`);
  }
  const fallback = fallbackAddress?.trim();
  if (fallback) return fallback;
  throw new Error("MRV native agent forwarder address is not configured.");
}

function walletRequestFromForwarderInput(
  forwarderInput: { input: string; requestBytes: number },
  options: NativeAgentForwarderRequestOptions,
): NativeAgentWalletRequest {
  const forwarder = resolveNativeAgentForwarderAddress(
    options.capabilities,
    forwarderInput.requestBytes,
    options.forwarderContractAddress,
  );
  return {
    method: "monolythium_submitMrvNativeCall",
    params: [{
      contractAddress: forwarder,
      input: forwarderInput.input,
      executionUnitLimitHex:
        options.executionUnitLimitHex ?? NATIVE_AGENT_MRV_EXECUTION_UNIT_LIMIT_HEX,
      valueWeiHex: "0x0",
    }],
  };
}

function requiredString(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(`${label} is required.`);
  return trimmed;
}

function actionValue(
  values: Record<string, string>,
  key: string,
  label: string,
): string {
  return requiredString(values[key] ?? "", label);
}

function optionalActionValue(
  values: Record<string, string>,
  key: string,
  fallback: string,
): string {
  const value = values[key]?.trim();
  return value && value.length > 0 ? value : fallback;
}

function actionBool(values: Record<string, string>, key: string): boolean {
  const value = (values[key] ?? "").trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes" || value === "on";
}

function actionResolution(values: Record<string, string>): "release-provider" | "refund-buyer" {
  const value = optionalActionValue(values, "resolution", "release-provider");
  if (value === "release-provider" || value === "refund-buyer") return value;
  throw new Error("Escrow resolution must be release-provider or refund-buyer.");
}

export function nativeAgentActionDefinition(
  kind: NativeAgentActionKind,
): NativeAgentActionDefinition {
  const action = NATIVE_AGENT_ACTIONS.find((entry) => entry.kind === kind);
  if (!action) throw new Error(`Unsupported native agent action: ${kind}`);
  return action;
}

export function nativeAgentActionInitialValues(
  kind: NativeAgentActionKind,
): Record<string, string> {
  return Object.fromEntries(
    nativeAgentActionDefinition(kind).fields.map((field) => [
      field.key,
      field.defaultValue ?? "",
    ]),
  );
}

type NativeAgentNonceStateRowsKey =
  | "issuers"
  | "attestations"
  | "consents"
  | "services"
  | "arbiters"
  | "spendingPolicies"
  | "escrows";

interface NativeAgentIndexedNonceSource {
  rowsKey: NativeAgentNonceStateRowsKey;
  accountValueKey: string;
  accountRowKeys: string[];
  idValueKey?: string;
  idRowKeys?: string[];
}

const NATIVE_AGENT_INDEXED_NONCE_SOURCES: Partial<Record<NativeAgentActionKind, NativeAgentIndexedNonceSource>> = {
  registerIssuer: {
    rowsKey: "issuers",
    accountValueKey: "issuer",
    accountRowKeys: ["issuer", "account"],
  },
  issueAttestation: {
    rowsKey: "attestations",
    accountValueKey: "issuer",
    accountRowKeys: ["issuer", "account"],
    idValueKey: "issuerId",
    idRowKeys: ["issuerId", "issuer_id"],
  },
  grantConsent: {
    rowsKey: "consents",
    accountValueKey: "subject",
    accountRowKeys: ["subject", "account"],
  },
  listService: {
    rowsKey: "services",
    accountValueKey: "provider",
    accountRowKeys: ["provider", "account"],
  },
  registerArbiter: {
    rowsKey: "arbiters",
    accountValueKey: "arbiter",
    accountRowKeys: ["arbiter", "account"],
  },
  setSpendingPolicy: {
    rowsKey: "spendingPolicies",
    accountValueKey: "owner",
    accountRowKeys: ["owner", "account"],
  },
  createEscrow: {
    rowsKey: "escrows",
    accountValueKey: "buyer",
    accountRowKeys: ["buyer", "account"],
  },
};

function nativeAgentIndexedNonceSource(
  kind: NativeAgentActionKind,
): NativeAgentIndexedNonceSource | null {
  return NATIVE_AGENT_INDEXED_NONCE_SOURCES[kind] ?? null;
}

function nativeAgentNormalizedString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return null;
}

function nativeAgentNormalizedAccount(value: unknown): string | null {
  return nativeAgentNormalizedString(value)?.toLowerCase() ?? null;
}

function nativeAgentStateRecords(
  state: NativeAgentStateResponse,
  rowsKey: NativeAgentNonceStateRowsKey,
): Record<string, unknown>[] {
  const rows = (state as unknown as Record<string, unknown>)[rowsKey];
  if (!Array.isArray(rows)) return [];
  return rows.filter((row): row is Record<string, unknown> =>
    typeof row === "object" && row !== null && !Array.isArray(row),
  );
}

function nativeAgentRowString(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = nativeAgentNormalizedString(row[key]);
    if (value !== null) return value;
  }
  return null;
}

function nativeAgentRowAccount(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = nativeAgentNormalizedAccount(row[key]);
    if (value !== null) return value;
  }
  return null;
}

function nativeAgentIndexedNonce(value: unknown): bigint | null {
  if (typeof value === "bigint") {
    return value >= 0n && value <= U64_MAX ? value : null;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    return BigInt(value);
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^0x[0-9a-fA-F]+$/.test(trimmed)) {
    const parsed = BigInt(trimmed);
    return parsed <= U64_MAX ? parsed : null;
  }
  if (/^[0-9]+$/.test(trimmed)) {
    const parsed = BigInt(trimmed);
    return parsed <= U64_MAX ? parsed : null;
  }
  return null;
}

export function nativeAgentActionNonceAccount(
  kind: NativeAgentActionKind,
  values: Record<string, string>,
): string | null {
  const source = nativeAgentIndexedNonceSource(kind);
  if (!source) return null;
  return nativeAgentNormalizedAccount(values[source.accountValueKey]);
}

export function nativeAgentActionIndexedNonce(
  kind: NativeAgentActionKind,
  values: Record<string, string>,
  state: NativeAgentStateResponse | null | undefined,
): string | null {
  const source = nativeAgentIndexedNonceSource(kind);
  const account = nativeAgentActionNonceAccount(kind, values);
  if (!source || !account || !state) return null;

  const idValue = source.idValueKey
    ? nativeAgentNormalizedString(values[source.idValueKey])
    : null;
  const rows = nativeAgentStateRecords(state, source.rowsKey).filter((row) => {
    if (nativeAgentRowAccount(row, source.accountRowKeys) !== account) return false;
    if (idValue && source.idRowKeys) {
      return nativeAgentRowString(row, source.idRowKeys) === idValue;
    }
    return true;
  });

  if (rows.length === 0) return "0";

  let maxNonce: bigint | null = null;
  for (const row of rows) {
    const nonce = nativeAgentIndexedNonce(row["nonce"]);
    if (nonce === null) continue;
    if (maxNonce === null || nonce > maxNonce) maxNonce = nonce;
  }

  if (maxNonce === null || maxNonce >= U64_MAX) return null;
  return (maxNonce + 1n).toString();
}

export function buildNativeAgentCallWalletRequest(
  encodedAgentCall: string,
  options: NativeAgentForwarderRequestOptions,
): NativeAgentWalletRequest {
  const forwarderInput = encodeNativeAgentModuleForwarderInput(
    buildNativeAgentModuleCallEnvelope(
      requiredString(encodedAgentCall, "Native agent call input"),
      options.maxCycles ?? NATIVE_AGENT_FORWARDER_MAX_CYCLES,
    ),
  );
  return walletRequestFromForwarderInput(forwarderInput, options);
}

export function buildNativeAgentActionWalletRequest(
  kind: NativeAgentActionKind,
  values: Record<string, string>,
  options: NativeAgentForwarderRequestOptions,
): NativeAgentWalletRequest {
  switch (kind) {
    case "registerIssuer":
      return buildNativeAgentRegisterIssuerWalletRequest({
        issuer: actionValue(values, "issuer", "Issuer"),
        nonce: actionValue(values, "nonce", "Nonce"),
        metadataHash: actionValue(values, "metadataHash", "Issuer metadata hash"),
        ...options,
      });
    case "issueAttestation":
      return buildNativeAgentIssueAttestationWalletRequest({
        issuerId: actionValue(values, "issuerId", "Issuer id"),
        issuer: actionValue(values, "issuer", "Issuer"),
        subject: actionValue(values, "subject", "Subject"),
        nonce: actionValue(values, "nonce", "Nonce"),
        schemaHash: actionValue(values, "schemaHash", "Attestation schema hash"),
        payloadHash: actionValue(values, "payloadHash", "Attestation payload hash"),
        ...options,
      });
    case "revokeAttestation":
      return buildNativeAgentRevokeAttestationWalletRequest({
        attestationId: actionValue(values, "attestationId", "Attestation id"),
        issuer: actionValue(values, "issuer", "Issuer"),
        ...options,
      });
    case "grantConsent":
      return buildNativeAgentGrantConsentWalletRequest({
        subject: actionValue(values, "subject", "Subject"),
        grantee: actionValue(values, "grantee", "Grantee"),
        nonce: actionValue(values, "nonce", "Nonce"),
        scopeHash: actionValue(values, "scopeHash", "Consent scope hash"),
        expiresAt: actionValue(values, "expiresAt", "Expires at"),
        ...options,
      });
    case "revokeConsent":
      return buildNativeAgentRevokeConsentWalletRequest({
        consentId: actionValue(values, "consentId", "Consent id"),
        subject: actionValue(values, "subject", "Subject"),
        ...options,
      });
    case "listService":
      return buildNativeAgentListServiceWalletRequest({
        provider: actionValue(values, "provider", "Provider"),
        nonce: actionValue(values, "nonce", "Nonce"),
        categoryHash: actionValue(values, "categoryHash", "Service category hash"),
        metadataHash: actionValue(values, "metadataHash", "Service metadata hash"),
        ...options,
      });
    case "deactivateService":
      return buildNativeAgentDeactivateServiceWalletRequest({
        serviceId: actionValue(values, "serviceId", "Service id"),
        provider: actionValue(values, "provider", "Provider"),
        ...options,
      });
    case "setAvailability":
      return buildNativeAgentSetAvailabilityWalletRequest({
        provider: actionValue(values, "provider", "Provider"),
        maxConcurrent: actionValue(values, "maxConcurrent", "Max concurrent"),
        paused: actionBool(values, "paused"),
        ...options,
      });
    case "openAvailability":
      return buildNativeAgentOpenAvailabilityWalletRequest({
        provider: actionValue(values, "provider", "Provider"),
        consumer: actionValue(values, "consumer", "Consumer"),
        ...options,
      });
    case "closeAvailability":
      return buildNativeAgentCloseAvailabilityWalletRequest({
        provider: actionValue(values, "provider", "Provider"),
        consumer: actionValue(values, "consumer", "Consumer"),
        ...options,
      });
    case "registerArbiter":
      return buildNativeAgentRegisterArbiterWalletRequest({
        arbiter: actionValue(values, "arbiter", "Arbiter"),
        nonce: actionValue(values, "nonce", "Nonce"),
        tier: actionValue(values, "tier", "Tier"),
        metadataHash: actionValue(values, "metadataHash", "Arbiter metadata hash"),
        ...options,
      });
    case "setSpendingPolicy":
      return buildNativeAgentSetSpendingPolicyWalletRequest({
        owner: actionValue(values, "owner", "Owner"),
        controller: actionValue(values, "controller", "Controller"),
        nonce: actionValue(values, "nonce", "Nonce"),
        assetId: actionValue(values, "assetId", "Asset id"),
        perActionLimit: actionValue(values, "perActionLimit", "Per-action limit"),
        windowLimit: actionValue(values, "windowLimit", "Window limit"),
        windowSecs: actionValue(values, "windowSecs", "Window seconds"),
        ...options,
      });
    case "recordPolicySpend":
      return buildNativeAgentRecordPolicySpendWalletRequest({
        policyId: actionValue(values, "policyId", "Policy id"),
        controller: actionValue(values, "controller", "Controller"),
        window: actionValue(values, "window", "Window"),
        amount: actionValue(values, "amount", "Spend amount"),
        ...options,
      });
    case "createEscrow":
      return buildNativeAgentCreateEscrowWalletRequest({
        buyer: actionValue(values, "buyer", "Buyer"),
        provider: actionValue(values, "provider", "Provider"),
        arbiter: actionValue(values, "arbiter", "Arbiter"),
        nonce: actionValue(values, "nonce", "Nonce"),
        assetId: actionValue(values, "assetId", "Asset id"),
        amount: actionValue(values, "amount", "Amount"),
        termsHash: actionValue(values, "termsHash", "Escrow terms hash"),
        ...options,
      });
    case "counterEscrow":
      return buildNativeAgentCounterEscrowWalletRequest({
        escrowId: actionValue(values, "escrowId", "Escrow id"),
        actor: actionValue(values, "actor", "Actor"),
        termsHash: actionValue(values, "termsHash", "Escrow terms hash"),
        ...options,
      });
    case "acceptEscrow":
      return buildNativeAgentAcceptEscrowWalletRequest({
        escrowId: actionValue(values, "escrowId", "Escrow id"),
        actor: actionValue(values, "actor", "Actor"),
        ...options,
      });
    case "startEscrow":
      return buildNativeAgentStartEscrowWalletRequest({
        escrowId: actionValue(values, "escrowId", "Escrow id"),
        actor: actionValue(values, "actor", "Provider"),
        ...options,
      });
    case "submitEscrow":
      return buildNativeAgentSubmitEscrowWalletRequest({
        escrowId: actionValue(values, "escrowId", "Escrow id"),
        actor: actionValue(values, "actor", "Provider"),
        payloadHash: actionValue(values, "payloadHash", "Escrow payload hash"),
        ...options,
      });
    case "approveEscrow":
      return buildNativeAgentApproveEscrowWalletRequest({
        escrowId: actionValue(values, "escrowId", "Escrow id"),
        actor: actionValue(values, "actor", "Buyer"),
        ...options,
      });
    case "disputeEscrow":
      return buildNativeAgentDisputeEscrowWalletRequest({
        escrowId: actionValue(values, "escrowId", "Escrow id"),
        actor: actionValue(values, "actor", "Actor"),
        ...options,
      });
    case "cancelEscrow":
      return buildNativeAgentCancelEscrowWalletRequest({
        escrowId: actionValue(values, "escrowId", "Escrow id"),
        actor: actionValue(values, "actor", "Actor"),
        ...options,
      });
    case "resolveEscrow":
      return buildNativeAgentResolveEscrowWalletRequest({
        escrowId: actionValue(values, "escrowId", "Escrow id"),
        actor: actionValue(values, "actor", "Arbiter"),
        resolution: actionResolution(values),
        ...options,
      });
    case "recordReputation":
      return buildNativeAgentRecordReputationWalletRequest({
        reviewer: actionValue(values, "reviewer", "Reviewer"),
        subject: actionValue(values, "subject", "Subject"),
        categoryId: actionValue(values, "categoryId", "Category"),
        scores: {
          speed: actionValue(values, "speed", "Speed"),
          quality: actionValue(values, "quality", "Quality"),
          communication: actionValue(values, "communication", "Communication"),
          accuracy: actionValue(values, "accuracy", "Accuracy"),
        },
        payloadHash: actionValue(values, "payloadHash", "Reputation payload hash"),
        ...options,
      });
  }
}

export function buildNativeAgentRegisterIssuerWalletRequest(
  args: NativeAgentRegisterIssuerWalletRequestArgs,
): NativeAgentWalletRequest {
  return buildNativeAgentCallWalletRequest(
    encodeNativeAgentRegisterIssuerCall({
      issuer: args.issuer,
      nonce: args.nonce,
      metadataHash: requiredString(args.metadataHash, "Issuer metadata hash"),
    }),
    args,
  );
}

export function buildNativeAgentIssueAttestationWalletRequest(
  args: NativeAgentIssueAttestationWalletRequestArgs,
): NativeAgentWalletRequest {
  return buildNativeAgentCallWalletRequest(
    encodeNativeAgentIssueAttestationCall({
      issuerId: requiredString(args.issuerId, "Issuer id"),
      issuer: args.issuer,
      subject: args.subject,
      nonce: args.nonce,
      schemaHash: requiredString(args.schemaHash, "Attestation schema hash"),
      payloadHash: requiredString(args.payloadHash, "Attestation payload hash"),
    }),
    args,
  );
}

export function buildNativeAgentRevokeAttestationWalletRequest(
  args: NativeAgentRevokeAttestationWalletRequestArgs,
): NativeAgentWalletRequest {
  return buildNativeAgentCallWalletRequest(
    encodeNativeAgentRevokeAttestationCall({
      attestationId: requiredString(args.attestationId, "Attestation id"),
      issuer: args.issuer,
    }),
    args,
  );
}

export function buildNativeAgentGrantConsentWalletRequest(
  args: NativeAgentGrantConsentWalletRequestArgs,
): NativeAgentWalletRequest {
  return buildNativeAgentCallWalletRequest(
    encodeNativeAgentGrantConsentCall({
      subject: args.subject,
      grantee: args.grantee,
      nonce: args.nonce,
      scopeHash: requiredString(args.scopeHash, "Consent scope hash"),
      expiresAt: args.expiresAt,
    }),
    args,
  );
}

export function buildNativeAgentRevokeConsentWalletRequest(
  args: NativeAgentRevokeConsentWalletRequestArgs,
): NativeAgentWalletRequest {
  return buildNativeAgentCallWalletRequest(
    encodeNativeAgentRevokeConsentCall({
      consentId: requiredString(args.consentId, "Consent id"),
      subject: args.subject,
    }),
    args,
  );
}

export function buildNativeAgentListServiceWalletRequest(
  args: NativeAgentListServiceWalletRequestArgs,
): NativeAgentWalletRequest {
  return buildNativeAgentCallWalletRequest(
    encodeNativeAgentListServiceCall({
      provider: args.provider,
      nonce: args.nonce,
      categoryHash: requiredString(args.categoryHash, "Service category hash"),
      metadataHash: requiredString(args.metadataHash, "Service metadata hash"),
    }),
    args,
  );
}

export function buildNativeAgentDeactivateServiceWalletRequest(
  args: NativeAgentDeactivateServiceWalletRequestArgs,
): NativeAgentWalletRequest {
  return buildNativeAgentCallWalletRequest(
    encodeNativeAgentDeactivateServiceCall({
      serviceId: requiredString(args.serviceId, "Service id"),
      provider: args.provider,
    }),
    args,
  );
}

export function buildNativeAgentSetAvailabilityWalletRequest(
  args: NativeAgentSetAvailabilityWalletRequestArgs,
): NativeAgentWalletRequest {
  return buildNativeAgentCallWalletRequest(
    encodeNativeAgentSetAvailabilityCall({
      provider: args.provider,
      maxConcurrent: args.maxConcurrent,
      paused: args.paused,
    }),
    args,
  );
}

export function buildNativeAgentOpenAvailabilityWalletRequest(
  args: NativeAgentAvailabilitySlotWalletRequestArgs,
): NativeAgentWalletRequest {
  return buildNativeAgentCallWalletRequest(
    encodeNativeAgentOpenAvailabilityCall({
      provider: args.provider,
      consumer: args.consumer,
    }),
    args,
  );
}

export function buildNativeAgentCloseAvailabilityWalletRequest(
  args: NativeAgentAvailabilitySlotWalletRequestArgs,
): NativeAgentWalletRequest {
  return buildNativeAgentCallWalletRequest(
    encodeNativeAgentCloseAvailabilityCall({
      provider: args.provider,
      consumer: args.consumer,
    }),
    args,
  );
}

export function buildNativeAgentRegisterArbiterWalletRequest(
  args: NativeAgentRegisterArbiterWalletRequestArgs,
): NativeAgentWalletRequest {
  return buildNativeAgentCallWalletRequest(
    encodeNativeAgentRegisterArbiterCall({
      arbiter: args.arbiter,
      nonce: args.nonce,
      tier: args.tier,
      metadataHash: requiredString(args.metadataHash, "Arbiter metadata hash"),
    }),
    args,
  );
}

export function buildNativeAgentSetSpendingPolicyWalletRequest(
  args: NativeAgentSetSpendingPolicyWalletRequestArgs,
): NativeAgentWalletRequest {
  const forwarderInput = buildNativeAgentSetSpendingPolicyForwarderInput(
    {
      owner: args.owner,
      controller: args.controller,
      nonce: args.nonce,
      assetId: args.assetId,
      perActionLimit: args.perActionLimit.trim(),
      windowLimit: args.windowLimit.trim(),
      windowSecs: args.windowSecs,
    },
    args.maxCycles ?? NATIVE_AGENT_FORWARDER_MAX_CYCLES,
  );
  return walletRequestFromForwarderInput(forwarderInput, args);
}

export function buildNativeAgentRecordPolicySpendWalletRequest(
  args: NativeAgentRecordPolicySpendWalletRequestArgs,
): NativeAgentWalletRequest {
  return buildNativeAgentCallWalletRequest(
    encodeNativeAgentRecordPolicySpendCall({
      policyId: requiredString(args.policyId, "Policy id"),
      controller: args.controller,
      window: args.window,
      amount: requiredString(args.amount, "Spend amount"),
    }),
    args,
  );
}

export function buildNativeAgentCreateEscrowWalletRequest(
  args: NativeAgentCreateEscrowWalletRequestArgs,
): NativeAgentWalletRequest {
  const forwarderInput = buildNativeAgentCreateEscrowForwarderInput(
    {
      buyer: args.buyer,
      provider: args.provider,
      arbiter: args.arbiter,
      nonce: args.nonce,
      assetId: args.assetId,
      amount: args.amount.trim(),
      termsHash: args.termsHash,
    },
    args.maxCycles ?? NATIVE_AGENT_FORWARDER_MAX_CYCLES,
  );
  return walletRequestFromForwarderInput(forwarderInput, args);
}

export function buildNativeAgentCounterEscrowWalletRequest(
  args: NativeAgentCounterEscrowWalletRequestArgs,
): NativeAgentWalletRequest {
  return buildNativeAgentCallWalletRequest(
    encodeNativeAgentCounterEscrowCall({
      escrowId: requiredString(args.escrowId, "Escrow id"),
      actor: args.actor,
      termsHash: requiredString(args.termsHash, "Escrow terms hash"),
    }),
    args,
  );
}

export function buildNativeAgentAcceptEscrowWalletRequest(
  args: NativeAgentEscrowActorWalletRequestArgs,
): NativeAgentWalletRequest {
  return buildNativeAgentCallWalletRequest(
    encodeNativeAgentAcceptEscrowCall({
      escrowId: requiredString(args.escrowId, "Escrow id"),
      actor: args.actor,
    }),
    args,
  );
}

export function buildNativeAgentStartEscrowWalletRequest(
  args: NativeAgentEscrowActorWalletRequestArgs,
): NativeAgentWalletRequest {
  return buildNativeAgentCallWalletRequest(
    encodeNativeAgentStartEscrowCall({
      escrowId: requiredString(args.escrowId, "Escrow id"),
      provider: args.actor,
    }),
    args,
  );
}

export function buildNativeAgentSubmitEscrowWalletRequest(
  args: NativeAgentEscrowActorWalletRequestArgs & { payloadHash: string },
): NativeAgentWalletRequest {
  return buildNativeAgentCallWalletRequest(
    encodeNativeAgentSubmitEscrowCall({
      escrowId: requiredString(args.escrowId, "Escrow id"),
      provider: args.actor,
      payloadHash: requiredString(args.payloadHash, "Escrow payload hash"),
    }),
    args,
  );
}

export function buildNativeAgentApproveEscrowWalletRequest(
  args: NativeAgentEscrowActorWalletRequestArgs,
): NativeAgentWalletRequest {
  return buildNativeAgentCallWalletRequest(
    encodeNativeAgentApproveEscrowCall({
      escrowId: requiredString(args.escrowId, "Escrow id"),
      actor: args.actor,
    }),
    args,
  );
}

export function buildNativeAgentDisputeEscrowWalletRequest(
  args: NativeAgentEscrowActorWalletRequestArgs,
): NativeAgentWalletRequest {
  return buildNativeAgentCallWalletRequest(
    encodeNativeAgentDisputeEscrowCall({
      escrowId: requiredString(args.escrowId, "Escrow id"),
      actor: args.actor,
    }),
    args,
  );
}

export function buildNativeAgentCancelEscrowWalletRequest(
  args: NativeAgentEscrowActorWalletRequestArgs,
): NativeAgentWalletRequest {
  return buildNativeAgentCallWalletRequest(
    encodeNativeAgentCancelEscrowCall({
      escrowId: requiredString(args.escrowId, "Escrow id"),
      actor: args.actor,
    }),
    args,
  );
}

export function buildNativeAgentResolveEscrowWalletRequest(
  args: NativeAgentResolveEscrowWalletRequestArgs,
): NativeAgentWalletRequest {
  return buildNativeAgentCallWalletRequest(
    encodeNativeAgentResolveEscrowCall({
      escrowId: requiredString(args.escrowId, "Escrow id"),
      actor: args.actor,
      resolution: args.resolution,
    }),
    args,
  );
}

export function buildNativeAgentRecordReputationWalletRequest(
  args: NativeAgentRecordReputationWalletRequestArgs,
): NativeAgentWalletRequest {
  const forwarderInput = buildNativeAgentRecordReputationForwarderInput(
    {
      reviewer: args.reviewer,
      subject: args.subject,
      categoryId: args.categoryId,
      scores: args.scores,
      payloadHash: args.payloadHash,
    },
    args.maxCycles ?? NATIVE_AGENT_FORWARDER_MAX_CYCLES,
  );
  return walletRequestFromForwarderInput(forwarderInput, args);
}

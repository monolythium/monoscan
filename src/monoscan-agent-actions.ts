import {
  buildNativeAgentCreateEscrowForwarderInput,
  buildNativeAgentRecordReputationForwarderInput,
  buildNativeAgentSetSpendingPolicyForwarderInput,
  type CapabilitiesResponse,
  type EncodeNativeAgentCreateEscrowArgs,
  type EncodeNativeAgentRecordReputationArgs,
  type EncodeNativeAgentSetSpendingPolicyArgs,
} from "@monolythium/core-sdk";
import { getNativeAgentForwarderAddress } from "./sdk/client";

const NATIVE_AGENT_FORWARDER_MAX_CYCLES = "22000";
const NATIVE_AGENT_MRV_EXECUTION_UNIT_LIMIT_HEX = "0x200000";

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

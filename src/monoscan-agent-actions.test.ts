import { describe, expect, it } from "vitest";
import {
  addressToTypedBech32,
  buildNativeAgentModuleCallEnvelope,
  buildNativeAgentCreateEscrowForwarderInput,
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
} from "@monolythium/core-sdk";
import {
  buildNativeAgentAcceptEscrowWalletRequest,
  buildNativeAgentActionWalletRequest,
  buildNativeAgentApproveEscrowWalletRequest,
  buildNativeAgentCallWalletRequest,
  buildNativeAgentCancelEscrowWalletRequest,
  buildNativeAgentCloseAvailabilityWalletRequest,
  buildNativeAgentCounterEscrowWalletRequest,
  buildNativeAgentCreateEscrowWalletRequest,
  buildNativeAgentDeactivateServiceWalletRequest,
  buildNativeAgentDisputeEscrowWalletRequest,
  buildNativeAgentGrantConsentWalletRequest,
  buildNativeAgentIssueAttestationWalletRequest,
  buildNativeAgentListServiceWalletRequest,
  buildNativeAgentOpenAvailabilityWalletRequest,
  buildNativeAgentRecordPolicySpendWalletRequest,
  buildNativeAgentRecordReputationWalletRequest,
  buildNativeAgentRegisterArbiterWalletRequest,
  buildNativeAgentRegisterIssuerWalletRequest,
  buildNativeAgentResolveEscrowWalletRequest,
  buildNativeAgentRevokeAttestationWalletRequest,
  buildNativeAgentRevokeConsentWalletRequest,
  buildNativeAgentSetAvailabilityWalletRequest,
  buildNativeAgentSetSpendingPolicyWalletRequest,
  buildNativeAgentStartEscrowWalletRequest,
  buildNativeAgentSubmitEscrowWalletRequest,
  nativeAgentActionIndexedNonce,
  nativeAgentActionInitialValues,
  nativeAgentActionNonceAccount,
  NATIVE_AGENT_ACTIONS,
  type NativeAgentWalletRequest,
} from "./monoscan-agent-actions";

const typedContract = (address: string) => addressToTypedBech32("contract", address);

function capabilitiesWithAgentForwarder(
  requestBytes: number,
  contractAddress = "0x3333333333333333333333333333333333333333",
): CapabilitiesResponse {
  return {
    blockNumber: 1n,
    capabilities: {},
    nativeModuleForwarders: {
      agent: [{
        module: "agent",
        requestBytes,
        contractAddress,
        artifactProfile: "native-call-forwarder-v1",
        status: "configured",
        deploymentVerified: false,
      }],
    },
  };
}

function nativeAgentState(overrides: Record<string, unknown[]> = {}) {
  return {
    schemaVersion: 1,
    limit: 100,
    filters: { includePolicySpends: false },
    issuers: [],
    attestations: [],
    consents: [],
    services: [],
    availability: [],
    arbiters: [],
    reputationReviews: [],
    spendingPolicies: [],
    policySpends: [],
    escrows: [],
    source: { indexerProvider: "test", projection: "native-agent-current-state" },
    ...overrides,
  } as any;
}

describe("native agent indexed nonce helpers", () => {
  const owner = "0x1111111111111111111111111111111111111111";
  const issuerId = `0x${"aa".repeat(32)}`;

  it("resolves nonce owner accounts for nonce-scoped actions only", () => {
    expect(nativeAgentActionNonceAccount("registerIssuer", { issuer: owner })).toBe(owner);
    expect(nativeAgentActionNonceAccount("createEscrow", { buyer: owner.toUpperCase() })).toBe(owner);
    expect(nativeAgentActionNonceAccount("revokeConsent", { subject: owner })).toBeNull();
  });

  it("derives the next nonce from matching indexed rows", () => {
    const state = nativeAgentState({
      issuers: [
        { issuer: owner, nonce: "4" },
        { issuer: owner.toUpperCase(), nonce: "0x07" },
        { issuer: "0x2222222222222222222222222222222222222222", nonce: "50" },
      ],
    });

    expect(nativeAgentActionIndexedNonce(
      "registerIssuer",
      { issuer: owner },
      state,
    )).toBe("8");
  });

  it("keeps issuer-attestation nonce derivation scoped to the issuer id", () => {
    const state = nativeAgentState({
      attestations: [
        { issuer: owner, issuerId, nonce: "2" },
        { issuer: owner, issuerId, nonce: "9" },
        { issuer: owner, issuerId: `0x${"bb".repeat(32)}`, nonce: "30" },
      ],
    });

    expect(nativeAgentActionIndexedNonce(
      "issueAttestation",
      { issuer: owner, issuerId },
      state,
    )).toBe("10");
  });

  it("returns the first nonce for an indexed account with no previous rows", () => {
    expect(nativeAgentActionIndexedNonce(
      "listService",
      { provider: owner },
      nativeAgentState({ services: [] }),
    )).toBe("0");
  });

  it("does not guess when matching rows omit parseable nonce data", () => {
    expect(nativeAgentActionIndexedNonce(
      "setSpendingPolicy",
      { owner },
      nativeAgentState({ spendingPolicies: [{ owner, controller: owner }] }),
    )).toBeNull();
    expect(nativeAgentActionIndexedNonce(
      "createEscrow",
      { buyer: owner },
      nativeAgentState({ escrows: [{ buyer: owner, nonce: "18446744073709551615" }] }),
    )).toBeNull();
  });
});

describe("native agent wallet request builders", () => {
  const forwarderContractAddress = "0x2222222222222222222222222222222222222222";
  const owner = addressToTypedBech32("user", "0x1111111111111111111111111111111111111111");
  const controller = addressToTypedBech32("user", "0x2222222222222222222222222222222222222222");
  const arbiter = addressToTypedBech32("user", "0x3333333333333333333333333333333333333333");
  const provider = addressToTypedBech32("user", "0x4444444444444444444444444444444444444444");
  const subject = addressToTypedBech32("user", "0x5555555555555555555555555555555555555555");
  const consumer = addressToTypedBech32("user", "0x6666666666666666666666666666666666666666");
  const reviewer = addressToTypedBech32("user", "0x7777777777777777777777777777777777777777");
  const h32 = (byte: string) => `0x${byte.repeat(32)}`;

  function expectedWalletInput(encodedCall: string) {
    return encodeNativeAgentModuleForwarderInput(
      buildNativeAgentModuleCallEnvelope(encodedCall, "22000"),
    );
  }

  const catalogSampleValues = {
    issuer: owner,
    issuerId: h32("11"),
    attestationId: h32("12"),
    consentId: h32("10"),
    subject,
    grantee: consumer,
    consumer,
    provider,
    serviceId: h32("13"),
    arbiter,
    reviewer,
    owner,
    controller,
    buyer: owner,
    actor: owner,
    nonce: "7",
    metadataHash: h32("aa"),
    schemaHash: h32("ab"),
    payloadHash: h32("ac"),
    scopeHash: h32("ad"),
    categoryHash: h32("ae"),
    assetId: h32("af"),
    policyId: h32("b0"),
    escrowId: h32("b1"),
    termsHash: h32("b2"),
    categoryId: "2",
    tier: "3",
    maxConcurrent: "8",
    paused: "true",
    perActionLimit: "125",
    windowLimit: "500",
    windowSecs: "3600",
    window: "11",
    amount: "25",
    speed: "5",
    quality: "4",
    communication: "3",
    accuracy: "2",
    resolution: "refund-buyer",
  };

  const extraActionCases: Array<{
    name: string;
    encodedCall: () => string;
    request: () => NativeAgentWalletRequest;
  }> = [
    {
      name: "issuer registration",
      encodedCall: () => encodeNativeAgentRegisterIssuerCall({
        issuer: owner,
        nonce: "1",
        metadataHash: h32("aa"),
      }),
      request: () => buildNativeAgentRegisterIssuerWalletRequest({
        issuer: owner,
        nonce: "1",
        metadataHash: h32("aa"),
        forwarderContractAddress,
      }),
    },
    {
      name: "attestation issue",
      encodedCall: () => encodeNativeAgentIssueAttestationCall({
        issuerId: h32("11"),
        issuer: owner,
        subject,
        nonce: "2",
        schemaHash: h32("12"),
        payloadHash: h32("13"),
      }),
      request: () => buildNativeAgentIssueAttestationWalletRequest({
        issuerId: h32("11"),
        issuer: owner,
        subject,
        nonce: "2",
        schemaHash: h32("12"),
        payloadHash: h32("13"),
        forwarderContractAddress,
      }),
    },
    {
      name: "attestation revoke",
      encodedCall: () => encodeNativeAgentRevokeAttestationCall({
        attestationId: h32("14"),
        issuer: owner,
      }),
      request: () => buildNativeAgentRevokeAttestationWalletRequest({
        attestationId: h32("14"),
        issuer: owner,
        forwarderContractAddress,
      }),
    },
    {
      name: "consent grant",
      encodedCall: () => encodeNativeAgentGrantConsentCall({
        subject,
        grantee: consumer,
        nonce: "3",
        scopeHash: h32("15"),
        expiresAt: "10000",
      }),
      request: () => buildNativeAgentGrantConsentWalletRequest({
        subject,
        grantee: consumer,
        nonce: "3",
        scopeHash: h32("15"),
        expiresAt: "10000",
        forwarderContractAddress,
      }),
    },
    {
      name: "consent revoke",
      encodedCall: () => encodeNativeAgentRevokeConsentCall({
        consentId: h32("16"),
        subject,
      }),
      request: () => buildNativeAgentRevokeConsentWalletRequest({
        consentId: h32("16"),
        subject,
        forwarderContractAddress,
      }),
    },
    {
      name: "service listing",
      encodedCall: () => encodeNativeAgentListServiceCall({
        provider,
        nonce: "4",
        categoryHash: h32("17"),
        metadataHash: h32("18"),
      }),
      request: () => buildNativeAgentListServiceWalletRequest({
        provider,
        nonce: "4",
        categoryHash: h32("17"),
        metadataHash: h32("18"),
        forwarderContractAddress,
      }),
    },
    {
      name: "service deactivation",
      encodedCall: () => encodeNativeAgentDeactivateServiceCall({
        serviceId: h32("19"),
        provider,
      }),
      request: () => buildNativeAgentDeactivateServiceWalletRequest({
        serviceId: h32("19"),
        provider,
        forwarderContractAddress,
      }),
    },
    {
      name: "availability set",
      encodedCall: () => encodeNativeAgentSetAvailabilityCall({
        provider,
        maxConcurrent: "8",
        paused: false,
      }),
      request: () => buildNativeAgentSetAvailabilityWalletRequest({
        provider,
        maxConcurrent: "8",
        paused: false,
        forwarderContractAddress,
      }),
    },
    {
      name: "availability open",
      encodedCall: () => encodeNativeAgentOpenAvailabilityCall({
        provider,
        consumer,
      }),
      request: () => buildNativeAgentOpenAvailabilityWalletRequest({
        provider,
        consumer,
        forwarderContractAddress,
      }),
    },
    {
      name: "availability close",
      encodedCall: () => encodeNativeAgentCloseAvailabilityCall({
        provider,
        consumer,
      }),
      request: () => buildNativeAgentCloseAvailabilityWalletRequest({
        provider,
        consumer,
        forwarderContractAddress,
      }),
    },
    {
      name: "arbiter registration",
      encodedCall: () => encodeNativeAgentRegisterArbiterCall({
        arbiter,
        nonce: "5",
        tier: "2",
        metadataHash: h32("1a"),
      }),
      request: () => buildNativeAgentRegisterArbiterWalletRequest({
        arbiter,
        nonce: "5",
        tier: "2",
        metadataHash: h32("1a"),
        forwarderContractAddress,
      }),
    },
    {
      name: "policy spend recording",
      encodedCall: () => encodeNativeAgentRecordPolicySpendCall({
        policyId: h32("1b"),
        controller,
        window: "12",
        amount: "25",
      }),
      request: () => buildNativeAgentRecordPolicySpendWalletRequest({
        policyId: h32("1b"),
        controller,
        window: "12",
        amount: "25",
        forwarderContractAddress,
      }),
    },
    {
      name: "escrow counter",
      encodedCall: () => encodeNativeAgentCounterEscrowCall({
        escrowId: h32("1c"),
        actor: owner,
        termsHash: h32("1d"),
      }),
      request: () => buildNativeAgentCounterEscrowWalletRequest({
        escrowId: h32("1c"),
        actor: owner,
        termsHash: h32("1d"),
        forwarderContractAddress,
      }),
    },
    {
      name: "escrow accept",
      encodedCall: () => encodeNativeAgentAcceptEscrowCall({
        escrowId: h32("1c"),
        actor: owner,
      }),
      request: () => buildNativeAgentAcceptEscrowWalletRequest({
        escrowId: h32("1c"),
        actor: owner,
        forwarderContractAddress,
      }),
    },
    {
      name: "escrow start",
      encodedCall: () => encodeNativeAgentStartEscrowCall({
        escrowId: h32("1c"),
        provider,
      }),
      request: () => buildNativeAgentStartEscrowWalletRequest({
        escrowId: h32("1c"),
        actor: provider,
        forwarderContractAddress,
      }),
    },
    {
      name: "escrow submit",
      encodedCall: () => encodeNativeAgentSubmitEscrowCall({
        escrowId: h32("1c"),
        provider,
        payloadHash: h32("1e"),
      }),
      request: () => buildNativeAgentSubmitEscrowWalletRequest({
        escrowId: h32("1c"),
        actor: provider,
        payloadHash: h32("1e"),
        forwarderContractAddress,
      }),
    },
    {
      name: "escrow approve",
      encodedCall: () => encodeNativeAgentApproveEscrowCall({
        escrowId: h32("1c"),
        actor: owner,
      }),
      request: () => buildNativeAgentApproveEscrowWalletRequest({
        escrowId: h32("1c"),
        actor: owner,
        forwarderContractAddress,
      }),
    },
    {
      name: "escrow dispute",
      encodedCall: () => encodeNativeAgentDisputeEscrowCall({
        escrowId: h32("1c"),
        actor: owner,
      }),
      request: () => buildNativeAgentDisputeEscrowWalletRequest({
        escrowId: h32("1c"),
        actor: owner,
        forwarderContractAddress,
      }),
    },
    {
      name: "escrow cancel",
      encodedCall: () => encodeNativeAgentCancelEscrowCall({
        escrowId: h32("1c"),
        actor: owner,
      }),
      request: () => buildNativeAgentCancelEscrowWalletRequest({
        escrowId: h32("1c"),
        actor: owner,
        forwarderContractAddress,
      }),
    },
    {
      name: "escrow resolve",
      encodedCall: () => encodeNativeAgentResolveEscrowCall({
        escrowId: h32("1c"),
        actor: arbiter,
        resolution: "refund-buyer",
      }),
      request: () => buildNativeAgentResolveEscrowWalletRequest({
        escrowId: h32("1c"),
        actor: arbiter,
        resolution: "refund-buyer",
        forwarderContractAddress,
      }),
    },
  ];

  it("builds spending-policy MRV native forwarder requests", () => {
    const args = {
      owner,
      controller,
      nonce: "7",
      assetId: `0x${"33".repeat(32)}`,
      perActionLimit: "125",
      windowLimit: "500",
      windowSecs: 3600,
    };
    const expectedForwarder = buildNativeAgentSetSpendingPolicyForwarderInput(args, "22000");

    const request = buildNativeAgentSetSpendingPolicyWalletRequest({
      ...args,
      forwarderContractAddress,
    });

    expect(request.method).toBe("monolythium_submitMrvNativeCall");
    expect(request.params[0]).toMatchObject({
      contractAddress: typedContract(forwarderContractAddress),
      input: expectedForwarder.input,
      executionUnitLimitHex: "0x200000",
      valueWeiHex: "0x0",
    });
    expect((request.params[0].input.length - 2) / 2).toBe(196);
  });

  it.each(extraActionCases)("builds $name MRV native forwarder requests", ({ encodedCall, request }) => {
    const expectedForwarder = expectedWalletInput(encodedCall());
    const actual = request();

    expect(actual.method).toBe("monolythium_submitMrvNativeCall");
    expect(actual.params[0]).toMatchObject({
      contractAddress: typedContract(forwarderContractAddress),
      input: expectedForwarder.input,
      executionUnitLimitHex: "0x200000",
      valueWeiHex: "0x0",
    });
  });

  it("builds generic wallet requests from an already encoded agent call", () => {
    const encodedCall = encodeNativeAgentRegisterIssuerCall({
      issuer: owner,
      nonce: "9",
      metadataHash: h32("ab"),
    });
    const expectedForwarder = expectedWalletInput(encodedCall);

    const request = buildNativeAgentCallWalletRequest(encodedCall, { forwarderContractAddress });

    expect(request.params[0]).toMatchObject({
      contractAddress: typedContract(forwarderContractAddress),
      input: expectedForwarder.input,
    });
  });

  it("keeps every catalog action buildable as a wallet request", () => {
    const seen = new Set<string>();
    for (const action of NATIVE_AGENT_ACTIONS) {
      seen.add(action.kind);
      const request = buildNativeAgentActionWalletRequest(
        action.kind,
        { ...nativeAgentActionInitialValues(action.kind), ...catalogSampleValues },
        { forwarderContractAddress },
      );

      expect(request.method).toBe("monolythium_submitMrvNativeCall");
      expect(request.params[0].contractAddress).toBe(typedContract(forwarderContractAddress));
      expect(request.params[0].input).toMatch(/^0x[0-9a-f]+$/i);
    }

    expect(seen.size).toBe(NATIVE_AGENT_ACTIONS.length);
    expect(seen).toContain("recordReputation");
    expect(seen).toContain("resolveEscrow");
  });

  it("uses capability-disclosed agent forwarders matching request byte length", () => {
    const args = {
      buyer: owner,
      provider: controller,
      arbiter,
      nonce: 9,
      assetId: `0x${"44".repeat(32)}`,
      amount: "123",
      termsHash: `0x${"55".repeat(32)}`,
    };
    const expectedForwarder = buildNativeAgentCreateEscrowForwarderInput(args, "22000");
    const request = buildNativeAgentCreateEscrowWalletRequest({
      ...args,
      forwarderContractAddress: null,
      capabilities: capabilitiesWithAgentForwarder(expectedForwarder.requestBytes),
    });

    expect(request.params[0]).toMatchObject({
      contractAddress: typedContract("0x3333333333333333333333333333333333333333"),
      input: expectedForwarder.input,
    });
    expect((request.params[0].input.length - 2) / 2).toBe(228);
  });

  it("builds reputation requests and rejects missing or mismatched forwarders", () => {
    const args = {
      reviewer: consumer,
      subject: reviewer,
      categoryId: 42,
      scores: { speed: 5, quality: 4, communication: 3, accuracy: 2 },
      payloadHash: `0x${"88".repeat(32)}`,
    };
    const expectedForwarder = buildNativeAgentRecordReputationForwarderInput(args, "22000");

    const request = buildNativeAgentRecordReputationWalletRequest({
      ...args,
      forwarderContractAddress,
      executionUnitLimitHex: "0x1234",
    });
    expect(request.params[0]).toMatchObject({
      contractAddress: typedContract(forwarderContractAddress),
      input: expectedForwarder.input,
      executionUnitLimitHex: "0x1234",
    });

    expect(() =>
      buildNativeAgentRecordReputationWalletRequest({
        ...args,
        forwarderContractAddress: null,
        capabilities: capabilitiesWithAgentForwarder(expectedForwarder.requestBytes + 1),
      }),
    ).toThrow("MRV native agent forwarder for 156 request bytes is not configured");

    expect(() =>
      buildNativeAgentRecordReputationWalletRequest({
        ...args,
        forwarderContractAddress: null,
      }),
    ).toThrow("MRV native agent forwarder address is not configured");
  });
});

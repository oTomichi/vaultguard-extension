// ─── Enums ───────────────────────────────────────────────────────────────────

export enum RiskLevel {
  SAFE = 'SAFE',
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum ThreatType {
  INFINITE_APPROVAL = 'INFINITE_APPROVAL',
  MALICIOUS_CONTRACT = 'MALICIOUS_CONTRACT',
  ADDRESS_POISONING = 'ADDRESS_POISONING',
  PHISHING_SITE = 'PHISHING_SITE',
  NEW_UNVERIFIED_CONTRACT = 'NEW_UNVERIFIED_CONTRACT',
  HONEYPOT = 'HONEYPOT',
  UNUSUAL_GAS = 'UNUSUAL_GAS',
  SUSPICIOUS_SIGNATURE = 'SUSPICIOUS_SIGNATURE',
  PERMIT_SIGNATURE = 'PERMIT_SIGNATURE',
  DRAIN_ALL = 'DRAIN_ALL',
}

export enum SubscriptionTier {
  FREE = 'FREE',
  PRO = 'PRO',
  TEAM = 'TEAM',
}

export enum ChainId {
  ETHEREUM = 1,
  POLYGON = 137,
  ARBITRUM = 42161,
  OPTIMISM = 10,
  BASE = 8453,
  BSC = 56,
  SEPOLIA = 11155111,
}

// ─── Transaction Types ────────────────────────────────────────────────────────

export interface RawTransaction {
  chainId: number;
  from: string;
  to: string | null;
  value: string; // hex or decimal string
  data: string;
  gas?: string;
  gasPrice?: string;
  nonce?: number;
}

export interface TokenTransfer {
  token: string;
  tokenSymbol: string;
  tokenName: string;
  decimals: number;
  from: string;
  to: string;
  amount: string;
  amountFormatted: string;
  usdValue?: number;
  direction: 'IN' | 'OUT';
}

export interface ContractApproval {
  token: string;
  tokenSymbol: string;
  spender: string;
  spenderLabel?: string;
  amount: string;
  amountFormatted: string;
  isInfinite: boolean;
  usdValue?: number;
}

export interface Warning {
  type: ThreatType;
  severity: RiskLevel;
  title: string;
  description: string;
  recommendation: string;
}

export interface SimulationResult {
  success: boolean;
  riskScore: number;
  riskLevel: RiskLevel;
  warnings: Warning[];
  transfers: TokenTransfer[];
  approvals: ContractApproval[];
  ethValueChange: string;
  gasUsed: string;
  decodedFunction?: {
    name: string;
    params: Array<{ name: string; type: string; value: string }>;
  };
  simulationId?: string;
  error?: string;
}

// ─── Signature Types ──────────────────────────────────────────────────────────

export interface EIP712Domain {
  name?: string;
  version?: string;
  chainId?: number;
  verifyingContract?: string;
  salt?: string;
}

export interface TypedDataMessage {
  domain: EIP712Domain;
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
}

export interface SignatureAnalysis {
  isPermit: boolean;
  isDelegation: boolean;
  isOffChainOrder: boolean;
  riskScore: number;
  riskLevel: RiskLevel;
  warnings: Warning[];
  humanReadable: string;
  expiryTimestamp?: number;
  spender?: string;
  value?: string;
  /** Token the permit covers (EIP-2612: the verifying contract; Permit2: details.token). */
  token?: string;
  isUnlimited?: boolean;
}

// ─── Approval Monitor ─────────────────────────────────────────────────────────

export interface ApprovalRecord {
  id: string;
  walletAddress: string;
  chainId: number;
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  tokenDecimals?: number;
  spenderAddress: string;
  spenderLabel?: string;
  amount: string;
  isInfinite: boolean;
  riskScore: number;
  riskLevel: RiskLevel;
  transactionHash: string;
  blockNumber: number;
  timestamp: Date;
}

// ─── Threat Intelligence ──────────────────────────────────────────────────────

export interface ThreatRecord {
  id: string;
  type: ThreatType;
  contractAddress?: string;
  domain?: string;
  description: string;
  severity: RiskLevel;
  source: string;
  timestamp: Date;
  chainId?: number;
}

// ─── API Request/Response Types ───────────────────────────────────────────────

export interface SimulateRequest {
  chainId: number;
  from: string;
  to: string | null;
  value: string;
  data: string;
  gas?: string;
}

export interface SimulateResponse {
  success: boolean;
  data?: SimulationResult;
  error?: string;
  cached: boolean;
  latencyMs: number;
}

export interface CheckAddressRequest {
  address: string;
  chainId?: number;
}

export interface CheckAddressResponse {
  address: string;
  isMalicious: boolean;
  riskScore: number;
  labels: string[];
  threats: ThreatRecord[];
}

export interface CheckDomainRequest {
  domain: string;
}

export interface CheckDomainResponse {
  domain: string;
  isPhishing: boolean;
  riskScore: number;
  source?: string;
  reportedAt?: Date;
}

export interface WalletApprovalsRequest {
  walletAddress: string;
  chainIds?: number[];
}

export interface WalletSecurityScore {
  walletAddress: string;
  overallScore: number;
  riskLevel: RiskLevel;
  approvalCount: number;
  highRiskApprovals: number;
  infiniteApprovals: number;
  approvals: ApprovalRecord[];
  lastScanned: Date;
}

// ─── Extension Message Types ──────────────────────────────────────────────────

export type ExtensionMessageType =
  | 'TRANSACTION_DETECTED'
  | 'SIGNATURE_DETECTED'
  | 'SIMULATE_TRANSACTION'
  | 'SIMULATION_RESULT'
  | 'CHECK_DOMAIN'
  | 'DOMAIN_RESULT'
  | 'REVOKE_APPROVAL'
  | 'PANIC_MODE'
  | 'USER_PROCEED'
  | 'USER_BLOCK'
  | 'GET_STATUS'
  | 'STATUS_RESPONSE'
  | 'REVIEW_ACTION';

export interface ExtensionMessage {
  type: ExtensionMessageType;
  payload?: unknown;
  requestId?: string;
}

export interface TransactionDetectedPayload {
  transaction: RawTransaction;
  origin: string;
  walletType: 'metamask' | 'phantom' | 'rabby' | 'coinbase';
}

export interface SignatureDetectedPayload {
  typedData: TypedDataMessage;
  origin: string;
  walletType: string;
}

// ─── Dashboard Types ──────────────────────────────────────────────────────────

export interface DashboardStats {
  securityScore: number;
  riskLevel: RiskLevel;
  activeApprovals: number;
  highRiskApprovals: number;
  transactionsScanned: number;
  threatsBlocked: number;
  lastScanDate: Date | null;
}

export interface TransactionHistoryItem {
  id: string;
  hash: string;
  chainId: number;
  from: string;
  to: string;
  value: string;
  riskScore: number;
  riskLevel: RiskLevel;
  warnings: Warning[];
  timestamp: Date;
  status: 'confirmed' | 'failed' | 'pending';
}

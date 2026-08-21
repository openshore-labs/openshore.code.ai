// The App Store In-App Purchase bridge: StoreKit 2 reached through a small
// Capacitor plugin (Swift side in app/plugins/oscode-iap). This file is the JS
// contract. It is the typed bridge only. Wiring into the store or any UI is a
// later phase.
//
// The server is the source of truth for entitlement: every method returns the
// raw signed JWS so the backend can verify each transaction with Apple. The
// client-side result is a fast hint, not the authority.
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/** The auto-renewable Personal plan. Keep in sync with App Store Connect. */
export const PERSONAL_YEARLY_PRODUCT_ID = 'ai.openshore.oscode.personal.yearly';

export interface IapProduct {
  id: string;
  displayName: string;
  displayPrice: string;
  description: string;
}

export type PurchaseState = 'purchased' | 'cancelled' | 'pending' | 'unknown';

export interface PurchaseResult {
  state: PurchaseState;
  /** Present when state is 'purchased': the raw signed JWS for server checks. */
  jws?: string;
  productId?: string;
  originalId?: string;
  /** Client-side signature check. A hint only; the server is authoritative. */
  verified?: boolean;
}

export interface RestoredTransaction {
  jws: string;
  productId: string;
  originalId: string;
}

export interface EntitlementResult {
  active: boolean;
  jws?: string;
  /** ISO 8601 expiry, when the entitlement carries one. */
  expiresAt?: string;
}

export interface TransactionUpdate {
  jws: string;
  productId: string;
  originalId: string;
  revoked: boolean;
  verified: boolean;
  expiresAt?: string;
}

export interface OscodeIapPlugin {
  /** Load App Store products for the given ids. */
  products(options: { productIds: string[] }): Promise<{ products: IapProduct[] }>;
  /** Buy a product. Finishes the transaction and returns its JWS. */
  purchase(options: { productId: string }): Promise<PurchaseResult>;
  /** Restore Purchases (Apple 3.1.1): current entitlements as JWS list. */
  restore(options?: { productId?: string }): Promise<{ transactions: RestoredTransaction[] }>;
  /** Is there a live entitlement for this product right now? */
  currentEntitlement(options: { productId: string }): Promise<EntitlementResult>;

  /** Renewals and revocations that arrive while the app is open. */
  addListener(
    eventName: 'transactionUpdate',
    listener: (data: TransactionUpdate) => void,
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}

export const OscodeIap = registerPlugin<OscodeIapPlugin>('OscodeIap');

/** Native StoreKit is iOS only. Gate every call on this. */
export function iapAvailable(): boolean {
  return Capacitor.getPlatform() === 'ios';
}

// ---------------------------------------------------------------------------
// Typed convenience wrappers. Thin pass-throughs to the plugin.
// ---------------------------------------------------------------------------

export function products(productIds: string[]): Promise<{ products: IapProduct[] }> {
  return OscodeIap.products({ productIds });
}

export function purchase(productId: string): Promise<PurchaseResult> {
  return OscodeIap.purchase({ productId });
}

export function restore(productId?: string): Promise<{ transactions: RestoredTransaction[] }> {
  return OscodeIap.restore(productId ? { productId } : undefined);
}

export function currentEntitlement(productId: string): Promise<EntitlementResult> {
  return OscodeIap.currentEntitlement({ productId });
}

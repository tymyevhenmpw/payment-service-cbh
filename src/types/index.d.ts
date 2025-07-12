// Common domain types for payments

export type UserId = string;
export type WebsiteId = string;

export type PaymentType = "subscription" | "token_purchase";

export interface BasePayment {
  id: string; // UUID or Stripe payment ID
  userId: UserId;
  websiteId: WebsiteId;
  amount: number; // in cents
  currency: string; // e.g. 'usd'
  paymentType: PaymentType;
  createdAt: Date;
  status: "pending" | "succeeded" | "failed" | "canceled";
  stripePaymentIntentId?: string;
  stripeSubscriptionId?: string;
}

export interface SubscriptionPayment extends BasePayment {
  paymentType: "subscription";
  // Additional subscription-specific fields:
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd?: boolean;
}

export interface TokenPurchasePayment extends BasePayment {
  paymentType: "token_purchase";
  tokensPurchased: number; // number of tokens bought
}

export interface KafkaMessagePayload<T> {
  topic: string;
  key?: string;
  value: T;
  timestamp: number;
}

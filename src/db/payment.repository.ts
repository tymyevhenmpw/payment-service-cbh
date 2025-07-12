// db/payment.repository.ts

import { PaymentStatus, PaymentType, Prisma } from "@prisma/client";
import prisma from "../prisma/client";

interface CreatePaymentParams {
  userId: string;
  websiteId: string;
  type: PaymentType;
  amount: number;
  currency?: string;
  stripePaymentIntentId?: string;
  stripeSubscriptionId?: string;
  description?: string;
  status: PaymentStatus;
}

export const createPayment = async (params: CreatePaymentParams) => {
  return prisma.payment.create({
    data: {
      userId: params.userId,
      websiteId: params.websiteId,
      type: params.type,
      amount: params.amount,
      currency: params.currency || "usd",
      stripePaymentIntentId: params.stripePaymentIntentId,
      stripeSubscriptionId: params.stripeSubscriptionId,
      description: params.description,
      status: params.status,
    },
  });
};

export const updatePaymentStatus = async (
  paymentId: string,
  status: PaymentStatus
) => {
  return prisma.payment.update({
    where: { id: paymentId },
    data: { status },
  });
};

export const findPaymentByStripePaymentIntent = async (
  paymentIntentId: string
) => {
  return prisma.payment.findFirst({
    where: { stripePaymentIntentId: paymentIntentId },
  });
};

export const findPaymentById = async (id: string) => {
  return prisma.payment.findUnique({
    where: { id },
  });
};

// --- ADD THIS NEW FUNCTION ---
export const findPaymentByStripeSubscription = async (
  stripeSubscriptionId: string
) => {
  return prisma.payment.findFirst({
    where: { stripeSubscriptionId: stripeSubscriptionId },
  });
};

export const findAllPaymentsByUserId = async (
  userId: string
) => {
  return prisma.payment.findMany({
    where: { userId: userId },
    orderBy: { createdAt: 'desc' }, // Order by most recent payments first
  });
};

// --- END OF ADDITION ---
// controllers/token-purchases.controller.ts
import { FastifyReply, FastifyRequest } from "fastify";
import Stripe from "stripe";
import { config } from "../config/env";
import { stripe } from "../config/stripe";
import { createPayment, updatePaymentStatus, findPaymentByStripePaymentIntent } from "../db/payment.repository";
import { PaymentType, PaymentStatus } from "@prisma/client";
import axios from 'axios'; // Import axios for calling main service

// Create a token purchase (one-time payment)
export async function createTokenPurchase(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { userId, websiteId, tokensAmount, currency } = request.body as {
      userId: string;
      websiteId: string;
      tokensAmount: number;
      currency: string;
    };

    if (!tokensAmount || tokensAmount <= 0) {
      return reply.status(400).send({ error: "Invalid tokens amount." });
    }

    const priceInDollars = tokensAmount / config.tokenCoefficientMultiplier;
    const amountInCents = Math.round(priceInDollars * 100);

    if (amountInCents <= 50) {
      return reply.status(400).send({ error: "Amount is too low for Stripe payment (min $0.50)." });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: currency || "usd",
      metadata: { userId, websiteId, tokensAmount: String(tokensAmount) },
    });

    const paymentRecord = await createPayment({ // Store the created payment record
      userId,
      websiteId,
      type: PaymentType.TOKEN_PURCHASE,
      amount: amountInCents,
      currency: currency || "usd",
      stripePaymentIntentId: paymentIntent.id,
      description: `Token purchase: ${tokensAmount} tokens`,
      status: PaymentStatus.PENDING,
    });

    return reply.status(201).send({ clientSecret: paymentIntent.client_secret, paymentId: paymentRecord.id }); // Return paymentId
  } catch (error) {
    console.error("Error creating token purchase:", error);
    return reply.status(500).send({ error: "Failed to create token purchase" });
  }
}

// Handle Stripe webhook for token purchases
export async function handleWebhook(request: FastifyRequest, reply: FastifyReply) {
  const sig = request.headers["stripe-signature"] as string;
  const webhookSecret = config.stripePurchaseWebhookSecret;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(request.rawBody as Buffer, sig, webhookSecret);
  } catch (err: any) {
    console.error("Webhook signature verification failed for token purchase.", err);
    return reply.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case "payment_intent.succeeded":
      const paymentIntentSucceeded = event.data.object as Stripe.PaymentIntent;
      console.log("Token Payment succeeded:", paymentIntentSucceeded.id);

      const pendingPaymentSucceeded = await findPaymentByStripePaymentIntent(paymentIntentSucceeded.id);

      if (pendingPaymentSucceeded) {
        await updatePaymentStatus(pendingPaymentSucceeded.id, PaymentStatus.SUCCEEDED);
        console.log(`Payment record ${pendingPaymentSucceeded.id} updated to SUCCEEDED.`);

        const tokensAmount = parseInt(paymentIntentSucceeded.metadata?.tokensAmount || '0', 10);
        const websiteId = paymentIntentSucceeded.metadata?.websiteId;
        const paymentId = pendingPaymentSucceeded.id; // Get the internal payment ID

        if (tokensAmount > 0 && websiteId) {
          console.log(`User ${pendingPaymentSucceeded.userId} should be credited with ${tokensAmount} tokens for website ${websiteId}.`);
          // Call the main service to add credits to the website
          try {
            await axios.put(
              `${config.mainServiceApiBaseUrl}/websites/${websiteId}/add-credits`,
              { tokensToAdd: tokensAmount, paymentId: paymentId }, // Send tokensToAdd and paymentId
              { headers: { 'x-payment-service-api-key': config.paymentServiceApiKey } } // Auth header
            );
            console.log(`Successfully sent request to main service to add ${tokensAmount} credits to website ${websiteId}.`);
          } catch (mainServiceError: any) {
            console.error(`Failed to add credits to website ${websiteId} in main service:`, mainServiceError.message);
            // Log full error response from main service if available
            if (axios.isAxiosError(mainServiceError) && mainServiceError.response) {
                console.error('Main service error response:', mainServiceError.response.data);
            }
          }
        }
      } else {
        console.warn(`No pending payment found for Stripe PaymentIntent ID: ${paymentIntentSucceeded.id}. This might be an issue or a race condition.`);
      }
      break;

    case "payment_intent.payment_failed":
      const paymentIntentFailed = event.data.object as Stripe.PaymentIntent;
      console.log("Token Payment failed:", paymentIntentFailed.id);

      const pendingPaymentFailed = await findPaymentByStripePaymentIntent(paymentIntentFailed.id);

      if (pendingPaymentFailed) {
        await updatePaymentStatus(pendingPaymentFailed.id, PaymentStatus.FAILED);
        console.log(`Payment record ${pendingPaymentFailed.id} updated to FAILED.`);
      } else {
        console.warn(`No pending payment found for Stripe PaymentIntent ID: ${paymentIntentFailed.id}.`);
      }
      break;

    default:
      console.log(`Unhandled token purchase event type ${event.type}`);
  }

  reply.status(200).send({ received: true });
}
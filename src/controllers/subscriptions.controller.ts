// controllers/subscriptions.controller.ts
import { FastifyReply, FastifyRequest } from "fastify";
import Stripe from "stripe";
import axios from "axios"; // Import axios for HTTP requests
import { config } from "../config/env"; // Import config
import { stripe } from "../config/stripe"; // Assuming this imports the Stripe instance correctly
import { createPayment, updatePaymentStatus, findPaymentByStripeSubscription } from "../db/payment.repository"; // Assuming this is your payment repository
import { PaymentType, PaymentStatus } from "@prisma/client";

// Define the structure of the Plan object we expect from the main service
interface Plan {
  _id: string;
  name: string;
  description?: string;
  priceMonthly: number;
  creditBoostMonthly: number;
  allowAI: boolean;
  maxStaffMembers: number;
  allowPredefinedResponses: boolean;
  stripePriceId: string; // IMPORTANT: Assuming main service API provides this Stripe Price ID
}

// Define the structure of the User object we expect from the main service
interface User {
  _id: string;
  email: string;
  stripeCusId?: string; // This is the key!
  // Add other user properties if needed, e.g., name
}

// Helper function to fetch user details from the main service
async function fetchUserFromMainService(userId: string, authToken: string): Promise<User> {
  console.log(`[fetchUserFromMainService] Attempting to fetch user ${userId} from main service.`);
  try {
    const response = await axios.get<User>(`${config.mainServiceApiBaseUrl}/users/${userId}`, {
      headers: {
        'x-auth-token': authToken
      }
    });
    console.log(`[fetchUserFromMainService] Successfully fetched user ${userId}.`);
    return response.data;
  } catch (error: any) {
    console.error(`[fetchUserFromMainService] Error fetching user ${userId} from main service:`, error.message);
    if (axios.isAxiosError(error) && error.response) {
      throw new Error(`Failed to fetch user from main service: ${error.response.status} - ${error.response.data.message || error.message}`);
    }
    throw new Error(`Failed to fetch user from main service: ${error.message}`);
  }
}

// Helper function to update user's Stripe Customer ID in the main service
async function updateStripeCustomerIdInMainService(userId: string, stripeCustomerId: string, authToken: string): Promise<void> {
  console.log(`[updateStripeCustomerIdInMainService] Attempting to update Stripe Customer ID for user ${userId} to ${stripeCustomerId} in main service.`);
  try {
    await axios.put(`${config.mainServiceApiBaseUrl}/users/${userId}/customerId`,
      { stripeCustomerId: stripeCustomerId },
      {
        headers: {
          'x-auth-token': authToken
        }
      }
    );
    console.log(`[updateStripeCustomerIdInMainService] Successfully updated user ${userId} with new Stripe Customer ID: ${stripeCustomerId} in main service.`);
  } catch (error: any) {
    console.error(`[updateStripeCustomerIdInMainService] Error updating stripeCusId for user ${userId} in main service:`, error.message);
    if (axios.isAxiosError(error) && error.response) {
      throw new Error(`Failed to update stripeCusId in main service: ${error.response.status} - ${error.response.data.message || error.message}`);
    }
    throw new Error(`Failed to update stripeCusId in main service: ${error.message}`);
  }
}

// Helper function to inform main service about plan change confirmation
async function confirmPlanChangeInMainService(
  websiteId: string,
  newPlanId: string,
  newStripeSubscriptionId: string,
  paymentId: string,
  authToken: string
): Promise<void> {
  console.log(`[confirmPlanChangeInMainService] Attempting to confirm plan change for website ${websiteId} (newPlan: ${newPlanId}, StripeSub: ${newStripeSubscriptionId}, PaymentId: ${paymentId}) in main service.`);
  try {
    await axios.put(
      `${config.mainServiceApiBaseUrl}/websites/${websiteId}/confirm-plan-change`,
      {
        newPlanId: newPlanId,
        newStripeSubscriptionId: newStripeSubscriptionId,
        paymentId: paymentId,
      },
      {
        headers: {
          'x-payment-service-api-key': config.paymentServiceApiKey,
        }
      }
    );
    console.log(`[confirmPlanChangeInMainService] Successfully confirmed plan change for website ${websiteId} in main service.`);
  } catch (error: any) {
    console.error(`[confirmPlanChangeInMainService] Failed to confirm plan change for website ${websiteId} in main service:`, error.message);
    if (axios.isAxiosError(error) && error.response) {
      console.error('[confirmPlanChangeInMainService] Main service error response:', error.response.data);
    }
    throw new Error(`Failed to confirm plan change in main service: ${error.message}`);
  }
}


// Create a subscription (initial creation)
export async function createSubscription(request: FastifyRequest, reply: FastifyReply) {
  const { userId, websiteId, planId } = request.body as {
    userId: string;
    websiteId: string;
    planId: string;
  };
  const authToken = request.headers['x-auth-token'] as string;

  console.log(`[createSubscription] Initiating subscription creation for userId: ${userId}, websiteId: ${websiteId}, planId: ${planId}`);

  if (!userId || !websiteId || !planId || !authToken) {
    console.warn(`[createSubscription] Missing required parameters. userId: ${userId}, websiteId: ${websiteId}, planId: ${planId}, authToken present: ${!!authToken}`);
    return reply.status(400).send({ error: "Missing userId, websiteId, planId, or X-Auth-Token header." });
  }

  try {
    // 1. Fetch user details to get Stripe Customer ID
    let user: User;
    try {
      user = await fetchUserFromMainService(userId, authToken);
    } catch (error: any) {
      console.error("[createSubscription] Error fetching user for subscription:", error);
      return reply.status(500).send({ error: error.message || "Failed to retrieve user information." });
    }

    let stripeCustomerId: string;
    if (user.stripeCusId) {
      stripeCustomerId = user.stripeCusId;
      console.log(`[createSubscription] Using existing Stripe Customer ID: ${stripeCustomerId} for user ${userId}`);
    } else {
      console.log(`[createSubscription] No Stripe Customer ID found for user ${userId}. Creating a new one.`);
      try {
        const customer = await stripe.customers.create({
          email: user.email,
          metadata: { appUserId: userId },
        });
        stripeCustomerId = customer.id;
        console.log(`[createSubscription] New Stripe Customer created: ${stripeCustomerId}`);

        await updateStripeCustomerIdInMainService(userId, stripeCustomerId, authToken);
      } catch (stripeCustomerError: any) {
        console.error("[createSubscription] Error creating Stripe Customer:", stripeCustomerError);
        return reply.status(500).send({ error: "Failed to create Stripe Customer." });
      }
    }

    // 2. Make API call to MAIN_SERVICE_API_BASE_URL/plans to get plan details
    let plan: Plan;
    try {
      console.log(`[createSubscription] Fetching plan details for planId: ${planId}`);
      const planResponse = await axios.get<Plan>(`${config.mainServiceApiBaseUrl}/plans/${planId}`);
      plan = planResponse.data;

      if (!plan) {
        console.warn(`[createSubscription] Plan ${planId} not found in main service.`);
        return reply.status(404).send({ error: "Plan not found." });
      }

      if (!plan.stripePriceId) {
        console.error(`[createSubscription] Stripe Price ID not available for plan ${planId}.`);
        return reply.status(500).send({ error: "Stripe Price ID not available for this plan. Ensure it's returned by the main service or mapped." });
      }
      console.log(`[createSubscription] Fetched plan: ${plan.name} with Stripe Price ID: ${plan.stripePriceId}`);

    } catch (apiError: any) {
      console.error(`[createSubscription] Error fetching plan details from main service: ${apiError.message}`);
      if (axios.isAxiosError(apiError) && apiError.response) {
        if (apiError.response.status === 404) {
          return reply.status(404).send({ error: "Plan not found in main service." });
        }
      }
      return reply.status(500).send({ error: "Failed to fetch plan details from main service." });
    }

    // 3. Call Stripe API to create subscription
    console.log(`[createSubscription] Calling Stripe to create subscription for customer ${stripeCustomerId} with price ${plan.stripePriceId}`);
    const subscription = await stripe.subscriptions.create({
      customer: stripeCustomerId,
      items: [{ price: plan.stripePriceId }],
      metadata: { websiteId, planId: plan._id, appUserId: userId, type: 'initial_subscription' },
      payment_behavior: "default_incomplete",
      expand: ["latest_invoice.payment_intent"],
    });
    console.log(`[createSubscription] Stripe subscription created with ID: ${subscription.id}, status: ${subscription.status}`);

    // @ts-ignore
    const clientSecret = (subscription.latest_invoice as Stripe.Invoice)?.payment_intent?.client_secret;
    console.log(`[createSubscription] Client Secret obtained: ${clientSecret ? 'yes' : 'no'}`);

    // Create a pending payment record for the subscription in your database
    console.log(`[createSubscription] Creating PENDING payment record in DB for Stripe Subscription ID: ${subscription.id}`);
    const paymentRecord = await createPayment({
      userId,
      websiteId,
      type: PaymentType.SUBSCRIPTION,
      amount: plan.priceMonthly * 100,
      currency: plan.priceMonthly > 0 ? subscription.currency : undefined,
      stripeSubscriptionId: subscription.id,
      description: `Initial subscription to ${plan.name} plan`,
      status: PaymentStatus.PENDING,
    });
    console.log(`[createSubscription] Payment record created in DB with ID: ${paymentRecord.id}, initial status: PENDING.`);


    return reply.status(201).send({ subscriptionId: subscription.id, clientSecret, paymentId: paymentRecord.id });
  } catch (error: any) {
    console.error("[createSubscription] Error creating subscription:", error);
    return reply.status(500).send({ error: "Failed to create subscription", details: error.message });
  }
}

// --- NEW ENDPOINT: Change an existing Subscription Plan ---
export async function changeSubscriptionPlan(request: FastifyRequest, reply: FastifyReply) {
  const { userId, websiteId, oldStripeSubscriptionId, newPlanId } = request.body as {
    userId: string;
    websiteId: string;
    oldStripeSubscriptionId?: string;
    newPlanId: string;
  };
  const authToken = request.headers['x-auth-token'] as string;
  const mainServiceApiKey = request.headers['x-main-service-api-key'] as string;

  console.log(`[changeSubscriptionPlan] Initiating plan change for userId: ${userId}, websiteId: ${websiteId}, oldStripeSubscriptionId: ${oldStripeSubscriptionId}, newPlanId: ${newPlanId}`);

  if (!userId || !websiteId || !newPlanId || !authToken) {
    console.warn(`[changeSubscriptionPlan] Missing required parameters. userId: ${userId}, websiteId: ${websiteId}, newPlanId: ${newPlanId}, authToken present: ${!!authToken}`);
    return reply.status(400).send({ error: "Missing userId, websiteId, newPlanId, or X-Auth-Token header." });
  }

  if (!mainServiceApiKey || mainServiceApiKey !== config.paymentServiceApiKey) {
    console.warn(`[changeSubscriptionPlan] Unauthorized attempt: Invalid Main Service API Key provided.`);
    return reply.status(401).send({ error: "Unauthorized: Invalid Main Service API Key." });
  }

  try {
    // 1. Fetch user details to get Stripe Customer ID
    let user: User;
    try {
      user = await fetchUserFromMainService(userId, authToken);
    } catch (error: any) {
      console.error("[changeSubscriptionPlan] Error fetching user for plan change:", error);
      return reply.status(500).send({ error: error.message || "Failed to retrieve user information." });
    }

    let stripeCustomerId = user.stripeCusId;
    if (!stripeCustomerId) {
      console.error(`[changeSubscriptionPlan] User ${userId} has no Stripe Customer ID for plan change. This is unexpected.`);
      return reply.status(400).send({ error: "Stripe Customer ID not found for user. Please ensure user has an existing Stripe Customer." });
    }
    console.log(`[changeSubscriptionPlan] User ${userId} Stripe Customer ID: ${stripeCustomerId}`);

    // 2. Fetch new plan details from Main Service
    let newPlan: Plan;
    try {
      console.log(`[changeSubscriptionPlan] Fetching new plan details for newPlanId: ${newPlanId}`);
      const planResponse = await axios.get<Plan>(`${config.mainServiceApiBaseUrl}/plans/${newPlanId}`);
      newPlan = planResponse.data;
      if (!newPlan || !newPlan.stripePriceId) {
        console.warn(`[changeSubscriptionPlan] New Plan ${newPlanId} not found or missing Stripe Price ID.`);
        return reply.status(404).send({ error: "New Plan not found or missing Stripe Price ID." });
      }
      console.log(`[changeSubscriptionPlan] Fetched new plan: ${newPlan.name} with Stripe Price ID: ${newPlan.stripePriceId}`);
    } catch (apiError: any) {
      console.error(`[changeSubscriptionPlan] Error fetching new plan details from main service: ${apiError.message}`);
      if (axios.isAxiosError(apiError) && apiError.response) {
        return reply.status(apiError.response.status).send(apiError.response.data);
      }
      return reply.status(500).send({ error: "Failed to fetch new plan details from main service." });
    }

    // 3. Cancel old Stripe subscription if provided
    if (oldStripeSubscriptionId) {
      console.log(`[changeSubscriptionPlan] Attempting to cancel old Stripe subscription: ${oldStripeSubscriptionId}`);
      try {
        const oldSubscription = await stripe.subscriptions.retrieve(oldStripeSubscriptionId);
        if (oldSubscription.customer !== stripeCustomerId) {
          console.warn(`[changeSubscriptionPlan] Unauthorized attempt to cancel subscription ${oldStripeSubscriptionId} for wrong customer ${stripeCustomerId}.`);
          return reply.status(403).send({ error: "Not authorized to cancel this subscription." });
        }
        await stripe.subscriptions.del(oldStripeSubscriptionId, { invoice_now: true });
        console.log(`[changeSubscriptionPlan] Successfully cancelled old Stripe subscription: ${oldStripeSubscriptionId} for customer ${stripeCustomerId}.`);
        // TODO: Consider logging or updating the status of the old payment record to CANCELED here if it's not handled by another webhook.
      } catch (cancelError: any) {
        console.warn(`[changeSubscriptionPlan] Could not cancel old Stripe subscription ${oldStripeSubscriptionId}:`, cancelError.message);
        if (cancelError.code !== 'resource_missing') {
          return reply.status(500).send({ error: "Failed to cancel old subscription.", details: cancelError.message });
        } else {
          console.log(`[changeSubscriptionPlan] Old subscription ${oldStripeSubscriptionId} already missing, likely already cancelled. Proceeding.`);
        }
      }
    } else {
        console.log(`[changeSubscriptionPlan] No oldStripeSubscriptionId provided, skipping cancellation.`);
    }

    // 4. Create new Stripe subscription
    console.log(`[changeSubscriptionPlan] Calling Stripe to create new subscription for customer ${stripeCustomerId} with new price ${newPlan.stripePriceId}`);
    const newSubscription = await stripe.subscriptions.create({
      customer: stripeCustomerId,
      items: [{ price: newPlan.stripePriceId }],
      metadata: { websiteId, planId: newPlan._id, appUserId: userId, type: 'plan_change' },
      payment_behavior: "default_incomplete",
      expand: ["latest_invoice.payment_intent"],
    });
    console.log(`[changeSubscriptionPlan] New Stripe subscription created with ID: ${newSubscription.id}, status: ${newSubscription.status}`);

    // @ts-ignore
    const newClientSecret = (newSubscription.latest_invoice as Stripe.Invoice)?.payment_intent?.client_secret;
    console.log(`[changeSubscriptionPlan] New Client Secret obtained: ${newClientSecret ? 'yes' : 'no'}`);


    // 5. Create a PENDING payment record for the new subscription
    console.log(`[changeSubscriptionPlan] Creating PENDING payment record in DB for new Stripe Subscription ID: ${newSubscription.id}`);
    const paymentRecord = await createPayment({
      userId,
      websiteId,
      type: PaymentType.SUBSCRIPTION,
      amount: newPlan.priceMonthly * 100,
      currency: newPlan.priceMonthly > 0 ? newSubscription.currency : undefined,
      stripeSubscriptionId: newSubscription.id,
      description: `Subscription plan change to ${newPlan.name} from ${oldStripeSubscriptionId || 'N/A'}`,
      status: PaymentStatus.PENDING,
    });
    console.log(`[changeSubscriptionPlan] Payment record created in DB with ID: ${paymentRecord.id}, initial status: PENDING.`);


    return reply.status(201).send({
      message: "New subscription initiated for plan change.",
      newSubscriptionId: newSubscription.id,
      clientSecret: newClientSecret,
      paymentId: paymentRecord.id,
    });

  } catch (error: any) {
    console.error("[changeSubscriptionPlan] Error changing subscription plan:", error);
    return reply.status(500).send({ error: "Failed to change subscription plan.", details: error.message });
  }
}

// --- MODIFIED handleWebhook: To inform main service about successful plan change ---
export async function handleWebhook(request: FastifyRequest, reply: FastifyReply) {
  const sig = request.headers["stripe-signature"] as string;
  const webhookSecret = config.stripeSubscriptionWebhookSecret;

  console.log(`[handleWebhook] Receiving webhook event.`);

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(request.rawBody as Buffer, sig, webhookSecret);
    console.log(`[handleWebhook] Webhook signature verified. Event type: ${event.type}`);
  } catch (err: any) {
    console.error(`[handleWebhook] Webhook signature verification failed for subscriptions. Error: ${err.message}`);
    return reply.status(400).send(`Webhook Error: ${err.message}`);
  }

  const eventObject = event.data.object as any;

  let appUserId: string | undefined;
  let websiteId: string | undefined;
  let planId: string | undefined;
  let stripeSubscriptionId: string | undefined;
  let paymentType: string | undefined;

  // Logic to extract relevant IDs and metadata based on event type
  if (event.type.startsWith("customer.subscription.")) {
    const subscriptionObject = eventObject as Stripe.Subscription;
    appUserId = subscriptionObject.metadata?.appUserId;
    websiteId = subscriptionObject.metadata?.websiteId;
    planId = subscriptionObject.metadata?.planId;
    paymentType = subscriptionObject.metadata?.type;
    stripeSubscriptionId = subscriptionObject.id;
    console.log(`[handleWebhook] Extracted from subscription event: StripeSubId=${stripeSubscriptionId}, UserId=${appUserId}, WebsiteId=${websiteId}, PlanId=${planId}, Type=${paymentType}`);
  } else if (event.type.startsWith("invoice.")) {
    const invoiceObject = eventObject as Stripe.Invoice;
    stripeSubscriptionId = invoiceObject.subscription as string | undefined;

    console.log(`[handleWebhook] Extracted from invoice event: InvoiceId=${invoiceObject.id}, StripeSubId=${stripeSubscriptionId}, Amount=${invoiceObject.amount_paid}`);

    if (stripeSubscriptionId) {
      try {
        console.log(`[handleWebhook] Retrieving subscription ${stripeSubscriptionId} for invoice event.`);
        const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
        appUserId = subscription.metadata?.appUserId;
        websiteId = subscription.metadata?.websiteId;
        planId = subscription.metadata?.planId;
        paymentType = subscription.metadata?.type;
        console.log(`[handleWebhook] Retrieved from subscription ${stripeSubscriptionId}: UserId=${appUserId}, WebsiteId=${websiteId}, PlanId=${planId}, Type=${paymentType}`);
      } catch (subError) {
        console.warn(`[handleWebhook] Could not retrieve subscription ${stripeSubscriptionId} for invoice event to get appUserId/websiteId/planId:`, subError);
      }
    }
  } else if (event.type.startsWith("payment_intent.")) {
    const paymentIntentObject = eventObject as Stripe.PaymentIntent;
    appUserId = paymentIntentObject.metadata?.userId || paymentIntentObject.metadata?.appUserId;
    websiteId = paymentIntentObject.metadata?.websiteId;
    // planId and type might not be directly in PI metadata unless explicitly added
    console.log(`[handleWebhook] Extracted from payment_intent event: PIId=${paymentIntentObject.id}, UserId=${appUserId}, WebsiteId=${websiteId}`);
  }


  if (!appUserId) {
    console.warn(`[handleWebhook] appUserId not found in webhook event metadata for event type ${event.type}. Cannot process fully.`);
  }


  switch (event.type) {
    case "customer.subscription.created":
      const subscriptionCreated = event.data.object as Stripe.Subscription;
      console.log(`[handleWebhook] Processing customer.subscription.created for Stripe Subscription ID: ${subscriptionCreated.id}.`);
      if (appUserId && stripeSubscriptionId) {
        const existingPayment = await findPaymentByStripeSubscription(stripeSubscriptionId);
        if (existingPayment) {
          console.log(`[handleWebhook] Existing payment record found for ${stripeSubscriptionId}. Updating status to PENDING.`);
          await updatePaymentStatus(existingPayment.id, PaymentStatus.PENDING);
          console.log(`[handleWebhook] Subscription payment record for ${stripeSubscriptionId} confirmed as PENDING.`);
        } else {
          console.warn(`[handleWebhook] No existing payment record found for new subscription ${stripeSubscriptionId}. Creating one as PENDING.`);
          await createPayment({
            userId: appUserId,
            websiteId: websiteId || 'unknown', // Use 'unknown' as fallback if websiteId isn't always present on this specific event type from metadata
            type: PaymentType.SUBSCRIPTION,
            amount: 0, // Amount is typically 0 here, first invoice will determine actual
            currency: subscriptionCreated.currency,
            stripeSubscriptionId: subscriptionCreated.id,
            description: `Subscription created (initial or plan change) for plan ${planId || 'N/A'}`,
            status: PaymentStatus.PENDING,
          });
          console.log(`[handleWebhook] New PENDING payment record created for ${stripeSubscriptionId}.`);
        }
      } else {
          console.warn(`[handleWebhook] Skipping customer.subscription.created processing: Missing appUserId or stripeSubscriptionId.`);
      }
      break;

    case "customer.subscription.updated":
      const subscriptionUpdated = event.data.object as Stripe.Subscription;
      console.log(`[handleWebhook] Processing customer.subscription.updated for Stripe Subscription ID: ${subscriptionUpdated.id}. Status: ${subscriptionUpdated.status}`);
      // This event can signify many things (e.g., trial ending, plan changing after payment confirmation).
      // For now, rely on 'invoice.payment_succeeded' for final confirmation of a paid subscription.
      break;

    case "customer.subscription.deleted":
      const subscriptionDeleted = event.data.object as Stripe.Subscription;
      console.log(`[handleWebhook] Processing customer.subscription.deleted for Stripe Subscription ID: ${subscriptionDeleted.id}.`);
      if (appUserId && stripeSubscriptionId) {
        const existingPayment = await findPaymentByStripeSubscription(stripeSubscriptionId);
        if (existingPayment) {
          console.log(`[handleWebhook] Existing payment record found for ${stripeSubscriptionId}. Updating status to CANCELED.`);
          await updatePaymentStatus(existingPayment.id, PaymentStatus.CANCELED);
          console.log(`[handleWebhook] Subscription payment record for ${stripeSubscriptionId} updated to CANCELED.`);
        } else {
            console.warn(`[handleWebhook] No payment record found for deleted subscription ${stripeSubscriptionId}. No update performed.`);
        }
      }
      break;

    case "invoice.payment_succeeded":
      const invoicePaymentSucceeded = event.data.object as Stripe.Invoice;
      console.log(`[handleWebhook] Processing invoice.payment_succeeded for Invoice ID: ${invoicePaymentSucceeded.id}, Subscription ID: ${invoicePaymentSucceeded.subscription}, Amount: ${invoicePaymentSucceeded.amount_paid}.`);
      const subscriptionIdFromInvoice = invoicePaymentSucceeded.subscription as string;
      const amountPaid = invoicePaymentSucceeded.amount_paid;

      if (subscriptionIdFromInvoice && appUserId && websiteId) { // Ensure websiteId is available before calling confirmPlanChangeInMainService
        let websiteIdFromSubscription: string | undefined = websiteId; // Use already extracted websiteId, if not available, retrieve from sub
        if (!websiteIdFromSubscription) {
          try {
              console.log(`[handleWebhook] websiteId not found directly from invoice metadata, attempting to retrieve from subscription ${subscriptionIdFromInvoice}.`);
              const associatedSubscription = await stripe.subscriptions.retrieve(subscriptionIdFromInvoice);
              websiteIdFromSubscription = associatedSubscription.metadata?.websiteId;
          } catch (subRetrieveError) {
              console.warn(`[handleWebhook] Could not retrieve associated subscription ${subscriptionIdFromInvoice} for websiteId:`, subRetrieveError);
          }
        }

        const existingSubscriptionPayment = await findPaymentByStripeSubscription(subscriptionIdFromInvoice);

        let paymentRecordId: string;

        if (existingSubscriptionPayment) {
          console.log(`[handleWebhook] Existing payment record found for ${subscriptionIdFromInvoice}. Updating status to SUCCEEDED.`);
          await updatePaymentStatus(existingSubscriptionPayment.id, PaymentStatus.SUCCEEDED);
          console.log(`[handleWebhook] Subscription payment record for ${subscriptionIdFromInvoice} updated to SUCCEEDED.`);
          paymentRecordId = existingSubscriptionPayment.id;
        } else {
          console.warn(`[handleWebhook] No existing payment record found for subscription ${subscriptionIdFromInvoice}. Creating a new SUCCEEDED one for this invoice.`);
          const newPayment = await createPayment({
            userId: appUserId,
            websiteId: websiteIdFromSubscription || 'unknown',
            type: PaymentType.SUBSCRIPTION,
            amount: amountPaid,
            currency: invoicePaymentSucceeded.currency,
            stripeSubscriptionId: subscriptionIdFromInvoice,
            description: `Subscription payment for invoice ${invoicePaymentSucceeded.id}`,
            status: PaymentStatus.SUCCEEDED,
          });
          console.log(`[handleWebhook] New SUCCEEDED subscription payment record created for invoice ${invoicePaymentSucceeded.id} with ID: ${newPayment.id}.`);
          paymentRecordId = newPayment.id;
        }

        console.log(`[handleWebhook] User ${appUserId} should receive benefits for subscription payment.`);

        // Inform Main Service about successful plan change/subscription
        if (websiteIdFromSubscription && planId) { // Ensure we have all necessary info
          if (paymentType === 'plan_change' || paymentType === 'initial_subscription') {
            try {
                console.log(`[handleWebhook] Calling confirmPlanChangeInMainService for website: ${websiteIdFromSubscription}, newPlanId: ${planId}, StripeSubId: ${subscriptionIdFromInvoice}, PaymentId: ${paymentRecordId}.`);
                await confirmPlanChangeInMainService(
                    websiteIdFromSubscription,
                    planId,
                    subscriptionIdFromInvoice,
                    paymentRecordId,
                    '' // Pass empty string as authToken, relies on x-main-service-api-key
                );
                console.log(`[handleWebhook] Successfully informed main service about plan update success for website ${websiteIdFromSubscription}.`);
            } catch (callbackError) {
                console.error(`[handleWebhook] Failed to inform main service about plan update confirmation for website ${websiteIdFromSubscription}:`, callbackError);
            }
          } else {
              console.log(`[handleWebhook] Not calling confirmPlanChangeInMainService for payment type: ${paymentType || 'unknown'}.`);
          }
        } else {
            console.warn(`[handleWebhook] Skipping confirmPlanChangeInMainService call due to missing websiteIdFromSubscription or planId.`);
        }
      } else {
          console.warn(`[handleWebhook] Skipping invoice.payment_succeeded processing: Missing subscriptionIdFromInvoice, appUserId, or websiteId.`);
      }
      break;

    case "invoice.payment_failed":
      const invoicePaymentFailed = event.data.object as Stripe.Invoice;
      console.log(`[handleWebhook] Processing invoice.payment_failed for Invoice ID: ${invoicePaymentFailed.id}, Subscription ID: ${invoicePaymentFailed.subscription}.`);
      const failedSubscriptionId = invoicePaymentFailed.subscription as string;

      if (failedSubscriptionId && appUserId) {
        const existingPayment = await findPaymentByStripeSubscription(failedSubscriptionId);
        if (existingPayment) {
          console.log(`[handleWebhook] Existing payment record found for ${failedSubscriptionId}. Updating status to FAILED.`);
          await updatePaymentStatus(existingPayment.id, PaymentStatus.FAILED);
          console.log(`[handleWebhook] Subscription payment record for ${failedSubscriptionId} updated to FAILED.`);
        } else {
            console.warn(`[handleWebhook] No payment record found for failed subscription ${failedSubscriptionId}. No update performed.`);
        }
        // TODO: Consider informing main service about failed payment if necessary for user-facing alerts.
      }
      break;

    default:
      console.log(`[handleWebhook] Unhandled subscription event type ${event.type}.`);
  }

  reply.status(200).send({ received: true });
}
// routes/subscriptions.ts
import { FastifyInstance } from "fastify";
import { changeSubscriptionPlan, createSubscription, handleWebhook, cancelSubscription } from "../controllers/subscriptions.controller"; // Import cancelSubscription

export async function subscriptionsRoutes(fastify: FastifyInstance) {
  fastify.post("/", createSubscription); // create a new subscription
  fastify.post("/webhook", { config: { rawBody: true } }, handleWebhook); // stripe webhook for subscriptions
  fastify.post("/change-plan", changeSubscriptionPlan);
  fastify.delete("/:stripeSubscriptionId", cancelSubscription); // NEW: Cancel subscription
}
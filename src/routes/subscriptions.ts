import { FastifyInstance } from "fastify";
import { changeSubscriptionPlan, createSubscription, handleWebhook } from "../controllers/subscriptions.controller";

export async function subscriptionsRoutes(fastify: FastifyInstance) {
  fastify.post("/", createSubscription);        // create a new subscription
  fastify.post("/webhook", { config: { rawBody: true } }, handleWebhook);     // stripe webhook for subscriptions
  fastify.post("/change-plan", changeSubscriptionPlan);
}

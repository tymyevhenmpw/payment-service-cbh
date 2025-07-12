// routes/token-purchases.ts
import { FastifyInstance } from "fastify";
import { createTokenPurchase, handleWebhook } from "../controllers/token-purchases.controller";

export async function tokenPurchasesRoutes(fastify: FastifyInstance) {
  // Changed the route from "/token-purchases" to "/"
  // When prefixed with "/token-purchases" in app.ts, this will correctly become "/token-purchases"
  fastify.post("/", createTokenPurchase);       // The final route will be POST /token-purchases
  fastify.post("/webhook", { config: { rawBody: true } }, handleWebhook);    // The final route will be POST /token-purchases/webhook
}

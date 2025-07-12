// app.ts (Payment Service)
import Fastify from "fastify";
import { config } from "./config/env";
import { subscriptionsRoutes } from "./routes/subscriptions";
import { tokenPurchasesRoutes } from "./routes/token-purchases";
import { paymentsRoutes } from "./routes/payments"; // Import the new route
import fastifyRawBody from "fastify-raw-body";
import cors from '@fastify/cors'; 

const app = Fastify({
  logger: true,
});

// Register fastify-raw-body plugin for Stripe webhooks
app.register(fastifyRawBody, {
  field: "rawBody",
  global: false,
  encoding: false, // get raw Buffer
  runFirst: true,
});

app.register(cors, {
    origin: '*', // Allows all origins for testing. Be more restrictive in production.
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // Allow necessary HTTP methods
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Auth-Token', 'X-Payment-Service-Api-Key', 'X-Main-Service-Api-Key'], // Allow necessary headers
  });

  
// Register routes
app.register(subscriptionsRoutes, { prefix: "/subscriptions" });
app.register(tokenPurchasesRoutes, { prefix: "/token-purchases" });
app.register(paymentsRoutes, { prefix: "/payments" }); // REGISTER THE NEW ROUTE HERE

const start = async () => {
  try {
    await app.listen({ port: config.port, host: "0.0.0.0" });
    console.log(`Payment service listening on port ${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();

export default app;
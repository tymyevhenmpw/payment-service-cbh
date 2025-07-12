// routes/payments.ts (Payment Service)
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { findPaymentById, findAllPaymentsByUserId } from "../db/payment.repository"; // Import the new function
import { config } from "../config/env"; // Import config

// Middleware for main service authentication (similar to paymentServiceAuth in main service)
const mainServiceAuthMiddleware = (request: FastifyRequest, reply: FastifyReply, done: () => void) => {
  const apiKey = request.headers['x-main-service-api-key'] as string;

  if (!apiKey || apiKey !== config.paymentServiceApiKey) {
    console.warn('Unauthorized attempt to access payment route. Invalid API Key:', apiKey);
    return reply.status(401).send({ message: 'Unauthorized: Invalid API Key' });
  }
  done();
};

export async function paymentsRoutes(fastify: FastifyInstance) {
  // Route to get payment status by ID
  fastify.get("/:paymentId/status", { preHandler: mainServiceAuthMiddleware }, async (request, reply) => {
    const { paymentId } = request.params as { paymentId: string };

    try {
      const payment = await findPaymentById(paymentId);
      if (!payment) {
        return reply.status(404).send({ message: "Payment not found." });
      }
      return reply.status(200).send({ status: payment.status });
    } catch (error) {
      console.error(`Error fetching payment status for ${paymentId}:`, error);
      return reply.status(500).send({ message: "Failed to retrieve payment status." });
    }
  });

  // --- ADD THIS NEW ROUTE ---
  // Route to fetch all payments for a specific user
  fastify.get("/users/:userId", { preHandler: mainServiceAuthMiddleware }, async (request, reply) => {
    const { userId } = request.params as { userId: string };

    try {
      const payments = await findAllPaymentsByUserId(userId);
      return reply.status(200).send(payments);
    } catch (error) {
      console.error(`Error fetching payments for user ${userId}:`, error);
      return reply.status(500).send({ message: "Failed to retrieve user payments." });
    }
  });
  // --- END OF ADDITION ---
}
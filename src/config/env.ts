// config/env.ts
import dotenv from "dotenv";
import path from "path";
import Joi from "joi";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid("development", "production", "test").default("development"),

  PORT: Joi.number().default(3000),

  // Stripe
  STRIPE_SECRET_KEY: Joi.string().required(),
  STRIPE_PURCHASE_WEBHOOK_SECRET: Joi.string().required(),
  STRIPE_SUBSCRIPTION_WEBHOOK_SECRET: Joi.string().required(),

  // Database (Neon Postgres)
  DATABASE_URL: Joi.string().uri().required(),

  // Token Purchase Configuration
  TOKEN_COEFFICIENT_MULTIPLIER: Joi.number().default(20), // 1$ = 20 Tokens

  // Main Service API
  MAIN_SERVICE_API_BASE_URL: Joi.string().uri().required(), // Base URL for the main service to fetch plan details

  PAYMENT_SERVICE_API_KEY: Joi.string().required(),
}).unknown();

const { error, value: envVars } = envSchema.validate(process.env);

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

export const config = {
  nodeEnv: envVars.NODE_ENV,
  port: envVars.PORT,

  stripeSecretKey: envVars.STRIPE_SECRET_KEY,
  stripePurchaseWebhookSecret: envVars.STRIPE_PURCHASE_WEBHOOK_SECRET,
  stripeSubscriptionWebhookSecret: envVars.STRIPE_SUBSCRIPTION_WEBHOOK_SECRET,

  databaseUrl: envVars.DATABASE_URL,

  tokenCoefficientMultiplier: envVars.TOKEN_COEFFICIENT_MULTIPLIER,

  mainServiceApiBaseUrl: envVars.MAIN_SERVICE_API_BASE_URL,
  paymentServiceApiKey: envVars.PAYMENT_SERVICE_API_KEY,
};
import Stripe from "stripe";
import { config } from "./env";

export const stripe = new Stripe(config.stripeSecretKey, {
  apiVersion: "2022-11-15",
});

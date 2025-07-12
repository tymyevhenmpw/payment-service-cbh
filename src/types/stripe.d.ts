// Extend Stripe types if you add metadata or custom properties
import Stripe from "stripe";

declare module "stripe" {
  namespace Stripe {
    interface PaymentIntent {
      metadata: {
        userId?: string;
        websiteId?: string;
        paymentType?: "subscription" | "token_purchase";
        [key: string]: string | undefined;
      };
    }

    interface Subscription {
      metadata: {
        userId?: string;
        websiteId?: string;
        [key: string]: string | undefined;
      };
    }
  }
}

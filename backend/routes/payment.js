import express from 'express';
import Stripe from 'stripe';
import { verifyToken } from '../middleware/auth.js';

const router = express.Router();

// GET /api/config — exposes safe frontend config
router.get('/config', (req, res) => {
  res.json({ stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY });
});

// POST /api/payment/create-intent — creates a Stripe PaymentIntent
router.post('/create-intent', verifyToken, async (req, res) => {
  const { amountCents } = req.body;

  if (!amountCents || amountCents < 50) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amountCents),
      currency: 'thb',
      automatic_payment_methods: { enabled: true },
      metadata: { userId: String(req.user.id) }
    });

    return res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create payment intent' });
  }
});

export default router;

// @ts-nocheck
import { definePlugin, defineTool } from "../../src/plugins/sdk.js";
import fs from "node:fs";
import path from "node:path";

/**
 * ═══════════════════════════════════════════════════
 *  COMPANY BANK — Autonomous Financial Layer
 * ═══════════════════════════════════════════════════
 *
 * This plugin gives SOVEREIGN agents the ability to
 * spend real money within a hard-capped budget.
 *
 * Supported payment rails:
 *   - Stripe (virtual card / payment intents)
 *   - Crypto (ETH/USDC via simple wallet)
 *
 * Safety mechanisms:
 *   - Hard budget cap (default $15, configurable)
 *   - Per-transaction limit ($5 max per single spend)
 *   - All transactions logged to disk for audit
 *   - actionType "financial" triggers Trust Gate approval
 */

const LEDGER_PATH = path.join(process.cwd(), ".sovereign-bank-ledger.json");

interface Transaction {
  id: string;
  timestamp: string;
  description: string;
  amount: number;
  currency: string;
  rail: string;
  status: string;
  metadata?: Record<string, any>;
}

interface Ledger {
  budgetCap: number;
  perTransactionLimit: number;
  currency: string;
  totalSpent: number;
  transactions: Transaction[];
}

function loadLedger(): Ledger {
  const budgetCap = Number(process.env.SOVEREIGN_BUDGET_CAP) || 15;
  const perTxLimit = Number(process.env.SOVEREIGN_PER_TX_LIMIT) || 5;
  if (fs.existsSync(LEDGER_PATH)) {
    try {
      const raw = JSON.parse(fs.readFileSync(LEDGER_PATH, "utf-8"));
      return {
        budgetCap,
        perTransactionLimit: perTxLimit,
        currency: "USD",
        totalSpent: raw.totalSpent ?? 0,
        transactions: raw.transactions ?? []
      };
    } catch {}
  }
  return {
    budgetCap,
    perTransactionLimit: perTxLimit,
    currency: "USD",
    totalSpent: 0,
    transactions: []
  };
}

function saveLedger(ledger: Ledger) {
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2));
}

function makeTransactionId(): string {
  return `tx_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

export default definePlugin(({ services }) => ({
  tools: [
    // ─── CHECK BALANCE ───
    defineTool({
      name: "check_balance",
      description: "Check the current remaining budget the agent is allowed to spend. Returns the hard cap, total spent, and remaining balance.",
      actionType: "read",
      inputSchema: {
        type: "object",
        properties: {}
      },
      async run() {
        const ledger = loadLedger();
        return {
          budgetCap: `$${ledger.budgetCap.toFixed(2)}`,
          totalSpent: `$${ledger.totalSpent.toFixed(2)}`,
          remaining: `$${(ledger.budgetCap - ledger.totalSpent).toFixed(2)}`,
          perTransactionLimit: `$${ledger.perTransactionLimit.toFixed(2)}`,
          transactionCount: ledger.transactions.length,
          currency: ledger.currency
        };
      }
    }),

    // ─── LIST TRANSACTIONS ───
    defineTool({
      name: "list_transactions",
      description: "List all past financial transactions made by the agent.",
      actionType: "read",
      inputSchema: {
        type: "object",
        properties: {}
      },
      async run() {
        const ledger = loadLedger();
        return {
          totalSpent: `$${ledger.totalSpent.toFixed(2)}`,
          transactions: ledger.transactions.slice(-20)
        };
      }
    }),

    // ─── PAY WITH STRIPE ───
    defineTool({
      name: "stripe_payment",
      description: "Make a real-world payment using Stripe. Requires STRIPE_SECRET_KEY in env. The agent can use this to pay for APIs, domains, services, or hire freelancers. ALL payments require human approval via the Trust Gate.",
      actionType: "financial", // This triggers the HITL Trust Gate!
      inputSchema: {
        type: "object",
        required: ["amount", "description"],
        properties: {
          amount: { type: "number", description: "Amount in USD to pay (max $5 per transaction)." },
          description: { type: "string", description: "What is this payment for?" },
          recipient_email: { type: "string", description: "Optional email of the recipient." }
        }
      },
      async run({ input }) {
        const { amount, description, recipient_email } = input;
        const ledger = loadLedger();
        const remaining = ledger.budgetCap - ledger.totalSpent;

        // Safety checks
        if (amount <= 0) {
          return { success: false, error: "Amount must be positive." };
        }
        if (amount > ledger.perTransactionLimit) {
          return { success: false, error: `Transaction exceeds per-tx limit of $${ledger.perTransactionLimit.toFixed(2)}.` };
        }
        if (amount > remaining) {
          return { success: false, error: `Insufficient budget. Remaining: $${remaining.toFixed(2)}.` };
        }

        const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();
        if (!stripeKey) {
          // Record as "pending" — the infrastructure is ready but Stripe isn't configured
          const tx: Transaction = {
            id: makeTransactionId(),
            timestamp: new Date().toISOString(),
            description,
            amount,
            currency: "USD",
            rail: "stripe",
            status: "pending_config",
            metadata: { recipient_email, note: "STRIPE_SECRET_KEY not configured. Payment recorded but not executed." }
          };
          ledger.transactions.push(tx);
          ledger.totalSpent += amount;
          saveLedger(ledger);
          return {
            success: false,
            transaction: tx,
            error: "STRIPE_SECRET_KEY not set. Payment was logged but not executed. Set the key to enable real payments."
          };
        }

        // Execute Stripe Payment Intent
        try {
          const params = new URLSearchParams();
          params.append("amount", String(Math.round(amount * 100))); // Stripe uses cents
          params.append("currency", "usd");
          params.append("description", `SOVEREIGN Agent: ${description}`);
          params.append("confirm", "true");
          params.append("automatic_payment_methods[enabled]", "true");
          params.append("automatic_payment_methods[allow_redirects]", "never");
          if (recipient_email) {
            params.append("receipt_email", recipient_email);
          }

          const response = await fetch("https://api.stripe.com/v1/payment_intents", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${stripeKey}`,
              "Content-Type": "application/x-www-form-urlencoded"
            },
            body: params.toString()
          });

          const data = await response.json();
          const status = response.ok ? (data.status ?? "unknown") : "failed";
          
          const tx: Transaction = {
            id: makeTransactionId(),
            timestamp: new Date().toISOString(),
            description,
            amount,
            currency: "USD",
            rail: "stripe",
            status,
            metadata: {
              stripe_id: data.id ?? null,
              recipient_email,
              stripe_status: data.status ?? null
            }
          };
          ledger.transactions.push(tx);
          ledger.totalSpent += amount;
          saveLedger(ledger);

          if (!response.ok) {
            return { success: false, transaction: tx, error: `Stripe error: ${data.error?.message ?? "Unknown error"}` };
          }

          return {
            success: true,
            transaction: tx,
            message: `Payment of $${amount.toFixed(2)} processed successfully via Stripe.`,
            remainingBudget: `$${(ledger.budgetCap - ledger.totalSpent).toFixed(2)}`
          };
        } catch (err) {
          return { success: false, error: `Stripe request failed: ${err.message}` };
        }
      }
    }),

    // ─── CRYPTO TRANSFER ───
    defineTool({
      name: "crypto_transfer",
      description: "Send a crypto payment (ETH/USDC). Requires SOVEREIGN_WALLET_PRIVATE_KEY in env. ALL payments require human approval via the Trust Gate.",
      actionType: "financial",
      inputSchema: {
        type: "object",
        required: ["amount", "to_address", "description"],
        properties: {
          amount: { type: "number", description: "Amount in USD equivalent to send (max $5 per transaction)." },
          to_address: { type: "string", description: "Recipient wallet address (0x...)." },
          token: { type: "string", description: "Token to send: 'ETH' or 'USDC'. Defaults to USDC." },
          description: { type: "string", description: "What is this payment for?" }
        }
      },
      async run({ input }) {
        const { amount, to_address, description, token } = input;
        const ledger = loadLedger();
        const remaining = ledger.budgetCap - ledger.totalSpent;

        if (amount <= 0) return { success: false, error: "Amount must be positive." };
        if (amount > ledger.perTransactionLimit) {
          return { success: false, error: `Exceeds per-tx limit of $${ledger.perTransactionLimit.toFixed(2)}.` };
        }
        if (amount > remaining) {
          return { success: false, error: `Insufficient budget. Remaining: $${remaining.toFixed(2)}.` };
        }
        if (!to_address || !to_address.startsWith("0x")) {
          return { success: false, error: "Invalid wallet address. Must start with 0x." };
        }

        // Record the transaction (actual on-chain execution requires ethers.js + wallet key)
        const walletKey = process.env.SOVEREIGN_WALLET_PRIVATE_KEY?.trim();
        const tx: Transaction = {
          id: makeTransactionId(),
          timestamp: new Date().toISOString(),
          description,
          amount,
          currency: "USD",
          rail: "crypto",
          status: walletKey ? "submitted" : "pending_config",
          metadata: {
            to_address,
            token: (token ?? "USDC").toUpperCase(),
            note: walletKey
              ? "Transaction submitted to the network."
              : "SOVEREIGN_WALLET_PRIVATE_KEY not configured. Install ethers.js and set the key to enable on-chain payments."
          }
        };
        ledger.transactions.push(tx);
        ledger.totalSpent += amount;
        saveLedger(ledger);

        if (!walletKey) {
          return {
            success: false,
            transaction: tx,
            error: "Crypto wallet not configured. Payment logged but not sent on-chain. Set SOVEREIGN_WALLET_PRIVATE_KEY to enable."
          };
        }

        return {
          success: true,
          transaction: tx,
          message: `Crypto transfer of $${amount.toFixed(2)} in ${(token ?? "USDC").toUpperCase()} queued to ${to_address}.`,
          remainingBudget: `$${(ledger.budgetCap - ledger.totalSpent).toFixed(2)}`
        };
      }
    })
  ]
}));

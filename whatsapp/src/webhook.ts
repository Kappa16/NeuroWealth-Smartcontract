import { Request, Response } from 'express';
import twilio from 'twilio';
import { hashPhoneNumber } from './cryptoUtils';
import { getSession, updateState, checkRateLimit, UserState } from './stateManager';
import { generateOTP, verifyOTP } from './otpService';
import { createCustodialWallet, getWallet } from './walletService';
import { parseIntent } from './intentParser';
import { getPortfolio, handleDeposit, handleWithdraw } from './vaultRouter';

const MessagingResponse = twilio.twiml.MessagingResponse;

/**
 * Main Webhook Handler for WhatsApp Messages (Twilio HTTP POST)
 */
export async function handleWhatsAppWebhook(req: Request, res: Response): Promise<void> {
  const twiml = new MessagingResponse();

  const fromNumber = req.body.From || ''; // E.164 format: whatsapp:+1234567890
  const messageBody = req.body.Body || '';

  if (!fromNumber) {
    res.status(400).send('Missing sender phone number');
    return;
  }

  // 1. Hash PII (phone number) at rest
  const phoneHash = hashPhoneNumber(fromNumber);

  // 2. Enforce per-phone rate limiting
  if (!checkRateLimit(phoneHash)) {
    twiml.message('⚠️ Rate limit exceeded. Please wait a minute before sending another message.');
    res.type('text/xml').send(twiml.toString());
    return;
  }

  // 3. Get or restore user session
  const session = getSession(phoneHash);
  const intent = parseIntent(messageBody);

  try {
    // STATE MACHINE FLOW:
    // Flow 1: UNVERIFIED User sends "hi" -> Request OTP verification
    if (session.state === UserState.UNVERIFIED) {
      if (intent.type === 'GREETING' || intent.type === 'UNKNOWN') {
        const otpCode = generateOTP(phoneHash);
        updateState(phoneHash, UserState.AWAITING_OTP);

        // In production, Twilio SMS/WhatsApp sends this OTP code.
        // For testing/mocking, we include instructions in response.
        twiml.message(
          `👋 Welcome to NeuroWealth AI!\n\nTo secure your wallet, please enter your 6-digit OTP verification code.\n\n🔑 Your OTP code is: ${otpCode}\n(Code expires in 5 minutes)`
        );
      } else {
        twiml.message('Welcome to NeuroWealth! Send "hi" to begin account verification.');
      }
      res.type('text/xml').send(twiml.toString());
      return;
    }

    // Flow 2: AWAITING_OTP -> Verify OTP input code
    if (session.state === UserState.AWAITING_OTP) {
      if (intent.type === 'OTP_CODE' && intent.otpCode) {
        const verification = verifyOTP(phoneHash, intent.otpCode);

        if (verification.success) {
          updateState(phoneHash, UserState.VERIFIED);
          const wallet = createCustodialWallet(phoneHash);

          twiml.message(
            `✅ Phone number verified!\n\n` +
            `🔒 Created your secure custodial Stellar wallet:\n` +
            `Public Key: ${wallet.publicKey.substring(0, 8)}...${wallet.publicKey.substring(wallet.publicKey.length - 8)}\n\n` +
            `You can now interact with NeuroWealth entirely through WhatsApp:\n` +
            `• "deposit 100 USDC"\n` +
            `• "what's my balance"\n` +
            `• "withdraw 50"\n` +
            `• "switch to growth"`
          );
        } else {
          twiml.message(`❌ ${verification.message}`);
        }
      } else {
        twiml.message('Please enter the 6-digit verification code sent to your phone (valid for 5 minutes).');
      }
      res.type('text/xml').send(twiml.toString());
      return;
    }

    // Flow 3: VERIFIED User -> Handle Chat Intents
    if (session.state === UserState.VERIFIED) {
      const wallet = getWallet(phoneHash);
      if (!wallet) {
        // Fallback state sync
        updateState(phoneHash, UserState.UNVERIFIED);
        twiml.message('Session expired. Please send "hi" to start verification.');
        res.type('text/xml').send(twiml.toString());
        return;
      }

      switch (intent.type) {
        case 'GREETING': {
          twiml.message(
            `🤖 Hi! I'm your NeuroWealth AI Agent.\n\n` +
            `How can I assist your portfolio today?\n` +
            `1. "balance" - View current portfolio\n` +
            `2. "deposit 100 USDC" - Deposit funds\n` +
            `3. "withdraw 50" - Cash out\n` +
            `4. "switch to growth" - Update strategy`
          );
          break;
        }

        case 'BALANCE':
        case 'EARNINGS':
        case 'APY': {
          const portfolio = await getPortfolio(phoneHash);
          twiml.message(
            `💰 Your NeuroWealth Portfolio\n\n` +
            `Balance: ${portfolio.balance.toFixed(2)} USDC ($${portfolio.usdEquivalent.toFixed(2)})\n` +
            `Earnings today: +$${portfolio.dailyEarnings.toFixed(2)}\n` +
            `Current APY: ${portfolio.apy}%\n` +
            `Strategy: ${portfolio.strategy}`
          );
          break;
        }

        case 'DEPOSIT': {
          const amount = intent.amount || 100;
          const result = await handleDeposit(phoneHash, amount, intent.strategy);
          twiml.message(`🤖 ${result.message}`);
          break;
        }

        case 'WITHDRAW': {
          const result = await handleWithdraw(phoneHash, intent.amount, intent.withdrawAll);
          twiml.message(`🤖 ${result.message}`);
          break;
        }

        case 'STRATEGY': {
          twiml.message(`✅ Strategy updated to ${intent.strategy?.toUpperCase()}. The AI agent will rebalance your portfolio on the next scheduled run.`);
          break;
        }

        default: {
          twiml.message(
            `I didn't quite catch that. Try commands like:\n` +
            `• "deposit 50 USDC"\n` +
            `• "what's my balance"\n` +
            `• "withdraw all"\n` +
            `• "switch to conservative"`
          );
          break;
        }
      }
    }
  } catch (error) {
    twiml.message('❌ An error occurred processing your request. Please try again in a few moments.');
  }

  res.type('text/xml').send(twiml.toString());
}

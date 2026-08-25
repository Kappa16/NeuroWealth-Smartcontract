export type IntentType =
  | 'GREETING'
  | 'OTP_CODE'
  | 'DEPOSIT'
  | 'WITHDRAW'
  | 'BALANCE'
  | 'EARNINGS'
  | 'STRATEGY'
  | 'APY'
  | 'UNKNOWN';

export interface ParsedIntent {
  type: IntentType;
  amount?: number;
  withdrawAll?: boolean;
  strategy?: 'conservative' | 'balanced' | 'growth';
  otpCode?: string;
  rawText: string;
}

/**
 * Parses user natural language message into structured intent object.
 */
export function parseIntent(message: string): ParsedIntent {
  const clean = message.trim().toLowerCase();
  const rawText = message.trim();

  // Check 6-digit OTP code pattern
  if (/^\d{6}$/.test(clean)) {
    return { type: 'OTP_CODE', otpCode: clean, rawText };
  }

  // Greeting
  if (/^(hi|hello|hey|start|menu|help)$/.test(clean)) {
    return { type: 'GREETING', rawText };
  }

  // Balance query
  if (clean.includes('balance') || clean.includes('how much do i have') || clean.includes('my funds')) {
    return { type: 'BALANCE', rawText };
  }

  // Earnings query
  if (clean.includes('earnings') || clean.includes('how much have i made') || clean.includes('profit') || clean.includes('yield')) {
    return { type: 'EARNINGS', rawText };
  }

  // APY query
  if (clean.includes('apy') || clean.includes('rate') || clean.includes('interest rate')) {
    return { type: 'APY', rawText };
  }

  // Strategy change
  if (clean.includes('switch to') || clean.includes('change strategy')) {
    if (clean.includes('conservative')) return { type: 'STRATEGY', strategy: 'conservative', rawText };
    if (clean.includes('growth')) return { type: 'STRATEGY', strategy: 'growth', rawText };
    if (clean.includes('balanced')) return { type: 'STRATEGY', strategy: 'balanced', rawText };
  }

  // Deposit intent
  if (clean.startsWith('deposit') || clean.includes('add money') || clean.includes('put in')) {
    const amountMatch = clean.match(/(\d+(\.\d+)?)/);
    const amount = amountMatch ? parseFloat(amountMatch[1]) : undefined;

    let strategy: 'conservative' | 'balanced' | 'growth' | undefined = undefined;
    if (clean.includes('conservative')) strategy = 'conservative';
    if (clean.includes('growth')) strategy = 'growth';
    if (clean.includes('balanced')) strategy = 'balanced';

    return { type: 'DEPOSIT', amount, strategy, rawText };
  }

  // Withdraw intent
  if (clean.startsWith('withdraw') || clean.includes('take out') || clean.includes('cash out')) {
    if (clean.includes('all') || clean.includes('everything')) {
      return { type: 'WITHDRAW', withdrawAll: true, rawText };
    }
    const amountMatch = clean.match(/(\d+(\.\d+)?)/);
    const amount = amountMatch ? parseFloat(amountMatch[1]) : undefined;
    return { type: 'WITHDRAW', amount, withdrawAll: false, rawText };
  }

  return { type: 'UNKNOWN', rawText };
}
